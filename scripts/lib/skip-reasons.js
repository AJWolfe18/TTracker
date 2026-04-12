/**
 * Canonical pipeline + reason constants for the pipeline_skips observability table.
 *
 * ADO-466: Silent Skip Visibility
 *
 * Every call site in the codebase that skips work (continue / return-early)
 * MUST write a row to pipeline_skips before skipping — no bare console.log.
 *
 * Usage:
 *   const { PIPELINES, REASONS, recordSkip } = require('./lib/skip-reasons');
 *   await recordSkip(supabase, {
 *     pipeline: PIPELINES.RSS_ENRICHMENT,
 *     reason: REASONS.BUDGET_EXCEEDED,
 *     entity_type: 'story',
 *     entity_id: String(story.id),
 *     metadata: { spent_usd: 4.82, day: '2026-04-12' }
 *   });
 *
 * Add new pipelines/reasons here, not inline at call sites. Typos at call
 * sites will fail JS lookup immediately rather than silently write a
 * malformed row.
 */

const PIPELINES = Object.freeze({
  RSS_FETCH:          'rss_fetch',          // scripts/rss/fetch_feed.js — freshness filter, dedup rejection
  RSS_ENRICHMENT:     'rss_enrichment',     // scripts/rss-tracker-supabase.js — budget cap, entity extraction gate
  EMBEDDINGS:         'embeddings',         // scripts/rss-tracker-supabase.js — embedding failures
  ENTITY_EXTRACTION:  'entity_extraction',  // scripts/enrichment/extract-article-entities-inline.js — parse/API errors
  ENTITY_AGGREGATION: 'entity_aggregation', // scripts/aggregate-story-entities.js — no entities, empty articles
  STORY_ENRICHMENT:   'story_enrichment',   // scripts/enrichment/enrich-stories-inline.js — no-articles failure
});

const REASONS = Object.freeze({
  BUDGET_EXCEEDED:       'budget_exceeded',       // daily OpenAI budget cap hit
  FRESHNESS_FILTER:      'freshness_filter',      // article outside freshness window
  NO_ARTICLES:           'no_articles',           // story/entity aggregation had zero articles linked
  NO_ENTITIES:           'no_entities',           // entity aggregation found no entities
  EMBEDDING_FAILURE:     'embedding_failure',     // single-attempt embedding call failed
  MAX_RETRIES_EXCEEDED:  'max_retries_exceeded',  // embedding retried too many times
  PARSE_ERROR:           'parse_error',           // JSON/response parse failed
  API_ERROR:             'api_error',             // external API call errored
});

/**
 * Record a skip event.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} skip
 * @param {string} skip.pipeline     — use PIPELINES.*
 * @param {string} skip.reason       — use REASONS.*
 * @param {string} [skip.entity_type]
 * @param {string|number|null} [skip.entity_id] — coerced to string; 0 is preserved, only null/undefined becomes NULL
 * @param {object} [skip.metadata]
 * @returns {Promise<void>} resolves even on insert failure (skip-logging must not break the pipeline)
 */
async function recordSkip(supabase, { pipeline, reason, entity_type, entity_id, metadata }) {
  if (!pipeline || !reason) {
    console.warn('[skip-reasons] recordSkip called without pipeline or reason — ignoring');
    return;
  }
  try {
    const { error } = await supabase
      .from('pipeline_skips')
      .insert({
        pipeline,
        reason,
        entity_type: entity_type || null,
        entity_id: entity_id != null ? String(entity_id) : null,
        metadata: metadata || null,
      });
    if (error) {
      console.warn(`[skip-reasons] insert failed (pipeline=${pipeline}, reason=${reason}):`, error.message);
    }
  } catch (err) {
    console.warn(`[skip-reasons] recordSkip threw (pipeline=${pipeline}, reason=${reason}):`, err?.message || err);
  }
}

module.exports = { PIPELINES, REASONS, recordSkip };
