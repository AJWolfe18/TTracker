#!/usr/bin/env node
/**
 * TTRC-236: Inline Article Entity Backfill
 *
 * Extracts entities directly for articles missing them.
 * Uses OpenAI GPT-4o-mini for extraction, normalizes to canonical IDs.
 *
 * Problem: Story clustering needs article.entities but pipeline only
 * populated story-level entities. This backfills article-level entities.
 *
 * Usage:
 *   node scripts/backfill-article-entities-inline.js [limit]
 *
 * Examples:
 *   node scripts/backfill-article-entities-inline.js 10     # Test with 10
 *   node scripts/backfill-article-entities-inline.js 100    # Backfill 100
 *   node scripts/backfill-article-entities-inline.js all    # Backfill all
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { normalizeEntities } from './lib/entity-normalization.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Config
const BATCH_SIZE = 50;
const DELAY_MS = 150;  // Slightly longer delay for GPT calls
const MAX_COST_USD = 0.25;
const MODEL = 'gpt-4o-mini';

// Costs (GPT-4o-mini)
const COST_PER_1K_INPUT = 0.00015;
const COST_PER_1K_OUTPUT = 0.0006;

// Track costs
let totalInputTokens = 0;
let totalOutputTokens = 0;
let totalArticles = 0;

function estimateCost() {
  return (totalInputTokens / 1000) * COST_PER_1K_INPUT +
         (totalOutputTokens / 1000) * COST_PER_1K_OUTPUT;
}

// ============================================================================
// Entity Extraction Prompt (Article-specific)
// ============================================================================

const ENTITY_EXTRACTION_PROMPT = `You are a political entity extractor. Return ONLY valid JSON object.

Extract 3-8 key entities from this news article using CANONICAL IDs:

Entity formats:
* PERSON: US-<LASTNAME> (e.g., US-TRUMP, US-BIDEN, US-PELOSI)
* ORG: ORG-<ABBREV> (e.g., ORG-DOJ, ORG-DHS, ORG-SUPREME-COURT)
* LOCATION: LOC-<NAME> (e.g., LOC-USA, LOC-TEXAS, LOC-UKRAINE)
* EVENT: EVT-<NAME> (e.g., EVT-JAN6, EVT-ACA)

Return JSON object format:
{
  "entities": [
    {
      "id": "US-TRUMP",
      "name": "Donald Trump",
      "type": "PERSON",
      "confidence": 0.95
    }
  ]
}

Guidelines:
- Only include entities with confidence ≥0.70
- Sort by importance/salience
- Prefer fewer high-quality entities over many weak ones
- Keep diverse types (not all PERSONs unless justified)
- If you cannot assign canonical ID, omit the entity
- Return empty array {"entities": []} if no entities found

IMPORTANT: Return ONLY the JSON object with "entities" key.`;

// ============================================================================
// Database Functions
// ============================================================================

async function getArticlesWithoutEntities(limit) {
  // Articles with no entities (empty array or null)
  // We need to check for both [] and null
  let query = supabase
    .from('articles')
    .select('id, title, content, excerpt, published_at')
    .or('entities.is.null,entities.eq.[]')
    .order('published_at', { ascending: false });

  if (limit && limit !== 'all') {
    query = query.limit(parseInt(limit));
  }

  const { data, error } = await query;

  if (error) {
    console.error('Failed to fetch articles:', error.message);
    return null;
  }

  return data;
}

async function updateArticleEntities(articleId, entities) {
  const { error } = await supabase
    .from('articles')
    .update({ entities: entities })
    .eq('id', articleId);

  if (error) {
    console.error(`Failed to update ${articleId}:`, error.message);
    return false;
  }

  return true;
}

// ============================================================================
// Entity Extraction
// ============================================================================

async function extractEntities(title, content) {
  const articleText = `Title: ${title}\n\nContent: ${content || '(no content)'}`.slice(0, 4000);

  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: ENTITY_EXTRACTION_PROMPT },
        { role: 'user', content: articleText }
      ],
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: 'json_object' }
    });

    const usage = response.usage || {};
    totalInputTokens += usage.prompt_tokens || 0;
    totalOutputTokens += usage.completion_tokens || 0;

    // Parse response - expecting {entities: [...]} format
    const responseText = response.choices[0].message.content;
    let parsed = JSON.parse(responseText);

    // Extract entities array from response object
    let entities = parsed.entities || parsed.entity || [];

    // Handle case where it's already an array (fallback)
    if (Array.isArray(parsed)) {
      entities = parsed;
    }

    if (!Array.isArray(entities)) {
      console.warn(`Invalid entities format, returning empty: ${responseText.slice(0, 100)}`);
      return [];
    }

    // Normalize entity IDs using existing normalization
    entities = normalizeEntities(entities);

    // Filter to only high-confidence entities
    entities = entities.filter(e => e && e.id && (e.confidence === undefined || e.confidence >= 0.70));

    return entities;

  } catch (err) {
    console.error(`Entity extraction error: ${err.message}`);
    return [];
  }
}

async function processArticle(article) {
  const content = article.content || article.excerpt || '';

  try {
    const entities = await extractEntities(article.title, content);

    const success = await updateArticleEntities(article.id, entities);
    if (success) {
      totalArticles++;
      return { success: true, entityCount: entities.length };
    }
  } catch (err) {
    console.error(`Error processing ${article.id}:`, err.message);
  }

  return { success: false, entityCount: 0 };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const limit = process.argv[2] || '10';

  console.log('='.repeat(70));
  console.log('TTRC-236: Inline Article Entity Backfill');
  console.log('='.repeat(70));
  console.log('');
  console.log(`Model: ${MODEL}`);
  console.log(`Limit: ${limit}`);
  console.log(`Max cost: $${MAX_COST_USD}`);
  console.log('');

  // Fetch articles
  console.log('Fetching articles without entities...');
  const articles = await getArticlesWithoutEntities(limit);

  if (!articles) {
    console.error('Failed to fetch articles');
    process.exit(1);
  }

  if (articles.length === 0) {
    console.log('All articles already have entities!');
    process.exit(0);
  }

  console.log(`Found ${articles.length} articles without entities`);
  console.log('');

  // Show sample
  console.log('Sample:');
  articles.slice(0, 3).forEach(a => {
    console.log(`  - ${a.title.slice(0, 60)}...`);
  });
  if (articles.length > 3) {
    console.log(`  ... and ${articles.length - 3} more`);
  }
  console.log('');

  // Estimate cost
  const avgInputTokens = 400;  // ~title + content snippet
  const avgOutputTokens = 100; // ~entity JSON
  const estimatedCost = ((articles.length * avgInputTokens) / 1000) * COST_PER_1K_INPUT +
                        ((articles.length * avgOutputTokens) / 1000) * COST_PER_1K_OUTPUT;
  console.log(`Estimated cost: $${estimatedCost.toFixed(4)}`);

  if (estimatedCost > MAX_COST_USD) {
    console.log(`\nWARNING: Estimated cost exceeds max ($${MAX_COST_USD})`);
    console.log('Reduce limit or increase MAX_COST_USD');
    process.exit(1);
  }

  console.log('');
  console.log('Processing...');
  console.log('');

  // Process articles
  let success = 0;
  let failed = 0;
  let totalEntities = 0;

  for (let i = 0; i < articles.length; i++) {
    // Check cost limit
    const currentCost = estimateCost();
    if (currentCost >= MAX_COST_USD) {
      console.log(`\nStopping: cost limit reached ($${currentCost.toFixed(4)})`);
      break;
    }

    const article = articles[i];
    const result = await processArticle(article);

    if (result.success) {
      success++;
      totalEntities += result.entityCount;
      process.stdout.write(result.entityCount > 0 ? '.' : 'o');  // o = no entities found
    } else {
      failed++;
      process.stdout.write('x');
    }

    // Progress indicator
    if ((i + 1) % 50 === 0) {
      const pct = ((i + 1) / articles.length * 100).toFixed(0);
      const cost = estimateCost().toFixed(4);
      process.stdout.write(` [${i + 1}/${articles.length}] $${cost}\n`);
    }

    // Rate limiting
    if (i < articles.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  console.log('\n');
  console.log('='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log('');
  console.log(`Articles processed: ${success + failed}`);
  console.log(`Success: ${success}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total entities extracted: ${totalEntities}`);
  console.log(`Avg entities per article: ${(totalEntities / success).toFixed(1)}`);
  console.log('');
  console.log(`Input tokens: ${totalInputTokens.toLocaleString()}`);
  console.log(`Output tokens: ${totalOutputTokens.toLocaleString()}`);
  console.log(`Total cost: $${estimateCost().toFixed(4)}`);
  console.log('');

  // Verify - count articles still without entities
  const { count, error } = await supabase
    .from('articles')
    .select('*', { count: 'exact', head: true })
    .or('entities.is.null,entities.eq.[]');

  if (!error) {
    console.log(`Remaining without entities: ${count}`);
  }
  console.log('');

  if (success > 0) {
    console.log('Next step: Run recluster-simulation.js to test clustering');
  }
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
