#!/usr/bin/env node
/**
 * TTRC-234: Backfill Article Embeddings
 *
 * Generates embeddings for articles that don't have them yet.
 * Enqueues article.enrich jobs into the job queue for processing.
 *
 * Usage:
 *   node scripts/backfill-article-embeddings.js [limit]
 *
 * Examples:
 *   node scripts/backfill-article-embeddings.js 5      # Backfill 5 articles (test)
 *   node scripts/backfill-article-embeddings.js 50     # Backfill 50 articles
 *   node scripts/backfill-article-embeddings.js all    # Backfill ALL articles
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getArticlesWithoutEmbeddings(limit = null) {
  let query = supabase
    .from('articles')
    .select('id, title, url, published_at')
    .is('embedding_v1', null)
    .order('published_at', { ascending: false });

  if (limit && limit !== 'all') {
    query = query.limit(parseInt(limit));
  }

  const { data, error } = await query;

  if (error) {
    console.error('❌ Failed to fetch articles:', error.message);
    return null;
  }

  return data;
}

async function enqueueEnrichmentJob(articleId) {
  // Compute payload_hash for idempotent deduplication
  const payload = { article_id: articleId };
  const payloadText = JSON.stringify(payload);

  // SHA-256 hash of payload (matching SQL function behavior)
  const encoder = new TextEncoder();
  const data = encoder.encode(payloadText);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const payloadHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  const { data: result, error } = await supabase
    .from('job_queue')
    .insert({
      job_type: 'article.enrich',
      payload: payload,
      payload_hash: payloadHash,  // CRITICAL: Set payload_hash for ON CONFLICT deduplication
      status: 'pending',
      run_at: new Date().toISOString(),
      created_at: new Date().toISOString()
    })
    .select('id');

  if (error) {
    // Check if it's a duplicate (ON CONFLICT with payload_hash)
    if (error.code === '23505') {
      return { success: true, jobId: null, duplicate: true };
    }
    console.error(`❌ Failed to enqueue job for ${articleId}:`, error.message);
    return { success: false, jobId: null };
  }

  return { success: true, jobId: result?.[0]?.id || null, duplicate: false };
}

async function main() {
  const limit = process.argv[2] || '5';

  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║        TTRC-234: Article Embedding Backfill                   ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  console.log(`📊 Fetching articles without embeddings (limit: ${limit})...\n`);

  const articles = await getArticlesWithoutEmbeddings(limit);

  if (!articles) {
    console.error('❌ Failed to fetch articles');
    process.exit(1);
  }

  if (articles.length === 0) {
    console.log('✅ All articles already have embeddings!');
    process.exit(0);
  }

  console.log(`Found ${articles.length} articles without embeddings\n`);

  // Show sample
  console.log('Sample articles:');
  articles.slice(0, 5).forEach(a => {
    console.log(`  - ${a.id}: ${a.title.slice(0, 60)}...`);
  });

  if (articles.length > 5) {
    console.log(`  ... and ${articles.length - 5} more`);
  }

  console.log('\n');

  // Confirm before proceeding
  if (limit === 'all' || parseInt(limit) > 10) {
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    await new Promise((resolve) => {
      rl.question(`\nEnqueue ${articles.length} enrichment jobs? (y/n): `, (answer) => {
        if (answer.toLowerCase() !== 'y') {
          console.log('❌ Aborted');
          process.exit(0);
        }
        rl.close();
        resolve();
      });
    });
  }

  // Enqueue jobs
  console.log('\n📤 Enqueueing enrichment jobs...\n');

  let enqueued = 0;
  let duplicates = 0;
  let failed = 0;

  for (const article of articles) {
    const result = await enqueueEnrichmentJob(article.id);

    if (result.success) {
      if (result.duplicate) {
        duplicates++;
        process.stdout.write('D');
      } else {
        enqueued++;
        process.stdout.write('✓');
      }
    } else {
      failed++;
      process.stdout.write('✗');
    }

    // Add newline every 50 articles
    if ((enqueued + duplicates + failed) % 50 === 0) {
      process.stdout.write('\n');
    }
  }

  console.log('\n');
  console.log('═'.repeat(80));
  console.log('\n📊 BACKFILL SUMMARY\n');
  console.log(`  Total articles: ${articles.length}`);
  console.log(`  Jobs enqueued: ${enqueued}`);
  console.log(`  Already enqueued: ${duplicates}`);
  console.log(`  Failed: ${failed}`);

  if (failed > 0) {
    console.log('\n⚠️  Some jobs failed to enqueue. Check logs above for details.');
  }

  if (enqueued > 0) {
    console.log('\n✅ Enrichment jobs enqueued successfully!');
    console.log('\n📝 Next steps:');
    console.log('   1. Start job queue worker: node scripts/job-queue-worker.js');
    console.log('   2. Monitor progress in job_queue table');
    console.log('   3. Verify embeddings: SELECT COUNT(*) FROM articles WHERE embedding_v1 IS NOT NULL;');

    // Cost estimate
    const estimatedCost = enqueued * 0.0002;
    console.log(`\n💰 Estimated cost: $${estimatedCost.toFixed(4)} (~${enqueued} articles × $0.0002/article)`);
  }

  console.log('\n');
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
