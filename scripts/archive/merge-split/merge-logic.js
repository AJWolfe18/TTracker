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
 * Primary merge decision function - runs full logic, returns structured context
 * This is the single source of truth for merge decisions.
 *
 * @param {object} storyA - First story (needs: top_entities, first_seen_at, category, primary_actor)
 * @param {object} storyB - Second story
 * @param {number} similarity - Precomputed centroid similarity (0-1)
 * @param {object} config - Merge config (defaults to MERGE_CFG, can override for testing)
 * @returns {object} Context with decision, lane, blockedBy, passed, sharedEntities, sharedCount
 */
export function explainMergeDecision(storyA, storyB, similarity, config = MERGE_CFG) {
  const context = {
    decision: false,
    lane: null,           // 'multi_entity' | '1_entity' | null
    blockedBy: [],        // e.g. ['LOW_SIM_2', 'TIME_WINDOW']
    passed: [],           // e.g. ['HAS_ENTITIES', 'TIME_WINDOW_OK']
    sharedEntities: [],   // Actual shared entity IDs
    sharedCount: 0,
    similarity,
  };

  // 0. Validate similarity is a usable number (blocker #2)
  if (typeof similarity !== 'number' || Number.isNaN(similarity)) {
    context.blockedBy.push('SIM_INVALID');
    return context;
  }

  // 1. Check entity presence (hard precondition)
  if (!hasEntities(storyA) || !hasEntities(storyB)) {
    context.blockedBy.push('NO_ENTITIES');
    return context;
  }
  context.passed.push('HAS_ENTITIES');

  // 2. Check time window (blocker #1: null check before withinDays)
  const timeA = storyA.first_seen_at || storyA.last_updated_at;
  const timeB = storyB.first_seen_at || storyB.last_updated_at;

  if (!timeA || !timeB) {
    context.blockedBy.push('NO_TIME');
    return context;
  }

  if (!withinDays(timeA, timeB, config.MAX_GAP_DAYS)) {
    context.blockedBy.push('TIME_WINDOW');
    return context;
  }
  context.passed.push('TIME_WINDOW_OK');

  // 3. Optional: Check category match (blocker #3: block if missing when required)
  if (config.REQUIRE_CATEGORY_MATCH) {
    if (!storyA.category || !storyB.category) {
      context.blockedBy.push('CATEGORY_MISSING');
      return context;
    }
    if (storyA.category !== storyB.category) {
      context.blockedBy.push('CATEGORY_MISMATCH');
      return context;
    }
    context.passed.push('CATEGORY_MATCH_OK');
  }

  // 4. Optional: Check actor match (blocker #4: block if missing when required)
  if (config.REQUIRE_ACTOR_MATCH) {
    if (!storyA.primary_actor || !storyB.primary_actor) {
      context.blockedBy.push('ACTOR_MISSING');
      return context;
    }
    if (storyA.primary_actor !== storyB.primary_actor) {
      context.blockedBy.push('ACTOR_MISMATCH');
      return context;
    }
    context.passed.push('ACTOR_MATCH_OK');
  }

  // 5. Calculate effective shared entities (with media org discount)
  const shared = sharedEffective(storyA.top_entities, storyB.top_entities, config);
  context.sharedEntities = shared;
  context.sharedCount = shared.length;

  // 6. Multi-signal gating: entities + similarity
  // Lane: 3+ shared entities
  if (context.sharedCount >= 3) {
    context.passed.push('ENTITY_OVERLAP_3+');
    if (similarity >= config.SIM_FOR_3) {
      context.passed.push('SIM_3_OK');
      context.decision = true;
      context.lane = 'multi_entity';
      return context;
    } else {
      context.blockedBy.push('LOW_SIM_3');
      return context;
    }
  }

  // Lane: 2 shared entities
  if (context.sharedCount === 2) {
    context.passed.push('ENTITY_OVERLAP_2');
    if (similarity >= config.SIM_FOR_2) {
      context.passed.push('SIM_2_OK');
      context.decision = true;
      context.lane = 'multi_entity';
      return context;
    } else {
      context.blockedBy.push('LOW_SIM_2');
      return context;
    }
  }

  // Lane: 1 shared entity (strict, gated by config)
  if (context.sharedCount === 1) {
    context.passed.push('ENTITY_OVERLAP_1');
    if (config.ENABLE_1_ENTITY_LANE) {
      // Future: implement strict 1-entity lane checks
      // For now, reject with clear reason
      context.blockedBy.push('1_ENTITY_LANE_NOT_IMPLEMENTED');
    } else {
      context.blockedBy.push('1_ENTITY_LANE_DISABLED');
    }
    return context;
  }

  // No entity overlap
  context.blockedBy.push('NO_ENTITY_OVERLAP');
  return context;
}

/**
 * Thin wrapper - returns just the merge decision
 * Uses explainMergeDecision() as single source of truth
 *
 * @param {object} storyA - First story
 * @param {object} storyB - Second story
 * @param {number} similarity - Precomputed centroid similarity (0-1)
 * @param {object} config - Merge config (defaults to MERGE_CFG)
 * @returns {boolean} True if stories should merge
 */
export function shouldMerge(storyA, storyB, similarity, config = MERGE_CFG) {
  return explainMergeDecision(storyA, storyB, similarity, config).decision;
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

  // Check time window (with null check)
  const timeA = storyA.first_seen_at || storyA.last_updated_at;
  const timeB = storyB.first_seen_at || storyB.last_updated_at;

  if (!timeA || !timeB) {
    return 'NO_TIME';
  }

  if (!withinDays(timeA, timeB, config.MAX_GAP_DAYS)) {
    return 'TIME_WINDOW';
  }

  // Check category match (block if missing when required)
  if (config.REQUIRE_CATEGORY_MATCH) {
    if (!storyA.category || !storyB.category) {
      return 'CATEGORY_MISSING';
    }
    if (storyA.category !== storyB.category) {
      return 'CATEGORY';
    }
  }

  // Check actor match (block if missing when required)
  if (config.REQUIRE_ACTOR_MATCH) {
    if (!storyA.primary_actor || !storyB.primary_actor) {
      return 'ACTOR_MISSING';
    }
    if (storyA.primary_actor !== storyB.primary_actor) {
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
