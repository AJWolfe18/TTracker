// rerun-first-50-eos.js
// Re-runs spicy translations for the FIRST 50 executive orders (by order_number)
// Can OVERWRITE existing spicy summaries to improve quality
// Based on backfill-executive-spicy.js but targets specific orders

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

console.log('🔥 RE-RUN FIRST 50 EXECUTIVE ORDERS SPICY TRANSLATIONS');
console.log('======================================================\n');

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
const autoConfirm = args.includes('--yes');
const dryRun = args.includes('--dry-run');
const skipExisting = args.includes('--skip-existing'); // Skip orders that already have summaries

console.log('📊 Configuration:');
console.log(`   Target: First 50 Executive Orders`);
console.log(`   Auto-confirm: ${autoConfirm}`);
console.log(`   Dry run: ${dryRun}`);
console.log(`   Skip existing: ${skipExisting}\n`);

async function getFirst50Orders() {
    try {
        // Get first 50 orders by order_number (ascending)
        const columns = isTestBranch ? 
            'id,order_number,title,summary,description,date,spicy_summary' : 
            'id,order_number,title,summary,date,spicy_summary';
        
        // Get orders 1-50 specifically
        const query = `executive_orders?order_number=lte.50&order=order_number.asc&select=${columns}`;
        const orders = await supabaseRequest(query);
        
        if (!orders || orders.length === 0) {
            console.log('❌ No executive orders found!');
            return [];
        }
        
        // Filter based on skipExisting flag
        let targetOrders = orders;
        if (skipExisting) {
            targetOrders = orders.filter(o => !o.spicy_summary);
            console.log(`📜 Found ${orders.length} orders (1-50), ${targetOrders.length} without spicy translations`);
        } else {
            const withSummaries = orders.filter(o => o.spicy_summary).length;
            console.log(`📜 Found ${orders.length} orders (1-50), ${withSummaries} already have translations`);
            if (withSummaries > 0) {
                console.log(`   ⚠️  Will OVERWRITE existing translations!`);
            }
        }
        
        return targetOrders;
        
    } catch (error) {
        console.error('❌ Error fetching orders:', error.message);
        return [];
    }
}

async function updateOrder(order) {
    try {
        // Show if we're overwriting
        if (order.spicy_summary) {
            console.log(`   ♻️  Overwriting existing translation...`);
        }
        
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
        // Get first 50 orders
        const orders = await getFirst50Orders();
        
        if (orders.length === 0) {
            console.log('\n✨ No orders to process!');
            return;
        }
        
        // Show what we're about to do
        console.log('\n📋 Orders to process:');
        orders.forEach((order, idx) => {
            const hasExisting = order.spicy_summary ? ' [HAS EXISTING]' : '';
            console.log(`   ${idx + 1}. EO ${order.order_number}: ${order.title.substring(0, 50)}...${hasExisting}`);
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
            console.log('\n🚀 Starting re-run for first 50 EOs...\n');
        }
        
        // Process each order
        let successCount = 0;
        let failCount = 0;
        let overwriteCount = 0;
        let totalCost = 0;
        
        for (let i = 0; i < orders.length; i++) {
            const order = orders[i];
            console.log(`\n[${i + 1}/${orders.length}] Processing EO ${order.order_number}: ${order.title.substring(0, 50)}...`);
            
            if (order.spicy_summary) {
                overwriteCount++;
            }
            
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
        console.log('📊 RE-RUN COMPLETE\n');
        console.log(`   Processed: ${orders.length} orders`);
        console.log(`   Success: ${successCount}`);
        console.log(`   Overwritten: ${overwriteCount}`);
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

// Run the re-run
main();
