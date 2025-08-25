// spicy-summaries-integration.js
// Integration for GPT-5 spicy summaries into daily-tracker
// Uses GPT-5 for critical, GPT-5-mini for everything else

import fetch from 'node-fetch';

// ============================================
// SMART MODEL SELECTION
// ============================================

const GPT5_MODELS = {
  CRITICAL: 'gpt-5',        // For democracy threats: $0.00255/article
  DEFAULT: 'gpt-5-mini'     // For everything else: $0.00054/article
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

ARTICLE: {title}
{content}

CURRENT SEVERITY: {severity}

Write a 5-7 sentence summary that:
1. Opens with what's ACTUALLY outrageous (make it screenshot-worthy)
2. Explains the scam/lie/corruption in plain English - like you're pissed at a bar
3. Connects to their pattern of behavior with specific examples
4. Shows who gets hurt with REAL numbers and consequences  
5. Ends with a gut-punch call-out or rallying cry

VOICE RULES:
- Call lies "lies" not "misstatements" or "false claims"
- Call corruption "corruption" not "ethical concerns"
- Use the angry language real people use when they're genuinely pissed
- NO passive voice - name names and assign blame directly
- Include specific $amounts, dates, vote counts when available
- Make readers feel validated in their anger, not crazy for caring

SEVERITY GUIDE:
- CRITICAL (Fucking Treason): This is fascism/authoritarianism, democracy is dying
- SEVERE (Criminal Bullshit): People will suffer/die, this is criminal
- MODERATE (Swamp Shit): Standard grift, follow the money
- MINOR (Clown Show): Mock the stupidity, point and laugh

Also provide a one-sentence shareable hook that's so good people will screenshot it.

OUTPUT FORMAT:
SUMMARY: [Your 5-7 sentence spicy summary]
HOOK: [One devastating sentence for social media]`;

// ============================================
// SEVERITY SCORING PROMPT
// ============================================

const SEVERITY_SCORING_PROMPT = `Analyze this political article and assign severity based on ACTUAL HARM and THREAT TO DEMOCRACY, not media hype.

CRITICAL (Fucking Treason / Democracy Under Attack):
- Attempts to overturn/steal elections
- Attacking voting rights or voter access
- Threatening political violence or civil war
- Dismantling democratic institutions
- Packing courts with extremists
- Authoritarian power grabs

SEVERE (Criminal Bullshit / Criminal Corruption):
- Policies that will directly kill or harm people
- Healthcare cuts affecting life-saving treatment
- Clear criminal activity (not just shady)
- Inciting violence or terrorism
- Massive corruption with real victims
- Environmental disasters for profit

MODERATE (Swamp Shit / Swamp Business):
- Self-dealing and profiteering
- Standard political corruption
- Nepotism and cronyism
- Corporate bootlicking
- Campaign finance violations
- Lying for political gain

MINOR (Clown Show / Political Circus):
- Incompetence and stupidity
- Twitter tantrums
- Obvious hypocrisy
- Self-owns and contradictions
- Embarrassing gaffes
- Just being an asshole

ARTICLE: {title}
{content}

OUTPUT:
SEVERITY: critical|severe|moderate|minor
REASON: [One line explaining why - be specific about the harm]`;

// ============================================
// MAIN FUNCTION: GENERATE SPICY SUMMARY
// ============================================

export async function generateSpicySummary(article) {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    console.error('❌ No OpenAI API key found');
    return null;
  }
  
  try {
    // Step 1: Determine severity if not provided
    let severity = article.severity;
    let severityReason = '';
    
    if (!severity || severity === 'unknown') {
      console.log('  📊 Determining severity...');
      
      const severityResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-5-nano',  // Use cheapest for severity scoring
          messages: [{
            role: 'user',
            content: SEVERITY_SCORING_PROMPT
              .replace('{title}', article.title || '')
              .replace('{content}', article.description || article.content || '')
          }],
          max_completion_tokens: 100,
          reasoning_effort: 'minimal'
        })
      });
      
      if (severityResponse.ok) {
        const severityData = await severityResponse.json();
        const severityText = severityData.choices[0].message.content;
        
        const severityMatch = severityText.match(/SEVERITY: (\w+)/);
        const reasonMatch = severityText.match(/REASON: (.+)/);
        
        severity = severityMatch ? severityMatch[1] : 'moderate';
        severityReason = reasonMatch ? reasonMatch[1] : '';
        
        console.log(`  ✅ Severity determined: ${severity}`);
      }
    }
    
    // Step 2: Choose model based on severity
    const model = severity === 'critical' ? GPT5_MODELS.CRITICAL : GPT5_MODELS.DEFAULT;
    console.log(`  🤖 Using model: ${model} for ${severity} severity`);
    
    // Step 3: Generate spicy summary
    const summaryResponse = await fetch('https://api.openai.com/v1/chat/completions', {
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
            .replace('{title}', article.title || '')
            .replace('{content}', article.description || article.content || '')
            .replace('{severity}', severity.toUpperCase())
        }],
        max_completion_tokens: 400,
        reasoning_effort: 'minimal',  // Fast for summaries
        verbosity: 'medium'
      })
    });
    
    if (!summaryResponse.ok) {
      const error = await summaryResponse.text();
      console.error('  ❌ API error:', error);
      return null;
    }
    
    const summaryData = await summaryResponse.json();
    const summaryText = summaryData.choices[0].message.content;
    
    // Parse response
    const summaryMatch = summaryText.match(/SUMMARY: ([\s\S]+?)(?=HOOK:|$)/);
    const hookMatch = summaryText.match(/HOOK: (.+)/);
    
    const spicySummary = summaryMatch ? summaryMatch[1].trim() : summaryText;
    const shareableHook = hookMatch ? hookMatch[1].trim() : '';
    
    // Calculate cost
    const cost = model === GPT5_MODELS.CRITICAL ? 0.00255 : 0.00054;
    console.log(`  💰 Cost: $${cost.toFixed(5)}`);
    
    // Return enhanced article
    return {
      ...article,
      severity: severity,
      severity_reason: severityReason,
      severity_label_inapp: SEVERITY_LABELS.inApp[severity],
      severity_label_share: SEVERITY_LABELS.shareable[severity],
      editorial_summary: article.editorial_summary || article.description,  // Keep original
      spicy_summary: spicySummary,
      shareable_hook: shareableHook,
      ai_model_used: model,
      processing_cost: cost
    };
    
  } catch (error) {
    console.error('  ❌ Error generating spicy summary:', error.message);
    return null;
  }
}

// ============================================
// BATCH PROCESSING HELPER
// ============================================

export async function processArticlesWithSpicySummaries(articles) {
  console.log('\n🔥 GENERATING SPICY SUMMARIES\n');
  console.log('=' .repeat(50));
  
  const results = [];
  let totalCost = 0;
  let criticalCount = 0;
  let regularCount = 0;
  
  for (const article of articles) {
    console.log(`\n📰 ${article.title}`);
    
    const enhanced = await generateSpicySummary(article);
    
    if (enhanced) {
      results.push(enhanced);
      totalCost += enhanced.processing_cost;
      
      if (enhanced.severity === 'critical') {
        criticalCount++;
      } else {
        regularCount++;
      }
      
      console.log(`  🎯 Hook: "${enhanced.shareable_hook?.substring(0, 60)}..."`);
    } else {
      // Fallback to original if spicy generation fails
      results.push(article);
      console.log('  ⚠️ Using original summary');
    }
  }
  
  console.log('\n' + '=' .repeat(50));
  console.log('📊 SUMMARY STATISTICS:\n');
  console.log(`  Critical articles (GPT-5): ${criticalCount}`);
  console.log(`  Regular articles (GPT-5-mini): ${regularCount}`);
  console.log(`  Total cost: $${totalCost.toFixed(4)}`);
  console.log(`  Average cost per article: $${(totalCost / articles.length).toFixed(5)}`);
  console.log(`  Monthly projection (${articles.length * 30} articles): $${(totalCost * 30).toFixed(2)}`);
  
  return results;
}

// ============================================
// COST ESTIMATOR
// ============================================

export function estimateMonthlyCost(articlesPerDay, criticalPercentage = 0.1) {
  const criticalPerDay = articlesPerDay * criticalPercentage;
  const regularPerDay = articlesPerDay * (1 - criticalPercentage);
  
  const criticalCost = criticalPerDay * 0.00255 * 30;
  const regularCost = regularPerDay * 0.00054 * 30;
  const totalCost = criticalCost + regularCost;
  
  console.log('\n💰 COST ESTIMATE:');
  console.log(`  Articles/day: ${articlesPerDay}`);
  console.log(`  Critical (${criticalPercentage * 100}%): $${criticalCost.toFixed(2)}/month`);
  console.log(`  Regular (${(1 - criticalPercentage) * 100}%): $${regularCost.toFixed(2)}/month`);
  console.log(`  TOTAL: $${totalCost.toFixed(2)}/month`);
  
  return totalCost;
}

// Example usage:
// const article = {
//   title: "Trump Claims Election Was Stolen",
//   description: "Former President continues false claims...",
//   severity: null  // Will be determined automatically
// };
// 
// const enhanced = await generateSpicySummary(article);
// console.log(enhanced.spicy_summary);
// console.log(enhanced.shareable_hook);
