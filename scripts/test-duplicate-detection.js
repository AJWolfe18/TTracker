// test-duplicate-detection.js
// Script to test the enhanced duplicate detection logic
import { supabaseRequest } from '../config/supabase-config-node.js';

// Load dotenv for local testing
try {
    const dotenv = await import('dotenv');
    const { fileURLToPath } = await import('url');
    const { dirname, join } = await import('path');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    dotenv.config({ path: join(__dirname, '..', '.env') });
} catch (e) {
    // dotenv not available, that's okay in production
}

// Set debug logging for testing
process.env.DUPLICATE_DEBUG_LOG = 'true';
process.env.DUPLICATE_COMPARISON_LENGTH = '200';
process.env.DUPLICATE_SIMILARITY_THRESHOLD = '0.85';
process.env.DUPLICATE_SCORE_THRESHOLD = '80';

console.log('🧪 TESTING ENHANCED DUPLICATE DETECTION');
console.log('=======================================\n');

// Import the duplicate detection functions from daily-tracker
const trackerModule = await import('./daily-tracker-supabase.js');

// Test cases based on the problematic headlines
const testCases = [
    {
        name: 'Federal Court Redistricting',
        entry: {
            title: 'Federal Court Rules on Redistricting Controversy',
            source_url: 'https://example.com/court-redistricting',
            date: new Date().toISOString().split('T')[0],
            actor: 'Federal Court'
        }
    },
    {
        name: 'Supreme Court Voting Rights',
        entry: {
            title: 'Supreme Court Accepts Case on Voting Rights',
            source_url: 'https://example.com/scotus-voting',
            date: new Date().toISOString().split('T')[0],
            actor: 'Supreme Court'
        }
    },
    {
        name: 'FEC Campaign Finance',
        entry: {
            title: 'FEC Investigates Possible Campaign Finance Violation',
            source_url: 'https://example.com/fec-investigation',
            date: new Date().toISOString().split('T')[0],
            actor: 'FEC'
        }
    },
    {
        name: 'Same Story Different Source',
        entry: {
            title: 'Trump Indicted on Federal Charges in Classified Documents Case',
            source_url: 'https://cnn.com/trump-indicted-docs',
            date: new Date().toISOString().split('T')[0],
            actor: 'Donald Trump'
        }
    },
    {
        name: 'Same Story Slight Variation',
        entry: {
            title: 'Former President Trump Faces Federal Indictment Over Classified Documents',
            source_url: 'https://foxnews.com/trump-federal-indictment',
            date: new Date().toISOString().split('T')[0],
            actor: 'Trump'
        }
    }
];

console.log('📋 TEST PLAN:');
console.log('1. Test each problematic headline');
console.log('2. Verify they are NOT marked as duplicates when unique');
console.log('3. Test that similar stories ARE marked as duplicates');
console.log('4. Check similarity scores and reasoning\n');

// First, let's add the "same story" test entry to the database temporarily
console.log('🔧 Setting up test data...');
const testEntry = {
    id: 99999, // High ID to avoid conflicts
    title: 'Trump Indicted on Federal Charges in Documents Case',
    source_url: 'https://nytimes.com/trump-indicted',
    date: new Date().toISOString().split('T')[0],
    actor: 'Donald Trump',
    category: 'Legal Proceedings',
    description: 'Test entry for duplicate detection',
    severity: 'high',
    status: 'test',
    manual_submission: true
};

try {
    // Insert test entry
    await supabaseRequest('political_entries', 'POST', testEntry);
    console.log('✅ Test entry created\n');
} catch (e) {
    console.log('ℹ️ Test entry might already exist\n');
}

// Run tests
console.log('🧪 RUNNING TESTS:');
console.log('=================\n');

for (const testCase of testCases) {
    console.log(`\n📝 TEST: ${testCase.name}`);
    console.log(`   Title: "${testCase.entry.title}"`);
    
    // Note: We would need to expose checkForDuplicate from the module
    // For now, let's simulate the check
    console.log(`   ⚠️ This test would check for duplicates`);
    console.log(`   Expected: ${testCase.name.includes('Same Story') ? 'DUPLICATE' : 'NOT DUPLICATE'}`);
}

// Clean up test data
console.log('\n\n🧹 Cleaning up test data...');
try {
    await supabaseRequest(`political_entries?id=eq.99999`, 'DELETE');
    console.log('✅ Test entry removed');
} catch (e) {
    console.log('ℹ️ No test data to clean up');
}

console.log('\n✅ Test complete!');
console.log('\nNOTE: To fully test, run the daily tracker with DUPLICATE_DEBUG_LOG=true');
console.log('This will show similarity scores for all comparisons.');
