/*
 * Story enrichment for inline RSS pipeline.
 * SYSTEM_PROMPT imported from ./prompts.js (shared with job-queue-worker.js)
 *
 * TODO TTRC-267: Consider full shared enrichment module if worker
 * is kept for article.enrich operations.
 */

import OpenAI from 'openai';
import { SYSTEM_PROMPT } from './prompts.js';
import { normalizeEntities } from '../lib/entity-normalization.js';

// =====================================================================
// Constants
// =====================================================================

const ENRICHMENT_COOLDOWN_HOURS = 12; // Match worker cooldown

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

// SYSTEM_PROMPT imported from ./prompts.js (single source of truth)

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
 */
async function fetchStoryArticles(story_id, supabase) {
  const { data, error } = await supabase
    .from('article_story')
    .select('is_primary_source, similarity_score, matched_at, articles(title, source_name, content, excerpt)')
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
  // 2. OPENAI CALL (JSON MODE)
  // ========================================
  const completion = await openaiClient.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPayload }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 500,
    temperature: 0.7
  });

  // ========================================
  // 3. PARSE & VALIDATE JSON
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
  const summary_spicy = (obj.summary_spicy || summary_neutral || '').trim();
  const category_db = obj.category ? toDbCategory(obj.category) : null;
  const severity = ['critical', 'severe', 'moderate', 'minor'].includes(obj.severity)
    ? obj.severity
    : 'moderate';
  const primary_actor = (obj.primary_actor || '').trim() || null;

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
  // 4. UPDATE STORY
  // ========================================
  const { error: uErr } = await supabase
    .from('stories')
    .update({
      summary_neutral,
      summary_spicy,
      category: category_db,
      severity,
      primary_actor,
      top_entities,        // TTRC-235: text[] of canonical IDs
      entity_counter,      // TTRC-235: jsonb {id: count}
      last_enriched_at: new Date().toISOString()
    })
    .eq('id', story_id);

  if (uErr) throw new Error(`Failed to update story: ${uErr.message}`);

  // ========================================
  // 5. COST TRACKING
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
    severity,
    primary_actor
  };
}

// Export constants
export { ENRICHMENT_COOLDOWN_HOURS, UI_TO_DB_CATEGORIES };
