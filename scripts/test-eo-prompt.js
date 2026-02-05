import OpenAI from 'openai';
import dotenv from 'dotenv';
import { EO_ENRICHMENT_PROMPT, buildEOPayload } from './enrichment/prompts/executive-orders.js';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function testEOPrompt() {
  console.log('🧪 Testing EO Enrichment Prompt...\n');

  // Sample EO (using a real one from the database)
  const sampleEO = {
    order_number: '14145',
    title: 'Declaring a National Energy Emergency',
    date: '2025-01-20',
    summary: 'This order declares a national energy emergency to address supply shortages and expedite infrastructure projects.'
  };

  console.log('📋 Sample EO:', sampleEO.order_number, '-', sampleEO.title);
  console.log('📅 Date:', sampleEO.date);
  console.log('\n🔄 Calling OpenAI API...\n');

  const userPayload = buildEOPayload(sampleEO);

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: EO_ENRICHMENT_PROMPT },
        { role: 'user', content: userPayload }
      ],
      temperature: 0.7,
      max_tokens: 2000
    });

    const result = response.choices[0].message.content;
    const usage = response.usage;

    console.log('✅ Response received!\n');
    console.log('📊 Token Usage:');
    console.log('  Input:', usage.prompt_tokens);
    console.log('  Output:', usage.output_tokens);
    console.log('  Total:', usage.total_tokens);
    console.log('  Est. Cost: $' + ((usage.prompt_tokens * 0.00015 + usage.output_tokens * 0.0006) / 1000).toFixed(6));
    console.log('\n📝 Raw Response:');
    console.log(result);

    // Try to parse JSON
    try {
      const parsed = JSON.parse(result);
      console.log('\n✅ Valid JSON!');
      console.log('\n📋 Parsed Structure:');
      console.log('  Sections:', Object.keys(parsed).filter(k => k.startsWith('section_')).join(', '));
      console.log('  Category:', parsed.category);
      console.log('  Severity:', parsed.severity);
      console.log('  Action Tier:', parsed.action_tier);
      console.log('  Regions:', parsed.regions?.join(', ') || 'none');
      console.log('  Policy Areas:', parsed.policy_areas?.join(', ') || 'none');
      console.log('  Affected Agencies:', parsed.affected_agencies?.join(', ') || 'none');
      
      if (parsed.action_section) {
        console.log('\n🎯 Actions (' + parsed.action_section.title + '):');
        parsed.action_section.actions.forEach((a, i) => {
          console.log(`  ${i+1}. [${a.type}] ${a.description.substring(0, 80)}...`);
          console.log(`     Specificity: ${a.specificity}/10`);
        });
      } else {
        console.log('\n📍 No actions (tracking tier)');
      }

      // Validate word counts
      console.log('\n📏 Word Counts (target: 100-160):');
      ['section_what_they_say', 'section_what_it_means', 'section_reality_check', 'section_why_it_matters'].forEach(key => {
        const wordCount = parsed[key]?.split(/\s+/).length || 0;
        const status = wordCount >= 100 && wordCount <= 160 ? '✅' : '⚠️';
        console.log(`  ${status} ${key.replace('section_', '')}: ${wordCount} words`);
      });

    } catch (parseError) {
      console.log('\n❌ JSON Parse Error:', parseError.message);
      console.log('Response was not valid JSON');
    }

  } catch (error) {
    console.error('❌ OpenAI API Error:', error.message);
    process.exit(1);
  }
}

testEOPrompt().catch(console.error);
