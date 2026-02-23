#!/usr/bin/env node
/**
 * Test GPT enrichment with full SCOTUS opinion
 * Run: node scripts/scotus/test-gpt-enrichment.js
 */

import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const opinionText = fs.readFileSync('scripts/scotus/test-opinion.txt', 'utf8');

console.log('Opinion loaded:', opinionText.length.toLocaleString(), 'chars');
console.log('Estimated tokens:', Math.round(opinionText.length / 4).toLocaleString());
console.log('Sending to GPT-4o-mini...');
console.log('');

const prompt = `You are analyzing a Supreme Court opinion for TrumpyTracker, an editorial site with a pro-people, anti-corporate perspective.

Given the full opinion text below, extract:

1. **ruling_impact_level** (0-5):
   - 5 = Constitutional Crisis (precedent dead, raw power wins)
   - 4 = Rubber-stamping Tyranny (court green-lights overreach)
   - 3 = Institutional Sabotage (technical moves gut rights)
   - 2 = Judicial Sidestepping (avoiding merits)
   - 1 = Crumbs from the Bench (narrow win for people)
   - 0 = Democracy Wins (system protects vulnerable)

2. **who_wins**: Plain English - who benefits from this ruling? (2-3 sentences)

3. **who_loses**: Plain English - who is harmed? (2-3 sentences)

4. **summary_spicy**: Editorial summary of what happened (3-4 sentences, can use measured profanity for level 4-5)

5. **why_it_matters**: Systemic impact - why should regular people care? (2-3 sentences)

6. **dissent_highlights**: If there's a dissent, what did the dissenting justices warn about? Key quotes or paraphrases. If unanimous, say so. (2-4 sentences)

7. **vote_split**: e.g. "6-3" or "9-0" or "Per curiam"

Return as JSON only, no markdown code blocks.

---

OPINION TEXT:
${opinionText}
`;

async function testEnrichment() {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 1500
    })
  });

  const data = await response.json();

  if (data.error) {
    console.log('ERROR:', data.error.message);
    return;
  }

  console.log('=== GPT RESPONSE ===');
  console.log('');
  console.log(data.choices[0].message.content);
  console.log('');
  console.log('---');
  console.log('Tokens used - Prompt:', data.usage.prompt_tokens, '| Completion:', data.usage.completion_tokens);
  const cost = (data.usage.prompt_tokens * 0.00000015) + (data.usage.completion_tokens * 0.0000006);
  console.log('Cost: $' + cost.toFixed(4));
}

testEnrichment().catch(console.error);
