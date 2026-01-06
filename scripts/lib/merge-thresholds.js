/**
 * Merge Detection Configuration
 * Single source of truth for merge thresholds and tunables
 *
 * Used by:
 * - scripts/validate-merge-quality.js (validation + sweep)
 * - scripts/rss/periodic-merge.js (production merge detection)
 */

export const MERGE_CFG = {
  // Entity overlap requirements
  MIN_SHARED: 2,                    // Minimum shared entities (after media org discount)

  // Similarity thresholds (multi-signal gating)
  SIM_FOR_2: 0.85,                  // High bar when only 2 shared entities
  SIM_FOR_3: 0.75,                  // Lower bar when 3+ shared entities

  // Time window
  MAX_GAP_DAYS: 7,                  // Publication date overlap window (days)

  // Optional match requirements
  REQUIRE_ACTOR_MATCH: false,       // Must share primary_actor (if both set) - DISABLED for now, most stories lack this field
  REQUIRE_CATEGORY_MATCH: false,    // Must share category (if both set) - DISABLED for now, most stories lack this field

  // Media organization discount (A/B testable)
  DISCOUNT_MEDIA_ORGS: false,       // If true, exclude media orgs from entity count (DISABLED - too aggressive for current data)
  MEDIA_ORGS: new Set([
    'ORG-NYT',
    'ORG-WAPO',
    'ORG-AP',
    'ORG-REUTERS',
    'ORG-FOX',
    'ORG-CNN',
    'ORG-POLITICO',
  ]),
};
