#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_TEST_URL,
  process.env.SUPABASE_TEST_SERVICE_KEY
);

async function checkEmbeddings() {
  console.log('=== CHECKING ARTICLE EMBEDDINGS ===\n');

  // Get recent articles
  const { data: articles } = await supabase
    .from('articles')
    .select('id, title, source_name, topic_slug, created_at, embedding_v1')
    .gt('created_at', '2025-12-19 03:00:00')
    .order('created_at', { ascending: false })
    .limit(100);

  console.log(`Total articles: ${articles.length}\n`);

  // Count with/without embeddings
  const withEmbedding = articles.filter(a => a.embedding_v1 !== null);
  const withoutEmbedding = articles.filter(a => a.embedding_v1 === null);

  console.log(`With embedding: ${withEmbedding.length}`);
  console.log(`Without embedding: ${withoutEmbedding.length}\n`);

  // Group by source
  console.log('=== EMBEDDINGS BY SOURCE ===\n');

  const bySources = new Map();
  articles.forEach(a => {
    if (!bySources.has(a.source_name)) {
      bySources.set(a.source_name, { total: 0, withEmbedding: 0 });
    }
    const stats = bySources.get(a.source_name);
    stats.total++;
    if (a.embedding_v1 !== null) {
      stats.withEmbedding++;
    }
  });

  for (const [source, stats] of bySources.entries()) {
    const pct = ((stats.withEmbedding / stats.total) * 100).toFixed(0);
    console.log(`${source}:`);
    console.log(`  Total: ${stats.total}`);
    console.log(`  With embedding: ${stats.withEmbedding} (${pct}%)`);
    console.log('');
  }

  // Show articles without embeddings
  console.log('\n=== SAMPLE ARTICLES WITHOUT EMBEDDINGS ===\n');

  withoutEmbedding.slice(0, 10).forEach(a => {
    console.log(`"${a.title.substring(0, 70)}..."`);
    console.log(`  Source: ${a.source_name}`);
    console.log(`  Topic slug: ${a.topic_slug || 'NONE'}`);
    console.log('');
  });

  // Check if content/excerpt exists for articles without embeddings
  console.log('\n=== CHECKING WHY EMBEDDINGS FAILED ===\n');

  const { data: detailedArticles } = await supabase
    .from('articles')
    .select('id, title, source_name, content, excerpt, embedding_v1')
    .in('id', withoutEmbedding.slice(0, 5).map(a => a.id));

  detailedArticles.forEach(a => {
    console.log(`Article: "${a.title.substring(0, 60)}..."`);
    console.log(`  Source: ${a.source_name}`);
    console.log(`  Has content: ${a.content ? 'YES' : 'NO'}`);
    console.log(`  Has excerpt: ${a.excerpt ? 'YES' : 'NO'}`);
    if (a.content) {
      console.log(`  Content length: ${a.content.length} chars`);
    }
    if (a.excerpt) {
      console.log(`  Excerpt length: ${a.excerpt.length} chars`);
    }
    console.log('');
  });
}

checkEmbeddings().catch(console.error);
