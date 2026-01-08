/**
 * Backfill Script for Clustering V2 (TTRC-225)
 *
 * Processes existing articles to extract:
 * - Entities (via OpenAI GPT-4o-mini)
 * - Embeddings (via OpenAI ada-002)
 * - Keyphrases (TF-IDF)
 * - Quote hashes (SimHash)
 * - Artifact URLs
 * - Geography
 *
 * Strategy (from PM feedback):
 * - Process OLDEST → NEWEST (builds stable centroids)
 * - Batch size: 25 articles (rate limit compliance)
 * - Pause every 100 articles for ANN index refresh
 * - Freeze merges until Pass 2 (prevents premature clustering)
 *
 * Usage:
 *   node scripts/backfill-clustering-v2.js [--dry-run] [--limit=N]
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { openaiClient } from './lib/openai-client.js';

// Load environment variables from .env
dotenv.config();
import {
  canonicalizeUrl,
  extractArtifacts,
  extractKeyphrases,
  extractGeography,
  cleanContent,
  getFirstSentences
} from './lib/extraction-utils.js';

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  BATCH_SIZE: 25,          // Articles per batch
  PAUSE_EVERY: 100,        // Pause for index refresh
  PAUSE_DURATION: 5000,    // 5 seconds
  DRY_RUN: process.argv.includes('--dry-run'),
  LIMIT: parseInt(process.argv.find(arg => arg.startsWith('--limit='))?.split('=')[1]) || null
};

console.log('[backfill] Configuration:', CONFIG);

// ============================================================================
// Main Backfill Logic
// ============================================================================

async function backfillArticles() {
  console.log('[backfill] Starting backfill process...');
  console.log('[backfill] This will process articles OLDEST → NEWEST');

  // 1. Get all articles that need processing (exclude test articles)
  let query = supabase
    .from('articles')
    .select('id, title, content, url, published_at')
    .is('embedding_v1', null)  // Only articles without embeddings
    .not('id', 'like', 'test-%')  // Exclude test articles
    .not('id', 'like', 'quick-test-%')  // Exclude quick test articles
    .not('id', 'like', 'art-conc-%')  // Exclude concurrent test articles
    .order('published_at', { ascending: true });  // OLDEST first

  if (CONFIG.LIMIT) {
    query = query.limit(CONFIG.LIMIT);
  }

  const { data: articles, error } = await query;

  if (error) {
    console.error('[backfill] Failed to fetch articles:', error);
    return;
  }

  console.log(`[backfill] Found ${articles.length} articles to process`);

  if (CONFIG.DRY_RUN) {
    console.log('[backfill] DRY RUN - No changes will be made');
    console.log('[backfill] Sample articles:', articles.slice(0, 5).map(a => ({
      id: a.id,
      title: a.title.substring(0, 60),
      published: a.published_at
    })));
    return;
  }

  // 2. Process in batches
  let processed = 0;
  let errors = 0;

  for (let i = 0; i < articles.length; i += CONFIG.BATCH_SIZE) {
    const batch = articles.slice(i, i + CONFIG.BATCH_SIZE);
    console.log(`\n[backfill] Processing batch ${Math.floor(i / CONFIG.BATCH_SIZE) + 1} (articles ${i + 1}-${i + batch.length})...`);

    for (const article of batch) {
      try {
        await processArticle(article);
        processed++;
        console.log(`  ✓ ${article.id}: ${article.title.substring(0, 50)}...`);
      } catch (error) {
        errors++;
        console.error(`  ✗ ${article.id}: ${error.message}`);
      }
    }

    // Pause every 100 articles for index refresh
    if (processed % CONFIG.PAUSE_EVERY === 0 && processed > 0) {
      console.log(`\n[backfill] Processed ${processed} articles. Pausing ${CONFIG.PAUSE_DURATION / 1000}s for index refresh...`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.PAUSE_DURATION));
    }
  }

  console.log(`\n[backfill] ✅ Complete!`);
  console.log(`[backfill] Processed: ${processed}, Errors: ${errors}`);

  // Check budget
  const { data: dailySpend } = await supabase.rpc('get_daily_openai_spend');
  const { data: monthlySpend } = await supabase.rpc('get_monthly_openai_spend');
  console.log(`[backfill] OpenAI spend: Daily=$${parseFloat(dailySpend || 0).toFixed(2)}, 30-day=$${parseFloat(monthlySpend || 0).toFixed(2)}`);
}

/**
 * Process a single article: extract all metadata
 */
async function processArticle(article) {
  const metadata = {};

  // 1. Clean content
  const cleanedContent = cleanContent(article.content || '');

  // 2. Extract entities (OpenAI)
  try {
    const entityResult = await openaiClient.extractEntities({
      id: article.id,
      title: article.title,
      content: cleanedContent
    });

    metadata.entities = entityResult.entities || [];
    metadata.primary_actor = entityResult.primary_actor;
  } catch (error) {
    console.warn(`    ⚠ Entity extraction failed: ${error.message}`);
    metadata.entities = [];
    metadata.primary_actor = null;
  }

  // 3. Generate embedding (OpenAI)
  try {
    const embedding = await openaiClient.generateEmbedding({
      id: article.id,
      title: article.title,
      content: getFirstSentences(cleanedContent, 3)
    });

    metadata.embedding_v1 = embedding;
    metadata.embedding_model_v1 = 'text-embedding-ada-002';
  } catch (error) {
    console.warn(`    ⚠ Embedding generation failed: ${error.message}`);
    throw error;  // Embedding is critical, fail if it errors
  }

  // 4. Extract keyphrases (local, no API)
  metadata.keyphrases = extractKeyphrases(
    `${article.title}\n\n${getFirstSentences(cleanedContent, 5)}`,
    10
  );

  // 5. Extract quote hashes (local, no API)
  metadata.quote_hashes = openaiClient.extractQuotes(cleanedContent);

  // 6. Extract artifacts (local, no API)
  metadata.artifact_urls = extractArtifacts(cleanedContent, article.url);

  // 7. Canonicalize URL (local, no API)
  metadata.url_canonical = canonicalizeUrl(article.url);

  // 8. Extract geography (local, no API)
  metadata.geo = extractGeography(`${article.title}\n\n${cleanedContent}`);

  // 9. Update article in database
  const { error: updateError } = await supabase
    .from('articles')
    .update({
      embedding_v1: `[${metadata.embedding_v1.join(',')}]`,  // pgvector format
      embedding_model_v1: metadata.embedding_model_v1,
      entities: metadata.entities,
      keyphrases: metadata.keyphrases,
      quote_hashes: metadata.quote_hashes,
      artifact_urls: metadata.artifact_urls,
      url_canonical: metadata.url_canonical,
      geo: metadata.geo
    })
    .eq('id', article.id);

  if (updateError) {
    throw new Error(`Database update failed: ${updateError.message}`);
  }
}

// ============================================================================
// Run
// ============================================================================

backfillArticles()
  .then(() => {
    console.log('[backfill] Exiting...');
    process.exit(0);
  })
  .catch(error => {
    console.error('[backfill] Fatal error:', error);
    process.exit(1);
  });
