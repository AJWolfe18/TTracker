#!/usr/bin/env node
/**
 * TTRC-236: Inline Article Embedding Backfill
 *
 * Generates embeddings directly for articles missing them.
 * Bypasses job queue (which has GENERATED ALWAYS constraint on payload_hash).
 * Uses EMBEDDING_MODEL_V1 from embedding-config.js for consistency.
 *
 * Usage:
 *   node scripts/backfill-article-embeddings-inline.js [limit]
 *
 * Examples:
 *   node scripts/backfill-article-embeddings-inline.js 10     # Test with 10
 *   node scripts/backfill-article-embeddings-inline.js 100    # Backfill 100
 *   node scripts/backfill-article-embeddings-inline.js all    # Backfill all
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { EMBEDDING_MODEL_V1 } from './lib/embedding-config.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Config
const BATCH_SIZE = 50;
const DELAY_MS = 100;
const MAX_COST_USD = 0.08;

// Track costs
let totalTokens = 0;
let totalArticles = 0;

function estimateCost(tokens) {
  // text-embedding-ada-002: $0.0001 per 1K tokens
  return (tokens / 1000) * 0.0001;
}

async function getArticlesWithoutEmbeddings(limit) {
  let query = supabase
    .from('articles')
    .select('id, title, content, excerpt, published_at')
    .is('embedding_v1', null)
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

async function generateEmbedding(text) {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL_V1,
    input: text.slice(0, 8000) // ada-002 has 8K token limit
  });

  const embedding = response.data[0].embedding;
  const tokens = response.usage.total_tokens;

  return { embedding, tokens };
}

async function updateArticleEmbedding(articleId, embedding) {
  // Format as PostgreSQL vector string: [x,y,z,...]
  const vectorString = `[${embedding.join(',')}]`;

  const { error } = await supabase
    .from('articles')
    .update({
      embedding_v1: vectorString,
      embedding_model_v1: EMBEDDING_MODEL_V1
    })
    .eq('id', articleId);

  if (error) {
    console.error(`Failed to update ${articleId}:`, error.message);
    return false;
  }

  return true;
}

async function processArticle(article) {
  // Build embedding input: title + content/excerpt
  const content = article.content || article.excerpt || '';
  const embeddingInput = `${article.title}\n\n${content.slice(0, 2000)}`;

  try {
    const { embedding, tokens } = await generateEmbedding(embeddingInput);
    totalTokens += tokens;

    const success = await updateArticleEmbedding(article.id, embedding);
    if (success) {
      totalArticles++;
      return true;
    }
  } catch (err) {
    console.error(`Error processing ${article.id}:`, err.message);
  }

  return false;
}

async function main() {
  const limit = process.argv[2] || '10';

  console.log('='.repeat(70));
  console.log('TTRC-236: Inline Article Embedding Backfill');
  console.log('='.repeat(70));
  console.log('');
  console.log(`Model: ${EMBEDDING_MODEL_V1}`);
  console.log(`Limit: ${limit}`);
  console.log(`Max cost: $${MAX_COST_USD}`);
  console.log('');

  // Fetch articles
  console.log('Fetching articles without embeddings...');
  const articles = await getArticlesWithoutEmbeddings(limit);

  if (!articles) {
    console.error('Failed to fetch articles');
    process.exit(1);
  }

  if (articles.length === 0) {
    console.log('All articles already have embeddings!');
    process.exit(0);
  }

  console.log(`Found ${articles.length} articles without embeddings`);
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
  const avgTokens = 500;
  const estimatedCost = estimateCost(articles.length * avgTokens);
  console.log(`Estimated cost: $${estimatedCost.toFixed(4)} (~${avgTokens} tokens/article avg)`);

  if (estimatedCost > MAX_COST_USD) {
    console.log(`\nWARNING: Estimated cost exceeds max ($${MAX_COST_USD})`);
    console.log('Reduce limit or increase MAX_COST_USD');
    process.exit(1);
  }

  console.log('');
  console.log('Processing...');
  console.log('');

  // Process in batches
  let success = 0;
  let failed = 0;

  for (let i = 0; i < articles.length; i++) {
    // Check cost limit
    const currentCost = estimateCost(totalTokens);
    if (currentCost >= MAX_COST_USD) {
      console.log(`\nStopping: cost limit reached ($${currentCost.toFixed(4)})`);
      break;
    }

    const article = articles[i];
    const ok = await processArticle(article);

    if (ok) {
      success++;
      process.stdout.write('.');
    } else {
      failed++;
      process.stdout.write('x');
    }

    // Progress indicator
    if ((i + 1) % 50 === 0) {
      const pct = ((i + 1) / articles.length * 100).toFixed(0);
      const cost = estimateCost(totalTokens).toFixed(4);
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
  console.log(`Total tokens: ${totalTokens.toLocaleString()}`);
  console.log(`Total cost: $${estimateCost(totalTokens).toFixed(4)}`);
  console.log('');

  // Verify
  const { data: remaining } = await supabase
    .from('articles')
    .select('count')
    .is('embedding_v1', null);

  console.log(`Remaining without embeddings: ${remaining?.[0]?.count || 'unknown'}`);
  console.log('');

  if (success > 0) {
    console.log('Next step: Run recompute-centroids.js to update story centroids');
  }
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
