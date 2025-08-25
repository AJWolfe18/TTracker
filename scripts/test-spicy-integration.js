// test-spicy-integration.js
// Quick test to verify spicy summaries integration works
import { generateSpicySummary } from './spicy-summaries-integration.js';

console.log('🔥 Testing Spicy Summaries Integration');
console.log('=====================================\n');

// Test article
const testArticle = {
    title: "Trump Announces Plan to Eliminate Department of Education",
    description: "Former President Trump revealed plans to completely dismantle the Department of Education if re-elected, stating it would save billions and return control to states.",
    severity: "high"
};

console.log('📰 Test Article:');
console.log(`Title: ${testArticle.title}`);
console.log(`Description: ${testArticle.description}`);
console.log(`Severity: ${testArticle.severity}\n`);

try {
    console.log('🌶️ Generating spicy summary...\n');
    const enhanced = await generateSpicySummary(testArticle);
    
    console.log('✅ Results:');
    console.log('-------------------');
    console.log('\n📝 Spicy Summary:');
    console.log(enhanced.spicy_summary);
    console.log('\n🎯 Shareable Hook:');
    console.log(enhanced.shareable_hook);
    console.log('\n🏷️ In-App Label:', enhanced.severity_label_inapp);
    console.log('📱 Share Label:', enhanced.severity_label_share);
    console.log('\n💰 Estimated Cost:', enhanced.cost_estimate || 'Not calculated');
    
} catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
}
