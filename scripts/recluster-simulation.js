#!/usr/bin/env node
/**
 * TTRC-236: Re-Cluster Simulation
 *
 * READ-ONLY simulation that evaluates what story each article WOULD match
 * using current clustering thresholds. Does NOT modify any data.
 *
 * Purpose:
 * - Validate clustering quality
 * - Identify mis-clustered articles
 * - Compare simulated vs actual assignments
 * - Generate metrics for threshold tuning
 *
 * Usage:
 *   node scripts/recluster-simulation.js [limit]
 *
 * Examples:
 *   node scripts/recluster-simulation.js 50    # Test 50 articles
 *   node scripts/recluster-simulation.js 500   # Full simulation
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { generateCandidates } from './rss/candidate-generation.js';
import { calculateHybridScore, getThreshold } from './rss/scoring.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ============================================================================
// Configuration
// ============================================================================

const VERBOSE = process.argv.includes('--verbose');

// ============================================================================
// Main Simulation
// ============================================================================

async function simulateReclustering(limit = 100) {
  const results = {
    total_articles: 0,
    same_assignment: 0,      // Would cluster to same story
    different_assignment: 0, // Would cluster to different story
    would_create_new: 0,     // No match found, would create new story
    no_current_story: 0,     // Article not currently assigned
    no_candidates: 0,        // No candidates found
    skipped_no_embedding: 0, // Article missing embedding

    score_buckets: {
      high: 0,      // >= 0.80
      medium: 0,    // 0.60 - 0.79
      low: 0,       // < 0.60
    },

    different_assignments: [], // Details of re-clustered articles
    top_scores: [],           // Highest scores for analysis
  };

  console.log('Fetching articles with embeddings and story assignments...\n');

  // Get articles with their current story assignments
  const { data: articles, error } = await supabase
    .from('articles')
    .select(`
      id, title, published_at, embedding_v1, entities,
      source_domain, content, excerpt, keyphrases,
      artifact_urls, quote_hashes, geo,
      article_story!inner(story_id, similarity_score)
    `)
    .not('embedding_v1', 'is', null)
    .order('published_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Failed to fetch articles:', error.message);
    return null;
  }

  console.log(`Fetched ${articles.length} articles with embeddings\n`);

  // Process each article
  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    results.total_articles++;

    // Progress indicator
    if ((i + 1) % 25 === 0) {
      console.log(`Processing ${i + 1}/${articles.length}...`);
    }

    // Parse embedding if needed
    if (typeof article.embedding_v1 === 'string') {
      try {
        article.embedding_v1 = JSON.parse(article.embedding_v1);
      } catch {
        results.skipped_no_embedding++;
        continue;
      }
    }

    // Get current story assignment
    // Note: article_story is an object (not array) due to 1:1 relationship
    const articleStory = Array.isArray(article.article_story)
      ? article.article_story[0]
      : article.article_story;
    const currentStoryId = articleStory?.story_id || null;
    const currentScore = articleStory?.similarity_score || null;

    if (!currentStoryId) {
      results.no_current_story++;
      continue;
    }

    // Parse entities if needed
    if (typeof article.entities === 'string') {
      try {
        article.entities = JSON.parse(article.entities);
      } catch {
        article.entities = [];
      }
    }

    // Generate candidates
    let candidates;
    try {
      // Suppress candidate-gen console logs temporarily
      const originalLog = console.log;
      console.log = () => {};
      candidates = await generateCandidates(article);
      console.log = originalLog;
    } catch (err) {
      console.error(`Error generating candidates for ${article.id}:`, err.message);
      results.no_candidates++;
      continue;
    }

    if (!candidates || candidates.length === 0) {
      results.no_candidates++;
      results.would_create_new++;
      continue;
    }

    // Parse story centroids and entity_counters (returned as strings from DB)
    for (const story of candidates) {
      if (typeof story.centroid_embedding_v1 === 'string') {
        try {
          story.centroid_embedding_v1 = JSON.parse(story.centroid_embedding_v1);
        } catch {
          story.centroid_embedding_v1 = null;
        }
      }
      if (typeof story.entity_counter === 'string') {
        try {
          story.entity_counter = JSON.parse(story.entity_counter);
        } catch {
          story.entity_counter = {};
        }
      }
    }

    // Score each candidate
    const scoredCandidates = candidates
      .map(story => ({
        story_id: story.id,
        headline: story.primary_headline,
        score: calculateHybridScore(article, story)
      }))
      .filter(c => c.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scoredCandidates.length === 0) {
      results.would_create_new++;
      continue;
    }

    // Get threshold for this article type
    const threshold = getThreshold(article);

    // Find best match
    const bestMatch = scoredCandidates[0];
    const wouldMatch = bestMatch.score >= threshold;
    const simulatedStoryId = wouldMatch ? bestMatch.story_id : null;

    // Track score buckets
    if (bestMatch.score >= 0.80) {
      results.score_buckets.high++;
    } else if (bestMatch.score >= 0.60) {
      results.score_buckets.medium++;
    } else {
      results.score_buckets.low++;
    }

    // Track top scores for analysis
    if (results.top_scores.length < 20) {
      results.top_scores.push({
        article_id: article.id,
        article_title: article.title.slice(0, 50),
        best_score: bestMatch.score,
        best_story_id: bestMatch.story_id,
        threshold,
        would_match: wouldMatch,
      });
    }

    // Compare simulated vs actual
    if (!wouldMatch) {
      results.would_create_new++;
    } else if (simulatedStoryId === currentStoryId) {
      results.same_assignment++;
    } else {
      results.different_assignment++;

      // Record details for the first 20 different assignments
      if (results.different_assignments.length < 20) {
        results.different_assignments.push({
          article_id: article.id,
          article_title: article.title.slice(0, 60),
          current_story_id: currentStoryId,
          simulated_story_id: simulatedStoryId,
          simulated_headline: bestMatch.headline?.slice(0, 50),
          best_score: bestMatch.score,
          current_score: currentScore,
          threshold,
        });
      }
    }

    // Small delay to avoid overwhelming the database
    await new Promise(r => setTimeout(r, 50));
  }

  return results;
}

// ============================================================================
// Report Generation
// ============================================================================

function generateReport(results) {
  console.log('\n');
  console.log('='.repeat(70));
  console.log('RE-CLUSTER SIMULATION RESULTS');
  console.log('='.repeat(70));
  console.log('');

  // Summary stats
  const total = results.total_articles;
  const pctSame = (100 * results.same_assignment / total).toFixed(1);
  const pctDiff = (100 * results.different_assignment / total).toFixed(1);
  const pctNew = (100 * results.would_create_new / total).toFixed(1);

  console.log('SUMMARY');
  console.log('-'.repeat(40));
  console.log(`Total articles analyzed: ${total}`);
  console.log(`Same assignment:         ${results.same_assignment} (${pctSame}%)`);
  console.log(`Different assignment:    ${results.different_assignment} (${pctDiff}%)`);
  console.log(`Would create new:        ${results.would_create_new} (${pctNew}%)`);
  console.log(`No current story:        ${results.no_current_story}`);
  console.log(`No candidates found:     ${results.no_candidates}`);
  console.log(`Skipped (no embedding):  ${results.skipped_no_embedding}`);
  console.log('');

  // Score distribution
  console.log('SCORE DISTRIBUTION (best match)');
  console.log('-'.repeat(40));
  const high = results.score_buckets.high;
  const med = results.score_buckets.medium;
  const low = results.score_buckets.low;
  const scored = high + med + low;

  console.log(`>= 0.80 (high):   ${high} (${(100 * high / scored).toFixed(1)}%)`);
  console.log(`0.60-0.79 (med):  ${med} (${(100 * med / scored).toFixed(1)}%)`);
  console.log(`< 0.60 (low):     ${low} (${(100 * low / scored).toFixed(1)}%)`);
  console.log('');

  // Different assignments
  if (results.different_assignments.length > 0) {
    console.log('TOP ARTICLES THAT WOULD RE-CLUSTER');
    console.log('-'.repeat(40));
    results.different_assignments.slice(0, 10).forEach((d, i) => {
      console.log(`${i + 1}. "${d.article_title}..."`);
      console.log(`   Current: story ${d.current_story_id} (score: ${d.current_score?.toFixed(2) || 'N/A'})`);
      console.log(`   Simulated: story ${d.simulated_story_id} (score: ${d.best_score.toFixed(3)})`);
      console.log(`   Threshold: ${d.threshold.toFixed(2)}`);
      console.log('');
    });
  }

  // Interpretation
  console.log('INTERPRETATION');
  console.log('-'.repeat(40));

  if (parseFloat(pctSame) >= 90) {
    console.log('STABLE: >90% of articles would cluster to same story.');
    console.log('Current thresholds and clustering are working well.');
  } else if (parseFloat(pctDiff) >= 20) {
    console.log('HIGH RE-CLUSTER: >20% would go to different stories.');
    console.log('Consider reviewing clustering algorithm or thresholds.');
  } else if (parseFloat(pctNew) >= 30) {
    console.log('FRAGMENTATION: >30% would create new stories.');
    console.log('Thresholds may be too strict - consider lowering.');
  } else {
    console.log('MODERATE: Results show some clustering variation.');
    console.log('Manual review of different_assignments recommended.');
  }

  console.log('');
  console.log('='.repeat(70));
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const limit = parseInt(process.argv[2]) || 100;

  console.log('='.repeat(70));
  console.log('TTRC-236: Re-Cluster Simulation (READ-ONLY)');
  console.log('='.repeat(70));
  console.log('');
  console.log(`Limit: ${limit} articles`);
  console.log(`Mode: Simulation only - NO data modifications`);
  console.log('');

  const startTime = Date.now();
  const results = await simulateReclustering(limit);

  if (!results) {
    console.error('Simulation failed');
    process.exit(1);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nSimulation completed in ${duration}s`);

  generateReport(results);

  // Output JSON for further analysis
  if (VERBOSE) {
    console.log('\nRAW RESULTS (JSON):');
    console.log(JSON.stringify(results, null, 2));
  }
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
