#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_TEST_URL,
  process.env.SUPABASE_TEST_SERVICE_KEY
);

async function checkEmbeddingTiming() {
  console.log('=== EMBEDDING TIMING ANALYSIS ===\n');

  // Check enrichArticles() query logic
  console.log('Query 1: Articles created in recent run (2025-12-19 03:00+):\n');

  const { data: recentArticles } = await supabase
    .from('articles')
    .select('id, title, source_name, created_at, embedding_v1')
    .gt('created_at', '2025-12-19 03:00:00')
    .order('created_at', { ascending: false });

  console.log(`Total articles from recent run: ${recentArticles.length}`);
  const recentWithEmbedding = recentArticles.filter(a => a.embedding_v1 !== null);
  console.log(`With embeddings: ${recentWithEmbedding.length}\n`);

  // Check what enrichArticles() would have queried
  console.log('Query 2: What enrichArticles() queries (no embedding, ordered by created_at ASC, limit 100):\n');

  const { data: enrichTarget } = await supabase
    .from('articles')
    .select('id, title, source_name, created_at, embedding_v1')
    .is('embedding_v1', null)
    .order('created_at', { ascending: true })
    .limit(100);

  console.log(`Articles enrichArticles() would target: ${enrichTarget.length}`);

  if (enrichTarget.length > 0) {
    const oldestDate = new Date(enrichTarget[0].created_at);
    const newestDate = new Date(enrichTarget[enrichTarget.length - 1].created_at);
    console.log(`Date range: ${oldestDate.toISOString()} to ${newestDate.toISOString()}`);

    // Check how many are from recent run
    const fromRecentRun = enrichTarget.filter(a => new Date(a.created_at) > new Date('2025-12-19 03:00:00'));
    console.log(`\nFrom recent run (2025-12-19 03:00+): ${fromRecentRun.length}`);
    console.log(`From BEFORE recent run: ${enrichTarget.length - fromRecentRun.length}\n`);
  }

  // Check if there's a backlog
  const { data: allNoEmbedding } = await supabase
    .from('articles')
    .select('id, created_at', { count: 'exact', head: true })
    .is('embedding_v1', null);

  console.log(`\n=== BACKLOG ===`);
  console.log(`Total articles without embeddings: ${allNoEmbedding?.length || 0}`);

  // Check if NYT/WaPo were already in DB before this run
  console.log(`\n=== HYPOTHESIS: Were NYT/WaPo created BEFORE this run? ===\n`);

  const nyt = recentArticles.filter(a => a.source_name === 'NYT Politics');
  const wapo = recentArticles.filter(a => a.source_name === 'WaPo Politics');

  console.log(`NYT articles in recent run: ${nyt.length}`);
  if (nyt.length > 0) {
    console.log(`  Earliest: ${nyt[nyt.length - 1].created_at}`);
    console.log(`  Latest: ${nyt[0].created_at}`);
    console.log(`  With embeddings: ${nyt.filter(a => a.embedding_v1 !== null).length}`);
  }

  console.log(`\nWaPo articles in recent run: ${wapo.length}`);
  if (wapo.length > 0) {
    console.log(`  Earliest: ${wapo[wapo.length - 1].created_at}`);
    console.log(`  Latest: ${wapo[0].created_at}`);
    console.log(`  With embeddings: ${wapo.filter(a => a.embedding_v1 !== null).length}`);
  }

  // Check article creation order
  console.log(`\n=== ARTICLE CREATION ORDER (first 10 and last 10) ===\n`);

  const sorted = [...recentArticles].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  console.log('FIRST 10 (oldest in recent run):');
  sorted.slice(0, 10).forEach(a => {
    console.log(`  ${a.created_at} | ${a.source_name.padEnd(25)} | Embedding: ${a.embedding_v1 ? 'YES' : 'NO '}`);
  });

  console.log('\nLAST 10 (newest in recent run):');
  sorted.slice(-10).forEach(a => {
    console.log(`  ${a.created_at} | ${a.source_name.padEnd(25)} | Embedding: ${a.embedding_v1 ? 'YES' : 'NO '}`);
  });
}

checkEmbeddingTiming().catch(console.error);
