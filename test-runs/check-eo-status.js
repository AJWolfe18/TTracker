// check-eo-status.js
// Check the current status of executive orders spicy translations

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

console.log('🔍 CHECKING EXECUTIVE ORDERS STATUS');
console.log('=====================================\n');
console.log(`📍 Environment: ${isTestBranch ? 'TEST' : 'PRODUCTION'} database\n`);

try {
    // Get total count of executive orders
    const totalOrders = await supabaseRequest('executive_orders?select=id&limit=1000');
    console.log(`📊 Total Executive Orders: ${totalOrders.length}`);
    
    // Get orders with spicy summaries
    const withSpicy = await supabaseRequest('executive_orders?spicy_summary=not.is.null&select=id');
    console.log(`✅ With Spicy Translations: ${withSpicy.length}`);
    
    // Get orders without spicy summaries
    const withoutSpicy = await supabaseRequest('executive_orders?spicy_summary=is.null&select=id,title,order_number&limit=5');
    console.log(`❌ Without Spicy Translations: ${totalOrders.length - withSpicy.length}`);
    
    // Check for eo_impact_type field
    const withImpactType = await supabaseRequest('executive_orders?eo_impact_type=not.is.null&select=id');
    console.log(`🎯 With EO Impact Type: ${withImpactType.length}\n`);
    
    // Show sample of orders without spicy summaries
    if (withoutSpicy.length > 0) {
        console.log('📝 Sample orders needing translations:');
        withoutSpicy.slice(0, 5).forEach(order => {
            console.log(`   - [${order.order_number || 'No Number'}] ${order.title.substring(0, 50)}...`);
        });
    }
    
    // Get a sample order with spicy summary to verify format
    const sampleWithSpicy = await supabaseRequest('executive_orders?spicy_summary=not.is.null&select=order_number,title,spicy_summary,eo_impact_type,severity_label_inapp&limit=1');
    if (sampleWithSpicy && sampleWithSpicy.length > 0) {
        console.log('\n✨ Sample translated order:');
        const sample = sampleWithSpicy[0];
        console.log(`   Order: ${sample.order_number}`);
        console.log(`   Title: ${sample.title.substring(0, 50)}...`);
        console.log(`   Impact Type: ${sample.eo_impact_type || 'Not set'}`);
        console.log(`   Label: ${sample.severity_label_inapp || 'Not set'}`);
        console.log(`   Spicy: "${sample.spicy_summary.substring(0, 100)}..."`);
    }
    
} catch (error) {
    console.error('❌ Error checking status:', error.message);
    process.exit(1);
}

console.log('\n✅ Status check complete!');
