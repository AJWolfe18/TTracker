// backfill-executive-spicy-fixed.js
// Fixed EO backfill using fetch instead of OpenAI package

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import fetch from 'node-fetch';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

// Detect which branch we're on and use appropriate config
const isTestBranch = fs.existsSync(join(__dirname, '..', 'TEST_BRANCH_MARKER.md'));
const configPath = isTestBranch ? '../config/supabase-config-test.js' : '../config/supabase-config-node.js';
const { supabaseRequest } = await import(configPath);

console.log('🔥 EXECUTIVE ORDERS SPICY TRANSLATION BACKFILL');
console.log('==============================================\n');
console.log(`📍 Environment: ${isTestBranch ? 'TEST' : 'PRODUCTION'} database\n`);

// Check API key
if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not found in .env file!');
    process.exit(1);
}
console.log('✅ OpenAI API key loaded\n');

// Command line arguments
const args = process.argv.slice(2);
const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 10;
const autoConfirm = args.includes('--yes');

console.log('📊 Configuration:');
console.log(`   Limit: ${limit} orders`);
console.log(`   Auto-confirm: ${autoConfirm}\n`);

// EO Impact categories (different from article severities)
const impactCategories = {
    'fascist_power_grab': {
        inapp: 'Fascist Power Grab 🔴',
        share: 'Fascist Overreach'
    },
    'authoritarian_overreach': {
        inapp: 'Authoritarian Overreach 🟠',
        share: 'Authoritarian Control'
    },
    'corrupt_grift': {
        inapp: 'Corrupt Grift 🟡',
        share: 'Corruption'
    },
    'performative_bullshit': {
        inapp: 'Performative Bullshit 🟢',
        share: 'Political Theater'
    }
};

async function callOpenAI(prompt) {
    const apiUrl = 'https://api.openai.com/v1/chat/completions';
    
    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.8,
                max_tokens: 500,
                response_format: { type: "json_object" }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        return JSON.parse(data.choices[0].message.content);
        
    } catch (error) {
        console.error('❌ API call failed:', error.message);
        return null;
    }
}

async function generateEOTranslation(order) {
    const prompt = `You are analyzing Executive Order "${order.title}" for TrumpyTracker.

This EO: ${order.summary || order.description || 'No description available'}

Your job is to expose what this order is REALLY designed to do - the authoritarian agenda behind the bureaucratic language.

Categorize this order's impact:
- fascist_power_grab: Dismantling democracy, eliminating oversight, seizing unconstitutional power
- authoritarian_overreach: Expanding surveillance, crushing dissent, militarizing government  
- corrupt_grift: Self-dealing, cronyism, funneling money to allies
- performative_bullshit: Meaningless culture war theater, distraction tactics

Write a translation that:
1. Exposes the REAL purpose in plain, angry language
2. Explains WHO benefits and WHO gets screwed
3. Connects to the broader authoritarian pattern
4. Sounds like you're warning a friend at a bar

Respond with JSON only:
{
  "eo_impact_type": "one of the categories above",
  "spicy_summary": "2-3 sentences exposing the real agenda. Be angry but accurate.",
  "shareable_hook": "One punchy sentence (under 200 chars) for social media"
}`;

    const result = await callOpenAI(prompt);
    
    if (result && result.eo_impact_type) {
        // Add the display labels
        const category = impactCategories[result.eo_impact_type] || impactCategories['performative_bullshit'];
        result.severity_label_inapp = category.inapp;
        result.severity_label_share = category.share;
    }
    
    return result;
}

async function processOrders() {
    try {
        // Get orders without spicy summaries
        const query = `executive_orders?spicy_summary=is.null&limit=${limit}&order=date.desc&select=id,order_number,title,summary,description,date`;
        const orders = await supabaseRequest(query);
        
        if (!orders || orders.length === 0) {
            console.log('✅ All executive orders already have spicy translations!');
            return;
        }
        
        console.log(`📜 Found ${orders.length} orders to process\n`);
        
        // Process confirmation
        if (!autoConfirm) {
            console.log('⏱️ Starting in 5 seconds... (Press Ctrl+C to cancel)');
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
        let processed = 0;
        let failed = 0;
        let totalCost = 0;
        
        for (const order of orders) {
            try {
                console.log(`\n[${processed + 1}/${orders.length}] Processing: ${order.title.substring(0, 60)}...`);
                
                const translation = await generateEOTranslation(order);
                
                if (!translation) {
                    console.log('  ⚠️ Failed to generate translation');
                    failed++;
                    continue;
                }
                
                console.log(`  🎯 Impact: ${translation.severity_label_inapp}`);
                console.log(`  💭 Hook: "${translation.shareable_hook}"`);
                
                // Update the database
                const updateData = {
                    eo_impact_type: translation.eo_impact_type,
                    spicy_summary: translation.spicy_summary,
                    shareable_hook: translation.shareable_hook,
                    severity_label_inapp: translation.severity_label_inapp,
                    severity_label_share: translation.severity_label_share
                };
                
                // Keep original summary as editorial_summary if not already set
                if (!order.editorial_summary && (order.summary || order.description)) {
                    updateData.editorial_summary = order.summary || order.description;
                }
                
                await supabaseRequest(
                    `executive_orders?id=eq.${order.id}`,
                    'PATCH',
                    updateData
                );
                
                console.log('  ✅ Updated successfully');
                processed++;
                totalCost += 0.00075; // Approximate cost for gpt-4o-mini
                
                // Rate limiting - 500ms between calls
                await new Promise(resolve => setTimeout(resolve, 500));
                
            } catch (error) {
                console.error(`  ❌ Error: ${error.message}`);
                failed++;
            }
        }
        
        console.log('\n' + '='.repeat(50));
        console.log('📊 BACKFILL COMPLETE');
        console.log(`✅ Processed: ${processed} orders`);
        console.log(`❌ Failed: ${failed} orders`);
        console.log(`💰 Estimated cost: $${totalCost.toFixed(4)}`);
        
    } catch (error) {
        console.error('❌ Fatal error:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

// Run the backfill
processOrders().catch(console.error);
