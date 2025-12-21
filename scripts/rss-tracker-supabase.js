/**
 * RSS Tracker - Inline Supabase Implementation
 * TTRC-266: Automated RSS fetching, clustering, and enrichment
 *
 * Replaces job-queue-worker.js for RSS automation
 * Runs via GitHub Actions every 2 hours
 */

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import crypto from 'crypto';
import { handleFetchFeed } from './rss/fetch_feed.js';
import { clusterArticle, resetRunState, getRunStats } from './rss/hybrid-clustering.js';
import { EMBEDDING_MODEL_V1 } from './lib/embedding-config.js';
import {
  enrichStory as enrichStoryImpl,
  shouldEnrichStory,
  buildEntityCounter,
  toTopEntities,
  UI_TO_DB_CATEGORIES,
  ENRICHMENT_COOLDOWN_HOURS
} from './enrichment/enrich-stories-inline.js';
import { extractArticleEntities } from './enrichment/extract-article-entities-inline.js';
import { extractTopicSlug } from './rss/topic-extraction.js';

// =====================================================================
// Configuration & Constants
// =====================================================================

const RUNTIME_LIMIT_MS = 4 * 60 * 1000; // 4 minutes
const MAX_FEEDS_PER_RUN = 30;
const DAILY_BUDGET_LIMIT = 5.00; // $5/day
const ESTIMATED_COST_PER_STORY = 0.003; // GPT-4o-mini average

// =====================================================================
// RSS Tracker Class
// =====================================================================

class RSSTracker {
  constructor() {
    // Environment setup
    this.environment = process.env.ENVIRONMENT || 'test';
    this.runStartedAt = new Date().toISOString();
    this.startTime = Date.now();

    // Supabase client (service role key)
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);

    // OpenAI client (initialized in constructor, not top-level)
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      throw new Error('Missing OPENAI_API_KEY');
    }

    this.openai = new OpenAI({ apiKey: openaiKey });

    // Stats tracking (matches admin.run_stats schema)
    this.stats = {
      feeds_total: 0,
      feeds_processed: 0,
      feeds_succeeded: 0,
      feeds_failed: 0,
      feeds_skipped_lock: 0,
      feeds_304_cached: 0,
      stories_clustered: 0,
      stories_enriched: 0,
      total_openai_cost_usd: 0,
      enrichment_skipped_budget: 0,
      enrichment_failed: 0,  // Track failed enrichments (TTRC-277)
      // TTRC-299: Embedding generation tracking
      embeddings_generated: 0,
      embedding_failures: 0,
      // TTRC-298: Entity extraction tracking
      entities_extracted: 0
    };

    this.runStatus = 'success';
  }

  // ===================================================================
  // Feed Processing
  // ===================================================================

  /**
   * Select active feeds for this run
   * Max 30 feeds, ordered by last_fetched_at (oldest first)
   */
  async selectFeeds() {
    const { data, error } = await this.supabase
      .from('feed_registry')
      .select('*')
      .eq('is_active', true)
      .lt('failure_count', 5)
      .order('last_fetched_at', { ascending: true })
      .limit(MAX_FEEDS_PER_RUN);

    if (error) throw new Error(`Failed to select feeds: ${error.message}`);

    this.stats.feeds_total = data?.length || 0;
    console.log(`📋 Selected ${this.stats.feeds_total} feeds for processing`);

    return data || [];
  }

  /**
   * Process a single feed with safe lock pattern
   */
  async processFeed(feed) {
    let lockAcquired = false;

    try {
      // Acquire advisory lock
      const { data, error } = await this.supabase
        .rpc('acquire_feed_lock', { feed_id_param: feed.id });

      if (error) throw error;
      lockAcquired = !!data;

      if (!lockAcquired) {
        console.log(`⏭ Feed ${feed.id} already locked, skipping`);
        this.stats.feeds_skipped_lock++;
        return;
      }

      // Fetch feed via existing fetch_feed.js logic
      console.log(`📡 Fetching feed ${feed.id}: ${feed.source_name}`);

      // Wrap call to match handleFetchFeed signature (expects full job object)
      const result = await handleFetchFeed({
        id: `inline-feed-${feed.id}`,
        type: 'fetch_feed',
        attempts: 0,
        payload: {
          feed_id: feed.id,
          url: feed.feed_url,  // Column is feed_url, not url
          source_name: feed.source_name
        }
      }, this.supabase);

      // Guard against missing result
      if (!result || typeof result.status === 'undefined') {
        console.warn(`❌ Feed ${feed.id} returned no status, treating as failure`);
        this.stats.feeds_failed++;
        return;
      }

      // Track results
      if (result.status === 304) {
        this.stats.feeds_304_cached++;
      }

      this.stats.feeds_processed++;
      this.stats.feeds_succeeded++;

    } catch (err) {
      this.stats.feeds_failed++;
      console.error(`❌ Feed ${feed.id} failed:`, err.message);
    } finally {
      // Release lock (safe pattern)
      if (lockAcquired) {
        try {
          await this.supabase.rpc('release_feed_lock', { feed_id_param: feed.id });
        } catch (releaseErr) {
          console.error(`⚠️ Failed to release lock for feed ${feed.id}:`, releaseErr.message);
        }
      }
    }
  }

  /**
   * Process all feeds with runtime guard
   */
  async processFeeds(feeds) {
    for (const feed of feeds) {
      // Runtime guard: break at 4 minutes
      if (Date.now() - this.startTime > RUNTIME_LIMIT_MS) {
        console.log('⏱ Runtime limit reached (4 min), stopping feed processing');
        this.runStatus = 'partial_success';
        break;
      }

      await this.processFeed(feed);
    }
  }

  // ===================================================================
  // Article Embedding (TTRC-299)
  // ===================================================================

  /**
   * Generate embeddings for articles that don't have them yet.
   * Must run BEFORE clustering so hybrid scoring has embeddings to work with.
   * Uses same model and storage format as job-queue-worker.js for consistency.
   */
  async enrichArticles() {
    try {
      // Query ALL articles without embeddings (no time filter - clears backlog)
      // TTRC-320: Order by NEWEST first - prioritize current run's articles
      // Old logic (ascending: true) caused 54% of new articles to miss embeddings
      const { data: articles, error } = await this.supabase
        .from('articles')
        .select('id, title, content, excerpt')
        .is('embedding_v1', null)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        console.error('❌ Failed to query articles for embedding:', error.message);
        return;
      }

      if (!articles || articles.length === 0) {
        console.log('✅ No articles need embeddings');
        return;
      }

      console.log(`🔢 Generating embeddings for ${articles.length} articles...`);

      for (const article of articles) {
        // Runtime guard: stop at 60% to leave room for clustering + enrichment
        if (Date.now() - this.startTime > RUNTIME_LIMIT_MS * 0.6) {
          console.log('⏱ Runtime limit approaching (60%), stopping embeddings');
          break;
        }

        try {
          // Build input: title + first 2000 chars of content (matches worker pattern)
          // TTRC-299: Sanitize to avoid undefined titles and raw HTML in embeddings
          const rawContent = article.content || article.excerpt || '';
          const cleanContent = String(rawContent).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          const safeTitle = (typeof article.title === 'string' && article.title.trim().length > 0)
            ? article.title.trim()
            : 'Untitled';
          const embeddingInput = `${safeTitle}\n\n${cleanContent.slice(0, 2000)}`;

          // Generate embedding via OpenAI (same model as worker)
          const response = await this.openai.embeddings.create({
            model: EMBEDDING_MODEL_V1,
            input: embeddingInput
          });

          // Validate embedding response structure
          const embedding = response?.data?.[0]?.embedding;
          if (!Array.isArray(embedding) || embedding.length === 0) {
            console.error(`❌ Invalid embedding response for ${article.id}`);
            this.stats.embedding_failures++;
            continue;
          }

          // Store as pgvector string format (matches existing pattern from worker)
          const { error: updateError } = await this.supabase
            .from('articles')
            .update({
              embedding_v1: `[${embedding.join(',')}]`,
              embedding_model_v1: EMBEDDING_MODEL_V1
            })
            .eq('id', article.id);

          if (updateError) {
            console.error(`❌ Failed to store embedding for ${article.id}:`, updateError.message);
            this.stats.embedding_failures++;
            continue;
          }

          this.stats.embeddings_generated++;
        } catch (err) {
          console.error(`❌ Embedding failed for ${article.id}:`, err.message);
          this.stats.embedding_failures++;
          // Continue with next article - this one will retry next run
        }
      }

      console.log(`✅ Embeddings complete: ${this.stats.embeddings_generated} generated, ${this.stats.embedding_failures} failed`);

    } catch (err) {
      console.error('❌ enrichArticles() failed:', err.message);
    }
  }

  // ===================================================================
  // Article Entity Extraction (TTRC-298)
  // ===================================================================

  /**
   * Extract entities from articles for clustering signals.
   * TTRC-298: Entities enable 25% weight in hybrid scoring.
   * Runs after embeddings, before clustering.
   */
  async extractArticleEntitiesPhase() {
    try {
      console.log('[RSS] === PHASE: ARTICLE ENTITY EXTRACTION ===');

      // Budget check first - respect daily limits
      const today = new Date().toISOString().split('T')[0];
      const { data: budget } = await this.supabase
        .from('budgets')
        .select('spent_usd')
        .eq('day', today)
        .single();

      if (budget?.spent_usd >= DAILY_BUDGET_LIMIT) {
        console.log('[RSS] Daily budget exceeded, skipping entity extraction');
        return;
      }

      // Query articles needing extraction (include excerpt-only articles)
      // TTRC-306: Also include articles without topic_slug for slug extraction
      const { data: articles, error } = await this.supabase
        .from('articles')
        .select('id, title, content, excerpt, entities, topic_slug')
        .or('entities.is.null,entities.eq.[],topic_slug.is.null')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('[RSS] Failed to query articles for entity extraction:', error.message);
        return;
      }

      if (!articles?.length) {
        console.log('[RSS] No articles need entity extraction');
        return;
      }

      console.log(`[RSS] Extracting entities and topic slugs for ${articles.length} articles`);
      let entitiesExtracted = 0, slugsExtracted = 0, failed = 0, totalTokens = 0;

      for (const article of articles) {
        // Runtime guard
        if (Date.now() - this.startTime > RUNTIME_LIMIT_MS * 0.7) {
          console.log('[RSS] Runtime limit approaching (70%), stopping extraction');
          break;
        }

        const content = article.content || article.excerpt || '';
        const updateFields = {};

        // TTRC-306: Extract entities if missing
        const needsEntities = !article.entities || article.entities.length === 0;
        if (needsEntities) {
          const { entities, tokens } = await extractArticleEntities(
            article.title,
            content,
            this.openai
          );
          updateFields.entities = entities.length > 0 ? entities : [];
          if (entities.length > 0) {
            entitiesExtracted++;
            if (tokens) totalTokens += tokens.total_tokens || 0;
          }
        }

        // TTRC-306: Extract topic slug if missing (idempotent)
        const needsSlug = !article.topic_slug;
        if (needsSlug) {
          const slug = await extractTopicSlug(article.title, content, article.excerpt || '', this.openai);
          if (slug) {
            updateFields.topic_slug = slug;
            slugsExtracted++;
          }
        }

        // Update if any fields need to be set
        if (Object.keys(updateFields).length > 0) {
          const { error: updateError } = await this.supabase
            .from('articles')
            .update(updateFields)
            .eq('id', article.id);

          if (updateError) {
            console.error(`[RSS] Failed to update article ${article.id}:`, updateError.message);
            failed++;
            continue;
          }
        }

        // Rate limiting (150ms between calls)
        await new Promise(r => setTimeout(r, 150));
      }

      const cost = (totalTokens / 1000) * 0.00015;
      console.log(`[RSS] Extraction complete: ${entitiesExtracted} entities, ${slugsExtracted} slugs, ${failed} failed, ~$${cost.toFixed(4)}`);
      this.stats.entities_extracted = entitiesExtracted;
      this.stats.slugs_extracted = slugsExtracted;

    } catch (err) {
      console.error('[RSS] extractArticleEntitiesPhase() failed:', err.message);
    }
  }

  // ===================================================================
  // Clustering
  // ===================================================================

  /**
   * Cluster unclustered articles into stories using hybrid scoring.
   * TTRC-299: Now calls clusterArticle() directly for semantic clustering.
   * RPC only returns articles with embeddings (migration 042).
   */
  async clusterArticles() {
    try {
      // Get unclustered articles via RPC
      // NOTE: RPC now only returns articles WITH embeddings (migration 042)
      const { data: articles, error } = await this.supabase
        .rpc('get_unclustered_articles', { limit_count: 100 });

      if (error) throw error;

      if (!articles || articles.length === 0) {
        console.log('✅ No unclustered articles found');
        return;
      }

      console.log(`🔗 Clustering ${articles.length} articles via hybrid scoring...`);

      // TTRC-299: Use hybrid clustering (validated in TTRC-236)
      // clusterArticle() is the single source of truth for all clustering decisions
      for (const article of articles) {
        // Runtime guard
        if (Date.now() - this.startTime > RUNTIME_LIMIT_MS) {
          console.log('⏱ Runtime limit reached, stopping clustering');
          this.runStatus = 'partial_success';
          break;
        }

        try {
          // Call hybrid clustering - handles candidate generation, scoring, and story assignment
          const result = await clusterArticle(article.id);

          // TTRC-299: Guard against null/invalid clustering result
          if (!result || !result.story_id) {
            console.warn(`⚠️ Clustering returned no decision for article ${article.id}`);
            continue;
          }

          // Log clustering decision with score for observability
          const scoreStr = (typeof result.score === 'number') ? result.score.toFixed(3) : 'N/A';
          console.log(`[cluster] Article ${article.id} → Story ${result.story_id} (${result.status || 'unknown'}, score: ${scoreStr})`);

          this.stats.stories_clustered++;
        } catch (err) {
          console.error(`❌ Clustering failed for ${article.id}:`, err.message);
          // Continue with next article - don't fail the whole run
        }
      }

      console.log(`✅ Clustered ${this.stats.stories_clustered} articles`);

    } catch (err) {
      console.error('❌ clusterArticles() failed:', err.message);
    }
  }

  // ===================================================================
  // Enrichment
  // ===================================================================

  /**
   * Enrich a single story with atomic budget check
   */
  async enrichAndBillStory(story) {
    // Check budget atomically BEFORE enrichment
    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await this.supabase.rpc('increment_budget_with_limit', {
      day_param: today,
      amount_usd: ESTIMATED_COST_PER_STORY,
      call_count: 1,
      daily_limit: DAILY_BUDGET_LIMIT
    });

    if (error) throw error;

    // Guard against malformed response
    if (!data || !Array.isArray(data) || !data[0]) {
      throw new Error('increment_budget_with_limit returned no data');
    }

    if (!data[0].success) {
      console.log(`⏸ Budget cap reached ($${DAILY_BUDGET_LIMIT}/day). Remaining: $${data[0].remaining}`);
      this.stats.enrichment_skipped_budget++;
      this.runStatus = 'partial_success';
      return false; // Signal to break enrichment loop
    }

    // Proceed with enrichment (call aliased import - no recursion)
    const result = await enrichStoryImpl(story, {
      supabase: this.supabase,
      openaiClient: this.openai
    });

    // Track cost
    this.stats.total_openai_cost_usd += result.cost;
    this.stats.stories_enriched++;

    console.log(`✅ Enriched story ${story.id}: $${result.cost.toFixed(6)} (${result.category})`);

    return true; // Continue enriching
  }

  /**
   * Enrich stories needing enrichment
   */
  async enrichStories() {
    try {
      // Get active stories needing enrichment (12h cooldown)
      const cooldownCutoff = new Date(Date.now() - ENRICHMENT_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();

      const { data: stories, error } = await this.supabase
        .from('stories')
        .select(`
          id,
          primary_headline,
          last_enriched_at,
          article_story!inner ( article_id )
        `)
        .eq('status', 'active')
        .or(`last_enriched_at.is.null,last_enriched_at.lt.${cooldownCutoff}`)
        .order('last_enriched_at', { ascending: true, nullsFirst: true })
        .limit(50);

      if (error) throw error;

      if (!stories || stories.length === 0) {
        console.log('✅ No stories need enrichment');
        return;
      }

      console.log(`🤖 Enriching ${stories.length} stories...`);

      for (const story of stories) {
        // Runtime guard (RUNTIME_LIMIT_MS = 4min, this.startTime set in constructor)
        if (Date.now() - this.startTime > RUNTIME_LIMIT_MS) {
          console.log('⏱ Runtime limit reached, stopping enrichment');
          this.runStatus = 'partial_success';
          break;
        }

        // NEW: Wrap enrichment call in try-catch (TTRC-277)
        // enrichAndBillStory throws on failure (no swallow inside)
        try {
          const shouldContinue = await this.enrichAndBillStory(story);
          if (!shouldContinue) {
            break; // Budget cap reached
          }
        } catch (enrichErr) {
          // Log error
          console.error(`❌ Enrichment failed for story ${story.id}:`, enrichErr.message);
          
          // Track failure
          this.stats.enrichment_failed++;
          this.runStatus = 'partial_success';
          
          // Set cooldown timestamp (nested try-catch for safety)
          // CRITICAL: Don't let DB errors crash the run
          try {
            await this.supabase
              .from('stories')
              .update({ last_enriched_at: new Date().toISOString() })
              .eq('id', story.id);
          } catch (updateErr) {
            console.error(`⚠️ Failed to update last_enriched_at for story ${story.id}:`, updateErr.message);
            // Swallow error - don't crash run if DB update fails
            // Story will retry next run (acceptable)
          }
          
          // Continue to next story
          continue;
        }
      }

      console.log(`✅ Enriched ${this.stats.stories_enriched} stories (cost: $${this.stats.total_openai_cost_usd.toFixed(4)})`);

    } catch (err) {
      console.error('❌ Enrichment failed:', err.message);
    }
  }

  // ===================================================================
  // Run Stats Logging
  // ===================================================================

  /**
   * Log run stats to admin.run_stats via RPC wrapper (fail-safe)
   * Uses log_run_stats RPC (migration 036) to access admin schema
   */
  async finalizeRunStats(status) {
    const finalStatus = status || this.runStatus || 'success';

    try {
      const { error } = await this.supabase.rpc('log_run_stats', {
        p_environment: this.environment,
        p_run_started_at: this.runStartedAt,
        p_run_finished_at: new Date().toISOString(),
        p_status: finalStatus,
        p_feeds_total: this.stats.feeds_total,
        p_feeds_processed: this.stats.feeds_processed,
        p_feeds_succeeded: this.stats.feeds_succeeded,
        p_feeds_failed: this.stats.feeds_failed,
        p_feeds_skipped_lock: this.stats.feeds_skipped_lock,
        p_feeds_304_cached: this.stats.feeds_304_cached,
        p_stories_clustered: this.stats.stories_clustered,
        p_stories_enriched: this.stats.stories_enriched,
        p_total_openai_cost_usd: this.stats.total_openai_cost_usd,
        p_enrichment_skipped_budget: this.stats.enrichment_skipped_budget,
        p_enrichment_failed: this.stats.enrichment_failed,  // 15th param (TTRC-277)
        p_entities_extracted: this.stats.entities_extracted  // 16th param (TTRC-298)
      });

      if (error) throw error;
      console.log(`📊 Run stats logged: ${finalStatus}`);
    } catch (finalizeErr) {
      console.error('[WARNING] Failed to log run stats:', finalizeErr.message);
      // Do NOT rethrow: run itself succeeded
    }
  }

  // ===================================================================
  // Main Run Flow
  // ===================================================================

  async run() {
    try {
      // TTRC-321 Phase 0: Set global run start for diagnostic logging
      globalThis.__RUN_START__ = new Date();
      console.log(`[RUN_START] ${globalThis.__RUN_START__.toISOString()}`);

      // Reset run state for batch dedup tracking
      resetRunState();

      console.log(`🚀 RSS Tracker starting (${this.environment.toUpperCase()})`);
      console.log(`⏰ Started at: ${this.runStartedAt}`);

      // 1. Process feeds
      const feeds = await this.selectFeeds();
      await this.processFeeds(feeds);

      // 2. Generate embeddings for new articles (TTRC-299)
      // Must run BEFORE clustering so hybrid scoring has embeddings
      await this.enrichArticles();

      // 3. Extract entities from articles (TTRC-298)
      // Must run BEFORE clustering so entity overlap scoring works
      await this.extractArticleEntitiesPhase();

      // 4. Cluster articles using hybrid scoring (TTRC-299)
      await this.clusterArticles();

      // 5. Enrich stories with AI summaries
      await this.enrichStories();

      // 6. Log final stats
      await this.finalizeRunStats();

      const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
      console.log(`✅ RSS Tracker complete in ${elapsed}s`);
      console.log(`📊 Stats:`, this.stats);

      // Log clustering override stats (TTRC-323/324 v2)
      const clusterStats = getRunStats();
      console.log(JSON.stringify({
        type: 'CLUSTERING_SUMMARY',
        created: clusterStats.created,
        attached_normal: clusterStats.attachedNormal,
        attached_321_same_run: clusterStats.attached321SameRun,
        attached_323_exact_title: clusterStats.attached323ExactTitle,
        // Backwards compat - keep old key for one release
        attached_324_slug_embed: clusterStats.attached324TierA + clusterStats.attached324TierB,
        // New tier-specific keys (v2)
        attached_324_tier_a: clusterStats.attached324TierA,
        attached_324_tier_b: clusterStats.attached324TierB
      }));

    } catch (err) {
      console.error('💥 RSS Tracker failed:', err.message);
      this.runStatus = 'failed';
      await this.finalizeRunStats('failed');
      throw err;
    }
  }
}

// =====================================================================
// Main Entry Point
// =====================================================================

async function main() {
  // Kill switch guard
  if (process.env.RSS_TRACKER_RUN_ENABLED !== 'true') {
    console.log('🛑 RSS Tracker disabled via RSS_TRACKER_RUN_ENABLED');
    return;
  }

  const tracker = new RSSTracker();
  await tracker.run();
}

// Execute
main().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
