// spicy-summaries-gpt5.js
// GPT-5 Spicy Summaries Implementation for TrumpyTracker
// Created: August 23, 2025

import fetch from 'node-fetch';
import { supabaseRequest } from '../config/supabase-config-node.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables from .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

console.log('🔥 SPICY SUMMARIES WITH GPT-5 - TESTING MODULE');
console.log('=================================================\n');

// ============================================
// GPT-5 MODEL CONFIGURATION
// ============================================

const GPT5_MODELS = {
  FULL: 'gpt-5',           // Best: $1.25/$10 per 1M tokens
  MINI: 'gpt-5-mini',      // Balanced: $0.25/$2 per 1M tokens  
  NANO: 'gpt-5-nano'       // Cheapest: $0.05/$0.40 per 1M tokens
};

// Context-aware severity labels
const SEVERITY_LABELS = {
  inApp: {
    critical: "Fucking Treason 🔴",
    severe: "Criminal Bullshit 🟠",
    moderate: "Swamp Shit 🟡",
    minor: "Clown Show 🟢"
  },
  shareable: {
    critical: "Democracy Under Attack",
    severe: "Criminal Corruption",
    moderate: "Swamp Business",
    minor: "Political Circus"
  }
};

// ============================================
// SPICY SUMMARY PROMPT
// ============================================

const SPICY_SUMMARY_PROMPT = `You write for TrumpyTracker - where we tell the TRUTH about political corruption without sugarcoating or both-sides bullshit.

ARTICLE CONTENT:
{article_content}

SEVERITY LEVEL: {severity_level}

Write a 5-7 sentence summary that:
1. Opens with what's ACTUALLY outrageous (make it screenshot-worthy)
2. Explains the scam/lie/corruption in plain English - like you're pissed at a bar
3. Connects to their pattern of behavior with specific examples
4. Shows who gets hurt with REAL numbers and consequences
5. Ends with a gut-punch call-out or rallying cry

VOICE RULES:
- Call lies "lies" not "misstatements" or "false claims"
- Call corruption "corruption" not "ethical concerns"
- Use the angry language real people use
- NO passive voice - name names and assign blame
- Include specific $amounts, dates, vote counts
- Make readers feel validated, not crazy for caring

SEVERITY GUIDE:
- CRITICAL (Fucking Treason): This is fascism/authoritarianism, democracy dying
- SEVERE (Criminal Bullshit): People will suffer/die, this is criminal
- MODERATE (Swamp Shit): Standard grift, follow the money
- MINOR (Clown Show): Mock the stupidity, point and laugh

Also provide a one-sentence "Shareable Hook" that's so good people will screenshot it.

OUTPUT FORMAT:
SUMMARY: [Your 5-7 sentence spicy summary]
HOOK: [One devastating sentence for social media]`;

// ============================================
// TEST WITH REAL ARTICLES
// ============================================

async function testWithRecentArticles() {
  try {
    // Get recent articles from database
    const articles = await supabaseRequest(
      'political_entries?select=*&order=date.desc&limit=5'
    );
    
    if (!articles || articles.length === 0) {
      console.log('No articles found in database');
      return;
    }
    
    console.log(`Found ${articles.length} recent articles to test\n`);
    
    for (const article of articles) {
      console.log('\n' + '='.repeat(60));
      console.log(`📰 Article: ${article.title}`);
      console.log(`Current Severity: ${article.severity}`);
      console.log(`Current Summary: ${article.editorial_summary?.substring(0, 100)}...`);
      
      // Test with each model
      for (const [modelKey, modelName] of Object.entries(GPT5_MODELS)) {
        console.log(`\n🔥 Testing ${modelKey} (${modelName}):`);
        
        const result = await generateSpicySummary(article, modelName);
        
        if (result.error) {
          console.log(`❌ Error: ${result.error}`);
        } else {
          console.log(`✅ New Severity: ${result.severityLabelInApp}`);
          console.log(`📱 Hook: "${result.shareableHook}"`);
          console.log(`💰 Cost: $${result.estimatedCost.toFixed(5)}`);
          console.log(`⏱️ Time: ${result.processingTime}ms`);
        }
      }
    }
    
  } catch (error) {
    console.error('Error testing with real articles:', error);
  }
}

// ============================================
// GENERATE SPICY SUMMARY
// ============================================

async function generateSpicySummary(article, model = GPT5_MODELS.MINI) {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    return { error: 'OPENAI_API_KEY not set' };
  }
  
  const startTime = Date.now();
  
  try {
    // Combine title and description for context
    const articleContent = `Title: ${article.title}\n\n${article.description || article.editorial_summary || ''}`;
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [{
          role: 'user',
          content: SPICY_SUMMARY_PROMPT
            .replace('{article_content}', articleContent)
            .replace('{severity_level}', mapSeverityToDescription(article.severity))
        }],
        temperature: 0.8,
        max_tokens: 400,
        reasoning_effort: 'medium', // GPT-5 specific
        verbosity: 'medium' // GPT-5 specific
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }
    
    const data = await response.json();
    const content = data.choices[0].message.content;
    
    // Parse the response
    const summaryMatch = content.match(/SUMMARY: ([\s\S]+?)(?=HOOK:|$)/);
    const hookMatch = content.match(/HOOK: (.+)/);
    
    const endTime = Date.now();
    
    return {
      severity: article.severity,
      severityLabelInApp: SEVERITY_LABELS.inApp[article.severity],
      severityLabelShareable: SEVERITY_LABELS.shareable[article.severity],
      spicySummary: summaryMatch ? summaryMatch[1].trim() : content,
      shareableHook: hookMatch ? hookMatch[1].trim() : '',
      model: model,
      processingTime: endTime - startTime,
      estimatedCost: calculateCost(articleContent, model)
    };
    
  } catch (error) {
    return {
      error: error.message,
      model: model
    };
  }
}

// Helper to map severity
function mapSeverityToDescription(severity) {
  const map = {
    critical: "CRITICAL (Fucking Treason)",
    severe: "SEVERE (Criminal Bullshit)",
    moderate: "MODERATE (Swamp Shit)",
    minor: "MINOR (Clown Show)"
  };
  return map[severity] || "MODERATE (Swamp Shit)";
}

// Calculate cost
function calculateCost(content, model) {
  const inputTokens = content.length / 4; // Rough estimate
  const outputTokens = 100; // Expected output
  
  const pricing = {
    'gpt-5': { input: 1.25 / 1000000, output: 10 / 1000000 },
    'gpt-5-mini': { input: 0.25 / 1000000, output: 2 / 1000000 },
    'gpt-5-nano': { input: 0.05 / 1000000, output: 0.40 / 1000000 }
  };
  
  const p = pricing[model];
  return (inputTokens * p.input) + (outputTokens * p.output);
}

// ============================================
// COMPARE MODELS
// ============================================

async function compareModels() {
  console.log('\n🔥 GPT-5 MODEL COMPARISON\n');
  console.log('Testing with a sample article...\n');
  
  const testArticle = {
    title: "Trump Claims 2020 Election Was Stolen at Ohio Rally",
    description: "Former President Trump repeated false claims about the 2020 election at a rally, despite courts finding no evidence of fraud.",
    severity: "critical"
  };
  
  const results = {};
  
  for (const [key, model] of Object.entries(GPT5_MODELS)) {
    console.log(`Testing ${key}...`);
    results[key] = await generateSpicySummary(testArticle, model);
  }
  
  console.log('\n📊 RESULTS COMPARISON:\n');
  console.log('='.repeat(60));
  
  for (const [model, result] of Object.entries(results)) {
    console.log(`\n${model.toUpperCase()}:`);
    if (result.error) {
      console.log(`  ❌ Error: ${result.error}`);
    } else {
      console.log(`  ✅ Success in ${result.processingTime}ms`);
      console.log(`  💰 Cost: $${result.estimatedCost.toFixed(5)}`);
      console.log(`  📱 Hook: "${result.shareableHook?.substring(0, 80)}..."`);
    }
  }
  
  // Monthly cost projection
  console.log('\n💰 MONTHLY COST PROJECTION (30 articles/day):');
  console.log(`  GPT-5:      ~$${(30 * 30 * 0.015).toFixed(2)}/month`);
  console.log(`  GPT-5-mini: ~$${(30 * 30 * 0.003).toFixed(2)}/month`);
  console.log(`  GPT-5-nano: ~$${(30 * 30 * 0.0006).toFixed(2)}/month`);
}

// ============================================
// RUN TESTS
// ============================================

const args = process.argv.slice(2);

if (args.includes('--test-real')) {
  console.log('Testing with real articles from database...\n');
  testWithRecentArticles();
} else if (args.includes('--compare')) {
  console.log('Comparing GPT-5 models...\n');
  compareModels();
} else {
  console.log('Usage:');
  console.log('  node spicy-summaries-gpt5.js --test-real   # Test with real articles');
  console.log('  node spicy-summaries-gpt5.js --compare     # Compare all GPT-5 models');
}

export { generateSpicySummary, GPT5_MODELS, SEVERITY_LABELS };
