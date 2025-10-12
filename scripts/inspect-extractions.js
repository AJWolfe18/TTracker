/**
 * Inspection Tool for Clustering V2 Extractions
 *
 * View extracted metadata from backfill process
 *
 * Usage:
 *   node scripts/inspect-extractions.js [article-id]
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

async function inspectExtractions(articleId = null) {
  console.log('\n=== CLUSTERING V2 EXTRACTION INSPECTOR ===\n');

  // 1. Overall Stats
  const { data: stats } = await supabase.rpc('rpc', {
    sql: `
      SELECT
        COUNT(*) as total_articles,
        COUNT(*) FILTER (WHERE embedding_v1 IS NOT NULL) as with_embeddings,
        COUNT(*) FILTER (WHERE jsonb_array_length(entities) > 0) as with_entities,
        COUNT(*) FILTER (WHERE array_length(keyphrases, 1) > 0) as with_keyphrases,
        COUNT(*) FILTER (WHERE geo IS NOT NULL) as with_geo,
        COUNT(*) FILTER (WHERE array_length(artifact_urls, 1) > 0) as with_artifacts
      FROM articles
    `
  }).single();

  console.log('📊 Extraction Coverage:');
  console.log(`   Total Articles: ${stats?.total_articles || 0}`);
  console.log(`   With Embeddings: ${stats?.with_embeddings || 0}`);
  console.log(`   With Entities: ${stats?.with_entities || 0}`);
  console.log(`   With Keyphrases: ${stats?.with_keyphrases || 0}`);
  console.log(`   With Geography: ${stats?.with_geo || 0}`);
  console.log(`   With Artifacts: ${stats?.with_artifacts || 0}`);

  // 2. Cost Summary
  const { data: costs } = await supabase
    .from('openai_usage')
    .select('operation, tokens_used, cost_usd, model, created_at');

  if (costs && costs.length > 0) {
    const totalCost = costs.reduce((sum, c) => sum + parseFloat(c.cost_usd), 0);
    const totalTokens = costs.reduce((sum, c) => sum + c.tokens_used, 0);

    console.log('\n💰 OpenAI Usage:');
    console.log(`   Total API Calls: ${costs.length}`);
    console.log(`   Total Tokens: ${totalTokens.toLocaleString()}`);
    console.log(`   Total Cost: $${totalCost.toFixed(4)}`);

    const byOperation = costs.reduce((acc, c) => {
      if (!acc[c.operation]) acc[c.operation] = { count: 0, cost: 0 };
      acc[c.operation].count++;
      acc[c.operation].cost += parseFloat(c.cost_usd);
      return acc;
    }, {});

    console.log('\n   By Operation:');
    for (const [op, data] of Object.entries(byOperation)) {
      console.log(`   - ${op}: ${data.count} calls, $${data.cost.toFixed(4)}`);
    }
  }

  // 3. Sample Articles
  if (articleId) {
    console.log(`\n🔍 Article Details: ${articleId}\n`);

    const { data: article } = await supabase
      .from('articles')
      .select('*')
      .eq('id', articleId)
      .single();

    if (!article) {
      console.log('   ❌ Article not found');
      return;
    }

    console.log(`   Title: ${article.title}`);
    console.log(`   URL: ${article.url}`);
    console.log(`   Canonical URL: ${article.url_canonical || 'N/A'}`);
    console.log(`   Published: ${article.published_at}`);

    console.log('\n   📋 Entities:');
    if (article.entities && article.entities.length > 0) {
      article.entities.forEach(e => {
        console.log(`   - ${e.name} (${e.type}) [${e.id}] - confidence: ${e.confidence}`);
      });
    } else {
      console.log('   (none)');
    }

    console.log('\n   🔑 Keyphrases:');
    console.log(`   ${article.keyphrases?.join(', ') || '(none)'}`);

    console.log('\n   🌍 Geography:');
    console.log(`   ${article.geo ? JSON.stringify(article.geo) : '(none)'}`);

    console.log('\n   📎 Artifacts:');
    console.log(`   ${article.artifact_urls?.join('\n   ') || '(none)'}`);

    console.log('\n   💬 Quote Hashes:');
    console.log(`   ${article.quote_hashes?.length || 0} quotes detected`);

    console.log('\n   🧮 Embedding:');
    console.log(`   Model: ${article.embedding_model_v1 || 'N/A'}`);
    console.log(`   Status: ${article.embedding_v1 ? '✅ Generated' : '❌ Missing'}`);

  } else {
    // Show sample of recently processed articles
    console.log('\n📄 Sample Processed Articles:\n');

    const { data: samples } = await supabase
      .from('articles')
      .select('id, title, entities, keyphrases')
      .not('embedding_v1', 'is', null)
      .order('id', { ascending: false })
      .limit(5);

    if (samples && samples.length > 0) {
      samples.forEach((a, i) => {
        console.log(`   ${i + 1}. ${a.title.substring(0, 60)}...`);
        console.log(`      ID: ${a.id}`);
        console.log(`      Entities: ${a.entities?.length || 0}`);
        console.log(`      Keyphrases: ${a.keyphrases?.length || 0}`);
        console.log('');
      });

      console.log('   💡 To inspect a specific article:');
      console.log(`      node scripts/inspect-extractions.js ${samples[0].id}`);
    }
  }

  console.log('\n');
}

// Run
const articleId = process.argv[2];
inspectExtractions(articleId)
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
