// test-spicy-complete.js
// Complete test of spicy summaries integration for both political entries and executive orders
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { generateSpicySummary } from './spicy-summaries-integration.js';
import { supabaseRequest } from '../config/supabase-config-node.js';

// Load environment variables from .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

console.log('🔥 COMPLETE SPICY SUMMARIES TEST');
console.log('==================================\n');

// Check if API key is loaded
if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not found in .env file!');
    console.error('   Please create a .env file with: OPENAI_API_KEY=your-key-here');
    process.exit(1);
}

console.log('✅ OpenAI API key loaded from .env\n');

// Test 1: Generate spicy summary for a political article
async function testPoliticalEntry() {
    console.log('📰 TEST 1: Political Article\n');
    
    const testArticle = {
        title: "Trump Claims He Can End Ukraine War in 24 Hours",
        description: "Former President Trump stated at a campaign rally that he could end the Ukraine conflict within a day of taking office, without providing specific details on his proposed solution.",
        severity: "high"
    };
    
    console.log('Input:');
    console.log(`  Title: ${testArticle.title}`);
    console.log(`  Description: ${testArticle.description}`);
    console.log(`  Severity: ${testArticle.severity}\n`);
    
    try {
        console.log('🌶️ Generating spicy summary...\n');
        const result = await generateSpicySummary(testArticle);
        
        console.log('✅ Results:');
        console.log('\n📝 Spicy Summary:');
        console.log(`   ${result.spicy_summary}\n`);
        console.log('📱 Shareable Hook:');
        console.log(`   "${result.shareable_hook}"\n`);
        console.log('🏷️ In-App Label:', result.severity_label_inapp);
        console.log('🏷️ Share Label:', result.severity_label_share);
        
        return true;
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        return false;
    }
}

// Test 2: Generate spicy summary for an executive order
async function testExecutiveOrder() {
    console.log('\n\n📜 TEST 2: Executive Order\n');
    
    const testOrder = {
        title: "Executive Order on Eliminating Diversity Programs in Federal Government",
        description: "This order directs all federal agencies to terminate diversity, equity, and inclusion programs and reassign personnel to other duties within 60 days.",
        severity: "high"
    };
    
    console.log('Input:');
    console.log(`  Title: ${testOrder.title}`);
    console.log(`  Description: ${testOrder.description}`);
    console.log(`  Severity: ${testOrder.severity}\n`);
    
    try {
        console.log('🌶️ Generating spicy summary...\n');
        const result = await generateSpicySummary(testOrder);
        
        console.log('✅ Results:');
        console.log('\n📝 Spicy Summary:');
        console.log(`   ${result.spicy_summary}\n`);
        console.log('📱 Shareable Hook:');
        console.log(`   "${result.shareable_hook}"\n`);
        console.log('🏷️ In-App Label:', result.severity_label_inapp);
        console.log('🏷️ Share Label:', result.severity_label_share);
        
        return true;
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        return false;
    }
}

// Test 3: Check database columns exist
async function testDatabaseColumns() {
    console.log('\n\n🗄️ TEST 3: Database Columns Check\n');
    
    try {
        // Check political_entries table
        console.log('Checking political_entries table...');
        const politicalTest = await supabaseRequest('political_entries?limit=1&select=spicy_summary,shareable_hook,severity_label_inapp,severity_label_share');
        console.log('✅ Political entries columns exist\n');
        
        // Check executive_orders table
        console.log('Checking executive_orders table...');
        const executiveTest = await supabaseRequest('executive_orders?limit=1&select=spicy_summary,shareable_hook,severity_label_inapp,severity_label_share');
        console.log('✅ Executive orders columns exist');
        
        return true;
    } catch (error) {
        console.error('❌ Database check failed:', error.message);
        console.error('   Make sure you ran the migration SQL in Supabase!');
        return false;
    }
}

// Main test runner
async function runTests() {
    console.log('Starting comprehensive test suite...\n');
    console.log('=' .repeat(50) + '\n');
    
    const results = {
        political: false,
        executive: false,
        database: false
    };
    
    // Run tests
    results.political = await testPoliticalEntry();
    results.executive = await testExecutiveOrder();
    results.database = await testDatabaseColumns();
    
    // Summary
    console.log('\n' + '=' .repeat(50));
    console.log('\n📊 TEST SUMMARY\n');
    console.log(`   Political Entry Test: ${results.political ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`   Executive Order Test: ${results.executive ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`   Database Columns Test: ${results.database ? '✅ PASSED' : '❌ FAILED'}`);
    
    const allPassed = Object.values(results).every(r => r === true);
    
    if (allPassed) {
        console.log('\n🎉 ALL TESTS PASSED! Ready for production.');
        console.log('\n📋 Next steps:');
        console.log('   1. Test with 10 articles: node scripts/backfill-political-spicy.js --limit 10');
        console.log('   2. Test with 10 orders: node scripts/backfill-executive-spicy.js --limit 10');
        console.log('   3. If successful, run full backfill without --limit');
    } else {
        console.log('\n⚠️ Some tests failed. Please fix issues before proceeding.');
    }
}

// Run all tests
runTests().catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
});
