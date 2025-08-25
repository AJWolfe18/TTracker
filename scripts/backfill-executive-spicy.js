// backfill-executive-spicy.js
// Adds spicy summaries to existing executive orders that don't have them
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

import { generateSpicySummary } from './spicy-summaries-integration.js';

console.log('🔥 EXECUTIVE ORDERS SPICY SUMMARIES BACKFILL');
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

// Map old severity values to new ones
function mapSeverity(oldSeverity) {
    // Direct mapping - critical stays critical, high becomes severe
    const mapping = {
        'critical': 'critical',  // Keep critical as critical
        'high': 'severe',        // High maps to severe
        'medium': 'moderate',    // Medium maps to moderate
        'low': 'minor'          // Low maps to minor
    };
    return mapping[oldSeverity] || oldSeverity; // If already new format, keep it
}

async function getOrdersWithoutSpicySummaries(limit) {
    try {
        // Get orders that don't have spicy summaries yet
        const query = `executive_orders?spicy_summary=is.null&limit=${limit}&order=order_number.desc&select=id,order_number,title,summary,severity_rating,date`;
        const orders = await supabaseRequest(query);
        
        if (!orders || orders.length === 0) {
            console.log('✅ All executive orders already have spicy summaries!');
            return [];
        }
        
        console.log(`📜 Found ${orders.length} executive orders without spicy summaries`);
        return orders;
        
    } catch (error) {
        console.error('❌ Error fetching orders:', error.message);
        return [];
    }
}

async function updateOrder(order) {
    try {
        // Map severity from old format to new format
        const mappedSeverity = mapSeverity(order.severity_rating || 'medium');
        
        // Generate spicy summary
        const spicyEnhanced = await generateSpicySummary({
            title: order.title,
            description: order.summary,
            severity: mappedSeverity
        });
        
        // Check if generation was successful
        if (!spicyEnhanced) {
            throw new Error('Spicy summary generation returned null');
        }
        
        // Update the order in the database
        const updateData = {
            spicy_summary: spicyEnhanced.spicy_summary,
            shareable_hook: spicyEnhanced.shareable_hook,
            severity_label_inapp: spicyEnhanced.severity_label_inapp,
            severity_label_share: spicyEnhanced.severity_label_share,
            // Also update severity_rating to new format if needed
            severity_rating: spicyEnhanced.severity
        };
        
        if (!dryRun) {
            await supabaseRequest(`executive_orders?id=eq.${order.id}`, 'PATCH', updateData);
        }
        
        return { success: true, data: spicyEnhanced };
        
    } catch (error) {
        console.error(`   ❌ Error updating order ${order.order_number}:`, error.message);
        return { success: false, error: error.message };
    }
}

async function main() {
    try {
        // Get orders without spicy summaries
        const orders = await getOrdersWithoutSpicySummaries(limit);
        
        if (orders.length === 0) {
            console.log('\n✨ No orders to process!');
            return;
        }
        
        // Show what we're about to do
        console.log('\n📋 Orders to process:');
        orders.forEach((order, idx) => {
            console.log(`   ${idx + 1}. EO ${order.order_number}: ${order.title.substring(0, 60)}...`);
        });
        
        // Calculate cost
        const estimatedCost = orders.length * 0.00075; // Average cost per order
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
            console.log(`\n[${i + 1}/${orders.length}] Processing EO ${order.order_number}: ${order.title.substring(0, 50)}...`);
            console.log(`   Original severity: ${order.severity_rating} → Mapped: ${mapSeverity(order.severity_rating || 'medium')}`);
            
            const result = await updateOrder(order);
            
            if (result.success) {
                successCount++;
                totalCost += 0.00075; // Track actual cost
                console.log(`   ✅ Success!`);
                console.log(`   📊 New severity: ${result.data.severity}`);
                if (result.data.shareable_hook) {
                    console.log(`   📱 Hook: "${result.data.shareable_hook}"`);
                }
                if (result.data.severity_label_inapp) {
                    console.log(`   🏷️ In-app: ${result.data.severity_label_inapp}`);
                }
                if (result.data.severity_label_share) {
                    console.log(`   🏷️ Share: ${result.data.severity_label_share}`);
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
