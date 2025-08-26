// test-eo-backfill.js
// Simple test to debug EO backfill issues

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

console.log('🔍 DEBUGGING EO BACKFILL');
console.log('========================\n');

// Check environment
const isTestBranch = fs.existsSync(join(__dirname, '..', 'TEST_BRANCH_MARKER.md'));
console.log(`📍 Environment: ${isTestBranch ? 'TEST' : 'PRODUCTION'}`);
console.log(`📍 Test marker exists: ${isTestBranch}\n`);

// Check API key
const hasApiKey = !!process.env.OPENAI_API_KEY;
console.log(`🔑 OpenAI API Key: ${hasApiKey ? 'Found' : 'MISSING!'}`);
if (hasApiKey) {
    console.log(`   Key starts with: ${process.env.OPENAI_API_KEY.substring(0, 7)}...`);
}

// Try to import the config
try {
    const configPath = isTestBranch ? '../config/supabase-config-test.js' : '../config/supabase-config-node.js';
    console.log(`\n📁 Trying to import: ${configPath}`);
    const { supabaseRequest } = await import(configPath);
    console.log('✅ Config imported successfully');
    
    // Try to fetch one EO
    console.log('\n🔍 Testing database connection...');
    const orders = await supabaseRequest('executive_orders?limit=1&select=id,title,order_number');
    console.log(`✅ Found ${orders.length} order(s)`);
    if (orders.length > 0) {
        console.log(`   Sample: [${orders[0].order_number}] ${orders[0].title.substring(0, 50)}...`);
    }
    
} catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('Stack:', error.stack);
}

// Check if spicy translator exists
try {
    console.log('\n📁 Checking spicy-eo-translator.js...');
    const translatorPath = join(__dirname, 'spicy-eo-translator.js');
    if (fs.existsSync(translatorPath)) {
        console.log('✅ Translator file exists');
        const { generateSpicyEOTranslation } = await import('./spicy-eo-translator.js');
        console.log('✅ Translator imported successfully');
    } else {
        console.log('❌ Translator file not found at:', translatorPath);
    }
} catch (error) {
    console.error('❌ Error importing translator:', error.message);
}

console.log('\n✅ Debug complete!');
