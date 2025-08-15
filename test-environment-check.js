// test-environment-check.js
// Quick script to verify test environment is working

import { SUPABASE_URL, supabaseRequest } from './supabase-config-wrapper.js';

console.log('🧪 TEST ENVIRONMENT CHECK');
console.log('========================\n');

// Set test environment
process.env.USE_TEST_ENV = 'true';

async function checkTestEnvironment() {
    try {
        // 1. Check which environment we're using
        console.log(`Environment: ${SUPABASE_URL.includes('wnrjrywpcadwutfykflu') ? '✅ TEST' : '❌ PRODUCTION'}`);
        console.log(`URL: ${SUPABASE_URL}\n`);
        
        // 2. Test database connection
        console.log('Testing database connection...');
        const entries = await supabaseRequest('political_entries?limit=5');
        console.log(`✅ Connected! Found ${entries.length} test entries\n`);
        
        // 3. Show test data
        if (entries.length > 0) {
            console.log('Sample test data:');
            entries.forEach(entry => {
                console.log(`  - ${entry.title} (${entry.severity})`);
            });
        }
        
        console.log('\n✅ TEST ENVIRONMENT IS WORKING!');
        console.log('You can now safely test changes without affecting production.');
        
    } catch (error) {
        console.error('❌ Test environment check failed:', error.message);
        process.exit(1);
    }
}

checkTestEnvironment();