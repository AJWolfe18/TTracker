// backfill-executive-spicy.js
// Adds spicy translations to existing executive orders that don't have them
// EXACTLY matches the structure of backfill-political-spicy.js

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

// Load environment variables from .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

// Detect which branch we're on and use appropriate config
const isTestBranch = fs.existsSync(join(__dirname, '..', 'TEST_BRANCH_MARKER.md'));
const configPath = isTestBranch ? '../config/supabase-config-test.js' : '../config/supabase-config-node.js';
const { supabaseRequest } = await import(configPath);

import { generateEOTranslation } from './spicy-eo-translator.js';

console.log('🔥 EXECUTIVE ORDERS SPICY TRANSLATION BACKFILL');
console.log('==============================================\n');

// Show which environment we're using
console.log(`📍 Environment: ${isTestBranch ? 'TEST' : 'PRODUCTION'} database\n`);

// Verify API key is loaded
if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not found!');
    console.error('   Please ensure .env file exists with: OPENAI_API_KEY=sk-...');
    process.exit(1);
}
console.log('✅ OpenAI API key loaded\n');

// Command line arguments
const args = process.argv.slice(2);
const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 10;
const autoConfirm = args.includes('--yes');
const dryRun = args.includes('--dry-run');

console.log('📊 Configuration:');
console.log(`   Limit: ${limit} orders`);
console.log(`   Auto-confirm: ${autoConfirm}`);
console.log(`   Dry run: ${dryRun}\n`);

async function getOrdersWithoutSpicyTranslations(limit) {
    try {
        // Get orders that don't have spicy translations yet
        // Note: Production doesn't have 'description' column, only test does
        const columns = isTestBranch ? 
            'id,order_number,title,summary,description,date' : 
            'id,order_number,title,summary,date';
        const query = `executive_orders?spicy_summary=is.null&limit=${limit}&order=date.desc&select=${columns}`;
        const orders = await supabaseRequest(query);
        
        if (!orders || orders.length === 0) {
            console.log('✅ All executive orders already have spicy translations!');
            return [];
        }
        
        console.log(`📜 Found ${orders.length} executive orders without spicy translations`);
        return orders;
        
    } catch (error) {
        console.error('❌ Error fetching orders:', error.message);
        return [];
    }
}

async function updateOrder(order) {
    try {
        // Generate spicy translation using GPT-5
        const translation = await generateEOTranslation({
            title: order.title,
            summary: order.summary,
            description: order.description // May be undefined in production
        });
        
        // Check if generation was successful
        if (!translation) {
            throw new Error('Spicy translation generation returned null');
        }
        
        // Update the order in the database
        const updateData = {
            eo_impact_type: translation.eo_impact_type,
            spicy_summary: translation.spicy_summary,
            shareable_hook: translation.shareable_hook,
            severity_label_inapp: translation.severity_label_inapp,
            severity_label_share: translation.severity_label_share
            // Note: EOs don't have editorial_summary - they use 'summary' field
        };
        
        if (!dryRun) {
            await supabaseRequest(`executive_orders?id=eq.${order.id}`, 'PATCH', updateData);
        }
        
        return { success: true, data: translation };
        
    } catch (error) {
        console.error(`   ❌ Error updating order ${order.id}:`, error.message);
        return { success: false, error: error.message };
    }
}

async function main() {
    try {
        // Get orders without spicy translations
        const orders = await getOrdersWithoutSpicyTranslations(limit);
        
        if (orders.length === 0) {
            console.log('\n✨ No orders to process!');
            return;
        }
        
        // Show what we're about to do
        console.log('\n📋 Orders to process:');
        orders.forEach((order, idx) => {
            console.log(`   ${idx + 1}. [${order.date}] ${order.title.substring(0, 60)}...`);
        });
        
        // Calculate cost (average between GPT-5 and GPT-5-mini)
        const estimatedCost = orders.length * 0.00075;
        console.log(`\n💰 Estimated cost: $${estimatedCost.toFixed(4)}`);
        
        // Confirm if not auto-confirmed
        if (!autoConfirm && !dryRun) {
            console.log('\n⚠️  Press Ctrl+C to cancel, or wait 5 seconds to continue...');
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
        if (dryRun) {
            console.log('\n🔍 DRY RUN MODE - No changes will be made\n');
        } else {
            console.log('\n🚀 Starting backfill...\n');
        }
        
        // Process each order
        let successCount = 0;
        let failCount = 0;
        let totalCost = 0;
        
        for (let i = 0; i < orders.length; i++) {
            const order = orders[i];
            console.log(`\n[${i + 1}/${orders.length}] Processing: ${order.title.substring(0, 60)}...`);
            
            const result = await updateOrder(order);
            
            if (result.success) {
                successCount++;
                totalCost += result.data.processing_cost || 0.00075;
                console.log(`   ✅ Success!`);
                console.log(`   📊 Impact: ${result.data.eo_impact_type}`);
                if (result.data.spicy_summary) {
                    console.log(`   📝 Translation: "${result.data.spicy_summary.substring(0, 100)}..."`);
                }
                if (result.data.shareable_hook) {
                    console.log(`   📱 Hook: "${result.data.shareable_hook}"`);
                }
                if (result.data.severity_label_inapp) {
                    console.log(`   🏷️  In-app: ${result.data.severity_label_inapp}`);
                }
                if (result.data.severity_label_share) {
                    console.log(`   🏷️  Share: ${result.data.severity_label_share}`);
                }
            } else {
                failCount++;
                console.log(`   ❌ Failed: ${result.error}`);
            }
            
            // Add small delay to avoid rate limiting
            if (!dryRun && i < orders.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        // Summary
        console.log('\n' + '='.repeat(50));
        console.log('📊 BACKFILL COMPLETE\n');
        console.log(`   Processed: ${orders.length} orders`);
        console.log(`   Success: ${successCount}`);
        console.log(`   Failed: ${failCount}`);
        console.log(`   Total cost: $${totalCost.toFixed(4)}`);
        console.log(`   Database: ${isTestBranch ? 'TEST' : 'PRODUCTION'}`);
        
        if (dryRun) {
            console.log('\n   (This was a dry run - no changes were made)');
        }
        
    } catch (error) {
        console.error('\n❌ Fatal error:', error.message);
        process.exit(1);
    }
}

// Run the backfill
main();
