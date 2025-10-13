// spicy-eo-translator.js
// Executive Order spicy translation using GPT-5 models
// Matches the structure of spicy-summaries-integration.js but for EOs

import fetch from 'node-fetch';

// ============================================
// SMART MODEL SELECTION - SAME AS POLITICAL
// ============================================

const GPT5_MODELS = {
  CRITICAL: 'gpt-5',        // For fascist power grabs: $0.00255/order
  DEFAULT: 'gpt-5-mini'     // For everything else: $0.00054/order
};

// EO-specific impact categories
const EO_IMPACT_LABELS = {
  inApp: {
    fascist_power_grab: 'Fascist Power Grab 🔴',
    authoritarian_overreach: 'Authoritarian Overreach 🟠',
    corrupt_grift: 'Corrupt Grift 🟡',
    performative_bullshit: 'Performative Bullshit 🟢'
  },
  shareable: {
    fascist_power_grab: 'Fascist Overreach',
    authoritarian_overreach: 'Authoritarian Control',
    corrupt_grift: 'Corruption',
    performative_bullshit: 'Political Theater'
  }
};

// ============================================
// EO TRANSLATION PROMPT
// ============================================

const EO_TRANSLATION_PROMPT = `You are analyzing Executive Order "{title}" for TrumpyTracker.

This EO: {content}

Your job is to expose what this order is REALLY designed to do - the authoritarian agenda behind the bureaucratic language.

Categorize this order's impact:
- fascist_power_grab: Dismantling democracy, eliminating oversight, seizing unconstitutional power
- authoritarian_overreach: Expanding surveillance, crushing dissent, militarizing government  
- corrupt_grift: Self-dealing, cronyism, funneling money to allies
- performative_bullshit: Meaningless culture war theater, distraction tactics

Write a FULL translation that:
1. Exposes the REAL agenda behind the bureaucratic language (what they're ACTUALLY trying to do)
2. Predicts how this will be weaponized and abused
3. Identifies WHO benefits (Trump, cronies, fascists) and WHO gets screwed (minorities, democracy, working people)
4. Connects this to their broader authoritarian playbook
5. Warns what this is setting up for the future

Be ANGRY and TRUTHFUL. This isn't news reporting - it's warning people about fascism.

OUTPUT FORMAT:
CATEGORY: [one of: fascist_power_grab, authoritarian_overreach, corrupt_grift, performative_bullshit]
SUMMARY: [A FULL 4-5 sentence translation exposing the real agenda. Be angry, specific, and accurate. Call out the fascist bullshit. Explain how they'll abuse this power. Connect it to the pattern.]
HOOK: [One punchy sentence (under 200 chars) for social media]`;

// ============================================
// EO CATEGORIZATION PROMPT
// ============================================

const EO_CATEGORIZATION_PROMPT = `Analyze this Executive Order and categorize its authoritarian impact.

fascist_power_grab - Democracy threats:
- Emergency powers, martial law
- Eliminating oversight/checks and balances
- Attacking elections/voting
- Seizing unconstitutional authority
- Court packing or judicial attacks

authoritarian_overreach - Control & surveillance:
- Expanding surveillance powers
- Militarizing federal agencies
- Crushing dissent or protest
- Media control or censorship
- Immigration crackdowns

corrupt_grift - Self-dealing & corruption:
- Funneling money to allies
- Regulatory capture
- Nepotism and cronyism
- Corporate handouts
- Self-enrichment schemes

performative_bullshit - Theater & distraction:
- Culture war nonsense
- Symbolic gestures with no real impact
- Renaming things
- Virtue signaling to base
- Distraction from real issues

EXECUTIVE ORDER: {title}
{content}

OUTPUT:
CATEGORY: [exact category name]
REASON: [One line explaining why]`;

// ============================================
// MAIN FUNCTION: GENERATE EO TRANSLATION
// ============================================

export async function generateEOTranslation(order) {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    console.error('❌ No OpenAI API key found');
    return null;
  }
  
  try {
    // Step 1: Categorize the order to determine model selection
    console.log('  📊 Categorizing order impact...');
    
    const categorizationResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-5-nano',  // Use cheapest for categorization
        messages: [{
          role: 'user',
          content: EO_CATEGORIZATION_PROMPT
            .replace('{title}', order.title || '')
            .replace('{content}', order.summary || order.description || '')
        }],
        max_completion_tokens: 100,
        reasoning_effort: 'minimal'
      })
    });
    
    let category = 'performative_bullshit';
    let categoryReason = '';
    
    if (categorizationResponse.ok) {
      const categorizationData = await categorizationResponse.json();
      const categorizationText = categorizationData.choices[0].message.content;
      
      const categoryMatch = categorizationText.match(/CATEGORY:\s*(\w+)/);
      const reasonMatch = categorizationText.match(/REASON:\s*(.+)/);
      
      if (categoryMatch) {
        const matched = categoryMatch[1].toLowerCase().replace(/\s+/g, '_');
        if (Object.keys(EO_IMPACT_LABELS.inApp).includes(matched)) {
          category = matched;
        }
      }
      categoryReason = reasonMatch ? reasonMatch[1] : '';
      
      console.log(`  ✅ Category: ${category}`);
    }
    
    // Step 2: Choose model based on category
    const model = category === 'fascist_power_grab' ? GPT5_MODELS.CRITICAL : GPT5_MODELS.DEFAULT;
    console.log(`  🤖 Using model: ${model} for ${category}`);
    
    // Step 3: Generate spicy translation
    const translationResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [{
          role: 'user',
          content: EO_TRANSLATION_PROMPT
            .replace('{title}', order.title || '')
            .replace('{content}', order.summary || order.description || '')
        }],
        max_completion_tokens: 400,
        reasoning_effort: 'minimal',
        verbosity: 'medium'
      })
    });
    
    if (!translationResponse.ok) {
      const error = await translationResponse.text();
      console.error('  ❌ API error:', error);
      return null;
    }
    
    const translationData = await translationResponse.json();
    const translationText = translationData.choices[0].message.content;
    
    // Parse response
    const summaryMatch = translationText.match(/SUMMARY:\s*([\s\S]+?)(?=HOOK:|$)/);
    const hookMatch = translationText.match(/HOOK:\s*(.+)/);
    
    const spicySummary = summaryMatch ? summaryMatch[1].trim() : translationText;
    const shareableHook = hookMatch ? hookMatch[1].trim().substring(0, 280) : '';
    
    // Calculate cost
    const cost = model === GPT5_MODELS.CRITICAL ? 0.00255 : 0.00054;
    console.log(`  💰 Cost: $${cost.toFixed(5)}`);
    
    // Return translation with labels
    return {
      ...order,
      eo_impact_type: category,
      impact_reason: categoryReason,
      severity_label_inapp: EO_IMPACT_LABELS.inApp[category],
      severity_label_share: EO_IMPACT_LABELS.shareable[category],
      spicy_summary: spicySummary,
      shareable_hook: shareableHook,
      ai_model_used: model,
      processing_cost: cost
    };
    
  } catch (error) {
    console.error('  ❌ Error generating EO translation:', error.message);
    return null;
  }
}

// ============================================
// BATCH PROCESSING HELPER
// ============================================

export async function processExecutiveOrders(orders) {
  console.log('\n🔥 GENERATING EO TRANSLATIONS\n');
  console.log('=' .repeat(50));
  
  const results = [];
  let totalCost = 0;
  let fascistCount = 0;
  let authoritarianCount = 0;
  let griftCount = 0;
  let bullshitCount = 0;
  
  for (const order of orders) {
    console.log(`\n📜 ${order.title}`);
    
    const translation = await generateEOTranslation(order);
    
    if (translation) {
      results.push(translation);
      totalCost += translation.processing_cost;
      
      switch(translation.eo_impact_type) {
        case 'fascist_power_grab': fascistCount++; break;
        case 'authoritarian_overreach': authoritarianCount++; break;
        case 'corrupt_grift': griftCount++; break;
        case 'performative_bullshit': bullshitCount++; break;
      }
      
      console.log(`  🎯 Impact: ${translation.severity_label_inapp}`);
      console.log(`  📱 Hook: "${translation.shareable_hook?.substring(0, 60)}..."`);
    } else {
      // Fallback to original if translation fails
      results.push(order);
      console.log('  ⚠️ Translation failed, keeping original');
    }
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('\n' + '=' .repeat(50));
  console.log('📊 TRANSLATION STATISTICS:\n');
  console.log(`  Fascist Power Grabs: ${fascistCount}`);
  console.log(`  Authoritarian Overreach: ${authoritarianCount}`);
  console.log(`  Corrupt Grift: ${griftCount}`);
  console.log(`  Performative Bullshit: ${bullshitCount}`);
  console.log(`  Total cost: $${totalCost.toFixed(4)}`);
  console.log(`  Average cost per order: $${(totalCost / orders.length).toFixed(5)}`);
  
  return results;
}
