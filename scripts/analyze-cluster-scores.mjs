#!/usr/bin/env node
/**
 * TTRC-307: Analyze cluster scores with per-component breakdown
 *
 * Exports CSV with columns:
 * - story_id, article_id, story_headline, article_title
 * - embedding_score, entity_score, title_score, time_score, geo_score, total_score
 * - non_stopword_entity_overlap_count, has_title_overlap (debug columns)
 * - threshold, would_attach
 *
 * This captures baseline metrics BEFORE scoring changes for comparison.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'fs';
import natural from 'natural';

const TfIdf = natural.TfIdf;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Current weights (before changes)
const WEIGHTS = {
  embedding: 0.40,
  entities: 0.25,
  title: 0.15,
  time: 0.10,
  keyphrases: 0.05,
  geography: 0.05,
};

// Entities that will become stopwords (for analysis)
const ENTITY_STOPWORDS = new Set([
  'US-TRUMP',
  'US-BIDEN',
  'LOC-USA',
  'ORG-WHITE-HOUSE',
  'ORG-DEM',
  'ORG-GOP',
  'ORG-CONGRESS',
  'ORG-SENATE',
  'ORG-HOUSE',
  'ORG-SUPREME-COURT',
  'ORG-DOJ',
  'ORG-FBI',
  'LOC-WASHINGTON',
]);

const TIME_DECAY_HOURS = 72;

// ============================================================================
// Scoring Functions (duplicated to capture current behavior)
// ============================================================================

function cosineSimilarity(vectorA, vectorB) {
  if (!vectorA?.length || !vectorB?.length || vectorA.length !== vectorB.length) return 0;

  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < vectorA.length; i++) {
    dotProduct += vectorA[i] * vectorB[i];
    normA += vectorA[i] * vectorA[i];
    normB += vectorB[i] * vectorB[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  if (normA === 0 || normB === 0) return 0;

  return dotProduct / (normA * normB);
}

function calculateEmbeddingScore(embA, embB) {
  if (!embA || !embB) return 0;
  const cosine = cosineSimilarity(embA, embB);
  return (cosine + 1) / 2;  // Current normalization
}

function calculateTitleScore(titleA, titleB) {
  if (!titleA || !titleB) return 0;

  const tfidf = new TfIdf();
  tfidf.addDocument(titleA.toLowerCase());
  tfidf.addDocument(titleB.toLowerCase());

  const vectorA = [];
  const vectorB = [];
  const terms = new Set();

  tfidf.listTerms(0).forEach(item => terms.add(item.term));
  tfidf.listTerms(1).forEach(item => terms.add(item.term));

  terms.forEach(term => {
    vectorA.push(tfidf.tfidf(term, 0));
    vectorB.push(tfidf.tfidf(term, 1));
  });

  // Current bug: uses embedding normalization on TF-IDF
  return calculateEmbeddingScore(vectorA, vectorB);
}

function calculateEntityScore(articleEntities, storyEntityCounter) {
  if (!articleEntities || !storyEntityCounter) return { score: 0, nonStopwordOverlap: 0 };

  const articleEntityIds = new Set((articleEntities || []).map(e => e?.id).filter(Boolean));
  const storyEntityIds = new Set(Object.keys(storyEntityCounter || {}));

  // Current Jaccard (with stopwords)
  const intersection = new Set([...articleEntityIds].filter(id => storyEntityIds.has(id)));
  const union = new Set([...articleEntityIds, ...storyEntityIds]);
  const score = union.size > 0 ? intersection.size / union.size : 0;

  // Calculate what non-stopword overlap WOULD be
  const articleNonStop = new Set([...articleEntityIds].filter(id => !ENTITY_STOPWORDS.has(id)));
  const storyNonStop = new Set([...storyEntityIds].filter(id => !ENTITY_STOPWORDS.has(id)));
  const nonStopOverlap = [...articleNonStop].filter(id => storyNonStop.has(id)).length;

  return { score, nonStopwordOverlap: nonStopOverlap };
}

function calculateTimeScore(articleTime, storyTime) {
  if (!articleTime || !storyTime) return 0.5;

  const articleDate = new Date(articleTime);
  const storyDate = new Date(storyTime);
  const diffMs = Math.abs(articleDate - storyDate);
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours <= TIME_DECAY_HOURS) {
    return 1.0 - (diffHours / TIME_DECAY_HOURS);
  }
  return 0.0;
}

function calculateGeoScore(articleGeo, storyGeo) {
  if (!articleGeo || !storyGeo) return 0;

  let matches = 0, total = 0;

  if (articleGeo.country && storyGeo.country) {
    total++;
    if (articleGeo.country === storyGeo.country) matches++;
  }
  if (articleGeo.state && storyGeo.state) {
    total++;
    if (articleGeo.state === storyGeo.state) matches++;
  }
  if (articleGeo.city && storyGeo.city) {
    total++;
    if (articleGeo.city === storyGeo.city) matches++;
  }

  return total > 0 ? matches / total : 0;
}

function getThreshold(article) {
  if (!article) return 0.62;

  const domain = article.source_domain || '';
  const WIRE_DOMAINS = ['ap.org', 'apnews.com', 'reuters.com', 'afp.com', 'bloomberg.com'];

  if (WIRE_DOMAINS.some(wd => domain.includes(wd))) return 0.60;
  if (article.opinion_flag) return 0.68;
  if (article.artifact_urls?.length > 0) return 0.64;

  return 0.62;
}

// ============================================================================
// Main Analysis
// ============================================================================

async function analyzeScores() {
  console.log('TTRC-307: Analyzing cluster scores (baseline before changes)...\n');

  // Get all article-story links
  const { data: links, error: e1 } = await supabase
    .from('article_story')
    .select('article_id, story_id, similarity_score');

  if (e1) {
    console.error('Failed to fetch article_story:', e1);
    return;
  }

  // Group by story, filter to multi-article stories
  const storyGroups = {};
  for (const link of links) {
    if (!storyGroups[link.story_id]) storyGroups[link.story_id] = [];
    storyGroups[link.story_id].push(link);
  }

  const multiArticleStoryIds = Object.keys(storyGroups)
    .filter(id => storyGroups[id].length >= 2);

  // Also need integer version for DB query
  const multiArticleStoryIdsInt = multiArticleStoryIds.map(id => parseInt(id));

  console.log(`Found ${multiArticleStoryIds.length} multi-article stories`);

  // Fetch stories with centroid
  const { data: stories, error: e2 } = await supabase
    .from('stories')
    .select('id, primary_headline, centroid_embedding_v1, entity_counter, last_updated_at')
    .in('id', multiArticleStoryIdsInt);

  if (e2) {
    console.error('Failed to fetch stories:', e2);
    return;
  }

  // Get all article IDs we need
  const allArticleIds = multiArticleStoryIds.flatMap(id =>
    storyGroups[id].map(l => l.article_id)
  );

  console.log(`Fetching ${allArticleIds.length} articles...`);

  // Fetch articles in batches (small batches - article IDs are long UUIDs)
  const batchSize = 50;
  const allArticles = [];
  for (let i = 0; i < allArticleIds.length; i += batchSize) {
    const batch = allArticleIds.slice(i, i + batchSize);
    const { data: arts, error: artError } = await supabase
      .from('articles')
      .select('id, title, embedding_v1, entities, published_at, geo, source_domain, opinion_flag, artifact_urls')
      .in('id', batch);
    if (artError) {
      console.error('Batch fetch error:', artError.message);
      continue;
    }
    if (arts) allArticles.push(...arts);
  }

  console.log(`Fetched ${allArticles.length} articles`);

  const articleMap = new Map(allArticles.map(a => [a.id, a]));
  const storyMap = new Map(stories.map(s => [s.id, s]));

  // Build rows
  const rows = [];
  let processed = 0;

  for (const storyIdStr of multiArticleStoryIds) {
    const storyId = parseInt(storyIdStr);
    const story = storyMap.get(storyId);
    if (!story) continue;

    // Parse centroid if string
    let centroid = story.centroid_embedding_v1;
    if (centroid && typeof centroid === 'string') {
      try { centroid = JSON.parse(centroid); } catch { centroid = null; }
    }

    for (const link of storyGroups[storyIdStr]) {
      const article = articleMap.get(link.article_id);
      if (!article) continue;

      // Parse embedding if string
      let embedding = article.embedding_v1;
      if (embedding && typeof embedding === 'string') {
        try { embedding = JSON.parse(embedding); } catch { embedding = null; }
      }

      // Calculate scores
      const embeddingScore = calculateEmbeddingScore(embedding, centroid);
      const titleScore = calculateTitleScore(article.title, story.primary_headline);
      const { score: entityScore, nonStopwordOverlap } = calculateEntityScore(
        article.entities,
        story.entity_counter
      );
      const timeScore = calculateTimeScore(article.published_at, story.last_updated_at);
      const geoScore = 0; // Stories don't have geography column

      const totalScore =
        WEIGHTS.embedding * embeddingScore +
        WEIGHTS.entities * entityScore +
        WEIGHTS.title * titleScore +
        WEIGHTS.time * timeScore +
        WEIGHTS.geography * geoScore;
      // Note: keyphrases not included (broken in current impl)

      const threshold = getThreshold(article);
      const hasTitleOverlap = titleScore >= 0.50;

      rows.push({
        story_id: storyId,
        article_id: article.id,
        story_headline: story.primary_headline,
        article_title: article.title,
        embedding_score: embeddingScore.toFixed(4),
        entity_score: entityScore.toFixed(4),
        title_score: titleScore.toFixed(4),
        time_score: timeScore.toFixed(4),
        geo_score: geoScore.toFixed(4),
        total_score: totalScore.toFixed(4),
        stored_score: link.similarity_score?.toFixed(4) || 'N/A',
        non_stopword_entity_overlap: nonStopwordOverlap,
        has_title_overlap: hasTitleOverlap ? 'yes' : 'no',
        threshold: threshold.toFixed(2),
        would_attach: totalScore >= threshold ? 'yes' : 'no',
      });

      processed++;
      if (processed % 100 === 0) {
        process.stdout.write(`\rProcessed ${processed} article-story pairs...`);
      }
    }
  }

  console.log(`\nProcessed ${processed} pairs total\n`);

  // CSV output
  const escapeCsv = (str) => {
    if (str == null) return '';
    const s = String(str).replace(/"/g, '""');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
  };

  const header = [
    'story_id', 'article_id', 'story_headline', 'article_title',
    'embedding_score', 'entity_score', 'title_score', 'time_score', 'geo_score',
    'total_score', 'stored_score',
    'non_stopword_entity_overlap', 'has_title_overlap',
    'threshold', 'would_attach'
  ].join(',');

  const csvLines = [header];
  for (const row of rows) {
    csvLines.push([
      row.story_id,
      row.article_id,
      escapeCsv(row.story_headline),
      escapeCsv(row.article_title),
      row.embedding_score,
      row.entity_score,
      row.title_score,
      row.time_score,
      row.geo_score,
      row.total_score,
      row.stored_score,
      row.non_stopword_entity_overlap,
      row.has_title_overlap,
      row.threshold,
      row.would_attach,
    ].join(','));
  }

  try { mkdirSync('./exports', { recursive: true }); } catch {}

  const filename = `cluster-scores-baseline-${new Date().toISOString().split('T')[0]}.csv`;
  const filepath = `./exports/${filename}`;
  writeFileSync(filepath, csvLines.join('\n'));

  // Summary stats
  console.log('='.repeat(60));
  console.log('BASELINE SCORE ANALYSIS COMPLETE');
  console.log('='.repeat(60));
  console.log('');
  console.log('File:', filepath);
  console.log('Total pairs:', rows.length);
  console.log('Multi-article stories:', multiArticleStoryIds.length);
  console.log('');

  // Calculate aggregate stats
  const embeddings = rows.map(r => parseFloat(r.embedding_score));
  const entities = rows.map(r => parseFloat(r.entity_score));
  const titles = rows.map(r => parseFloat(r.title_score));
  const totals = rows.map(r => parseFloat(r.total_score));
  const nonStopOverlaps = rows.map(r => r.non_stopword_entity_overlap);

  const avg = arr => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const pct = (arr, p) => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * p)];
  };

  if (rows.length === 0) {
    console.log('No data to analyze. Check if articles were fetched correctly.');
    return;
  }

  console.log('SCORE DISTRIBUTIONS:');
  console.log('');
  console.log('Component      | Avg    | P25   | P50   | P75   | P95');
  console.log('---------------|--------|-------|-------|-------|------');
  console.log(`Embedding      | ${avg(embeddings).toFixed(3)}  | ${pct(embeddings, 0.25).toFixed(3)} | ${pct(embeddings, 0.5).toFixed(3)} | ${pct(embeddings, 0.75).toFixed(3)} | ${pct(embeddings, 0.95).toFixed(3)}`);
  console.log(`Entity         | ${avg(entities).toFixed(3)}  | ${pct(entities, 0.25).toFixed(3)} | ${pct(entities, 0.5).toFixed(3)} | ${pct(entities, 0.75).toFixed(3)} | ${pct(entities, 0.95).toFixed(3)}`);
  console.log(`Title          | ${avg(titles).toFixed(3)}  | ${pct(titles, 0.25).toFixed(3)} | ${pct(titles, 0.5).toFixed(3)} | ${pct(titles, 0.75).toFixed(3)} | ${pct(titles, 0.95).toFixed(3)}`);
  console.log(`Total          | ${avg(totals).toFixed(3)}  | ${pct(totals, 0.25).toFixed(3)} | ${pct(totals, 0.5).toFixed(3)} | ${pct(totals, 0.75).toFixed(3)} | ${pct(totals, 0.95).toFixed(3)}`);
  console.log('');

  // Non-stopword overlap analysis
  const zeroOverlap = nonStopOverlaps.filter(n => n === 0).length;
  const oneOverlap = nonStopOverlaps.filter(n => n === 1).length;
  const twoPlus = nonStopOverlaps.filter(n => n >= 2).length;

  console.log('NON-STOPWORD ENTITY OVERLAP (key diagnostic):');
  console.log(`  0 overlap (only stopwords): ${zeroOverlap} (${(zeroOverlap/rows.length*100).toFixed(1)}%)`);
  console.log(`  1 overlap: ${oneOverlap} (${(oneOverlap/rows.length*100).toFixed(1)}%)`);
  console.log(`  2+ overlap: ${twoPlus} (${(twoPlus/rows.length*100).toFixed(1)}%)`);
  console.log('');

  if (zeroOverlap / rows.length > 0.3) {
    console.log('⚠️  WARNING: >30% of clusters have ZERO non-stopword entity overlap!');
    console.log('   These are likely false positives caused by generic entities (US-TRUMP, etc.)');
  }

  console.log('');
  console.log('NEXT STEPS:');
  console.log('  1. Review CSV for clusters where non_stopword_entity_overlap = 0');
  console.log('  2. These are the false positives the stopword filter will fix');
  console.log('  3. After scoring changes, run this script again to compare');
}

analyzeScores().catch(console.error);
