import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_TEST_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_TEST_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runQueries() {
  console.log('=== TTRC-302 Database State Verification ===\n');

  // Query 1: Slug coverage (select only id and topic_slug to minimize egress)
  console.log('1. SLUG COVERAGE:');
  const { data: articles, error: articlesError } = await supabase
    .from('articles')
    .select('id, topic_slug');

  if (articlesError) {
    console.error('   Error:', articlesError);
  } else {
    const total = articles.length;
    const withSlug = articles.filter(a => a.topic_slug !== null && a.topic_slug !== '').length;
    const slugPct = ((withSlug / total) * 100).toFixed(1);
    console.log(`   Total Articles: ${total}`);
    console.log(`   With Slug: ${withSlug}`);
    console.log(`   Slug %: ${slugPct}%\n`);
  }

  // Query 2: Story count
  console.log('2. STORY COUNT:');
  const { count: storyCount, error: storyError } = await supabase
    .from('stories')
    .select('*', { count: 'exact', head: true });

  if (storyError) {
    console.error('   Error:', storyError);
  } else {
    console.log(`   Total Stories: ${storyCount}\n`);
  }

  // Query 3: Junction count
  console.log('3. ARTICLE-STORY JUNCTION COUNT:');
  const { count: junctionCount, error: junctionError } = await supabase
    .from('article_story')
    .select('*', { count: 'exact', head: true });

  if (junctionError) {
    console.error('   Error:', junctionError);
  } else {
    console.log(`   Total Junctions: ${junctionCount}\n`);
  }

  // Query 4: Enrichment status (select only id and summary_neutral)
  console.log('4. ENRICHMENT STATUS:');
  const { data: stories, error: enrichError } = await supabase
    .from('stories')
    .select('id, summary_neutral');

  if (enrichError) {
    console.error('   Error:', enrichError);
  } else {
    const enriched = stories.filter(s => s.summary_neutral !== null && s.summary_neutral !== '').length;
    console.log(`   Enriched Stories: ${enriched} / ${stories.length}\n`);
  }

  // Query 5: Embeddings (count only, don't fetch actual embeddings)
  console.log('5. ARTICLES WITH EMBEDDINGS:');
  const { data: embeddingCheck, error: embeddingError } = await supabase
    .from('articles')
    .select('id')
    .not('embedding_v1', 'is', null);

  if (embeddingError) {
    console.error('   Error:', embeddingError);
  } else {
    console.log(`   Articles with Embeddings: ${embeddingCheck.length}\n`);
  }

  console.log('=== Summary Table ===');
  console.log('┌─────────────────────────────┬──────────┐');
  console.log('│ Metric                      │ Value    │');
  console.log('├─────────────────────────────┼──────────┤');
  if (articles) {
    const total = articles.length;
    const withSlug = articles.filter(a => a.topic_slug !== null && a.topic_slug !== '').length;
    const slugPct = ((withSlug / total) * 100).toFixed(1);
    console.log(`│ Total Articles              │ ${String(total).padStart(8)} │`);
    console.log(`│ Articles with Slug          │ ${String(withSlug).padStart(8)} │`);
    console.log(`│ Slug Coverage %             │ ${String(slugPct + '%').padStart(8)} │`);
  }
  if (storyCount !== undefined) {
    console.log(`│ Total Stories               │ ${String(storyCount).padStart(8)} │`);
  }
  if (junctionCount !== undefined) {
    console.log(`│ Article-Story Junctions     │ ${String(junctionCount).padStart(8)} │`);
  }
  if (stories) {
    const enriched = stories.filter(s => s.summary_neutral !== null && s.summary_neutral !== '').length;
    console.log(`│ Enriched Stories            │ ${String(enriched).padStart(8)} │`);
  }
  if (embeddingCheck) {
    console.log(`│ Articles with Embeddings    │ ${String(embeddingCheck.length).padStart(8)} │`);
  }
  console.log('└─────────────────────────────┴──────────┘');
}

runQueries().catch(console.error);
