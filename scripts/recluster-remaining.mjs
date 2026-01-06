#!/usr/bin/env node
/**
 * Cluster remaining unlinked articles
 *
 * Use this after recluster-all.mjs if some articles were missed.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { clusterArticle } from './rss/hybrid-clustering.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DELAY_MS = 100;

async function main() {
  console.log('='.repeat(60));
  console.log('CLUSTER REMAINING ARTICLES');
  console.log('='.repeat(60));
  console.log('');

  // Get all articles with embeddings (with pagination)
  let allArticles = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data: batch } = await supabase
      .from('articles')
      .select('id, title, published_at')
      .not('embedding_v1', 'is', null)
      .order('published_at', { ascending: true })
      .range(offset, offset + pageSize - 1);

    allArticles = allArticles.concat(batch || []);
    if (!batch || batch.length < pageSize) break;
    offset += pageSize;
  }

  // Get already linked articles
  const { data: linked } = await supabase
    .from('article_story')
    .select('article_id');

  const linkedSet = new Set(linked.map(l => l.article_id));

  // Find unlinked articles (excluding test articles)
  const unlinked = allArticles.filter(a =>
    !linkedSet.has(a.id) &&
    !a.id.startsWith('test-') &&
    !a.id.startsWith('quick-test-')
  );

  console.log('Total articles with embeddings:', allArticles.length);
  console.log('Already linked:', linkedSet.size);
  console.log('Unlinked (excluding test):', unlinked.length);
  console.log('');

  if (unlinked.length === 0) {
    console.log('All articles are clustered!');
    return;
  }

  console.log('Processing', unlinked.length, 'articles...');
  console.log('');

  const results = { processed: 0, attached: 0, created: 0, errors: 0 };
  const startTime = Date.now();

  for (let i = 0; i < unlinked.length; i++) {
    const article = unlinked[i];

    try {
      const result = await clusterArticle(article.id);
      results.processed++;

      if (result.created_new) {
        results.created++;
        process.stdout.write('.');
      } else {
        results.attached++;
        process.stdout.write('+');
      }

      if ((i + 1) % 50 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        console.log(` [${i + 1}/${unlinked.length}] ${elapsed}s`);
      }

      await new Promise(r => setTimeout(r, DELAY_MS));
    } catch (err) {
      results.errors++;
      process.stdout.write('X');
      console.error(`\nError on ${article.id}: ${err.message}`);
    }
  }

  console.log('');
  console.log('');
  console.log('='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log('Processed:', results.processed);
  console.log('Created new stories:', results.created);
  console.log('Attached to existing:', results.attached);
  console.log('Errors:', results.errors);
  console.log('Time:', ((Date.now() - startTime) / 1000).toFixed(1), 'seconds');
}

main().catch(console.error);
