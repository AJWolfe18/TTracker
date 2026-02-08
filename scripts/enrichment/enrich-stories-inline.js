/*
 * Story enrichment for inline RSS pipeline.
 * SYSTEM_PROMPT imported from ./prompts/stories.js (shared with job-queue-worker.js)
 *
 * ADO-270: Updated to use variation pools and alarm_level (0-5)
 * ADO-274: Frame-based variation system with deterministic selection
 */

import OpenAI from 'openai';
import { SYSTEM_PROMPT } from './prompts/stories.js';
import { normalizeEntities } from '../lib/entity-normalization.js';
import {
  PROMPT_VERSION,
  estimateStoryFrame,
  getStoryPoolKey,
  getStoryContentId,
  selectVariation,
  buildVariationInjection,
  normalizeAlarmLevel,
  alarmLevelToLegacySeverity,
  findBannedStarter,
  repairBannedStarter,
  SECTION_BANS
} from './stories-style-patterns.js';

// =====================================================================
// Constants
// =====================================================================

const ENRICHMENT_COOLDOWN_HOURS = 12; // Match worker cooldown

// =====================================================================
// Feed Registry Cache (ADO-274: avoid N+1 queries)
// =====================================================================

let feedRegistryCache = null;          // Map<string, {topics: string[], tier: number}>
let feedRegistryLoadPromise = null;

/**
 * Reset feed registry cache (call between batches if script stays alive)
 */
export function resetFeedRegistryCache() {
  feedRegistryCache = null;
  feedRegistryLoadPromise = null;
}

/**
 * Load feed registry into memory (topics and tier only)
 * Call once per batch to avoid N+1 queries
 * @param {Object} supabase - Supabase client
 * @returns {Promise<Map<string, {topics: string[], tier: number}>>}
 */
export async function loadFeedRegistry(supabase) {
  if (feedRegistryCache) return feedRegistryCache;
  if (feedRegistryLoadPromise) return feedRegistryLoadPromise;

  feedRegistryLoadPromise = (async () => {
    const { data, error } = await supabase
      .from('feed_registry')
      .select('id, topics, tier')
      .eq('is_active', true);

    // Always set cache so we don't spam queries on repeated failures
    const cache = new Map();

    if (error) {
      console.warn('Failed to load feed registry:', error.message);
      feedRegistryCache = cache;
      return feedRegistryCache;
    }

    for (const feed of data || []) {
      const key = String(feed.id);
      const tierRaw = Number(feed.tier);
      // Tier must be 1-3; default to 2 if invalid
      const tier = Number.isFinite(tierRaw) && tierRaw >= 1 && tierRaw <= 3 ? tierRaw : 2;
      cache.set(key, {
        topics: Array.isArray(feed.topics) ? feed.topics : [],
        tier
      });
    }

    feedRegistryCache = cache;
    return feedRegistryCache;
  })();

  try {
    return await feedRegistryLoadPromise;
  } finally {
    feedRegistryLoadPromise = null;
  }
}

/**
 * Get feed metadata by ID (uses cache if available)
 * @param {number|string} feedId - Feed ID
 * @param {Object} supabase - Supabase client
 * @returns {Promise<{topics: string[], tier: number}>}
 */
async function getFeedMeta(feedId, supabase) {
  const key = String(feedId);

  if (feedRegistryCache?.has(key)) {
    return feedRegistryCache.get(key);
  }

  const registry = await loadFeedRegistry(supabase);
  return registry.get(key) || { topics: [], tier: 2 };
}

// Category mapping: UI labels → DB enum values
const UI_TO_DB_CATEGORIES = {
  'Corruption & Scandals': 'corruption_scandals',
  'Democracy & Elections': 'democracy_elections',
  'Policy & Legislation': 'policy_legislation',
  'Justice & Legal': 'justice_legal',
  'Executive Actions': 'executive_actions',
  'Foreign Policy': 'foreign_policy',
  'Corporate & Financial': 'corporate_financial',
  'Civil Liberties': 'civil_liberties',
  'Media & Disinformation': 'media_disinformation',
  'Epstein & Associates': 'epstein_associates',
  'Other': 'other',
};

const toDbCategory = (label) => UI_TO_DB_CATEGORIES[label] || 'other';

// SYSTEM_PROMPT imported from ./prompts/stories.js (single source of truth)

// =====================================================================
// Helper Functions
// =====================================================================

/**
 * TTRC-235: Build entity counter from entities array
 * Creates jsonb {id: count} map for tracking entity frequency
 */
export function buildEntityCounter(entities) {
  const counts = {};
  for (const e of entities || []) {
    if (!e?.id) continue;
    counts[e.id] = (counts[e.id] || 0) + 1;
  }
  return counts; // jsonb
}

/**
 * TTRC-235: Convert entities to top_entities text[] of canonical IDs
 * Sorts by confidence desc, then by id for deterministic ordering
 * Deduplicates and caps at max entities
 */
export function toTopEntities(entities, max = 8) {
  // Sort by confidence desc, then by id for determinism
  const ids = (entities || [])
    .filter(e => e?.id)
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0) || a.id.localeCompare(b.id))
    .map(e => e.id);

  // Stable dedupe
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out.slice(0, max); // text[]
}

/**
 * Build user payload for OpenAI enrichment
 */
function buildUserPayload({ primary_headline, articles }) {
  const articleText = articles
    .map((a, i) => `[${i + 1}] ${a.source_name}: ${a.title}\n${a.excerpt}`)
    .join('\n\n');

  return `Story Headline: ${primary_headline}

Source Articles:
${articleText}

Generate enrichment JSON.`;
}

/**
 * Check if story needs enrichment (cooldown check)
 */
export function shouldEnrichStory(story) {
  if (!story.last_enriched_at) return true;

  const hoursSince = (Date.now() - new Date(story.last_enriched_at)) / (1000 * 60 * 60);
  return hoursSince >= ENRICHMENT_COOLDOWN_HOURS;
}

/**
 * Fetch up to 6 articles for a story, ordered by relevance
 * ADO-274: Now includes feed_id for frame estimation
 */
async function fetchStoryArticles(story_id, supabase) {
  const { data, error } = await supabase
    .from('article_story')
    .select('is_primary_source, similarity_score, matched_at, articles(title, source_name, content, excerpt, feed_id)')
    .eq('story_id', story_id)
    .order('is_primary_source', { ascending: false })
    .order('similarity_score', { ascending: false })
    .order('matched_at', { ascending: false })
    .limit(6);

  if (error) throw new Error(`Failed to fetch articles: ${error.message}`);
  return (data || []).filter(r => r.articles);
}

// =====================================================================
// Main Enrichment Function
// =====================================================================

/**
 * Enrich a single story with OpenAI summaries and categorization
 *
 * @param {Object} story - Story object with {id, primary_headline, last_enriched_at}
 * @param {Object} deps - Dependencies {supabase, openaiClient}
 * @returns {Object} Enrichment result with cost and updated fields
 */
export async function enrichStory(story, { supabase, openaiClient }) {
  const { id: story_id, primary_headline } = story;

  if (!story_id) throw new Error('story_id required');
  if (!openaiClient) throw new Error('OpenAI client required');

  // ========================================
  // 1. FETCH ARTICLES & BUILD CONTEXT
  // ========================================
  const links = await fetchStoryArticles(story_id, supabase);
  if (!links.length) {
    console.error(`❌ No articles found for story ${story_id}`);
    throw new Error('No articles found for story');
  }

  // Build article context (simplified - no scraping in inline version)
  const articles = links.map(({ articles: a }) => ({
    title: a.title || '',
    source_name: a.source_name || '',
    excerpt: (a.content || a.excerpt || '')
      .replace(/<[^>]+>/g, ' ')    // strip HTML tags
      .replace(/\s+/g, ' ')         // collapse whitespace
      .trim()
      .slice(0, 500)                // Limit to 500 chars per article
  }));

  const userPayload = buildUserPayload({
    primary_headline: primary_headline || '',
    articles
  });

  // ========================================
  // 2. BUILD VARIATION INJECTION (ADO-274)
  // ========================================
  // Use frame-based variation system with deterministic selection
  // Frame estimated from headline + feed tier (pre-enrichment signals only)

  // Get feed metadata from primary article (first in list, ordered by is_primary_source)
  const primaryFeedId = links[0]?.articles?.feed_id;
  const feedMeta = primaryFeedId
    ? await getFeedMeta(primaryFeedId, supabase)
    : { topics: [], tier: 2 };

  // Estimate frame from headline and feed tier
  const frame = estimateStoryFrame(primary_headline, feedMeta.tier);
  const poolKey = getStoryPoolKey(feedMeta.topics, frame);
  const contentId = getStoryContentId(story);

  // Deterministic variation selection
  const variation = selectVariation(poolKey, contentId, PROMPT_VERSION, []);
  const variationInjection = buildVariationInjection(variation, frame);

  // Debug logging for variation system (ADO-274)
  console.log(`[ADO-274] Story ${story_id}: frame=${frame}, pool=${poolKey}, pattern=${variation.id}`);

  // Inject variation into system prompt
  const systemPromptWithVariation = SYSTEM_PROMPT.replace(
    '{variation_injection}',
    variationInjection
  );

  // ========================================
  // 3. OPENAI CALL (JSON MODE)
  // ========================================
  const completion = await openaiClient.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPromptWithVariation },
      { role: 'user', content: userPayload }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 600, // Slightly higher for alarm_level calibration
    temperature: 0.7
  });

  // ========================================
  // 4. PARSE & VALIDATE JSON
  // ========================================
  const text = completion.choices?.[0]?.message?.content || '{}';
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    console.error('❌ JSON parse failed. Raw response:', text.slice(0, 500));
    throw new Error('Model did not return valid JSON');
  }

  // Extract and validate fields
  const summary_neutral = obj.summary_neutral?.trim();
  let summary_spicy = (obj.summary_spicy || summary_neutral || '').trim();
  const category_db = obj.category ? toDbCategory(obj.category) : null;
  const primary_actor = (obj.primary_actor || '').trim() || null;

  // ADO-270: Extract alarm_level (0-5) and derive legacy severity
  const alarm_level = normalizeAlarmLevel(obj.alarm_level);
  const severity = alarmLevelToLegacySeverity(alarm_level); // null for levels 0-1

  // ADO-274: Post-gen validation for banned starters
  const bannedPhrases = SECTION_BANS.summary_spicy || [];
  const bannedStarter = findBannedStarter(summary_spicy, bannedPhrases);

  if (bannedStarter) {
    const storyIdForLog = (typeof story_id !== 'undefined' && story_id != null)
      ? story_id
      : (story?.id ?? 'unknown');

    const patternIdForLog = variation?.id ?? 'unknown';

    console.warn(
      `[ADO-274] Banned starter in summary_spicy: "${bannedStarter}" (story=${storyIdForLog}, pattern=${patternIdForLog})`
    );

    const repair = repairBannedStarter('summary_spicy', summary_spicy, bannedStarter);

    if (repair.success) {
      console.log(
        `[ADO-274] Repaired banned starter (story=${storyIdForLog}, pattern=${patternIdForLog})`
      );
      summary_spicy = repair.content;
    } else {
      console.warn(
        `[ADO-274] Repair failed - keeping original (story=${storyIdForLog}, pattern=${patternIdForLog}, reason=${repair.reason || 'unknown'})`
      );
    }
  }

  // TTRC-235: Extract entities and format correctly
  // TTRC-236: Normalize entity IDs for consistent merge detection
  const rawEntities = obj.entities || [];
  const entities = normalizeEntities(rawEntities);
  const top_entities = toTopEntities(entities);  // text[] of IDs
  const entity_counter = buildEntityCounter(entities);  // jsonb {id: count}

  if (!summary_neutral) {
    throw new Error('Missing summary_neutral in response');
  }

  // ========================================
  // 5. UPDATE STORY
  // ========================================
  const { error: uErr } = await supabase
    .from('stories')
    .update({
      summary_neutral,
      summary_spicy,
      category: category_db,
      alarm_level,           // ADO-270: numeric 0-5
      severity,              // Legacy: derived from alarm_level, null for 0-1
      primary_actor,
      top_entities,          // TTRC-235: text[] of canonical IDs
      entity_counter,        // TTRC-235: jsonb {id: count}
      last_enriched_at: new Date().toISOString(),
      enrichment_status: null,
      enrichment_meta: {
        prompt_version: PROMPT_VERSION,
        frame,
        style_pattern_id: variation.id,
        collision: variation._meta?.collision || false,
        model: 'gpt-4o-mini',
        enriched_at: new Date().toISOString(),
      },
    })
    .eq('id', story_id);

  if (uErr) throw new Error(`Failed to update story: ${uErr.message}`);

  // ========================================
  // 6. COST TRACKING
  // ========================================
  const usage = completion.usage || { prompt_tokens: 0, completion_tokens: 0 };
  const costInput = (usage.prompt_tokens / 1000) * 0.00015;  // GPT-4o-mini input
  const costOutput = (usage.completion_tokens / 1000) * 0.0006; // GPT-4o-mini output
  const totalCost = costInput + costOutput;

  return {
    story_id,
    tokens: usage,
    cost: totalCost,
    summary_neutral,
    summary_spicy,
    category: category_db,
    alarm_level,
    severity,
    primary_actor
  };
}

// Export constants
export { ENRICHMENT_COOLDOWN_HOURS, UI_TO_DB_CATEGORIES };
