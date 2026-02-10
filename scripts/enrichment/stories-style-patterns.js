/**
 * Stories Style Patterns (ADO-274)
 *
 * Frame-based variation system for Stories enrichment to prevent repetitive GPT outputs.
 *
 * Architecture:
 * - 3 frame buckets: alarmed | critical | grudging_credit
 * - 3 topic pools: investigations | policy | general (from feed_registry.topics)
 * - 9 total pools (topic × frame)
 * - Patterns from shared core + Stories-specific additions
 * - Deterministic selection via FNV-1a hash with bias toward Stories-specific patterns
 * - Tier (1-3) used as nudge for frame estimation, NOT as pool dimension
 *
 * Frame ≠ Intensity:
 * - Frame: Directional stance (controlled by variation system)
 * - Intensity: Emotional temperature (controlled by tone calibration in prompt)
 *
 * Usage:
 *   import { estimateStoryFrame, selectVariation, buildVariationInjection, getStoryPoolKey, getStoryContentId } from './stories-style-patterns.js';
 *   const frame = estimateStoryFrame(story.primary_headline, feedTier);
 *   const poolKey = getStoryPoolKey(feedTopics, frame);
 *   const variation = selectVariation(poolKey, contentId, promptVersion, recentIds);
 *   const injection = buildVariationInjection(variation, frame);
 */

import { CORE_STYLE_PATTERNS, fnv1a32 } from '../shared/style-patterns-core.js';

// ============================================================================
// PROMPT VERSION (update when patterns change significantly)
// ============================================================================

export const PROMPT_VERSION = 'v4-ado274';

// ============================================================================
// TUNING KNOBS (exported for easy adjustment)
// ============================================================================

// Threshold for Stories-specific pattern bias (0-100)
// Below threshold: pick from Stories-specific patterns
// At or above threshold: pick from core patterns
export const STORIES_SPECIFIC_BIAS_THRESHOLD = 40;

// ============================================================================
// STORIES-SPECIFIC STYLE PATTERNS (~15 patterns)
// ============================================================================

export const STORIES_SPECIFIC_PATTERNS = [
  // --- BREAKING NEWS PATTERNS ---
  {
    id: 'story-breaking-impact',
    opening_approach: 'Lead with immediate impact of breaking news.',
    rhetorical_device: 'Cut through noise to essential change.',
    structure: 'What just happened -> who is affected -> why now -> what next.',
    closing_approach: 'End with what to watch for in next 24-48 hours.'
  },
  {
    id: 'story-developing',
    opening_approach: 'Open with what we know and what we do not.',
    rhetorical_device: 'Distinguish confirmed from rumored.',
    structure: 'Confirmed facts -> open questions -> competing narratives -> stakes.',
    closing_approach: 'End with key questions that remain.'
  },

  // --- INVESTIGATIONS POOL SPECIFICS ---
  {
    id: 'story-investigation-trail',
    opening_approach: 'Lead with the investigative thread being pulled.',
    rhetorical_device: 'Frame as accountability journalism at work.',
    structure: 'What was found -> how it connects -> who is implicated -> next steps.',
    closing_approach: 'End with what investigators are looking at next.'
  },
  {
    id: 'story-corruption-receipt',
    opening_approach: 'Open with the most damning documented detail.',
    rhetorical_device: 'Let receipts speak for themselves.',
    structure: 'Documented fact -> timeline -> pattern -> implication.',
    closing_approach: 'End with what the receipts make undeniable.'
  },
  {
    id: 'story-scandal-names',
    opening_approach: 'Lead by naming the specific actors involved.',
    rhetorical_device: 'Attach actions to names, not passive voice.',
    structure: 'Who did what -> when -> with what consequence -> accountability status.',
    closing_approach: 'End with whether accountability is possible.'
  },

  // --- POLICY POOL SPECIFICS ---
  {
    id: 'story-policy-translation',
    opening_approach: 'Open by translating policy-speak into plain impact.',
    rhetorical_device: 'Cut through bureaucratic language.',
    structure: 'What they said -> what it actually means -> who benefits/loses -> timeline.',
    closing_approach: 'End with when regular people will feel this.'
  },
  {
    id: 'story-policy-winners',
    opening_approach: 'Lead with who wins and who loses.',
    rhetorical_device: 'Frame policy as distribution, not abstraction.',
    structure: 'Winners -> losers -> mechanism -> political context.',
    closing_approach: 'End with whose interests drove this.'
  },
  {
    id: 'story-analysis-context',
    opening_approach: 'Open with the broader context this fits into.',
    rhetorical_device: 'Connect dots across time and pattern.',
    structure: 'Current event -> historical parallel -> pattern -> trajectory.',
    closing_approach: 'End with what the pattern predicts.'
  },

  // --- GENERAL POOL SPECIFICS ---
  {
    id: 'story-chaos-specific',
    opening_approach: 'Lead with this specific chaos within the larger chaos.',
    rhetorical_device: 'Use dumpster fire framing without being lazy.',
    structure: 'This specific mess -> how it connects to larger mess -> consequences.',
    closing_approach: 'End with what this chaos enables.'
  },
  {
    id: 'story-absurdity-flat',
    opening_approach: 'Open by stating the absurd element flatly.',
    rhetorical_device: 'Deadpan delivery letting absurdity land naturally.',
    structure: 'Absurd fact -> context -> why this is happening -> implication.',
    closing_approach: 'End without editorializing, let the fact sit.'
  },
  {
    id: 'story-weary-pattern',
    opening_approach: 'Lead with weary recognition of recurring pattern.',
    rhetorical_device: 'This again framing without fatigue.',
    structure: 'Pattern identified -> this instance -> why it keeps happening -> what would change it.',
    closing_approach: 'End with systemic note.'
  },

  // --- LOW ALARM PATTERNS (for grudging_credit frame) ---
  {
    id: 'story-credit-asterisk',
    opening_approach: 'Acknowledge the positive while noting the asterisks.',
    rhetorical_device: 'Credit where due without abandoning skepticism.',
    structure: 'What happened -> why it is good -> the caveats -> what to watch.',
    closing_approach: 'End with whether this represents a pattern or exception.'
  },
  {
    id: 'story-system-worked',
    opening_approach: 'Lead with which part of the system actually functioned.',
    rhetorical_device: 'Frame as guardrails holding, not administration goodness.',
    structure: 'What was blocked -> who blocked it -> mechanism -> fragility.',
    closing_approach: 'End with whether the guardrail is still secure.'
  },
  {
    id: 'story-unexpected-good',
    opening_approach: 'Open with genuine acknowledgment of unexpected outcome.',
    rhetorical_device: 'Suspicious optimism energy.',
    structure: 'Good news -> context -> why unexpected -> sustainability.',
    closing_approach: 'End with do not get used to it but appreciate this one.'
  }
];

// ============================================================================
// COMBINED PATTERN POOLS (Core + Stories-Specific)
// ============================================================================

// Combine core patterns with Stories-specific patterns
export const ALL_STORIES_PATTERNS = [...CORE_STYLE_PATTERNS, ...STORIES_SPECIFIC_PATTERNS];

// Build pattern lookup by ID with collision check (fail-closed on duplicates)
const PATTERN_BY_ID = {};
for (const p of ALL_STORIES_PATTERNS) {
  if (PATTERN_BY_ID[p.id]) {
    throw new Error(`Duplicate pattern ID detected: "${p.id}" - check CORE_STYLE_PATTERNS and STORIES_SPECIFIC_PATTERNS`);
  }
  PATTERN_BY_ID[p.id] = p;
}

// ============================================================================
// POOL KEY PARSING
// ============================================================================

/**
 * Parse pool key into topic and frame components
 * Handles multi-part frames like "grudging_credit"
 * Fail-soft: defaults to 'general' topic and 'critical' frame if malformed
 *
 * @param {string} poolKey - Pool key (e.g., "policy_grudging_credit")
 * @returns {{ topicPool: string, frame: string }}
 */
function parsePoolKey(poolKey) {
  const [topicPool, ...frameParts] = String(poolKey || '').split('_');
  const frame = frameParts.join('_') || 'critical';
  const topic = topicPool || 'general';
  return { topicPool: topic, frame };
}

// ============================================================================
// FEED TOPIC MAPPING
// ============================================================================

/**
 * Map feed_registry.topics array to story pool topic
 * @param {string[]} topics - Array of topics from feed_registry
 * @returns {'investigations' | 'policy' | 'general'} Pool topic
 */
export function mapFeedTopicsToPool(topics) {
  if (!topics || !Array.isArray(topics) || topics.length === 0) {
    return 'general';
  }

  // Safely convert to lowercase strings
  const topicsLower = topics.map(t => String(t).toLowerCase());

  // Investigations pool: scrutiny-focused sources
  if (topicsLower.some(t =>
    t.includes('investigation') ||
    t.includes('corruption') ||
    t.includes('accountability') ||
    t.includes('watchdog')
  )) {
    return 'investigations';
  }

  // Policy pool: analysis-focused sources
  if (topicsLower.some(t =>
    t.includes('policy') ||
    t.includes('legislation') ||
    t.includes('congress') ||
    t.includes('analysis')
  )) {
    return 'policy';
  }

  // Default: general coverage
  return 'general';
}

// ============================================================================
// FRAME ESTIMATION
// ============================================================================

// Negative-context patterns that indicate "blocked/stopped" is BAD news
// NOTE: Allow a few bridge-words ("DOJ", "congressional", etc.) between the verb and the noun.
// Example: "Trump blocked DOJ investigation" should be negative context (NOT grudging_credit).
const NEGATIVE_CONTEXT_PATTERNS = [
  /\bblock(?:ed|s|ing)?\s+(?:\w+\s+){0,3}(aid|relief|funding|assistance|access|investigation|inquiry|oversight|probe|subpoena|testimony)\b/i,
  /\bstop(?:ped|s|ping)?\s+(?:\w+\s+){0,3}(aid|relief|funding|assistance|access|investigation|inquiry|oversight|probe|subpoena|testimony)\b/i,
  /\boverturned\s+(?:\w+\s+){0,2}(protection|rights|ruling|decision)\b/i,
  /\bstruck\s+down\s+(?:\w+\s+){0,2}(protection|rights|law)\b/i
];

/**
 * Check if headline contains negative context that would make
 * credit-sounding words actually bad news
 * @param {string} text - Lowercase headline text
 * @returns {boolean}
 */
function hasNegativeContext(text) {
  return NEGATIVE_CONTEXT_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Estimate frame bucket from story metadata (pre-enrichment)
 *
 * Frame buckets:
 * - alarmed: Crisis mode, this is an attack (maps to alarm levels 4-5)
 * - critical: Standard sardonic voice, default (maps to alarm levels 2-3)
 * - grudging_credit: Credit where due (maps to alarm levels 0-1)
 *
 * @param {string} headline - Story primary_headline
 * @param {number|null} tier - Feed tier (1-3), used as nudge
 * @returns {'alarmed' | 'critical' | 'grudging_credit'} Frame bucket
 */
export function estimateStoryFrame(headline, tier) {
  // Warn if no headline provided (data quality issue)
  if (!headline) {
    console.warn('estimateStoryFrame: No headline provided, defaulting to critical frame');
    return 'critical';
  }

  // Safely convert to lowercase string
  const text = String(headline).toLowerCase();

  // Safely convert tier to number (handles string "1" from config)
  const tierNum = tier == null ? null : Number(tier);

  // ALARMED: Strong crisis signals
  const alarmedPatterns = [
    /insurrection/,
    /coup/,
    /fascis/,
    /authoritarian/,
    /martial\s+law/,
    /mass\s+deportation/,
    /constitutional\s+crisis/,
    /impeach/,
    /indicted?/,
    /arrested/,
    /raided?/,
    /charged\s+with/,
    /emergency\s+powers?/,
    /suspend(ed|s)?\s+(rights|constitution|habeas)/,
    /dictator|dictatorship/  // Tightened: was /dictat/ which matched "dictate"
  ];

  for (const pattern of alarmedPatterns) {
    if (pattern.test(text)) return 'alarmed';
  }

  // Tier 1 sources (breaking news) + urgent language bias toward alarmed
  if (tierNum === 1 && /breaking|urgent|emergency|crisis/.test(text)) {
    return 'alarmed';
  }

  // GRUDGING_CREDIT: Explicit good news signals (rare)
  // Check for negative context first - "blocked aid" is bad, not good
  if (hasNegativeContext(text)) {
    return 'critical'; // Don't misclassify as good news
  }

  // Note: Some patterns like "blocked" can still be ambiguous.
  // The mismatch fuse in the prompt lets GPT correct if frame estimate is wrong.
  const creditPatterns = [
    /victory\s+for/,
    /wins?\s+(case|suit|ruling|appeal)/,
    /court\s+rules?\s+against/,
    /blocked/,
    /stopped/,
    /defeated/,
    /overturned/,
    /struck\s+down/,
    /dismissed/,
    /acquitted/,
    /exonerated/,
    /protected/,
    /restored/
  ];

  for (const pattern of creditPatterns) {
    if (pattern.test(text)) return 'grudging_credit';
  }

  // DEFAULT: Critical (the baseline TrumpyTracker voice)
  return 'critical';
}

// ============================================================================
// POOL KEY SELECTION
// ============================================================================

/**
 * Get the pool key for a story
 *
 * Pool structure: {topic}_{frame}
 * - investigations_alarmed, investigations_critical, investigations_grudging_credit
 * - policy_alarmed, policy_critical, policy_grudging_credit
 * - general_alarmed, general_critical, general_grudging_credit
 *
 * @param {string[]} feedTopics - Topics from feed_registry
 * @param {'alarmed' | 'critical' | 'grudging_credit'} frame - Estimated frame
 * @returns {string} Pool key
 */
export function getStoryPoolKey(feedTopics, frame) {
  const topicPool = mapFeedTopicsToPool(feedTopics);
  return `${topicPool}_${frame}`;
}

// ============================================================================
// PATTERN SELECTION BY POOL
// ============================================================================

/**
 * Get Stories-specific patterns for a given topic pool and frame
 * @param {string} topicPool - 'investigations' | 'policy' | 'general'
 * @param {string} frame - 'alarmed' | 'critical' | 'grudging_credit'
 * @returns {Object[]} Array of Stories-specific pattern objects
 */
function getStoriesSpecificPatterns(topicPool, frame) {
  const patterns = [];

  // Add topic-specific patterns
  if (topicPool === 'investigations') {
    patterns.push(PATTERN_BY_ID['story-investigation-trail']);
    patterns.push(PATTERN_BY_ID['story-corruption-receipt']);
    patterns.push(PATTERN_BY_ID['story-scandal-names']);
    patterns.push(PATTERN_BY_ID['story-breaking-impact']);
  } else if (topicPool === 'policy') {
    patterns.push(PATTERN_BY_ID['story-policy-translation']);
    patterns.push(PATTERN_BY_ID['story-policy-winners']);
    patterns.push(PATTERN_BY_ID['story-analysis-context']);
    patterns.push(PATTERN_BY_ID['story-developing']);
  } else {
    // General pool
    patterns.push(PATTERN_BY_ID['story-chaos-specific']);
    patterns.push(PATTERN_BY_ID['story-absurdity-flat']);
    patterns.push(PATTERN_BY_ID['story-weary-pattern']);
    patterns.push(PATTERN_BY_ID['story-breaking-impact']);
  }

  // Add grudging_credit specific patterns
  if (frame === 'grudging_credit') {
    patterns.push(PATTERN_BY_ID['story-credit-asterisk']);
    patterns.push(PATTERN_BY_ID['story-system-worked']);
    patterns.push(PATTERN_BY_ID['story-unexpected-good']);
  }

  return patterns.filter(Boolean);
}

/**
 * Get core patterns appropriate for a given frame
 * @param {string} frame - 'alarmed' | 'critical' | 'grudging_credit'
 * @returns {Object[]} Array of core pattern objects
 */
function getCorePatterns(frame) {
  const patterns = [];

  for (const p of CORE_STYLE_PATTERNS) {
    if (frame === 'grudging_credit') {
      // Only some core patterns work for grudging_credit
      if (['contrast-then-now', 'mechanism-how-it-works', 'scope-who-affected', 'power-precedent', 'accountability-timeline'].includes(p.id)) {
        patterns.push(p);
      }
    } else {
      patterns.push(p);
    }
  }

  return patterns;
}

/**
 * Get all patterns appropriate for a given pool (for fallback/collision walking)
 * Dedupe defensively in case upstream changes introduce overlap
 * @param {string} poolKey - Pool key from getStoryPoolKey()
 * @returns {Object[]} Array of pattern objects
 */
function getAllPatternsForPool(poolKey) {
  const { topicPool, frame } = parsePoolKey(poolKey);
  const corePatterns = getCorePatterns(frame);
  const storiesPatterns = getStoriesSpecificPatterns(topicPool, frame);

  // Dedupe by ID defensively (currently cannot overlap due to fail-closed check above)
  const seen = new Set();
  const combined = [];
  for (const p of [...storiesPatterns, ...corePatterns]) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      combined.push(p);
    }
  }
  return combined;
}

// ============================================================================
// DETERMINISTIC SELECTION
// ============================================================================

/**
 * Select a variation deterministically based on content ID
 *
 * Uses hash-based bias: 40% chance of Stories-specific pattern, 60% core.
 * This ensures Stories "feel like Stories" while still using universal patterns.
 *
 * Seed recipe: {content_id}:{prompt_version}:{poolKey}
 * (frame is already encoded in poolKey)
 *
 * @param {string} poolKey - Pool key from getStoryPoolKey()
 * @param {string|number} contentId - Stable content identifier (e.g., story database id)
 * @param {string} promptVersion - Current prompt version
 * @param {string[]} recentIds - IDs of recently used patterns (for batch deduplication)
 * @returns {Object} Selected pattern with metadata
 */
export function selectVariation(poolKey, contentId, promptVersion, recentIds = []) {
  // Input validation (prevents silent failures)
  if (!poolKey || typeof poolKey !== 'string') {
    throw new Error('selectVariation: poolKey must be a non-empty string');
  }
  if (contentId === undefined || contentId === null) {
    throw new Error('selectVariation: contentId must be provided');
  }
  if (!promptVersion) {
    throw new Error('selectVariation: promptVersion must be provided');
  }

  const { topicPool, frame } = parsePoolKey(poolKey);

  // Build deterministic seed (frame already encoded in poolKey)
  const seed = `${contentId}:${promptVersion}:${poolKey}`;

  // Use separate derived hashes for bias and index to avoid correlation
  const hashBias = fnv1a32(`${seed}:bias`);
  const hashIdx = fnv1a32(`${seed}:idx`);

  // Determine which sub-pool to select from (biased toward Stories-specific)
  const biasRoll = hashBias % 100;
  const useStoriesSpecific = biasRoll < STORIES_SPECIFIC_BIAS_THRESHOLD;

  // Get the appropriate pattern pool
  const storiesPatterns = getStoriesSpecificPatterns(topicPool, frame);
  const corePatterns = getCorePatterns(frame);

  let primaryPool = useStoriesSpecific ? storiesPatterns : corePatterns;
  let fallbackPool = useStoriesSpecific ? corePatterns : storiesPatterns;

  // If primary pool is empty, use fallback
  if (primaryPool.length === 0) {
    primaryPool = fallbackPool;
    fallbackPool = [];
  }

  // If still empty, return fallback pattern
  if (primaryPool.length === 0) {
    console.warn(`Pattern pool empty for "${poolKey}" - using fallback pattern`);
    return {
      id: 'fallback',
      opening_approach: 'Lead with the key change this story represents.',
      rhetorical_device: 'Be direct and factual.',
      structure: 'What changed -> who is affected -> implication.',
      closing_approach: 'End with what to watch for.',
      _meta: { poolKey, frame, fallback: true }
    };
  }

  // Initial index from hash
  let idx = hashIdx % primaryPool.length;

  // Collision step: walk through pool to find unused pattern
  // Note: recentIds should be scoped per-poolKey by caller for best results
  const recentSet = new Set(recentIds);
  for (let step = 0; step < primaryPool.length; step++) {
    const candidate = primaryPool[idx];
    if (!recentSet.has(candidate.id)) {
      return {
        ...candidate,
        _meta: { poolKey, frame, seed, hashBias, hashIdx, idx, subpool: useStoriesSpecific ? 'stories' : 'core' }
      };
    }
    idx = (idx + 1) % primaryPool.length;
  }

  // All in primary pool used recently, try fallback pool
  if (fallbackPool.length > 0) {
    idx = hashIdx % fallbackPool.length;
    for (let step = 0; step < fallbackPool.length; step++) {
      const candidate = fallbackPool[idx];
      if (!recentSet.has(candidate.id)) {
        return {
          ...candidate,
          _meta: { poolKey, frame, seed, hashBias, hashIdx, idx, subpool: useStoriesSpecific ? 'core' : 'stories', spillover: true }
        };
      }
      idx = (idx + 1) % fallbackPool.length;
    }
  }

  // If all patterns used recently, return the hash-selected one anyway
  const allPatterns = getAllPatternsForPool(poolKey);
  const fallbackPattern = allPatterns[hashIdx % allPatterns.length];
  return { ...fallbackPattern, _meta: { poolKey, frame, seed, hashBias, hashIdx, collision: true } };
}

// ============================================================================
// VARIATION INJECTION BUILDER
// ============================================================================

/**
 * Build the REQUIRED VARIATION injection text for the prompt
 *
 * Note: Frame guidance is STANCE-ONLY. Intensity/temperature is controlled
 * by the main SYSTEM_PROMPT's alarm_level calibration (0-5).
 *
 * @param {Object} variation - Pattern from selectVariation()
 * @param {'alarmed' | 'critical' | 'grudging_credit'} frame - Frame bucket
 * @returns {string} Text to inject into prompt
 */
export function buildVariationInjection(variation, frame) {
  // Stance-only guidance (intensity controlled by alarm_level in main prompt)
  const frameGuidance = {
    alarmed: 'FRAME: ALARMED - Treat this as a crisis. An attack on democracy, rights, or norms.',
    critical: 'FRAME: CRITICAL - Treat this as standard corruption. Typical grift and dysfunction.',
    grudging_credit: 'FRAME: GRUDGING CREDIT - Credit where due, with skepticism. The system worked this time.'
  };

  return `REQUIRED VARIATION (do not ignore)

${frameGuidance[frame] || frameGuidance.critical}

STYLE PATTERN: ${variation.id}
- Opening approach: ${variation.opening_approach}
- Rhetorical device: ${variation.rhetorical_device}
- Structure: ${variation.structure}
- Closing approach: ${variation.closing_approach}

Follow this pattern's APPROACH and SPIRIT - do not copy any specific phrases verbatim.
The pattern guides structure, not exact wording.

MISMATCH FUSE: If your determined alarm_level conflicts with this frame
(e.g., you determine level 0-1 but received "alarmed" frame), keep the
style pattern structure but adjust stance to match your actual alarm_level.`;
}

// ============================================================================
// SECTION BANNED OPENERS (for post-generation validation)
// ============================================================================

export const SECTION_BANS = {
  summary_spicy: [
    'Beneath the surface',
    "What they don't say",
    "What they don't tell you",
    'The real story is',
    "Here's what's really going on",
    'Dig deeper and',
    'The truth is',
    "Let's be clear",
    "Here's the reality",
    "The stakes couldn't be higher",
    'This sets the stage'
  ]
};

export const REPAIR_TEMPLATES = [
  'In practice,',
  'Put plainly,',
  'Net effect:',
  'Bottom line:',
  'Practically speaking,',
  'The upshot:',
  'Translation:',
  'What this means:'
];

// ============================================================================
// TEXT NORMALIZATION HELPERS
// ============================================================================

/**
 * Strip leading punctuation, quotes, dashes, etc. for consistent comparison
 * Used by both findBannedStarter and repairBannedStarter to avoid drift
 * @param {string} s - Input string
 * @returns {string} Stripped string
 */
function stripLeadingJunk(s) {
  return String(s || '').trim().replace(/^[\s"'""''—–\-:>]+/, '');
}

/**
 * Check if text starts with a banned phrase (case-insensitive)
 * @param {string} text - Text to check
 * @param {string[]} bannedPhrases - Phrases to check for
 * @returns {string|null} The banned phrase found, or null
 */
export function findBannedStarter(text, bannedPhrases) {
  const normalized = stripLeadingJunk(text).toLowerCase();

  for (const phrase of bannedPhrases) {
    if (normalized.startsWith(String(phrase).toLowerCase())) {
      return phrase;
    }
  }
  return null;
}

/**
 * Attempt to repair a banned starter with a template
 * Fail-closed: only repairs if banned phrase is exactly at position 0
 * @param {string} section - Section name (for deterministic template selection)
 * @param {string} content - Original content
 * @param {string} bannedPhrase - The banned phrase found
 * @returns {{ success: boolean, content: string|null, reason: string|null }}
 */
export function repairBannedStarter(section, content, bannedPhrase) {
  const strippedContent = stripLeadingJunk(content);

  const phraseLower = String(bannedPhrase).toLowerCase();
  const phraseStart = strippedContent.toLowerCase().indexOf(phraseLower);

  // Fail-closed: only repair if phrase is exactly at position 0
  if (phraseStart !== 0) {
    return {
      success: false,
      content: null,
      reason: phraseStart < 0 ? 'PHRASE_NOT_FOUND' : 'PHRASE_NOT_AT_START'
    };
  }

  const phraseEnd = bannedPhrase.length;
  let remainder = strippedContent.slice(phraseEnd).replace(/^[,\s]+/, '').trim();

  if (remainder.length < 20) {
    return { success: false, content: null, reason: 'REMAINDER_TOO_SHORT' };
  }

  // Select template deterministically based on section
  const templateIdx = fnv1a32(section) % REPAIR_TEMPLATES.length;
  const template = REPAIR_TEMPLATES[templateIdx];

  // Rebuild - preserve original casing of remainder (don't corrupt acronyms like ICE, DOJ)
  const repaired = `${template} ${remainder}`;

  // Verify repair doesn't also start with banned phrase for THIS section only
  const bannedList = SECTION_BANS[section] || [];
  const stillBanned = findBannedStarter(repaired, bannedList);
  if (stillBanned) {
    return { success: false, content: null, reason: `STILL_BANNED:${stillBanned}` };
  }

  return { success: true, content: repaired, reason: null };
}

// ============================================================================
// ALARM LEVEL HELPERS
// ============================================================================

/**
 * Convert alarm level (0-5) to legacy severity_rating text
 * @param {number} alarmLevel - Numeric 0-5
 * @returns {string|null} Legacy severity or null for levels 0-1
 */
export function alarmLevelToLegacySeverity(alarmLevel) {
  // Must match DB constraint: critical, severe, moderate, minor
  if (alarmLevel === 5) return 'critical';
  if (alarmLevel === 4) return 'severe';
  if (alarmLevel === 3) return 'moderate';
  if (alarmLevel === 2) return 'minor';
  return null; // 0-1 can't be represented in legacy enum
}

/**
 * Normalize alarm level to valid 0-5 range
 * @param {*} value - Input value
 * @returns {number} Valid alarm level 0-5, defaults to 3
 */
export function normalizeAlarmLevel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 3;
  if (n < 0) return 0;
  if (n > 5) return 5;
  return Math.trunc(n);
}

// ============================================================================
// CONTENT ID GENERATION
// ============================================================================

/**
 * Get stable content ID for a story (for deterministic selection)
 *
 * Priority:
 * 1. Database ID (most stable)
 * 2. Hash of sorted article_ids (stable if articles don't change)
 * 3. Cluster ID (if available)
 * 4. Hash of headline (last resort, unstable)
 *
 * @param {Object} story - Story object
 * @returns {string} Stable content identifier
 */
export function getStoryContentId(story) {
  // Prefer database ID (use != null to handle id === 0)
  if (story?.id != null) return `story:${story.id}`;

  // Fallback: hash of sorted article_ids (safe for numeric or string IDs)
  if (story?.article_ids?.length) {
    const sorted = [...story.article_ids].sort((a, b) => String(a).localeCompare(String(b)));
    return `story:articles:${fnv1a32(sorted.join(','))}`;
  }

  // Fallback: cluster_id (use != null to handle cluster_id === 0)
  if (story?.cluster_id != null) return `story:cluster:${story.cluster_id}`;

  // Last resort: hash of headline (unstable)
  console.warn('Using unstable headline hash for story content_id');
  return `story:headline:${fnv1a32(String(story?.primary_headline || 'unknown'))}`;
}
