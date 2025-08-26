// backfill-executive-spicy-simple.js
// Simplified EO backfill matching political entries structure

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import OpenAI from 'openai';

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

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

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

async function generateEOTranslation(order) {
    const prompt = `You are analyzing Executive Order "${order.title}" for TrumpyTracker.

This EO: ${order.summary || order.description || 'No description available'}

Your job is to expose what this order is REALLY designed to do - the authoritarian agenda behind the bureaucratic language.

Categorize this order's impact:
- fascist_power_grab: Dismantling democracy, eliminating oversight, seizing unconstitutional power
- authoritarian_overreach: Expanding surveillance, crushing dissent, militarizing government
- corrupt_grift: Self-dealing, cronyism, funneling money to allies
- performative_bullshit: Meaningless culture war theater, distraction tactics

Respond with JSON only:
{
  "eo_impact_type": "one of the categories above",
  "spicy_summary": "2-3 sentences exposing the real agenda behind this order. Be angry but accurate. Explain what this ACTUALLY does and why it's dangerous.",
  "shareable_hook": "One punchy sentence (under 200 chars) that captures the outrage for social media"
}`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.8,
            max_tokens: 500,
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(response.choices[0].message.content);
        
        // Add the display labels
        const category = impactCategories[result.eo_impact_type] || impactCategories['performative_bullshit'];
        result.severity_label_inapp = category.inapp;
        result.severity_label_share = category.share;
        
        return result;
    } catch (error) {
        console.error('❌ OpenAI API error:', error.message);
        return null;
    }
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
            console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...');
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
                    severity_label_share: translation.severity_label_share,
                    editorial_summary: order.summary || order.description // Keep original
                };
                
                await supabaseRequest(
                    `executive_orders?id=eq.${order.id}`,
                    'PATCH',
                    updateData
                );
                
                console.log('  ✅ Updated successfully');
                processed++;
                totalCost += 0.00075; // Approximate cost
                
                // Rate limiting
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
        process.exit(1);
    }
}

// Run the backfill
processOrders();
