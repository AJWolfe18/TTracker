// test-spicy-simple.js
// Simple test of GPT-5 spicy summaries without database dependency
// Run: node scripts/test-spicy-simple.js

import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

console.log('🔥 SIMPLE SPICY SUMMARIES TEST WITH GPT-5\n');
console.log('==========================================\n');

// Check for API key
if (!process.env.OPENAI_API_KEY) {
  console.error('❌ ERROR: OPENAI_API_KEY not found!');
  console.error('\nPlease either:');
  console.error('1. Create a .env file with OPENAI_API_KEY=sk-...');
  console.error('2. Set environment variable: set OPENAI_API_KEY=sk-...\n');
  process.exit(1);
}

console.log('✅ OpenAI API key found\n');

// Test article
const TEST_ARTICLE = {
  title: "Trump Claims 2020 Election Was Stolen Despite 60+ Court Losses",
  content: `Former President Donald Trump continued to spread false claims about the 2020 election at a rally in Ohio, 
  telling supporters the election was "rigged" and "stolen" despite more than 60 court cases finding no evidence of 
  widespread fraud. His own Attorney General Bill Barr called the claims "bullshit" and his cybersecurity chief called 
  it "the most secure election in American history." This marks the 500th time Trump has repeated these lies since 
  losing by 7 million votes.`,
  severity: "critical"
};

// Spicy prompt
const SPICY_PROMPT = `You write for TrumpyTracker - where we tell the TRUTH about political corruption without sugarcoating.

Article: ${TEST_ARTICLE.title}
${TEST_ARTICLE.content}

Write a 5-7 sentence summary that:
1. Opens with what's ACTUALLY outrageous (screenshot-worthy)
2. Explains the lie/corruption in plain English
3. Shows who gets hurt with real consequences
4. Ends with a gut-punch call-out

Voice: Write like you're pissed at a bar, not a news anchor. Call lies "lies" not "misstatements."

Also provide a one-sentence shareable hook.

FORMAT:
SUMMARY: [Your spicy summary]
HOOK: [One devastating sentence]`;

// Test each model
async function testModel(modelName, modelId) {
  console.log(`\n📝 Testing ${modelName} (${modelId})...\n`);
  
  try {
    // Build request body based on model type
    let requestBody = {
      model: modelId,
      messages: [{
        role: 'user',
        content: SPICY_PROMPT
      }]
    };
    
    // Add model-specific parameters
    if (modelId.startsWith('gpt-5')) {
      // GPT-5 specific parameters
      requestBody.max_completion_tokens = 400;
      requestBody.reasoning_effort = 'minimal';  // Fastest for summaries
      requestBody.verbosity = 'medium';          // Control output length
      // Don't set temperature - use default
    } else {
      // GPT-4 parameters
      requestBody.max_tokens = 400;
      requestBody.temperature = 0.8;
    }
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error: ${error}`);
    }
    
    const data = await response.json();
    const content = data.choices[0].message.content;
    
    // Parse response
    const summaryMatch = content.match(/SUMMARY: ([\s\S]+?)(?=HOOK:|$)/);
    const hookMatch = content.match(/HOOK: (.+)/);
    
    if (summaryMatch) {
      console.log('📰 SUMMARY:');
      console.log(summaryMatch[1].trim());
    }
    
    if (hookMatch) {
      console.log('\n🎯 HOOK:');
      console.log(hookMatch[1].trim());
    }
    
    // Calculate cost
    const promptTokens = SPICY_PROMPT.length / 4;
    const completionTokens = content.length / 4;
    
    const costs = {
      'gpt-5': { input: 1.25/1000000, output: 10/1000000 },
      'gpt-5-mini': { input: 0.25/1000000, output: 2/1000000 },
      'gpt-5-nano': { input: 0.05/1000000, output: 0.40/1000000 }
    };
    
    const cost = costs[modelId];
    if (cost) {
      const totalCost = (promptTokens * cost.input) + (completionTokens * cost.output);
      console.log(`\n💰 Cost: $${totalCost.toFixed(5)}`);
      console.log(`📊 Monthly (30/day): $${(totalCost * 30 * 30).toFixed(2)}`);
    }
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    
    // Check if it's a model availability issue
    if (error.message.includes('model')) {
      console.log('\n💡 Note: GPT-5 models may not be available on all API keys yet.');
      console.log('   Try using gpt-4o or gpt-4o-mini for testing the prompts.');
    }
  }
}

// Run tests
async function runTests() {
  console.log('Testing article:', TEST_ARTICLE.title);
  console.log('=' .repeat(60));
  
  // Test GPT-5 models
  await testModel('GPT-5 Full', 'gpt-5');
  console.log('\n' + '-'.repeat(60));
  
  await testModel('GPT-5 Mini', 'gpt-5-mini');
  console.log('\n' + '-'.repeat(60));
  
  await testModel('GPT-5 Nano', 'gpt-5-nano');
  
  console.log('\n' + '='.repeat(60));
  console.log('\n✨ Testing with GPT-4o models as fallback...\n');
  console.log('='.repeat(60));
  
  // Also test with GPT-4o models
  await testModel('GPT-4o', 'gpt-4o');
  console.log('\n' + '-'.repeat(60));
  
  await testModel('GPT-4o Mini', 'gpt-4o-mini');
  
  console.log('\n' + '='.repeat(60));
  console.log('\n✅ Test complete!\n');
  
  console.log('Cost Comparison (30 articles/day):');
  console.log('GPT-5:      ~$13.50/month');
  console.log('GPT-5-mini: ~$2.70/month');
  console.log('GPT-5-nano: ~$0.54/month');
  console.log('GPT-4o:     ~$10.80/month');
  console.log('GPT-4o-mini: ~$0.65/month');
}

runTests();
