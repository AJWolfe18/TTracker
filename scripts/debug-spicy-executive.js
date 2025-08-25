// debug-spicy-executive.js
// Debug script to see what's happening with executive order spicy summaries
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

import { generateSpicySummary } from './spicy-summaries-integration.js';

console.log('🔍 DEBUG: Executive Order Spicy Summary Generation');
console.log('==================================================\n');
console.log(`📍 Environment: ${isTestBranch ? 'TEST' : 'PRODUCTION'} database\n`);

// Test with a sample executive order
const testOrder = {
    title: "Executive Order on Protecting Critical Infrastructure",
    description: "This order directs federal agencies to assess vulnerabilities in critical infrastructure and implement enhanced security measures within 90 days.",
    severity: "moderate"
};

console.log('📜 Test Executive Order:');
console.log(`   Title: ${testOrder.title}`);
console.log(`   Description: ${testOrder.description}`);
console.log(`   Severity: ${testOrder.severity}\n`);

console.log('🌶️ Generating spicy summary...\n');

const result = await generateSpicySummary(testOrder);

if (result) {
    console.log('✅ Generation successful!\n');
    console.log('📊 Full result object:');
    console.log(JSON.stringify(result, null, 2));
    
    console.log('\n🔍 Checking specific fields:');
    console.log(`   spicy_summary exists: ${result.spicy_summary ? 'YES' : 'NO'}`);
    console.log(`   spicy_summary length: ${result.spicy_summary ? result.spicy_summary.length : 0}`);
    console.log(`   shareable_hook exists: ${result.shareable_hook ? 'YES' : 'NO'}`);
    console.log(`   severity_label_inapp: ${result.severity_label_inapp || 'MISSING'}`);
    console.log(`   severity_label_share: ${result.severity_label_share || 'MISSING'}`);
    
    if (result.spicy_summary) {
        console.log('\n📝 Spicy Summary Content:');
        console.log('   ', result.spicy_summary);
    } else {
        console.log('\n❌ PROBLEM: spicy_summary is missing!');
    }
    
    if (result.shareable_hook) {
        console.log('\n📱 Shareable Hook:');
        console.log('   ', result.shareable_hook);
    }
} else {
    console.log('❌ Generation failed - returned null');
}

// Now check what's actually in the database
console.log('\n\n📊 Checking Database for Executive Orders with hooks but no summaries:');

const ordersWithIssue = await supabaseRequest(
    'executive_orders?shareable_hook=not.is.null&spicy_summary=is.null&limit=5&select=order_number,title,spicy_summary,shareable_hook'
);

if (ordersWithIssue && ordersWithIssue.length > 0) {
    console.log(`\n⚠️ Found ${ordersWithIssue.length} orders with hooks but no spicy summaries:`);
    ordersWithIssue.forEach((order, idx) => {
        console.log(`\n   ${idx + 1}. EO ${order.order_number}: ${order.title}`);
        console.log(`      Hook: "${order.shareable_hook}"`);
        console.log(`      Spicy Summary: ${order.spicy_summary || 'NULL'}`);
    });
    
    console.log('\n🔧 This indicates the spicy_summary field is not being saved properly!');
} else {
    console.log('\n✅ No issues found - all orders with hooks also have summaries');
}
