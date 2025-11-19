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
import {
  enrichStory as enrichStoryImpl,
  shouldEnrichStory,
  buildEntityCounter,
  toTopEntities,
  UI_TO_DB_CATEGORIES,
  ENRICHMENT_COOLDOWN_HOURS
} from './enrichment/enrich-stories-inline.js';

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
      enrichment_failed: 0  // NEW: Track failed enrichments (TTRC-277)
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
  // Clustering
  // ===================================================================

  /**
   * Cluster unclustered articles into stories (DB-centric)
   */
  async clusterArticles() {
    try {
      // Get unclustered articles via RPC (no PostgREST subquery issues)
      const { data: articles, error } = await this.supabase
        .rpc('get_unclustered_articles', { limit_count: 100 });

      if (error) throw error;

      if (!articles || articles.length === 0) {
        console.log('✅ No unclustered articles found');
        return;
      }

      console.log(`🔗 Clustering ${articles.length} articles...`);

      // Simple 1-article-per-story clustering for TTRC-266
      // (Complex similarity-based clustering deferred to future ticket)
      for (const article of articles) {
        // Runtime guard
        if (Date.now() - this.startTime > RUNTIME_LIMIT_MS) {
          console.log('⏱ Runtime limit reached, stopping clustering');
          this.runStatus = 'partial_success';
          break;
        }

        // Generate story_hash (EXACTLY matches DB formula from migration 020)
        // SQL: v_title_clean := COALESCE(NULLIF(_title,''), 'Untitled Story');
        //      v_story_hash := md5(lower(regexp_replace(v_title_clean, '\s+', ' ', 'g')));
        // JS must match: null/empty → 'Untitled Story', whitespace-only → kept & normalized
        const title = (article.title == null || article.title === '') ? 'Untitled Story' : article.title;
        const normalizedTitle = title.toLowerCase().replace(/\s+/g, ' ');
        const storyHash = crypto.createHash('md5').update(normalizedTitle).digest('hex');

        // Create new story for this article
        const { data: story, error: storyErr } = await this.supabase
          .from('stories')
          .insert({
            story_hash: storyHash,
            primary_headline: article.title,
            status: 'active',
            first_seen_at: article.published_date
          })
          .select()
          .single();

        if (storyErr) {
          console.error(`❌ Failed to create story for article ${article.id}:`, storyErr.message);
          continue;
        }

        // Link article to story
        const { error: linkErr } = await this.supabase
          .from('article_story')
          .insert({
            article_id: article.id,
            story_id: story.id,
            is_primary_source: true,
            similarity_score: 1.0
          });

        if (linkErr) {
          console.error(`❌ Failed to link article ${article.id} to story ${story.id}:`, linkErr.message);
          continue;
        }

        this.stats.stories_clustered++;
      }

      console.log(`✅ Clustered ${this.stats.stories_clustered} articles into new stories`);

    } catch (err) {
      console.error('❌ Clustering failed:', err.message);
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
        .select('id, primary_headline, last_enriched_at')
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
        p_enrichment_failed: this.stats.enrichment_failed  // NEW: Pass failure count (15th param, TTRC-277)
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
      console.log(`🚀 RSS Tracker starting (${this.environment.toUpperCase()})`);
      console.log(`⏰ Started at: ${this.runStartedAt}`);

      // 1. Process feeds
      const feeds = await this.selectFeeds();
      await this.processFeeds(feeds);

      // 2. Cluster articles
      await this.clusterArticles();

      // 3. Enrich stories
      await this.enrichStories();

      // 4. Log final stats
      await this.finalizeRunStats();

      const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
      console.log(`✅ RSS Tracker complete in ${elapsed}s`);
      console.log(`📊 Stats:`, this.stats);

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
