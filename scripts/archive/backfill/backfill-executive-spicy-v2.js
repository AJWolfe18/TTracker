// backfill-executive-spicy-v2.js
// Specialized backfill for Executive Orders using the new translation system
// Uses eo_impact_type field instead of severity mapping

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

// Detect which branch we're on and use appropriate config
const isTestBranch = fs.existsSync(join(__dirname, '..', 'TEST_BRANCH_MARKER.md'));
const configPath = isTestBranch ? '../config/supabase-config-test.js' : '../config/supabase-config-node.js';
const { supabaseRequest } = await import(configPath);

import { generateSpicyEOTranslation, calculateCost } from './spicy-eo-translator.js';

console.log('🔥 EXECUTIVE ORDERS SPICY TRANSLATION BACKFILL V2');
console.log('==================================================\n');
console.log('📍 Using EO-specific impact categorization');
console.log(`📍 Environment: ${isTestBranch ? 'TEST' : 'PRODUCTION'} database\n`);

// Verify API key
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
        // Get orders that don't have spicy summaries yet
        const query = `executive_orders?spicy_summary=is.null&limit=${limit}&order=date.desc&select=id,order_number,title,summary,date,document_number`;
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
        console.log(`\n[${order.order_number}] Processing: ${order.title.substring(0, 60)}...`);
        
        // Generate the spicy EO translation
        const translation = await generateSpicyEOTranslation({
            title: order.title,
            summary: order.summary,
            order_number: order.order_number,
            federal_register_number: order.document_number
        });
        
        console.log(`  🎯 Impact Type: ${translation.eo_impact_type}`);
        console.log(`  💰 Cost: $${calculateCost(translation.eo_impact_type).toFixed(5)}`);
        
        if (dryRun) {
            console.log('  🔍 DRY RUN - Would update with:');
            console.log(`     Impact: ${translation.severity_label_inapp}`);
            console.log(`     Translation: "${translation.spicy_summary.substring(0, 100)}..."`);
            console.log(`     Hook: "${translation.shareable_hook}"`);
            return { success: true, cost: calculateCost(translation.eo_impact_type) };
        }
        
        // Update the database with new fields
        const updateData = {
            eo_impact_type: translation.eo_impact_type,
            spicy_summary: translation.spicy_summary,
            shareable_hook: translation.shareable_hook,
            severity_label_inapp: translation.severity_label_inapp,
            severity_label_share: translation.severity_label_share,
            editorial_summary: order.summary // Keep original as editorial_summary
        };
        
        await supabaseRequest(
            `executive_orders?id=eq.${order.id}`,
            'PATCH',
            updateData
        );
        
        console.log('  ✅ Success!');
        console.log(`  📊 Impact: ${translation.severity_label_inapp}`);
        console.log(`  📝 Translation: "${translation.spicy_summary.substring(0, 150)}..."`);
        console.log(`  📱 Hook: "${translation.shareable_hook}"`);
        
        return { success: true, cost: calculateCost(translation.eo_impact_type) };
        
    } catch (error) {
        console.error(`  ❌ Error updating order ${order.order_number}:`, error.message);
        return { success: false, cost: 0 };
    }
}

async function main() {
    try {
        // Get orders needing translations
        const orders = await getOrdersWithoutSpicyTranslations(limit);
        
        if (orders.length === 0) {
            console.log('\n✨ No orders need processing!');
            return;
        }
        
        // Show what will be processed
        console.log('\n📋 Orders to process:');
        orders.slice(0, 5).forEach((order, i) => {
            console.log(`   ${i + 1}. EO ${order.order_number}: ${order.title.substring(0, 50)}...`);
        });
        if (orders.length > 5) {
            console.log(`   ... and ${orders.length - 5} more`);
        }
        
        // Estimate cost
        const estimatedCost = orders.length * 0.00054; // Using gpt-5-mini
        console.log(`\n💵 Estimated cost: $${estimatedCost.toFixed(2)}`);
        
        // Confirm before proceeding
        if (!autoConfirm && !dryRun) {
            console.log('\n⚠️  This will update the PRODUCTION database!');
            console.log('Type "yes" to continue or Ctrl+C to cancel:');
            
            const readline = require('readline').createInterface({
                input: process.stdin,
                output: process.stdout
            });
            
            const answer = await new Promise(resolve => {
                readline.question('', resolve);
            });
            readline.close();
            
            if (answer.toLowerCase() !== 'yes') {
                console.log('❌ Cancelled');
                return;
            }
        }
        
        // Process each order
        console.log('\n' + '='.repeat(50));
        console.log('Starting processing...\n');
        
        let processed = 0;
        let succeeded = 0;
        let failed = 0;
        let totalCost = 0;
        
        for (const order of orders) {
            processed++;
            console.log(`[${processed}/${orders.length}] Processing: ${order.title.substring(0, 50)}...`);
            
            const result = await updateOrder(order);
            
            if (result.success) {
                succeeded++;
                totalCost += result.cost;
            } else {
                failed++;
            }
            
            // Rate limiting - 500ms between requests
            if (processed < orders.length) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            console.log('='.repeat(50));
        }
        
        // Summary
        console.log('\n📊 BACKFILL COMPLETE');
        console.log(`   Processed: ${processed} orders`);
        console.log(`   Success: ${succeeded}`);
        console.log(`   Failed: ${failed}`);
        console.log(`   Total cost: $${totalCost.toFixed(4)}`);
        console.log(`   Database: ${isTestBranch ? 'TEST' : 'PRODUCTION'}`);
        
        if (failed > 0) {
            console.log('\n⚠️  Some orders failed. Run the script again to retry them.');
        }
        
    } catch (error) {
        console.error('\n❌ Fatal error:', error.message);
        process.exit(1);
    }
}

// Run the backfill
main();
