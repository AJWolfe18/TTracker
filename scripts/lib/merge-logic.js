/**
 * Shared Merge Detection Logic
 * Multi-signal gating: entities + embedding similarity + time window
 *
 * Used by:
 * - scripts/validate-merge-quality.js (validation)
 * - scripts/rss/periodic-merge.js (production)
 */

import { MERGE_CFG } from './merge-thresholds.js';

/**
 * Check if story has entities
 */
function hasEntities(story) {
  return Array.isArray(story.top_entities) && story.top_entities.length > 0;
}

/**
 * Check if two dates are within N days
 */
function withinDays(dateA, dateB, maxDays) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  const diffMs = Math.abs(a - b);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays <= maxDays;
}

/**
 * Calculate effective shared entities (with optional media org discount)
 * @param {string[]} entitiesA - Entity IDs from story A
 * @param {string[]} entitiesB - Entity IDs from story B
 * @param {object} config - Merge config (defaults to MERGE_CFG)
 * @returns {string[]} Shared entity IDs after discount
 */
function sharedEffective(entitiesA, entitiesB, config = MERGE_CFG) {
  const setB = new Set(entitiesB || []);
  const shared = [];

  for (const id of (entitiesA || [])) {
    if (!setB.has(id)) continue;

    // Apply media org discount if enabled
    if (config.DISCOUNT_MEDIA_ORGS && config.MEDIA_ORGS.has(id)) continue;

    shared.push(id);
  }

  return shared;
}

/**
 * Determine if two stories should merge
 *
 * @param {object} storyA - First story (needs: top_entities, first_seen_at, category, primary_actor)
 * @param {object} storyB - Second story
 * @param {number} similarity - Precomputed centroid similarity (0-1)
 * @param {object} config - Merge config (defaults to MERGE_CFG, can override for testing)
 * @returns {boolean} True if stories should merge
 */
export function shouldMerge(storyA, storyB, similarity, config = MERGE_CFG) {
  // 1. Check entity presence (hard precondition)
  if (!hasEntities(storyA) || !hasEntities(storyB)) {
    return false;
  }

  // 2. Check time window
  const timeA = storyA.first_seen_at || storyA.last_updated_at;
  const timeB = storyB.first_seen_at || storyB.last_updated_at;

  if (!withinDays(timeA, timeB, config.MAX_GAP_DAYS)) {
    return false;
  }

  // 3. Optional: Check category match
  if (config.REQUIRE_CATEGORY_MATCH) {
    if (storyA.category && storyB.category && storyA.category !== storyB.category) {
      return false;
    }
  }

  // 4. Optional: Check actor match
  if (config.REQUIRE_ACTOR_MATCH) {
    if (storyA.primary_actor && storyB.primary_actor && storyA.primary_actor !== storyB.primary_actor) {
      return false;
    }
  }

  // 5. Calculate effective shared entities (with media org discount)
  const shared = sharedEffective(storyA.top_entities, storyB.top_entities, config);
  const sharedCount = shared.length;

  // 6. Multi-signal gating: entities + similarity
  if (sharedCount >= 3 && similarity >= config.SIM_FOR_3) {
    return true;
  }

  if (sharedCount === 2 && similarity >= config.SIM_FOR_2) {
    return true;
  }

  // Reject: insufficient signal
  return false;
}

/**
 * Get skip reason for a pair that shouldn't be merged
 * Used by validator for coverage tracking
 *
 * @param {object} storyA - First story
 * @param {object} storyB - Second story
 * @param {object} config - Merge config (defaults to MERGE_CFG)
 * @returns {string|null} Skip reason or null if pair is viable
 */
export function skipReason(storyA, storyB, config = MERGE_CFG) {
  // Check entity presence
  if (!hasEntities(storyA) || !hasEntities(storyB)) {
    return 'NO_ENTITIES';
  }

  // Check time window
  const timeA = storyA.first_seen_at || storyA.last_updated_at;
  const timeB = storyB.first_seen_at || storyB.last_updated_at;

  if (!withinDays(timeA, timeB, config.MAX_GAP_DAYS)) {
    return 'TIME_WINDOW';
  }

  // Check category match
  if (config.REQUIRE_CATEGORY_MATCH) {
    if (storyA.category && storyB.category && storyA.category !== storyB.category) {
      return 'CATEGORY';
    }
  }

  // Check actor match
  if (config.REQUIRE_ACTOR_MATCH) {
    if (storyA.primary_actor && storyB.primary_actor && storyA.primary_actor !== storyB.primary_actor) {
      return 'ACTOR';
    }
  }

  // Pair is viable (will be tested against similarity thresholds)
  return null;
}

/**
 * Check if pair contains test data or unenriched stories
 * Used by validator to filter contaminated ground truth data
 *
 * @param {object} storyA - First story
 * @param {object} storyB - Second story
 * @returns {boolean} True if pair should be skipped
 */
export function isTestOrUnreadyPair(storyA, storyB) {
  const isVariation = (s) => /\[VARIATION\]/i.test(s.primary_headline || '');

  if (isVariation(storyA) || isVariation(storyB)) {
    return true;
  }

  if (!hasEntities(storyA) || !hasEntities(storyB)) {
    return true;
  }

  return false;
}
