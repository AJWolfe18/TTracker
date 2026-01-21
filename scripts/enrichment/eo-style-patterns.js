/**
 * Executive Order Style Patterns (ADO-273)
 *
 * Frame-based variation system for EO enrichment to prevent repetitive GPT outputs.
 *
 * Architecture:
 * - 3 frame buckets: alarmed | critical | grudging_credit
 * - 3 category pools: miller | donor | default
 * - 9 total pools (category × frame)
 * - Patterns from shared core + EO-specific additions
 * - Deterministic selection via FNV-1a hash
 *
 * Frame ≠ Intensity:
 * - Frame: Directional stance (controlled by variation system)
 * - Intensity: Emotional temperature (controlled by tone calibration in prompt)
 *
 * Usage:
 *   import { estimateFrame, selectVariation, buildVariationInjection, getPoolKey } from './eo-style-patterns.js';
 *   const frame = estimateFrame(eo.title, eo.description, eo.category);
 *   const poolKey = getPoolKey(eo.category, frame);
 *   const variation = selectVariation(poolKey, contentId, promptVersion, recentIds);
 *   const injection = buildVariationInjection(variation);
 */

import { CORE_STYLE_PATTERNS, fnv1a32 } from '../shared/style-patterns-core.js';

// ============================================================================
// PROMPT VERSION (update when patterns change significantly)
// ============================================================================

export const PROMPT_VERSION = 'v4-ado273';

// ============================================================================
// EO-SPECIFIC STYLE PATTERNS (~12 patterns)
// ============================================================================

export const EO_SPECIFIC_PATTERNS = [
  // --- EXECUTIVE POWER PATTERNS ---
  {
    id: 'eo-pen-stroke',
    opening_approach: 'Lead with what changed with a stroke of the pen.',
    rhetorical_device: 'Emphasize the unilateral nature of executive action.',
    structure: 'Before -> executive order -> after -> no vote required.',
    closing_approach: 'End with what else can be done this way.'
  },
  {
    id: 'eo-implementation',
    opening_approach: 'Open with how this will actually be implemented.',
    rhetorical_device: 'Focus on the ground-level reality, not the headline.',
    structure: 'Order text -> implementing agency -> practical steps -> enforcement.',
    closing_approach: 'End with when/where real people will feel this.'
  },
  {
    id: 'eo-legal-authority',
    opening_approach: 'Lead with the legal authority being claimed.',
    rhetorical_device: 'Question whether the claimed authority actually exists.',
    structure: 'Authority claimed -> actual statute -> gap analysis -> court challenge likelihood.',
    closing_approach: 'End with whether this will survive judicial review.'
  },
  {
    id: 'eo-agency-directive',
    opening_approach: 'Open by naming the agencies being ordered to act.',
    rhetorical_device: 'Frame as directing government machinery, not abstract policy.',
    structure: 'Agency ordered -> new directive -> resources required -> timeline.',
    closing_approach: 'End with capacity to actually execute.'
  },

  // --- MILLER POOL SPECIFICS (Authoritarian/Immigration) ---
  {
    id: 'eo-miller-cruelty',
    opening_approach: 'Lead with the specific harm to specific people.',
    rhetorical_device: 'Humanize the policy target without being maudlin.',
    structure: 'Who is targeted -> mechanism of harm -> stated justification -> actual effect.',
    closing_approach: 'End with what happens to real families/individuals.'
  },
  {
    id: 'eo-miller-expansion',
    opening_approach: 'Open with the expanded scope of executive power.',
    rhetorical_device: 'Compare to previous administrations, both parties.',
    structure: 'Previous limit -> new claim -> precedent set -> where this leads.',
    closing_approach: 'End with what future presidents can now do.'
  },

  // --- DONOR POOL SPECIFICS (Corporate/Grift) ---
  {
    id: 'eo-donor-deregulation',
    opening_approach: 'Lead with what protection is being removed.',
    rhetorical_device: 'Explain why the regulation existed in the first place.',
    structure: 'Regulation purpose -> harm it prevented -> removal -> expected outcomes.',
    closing_approach: 'End with who asked for this and who pays.'
  },
  {
    id: 'eo-donor-giveaway',
    opening_approach: 'Open with the dollar value being transferred.',
    rhetorical_device: 'Make the abstract concrete with numbers.',
    structure: 'Value transferred -> from whom -> to whom -> mechanism.',
    closing_approach: 'End with your share of the cost.'
  },

  // --- DEFAULT POOL SPECIFICS (General Policy) ---
  {
    id: 'eo-default-process',
    opening_approach: 'Lead with what process is being bypassed.',
    rhetorical_device: 'Note what would normally be required (legislation, rulemaking).',
    structure: 'Normal process -> shortcut taken -> justification -> implications.',
    closing_approach: 'End with whether this is sustainable.'
  },
  {
    id: 'eo-default-signaling',
    opening_approach: 'Open by distinguishing the signal from the substance.',
    rhetorical_device: 'Acknowledge when an EO is more messaging than policy.',
    structure: 'What it signals -> what it actually does -> gap -> audience.',
    closing_approach: 'End with who this is really for.'
  },

  // --- LOW ALARM PATTERNS (for grudging_credit frame) ---
  {
    id: 'eo-credit-context',
    opening_approach: 'Acknowledge the positive outcome while providing context.',
    rhetorical_device: 'Credit where due without abandoning skepticism.',
    structure: 'What happened -> why it is good -> asterisks -> what to watch.',
    closing_approach: 'End with whether this represents a pattern or exception.'
  },
  {
    id: 'eo-credit-guardrails',
    opening_approach: 'Lead with which guardrails held.',
    rhetorical_device: 'Frame as system working, not administration goodness.',
    structure: 'Constraint that held -> who enforced it -> outcome -> fragility.',
    closing_approach: 'End with whether the guardrail is still secure.'
  }
];

// ============================================================================
// COMBINED PATTERN POOLS (Core + EO-Specific)
// ============================================================================

// Combine core patterns with EO-specific patterns
export const ALL_EO_PATTERNS = [...CORE_STYLE_PATTERNS, ...EO_SPECIFIC_PATTERNS];

// Build pattern lookup by ID
const PATTERN_BY_ID = Object.fromEntries(ALL_EO_PATTERNS.map(p => [p.id, p]));

// ============================================================================
// FRAME ESTIMATION
// ============================================================================

/**
 * Estimate frame bucket from EO metadata (pre-enrichment)
 *
 * Frame buckets:
 * - alarmed: Crisis mode, this is an attack (maps to alarm levels 4-5)
 * - critical: Standard sardonic voice, default (maps to alarm levels 2-3)
 * - grudging_credit: Credit where due (maps to alarm levels 0-1)
 *
 * @param {string} title - EO title
 * @param {string|null} description - FR abstract (from description field)
 * @param {string|null} category - Pre-determined category if available
 * @returns {'alarmed' | 'critical' | 'grudging_credit'} Frame bucket
 */
export function estimateFrame(title, description, category) {
  // Warn if no title or description provided (data quality issue)
  if (!title && !description) {
    console.warn('estimateFrame: No title or description provided, defaulting to critical frame');
  }

  const text = `${title || ''} ${description || ''}`.toLowerCase();

  // ALARMED: Strong crisis signals
  const alarmedPatterns = [
    /emergency\s+powers?/,
    /martial\s+law/,
    /insurrection/,
    /suspend\s+(habeas|constitution|rights)/,
    /terminate\s+(agency|program|department)/,
    /federal\s+takeover/,
    /national\s+emergency.*border/,
    /mass\s+deportation/,
    /denaturalization/,
    /camps?\s+(detention|internment)/,
    /authoritarian/,
    /fascis/
  ];

  for (const pattern of alarmedPatterns) {
    if (pattern.test(text)) return 'alarmed';
  }

  // Category-based alarmed signals
  if (category === 'immigration_border' && /terminate|end|cancel|suspend/.test(text)) {
    return 'alarmed';
  }

  // GRUDGING_CREDIT: Explicit good news signals (rare for EOs)
  const creditPatterns = [
    /restore[sd]?\s+(protection|rights|access)/,
    /expand[sd]?\s+(access|rights|coverage)/,
    /increase[sd]?\s+(funding|support|aid)\s+for\s+(veterans|education|health)/,
    /strengthen[sd]?\s+(oversight|accountability|protection)/,
    /block[sd]?\s+(harmful|dangerous)/,
    /protect[sd]?\s+(workers|consumers|environment)/
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
 * Get the pool key for an EO
 *
 * Pool structure: {category}_{frame}
 * - miller_alarmed, miller_critical, miller_grudging_credit
 * - donor_alarmed, donor_critical, donor_grudging_credit
 * - default_alarmed, default_critical, default_grudging_credit
 *
 * @param {string} category - EO category
 * @param {'alarmed' | 'critical' | 'grudging_credit'} frame - Estimated frame
 * @returns {string} Pool key
 */
export function getPoolKey(category, frame) {
  // Determine category pool
  let categoryPool;

  if (category === 'immigration_border') {
    categoryPool = 'miller';
  } else if (category === 'economy_jobs_taxes' || category === 'environment_energy') {
    categoryPool = 'donor';
  } else {
    categoryPool = 'default';
  }

  return `${categoryPool}_${frame}`;
}

// ============================================================================
// PATTERN SELECTION BY POOL
// ============================================================================

/**
 * Get patterns appropriate for a given pool
 * @param {string} poolKey - Pool key from getPoolKey()
 * @returns {Object[]} Array of pattern objects
 */
function getPatternsForPool(poolKey) {
  const [categoryPool, frame] = poolKey.split('_');

  // Start with core patterns that work for any frame
  const patterns = [];

  // Add core patterns (filter by frame appropriateness)
  for (const p of CORE_STYLE_PATTERNS) {
    // Most core patterns work for alarmed and critical
    if (frame === 'grudging_credit') {
      // Only some core patterns work for grudging_credit
      if (['contrast-then-now', 'mechanism-how-it-works', 'scope-who-affected', 'power-precedent'].includes(p.id)) {
        patterns.push(p);
      }
    } else {
      patterns.push(p);
    }
  }

  // Add EO-specific patterns based on category pool
  if (categoryPool === 'miller') {
    patterns.push(PATTERN_BY_ID['eo-miller-cruelty']);
    patterns.push(PATTERN_BY_ID['eo-miller-expansion']);
    patterns.push(PATTERN_BY_ID['eo-pen-stroke']);
    patterns.push(PATTERN_BY_ID['eo-legal-authority']);
  } else if (categoryPool === 'donor') {
    patterns.push(PATTERN_BY_ID['eo-donor-deregulation']);
    patterns.push(PATTERN_BY_ID['eo-donor-giveaway']);
    patterns.push(PATTERN_BY_ID['eo-pen-stroke']);
    patterns.push(PATTERN_BY_ID['eo-implementation']);
  } else {
    // Default pool
    patterns.push(PATTERN_BY_ID['eo-default-process']);
    patterns.push(PATTERN_BY_ID['eo-default-signaling']);
    patterns.push(PATTERN_BY_ID['eo-pen-stroke']);
    patterns.push(PATTERN_BY_ID['eo-agency-directive']);
  }

  // Add grudging_credit specific patterns
  if (frame === 'grudging_credit') {
    patterns.push(PATTERN_BY_ID['eo-credit-context']);
    patterns.push(PATTERN_BY_ID['eo-credit-guardrails']);
  }

  // Filter out any null/undefined entries
  return patterns.filter(Boolean);
}

// ============================================================================
// DETERMINISTIC SELECTION
// ============================================================================

/**
 * Select a variation deterministically based on content ID
 *
 * Seed recipe: {content_id}:{prompt_version}:{poolKey}:{frame}
 *
 * @param {string} poolKey - Pool key from getPoolKey()
 * @param {string|number} contentId - Stable content identifier (e.g., EO database id)
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

  const frame = poolKey.split('_')[1];
  const patterns = getPatternsForPool(poolKey);

  if (patterns.length === 0) {
    // Fallback to a basic pattern
    console.warn(`⚠️ Pattern pool empty for "${poolKey}" - using fallback pattern`);
    return {
      id: 'fallback',
      opening_approach: 'Lead with the key change this order makes.',
      rhetorical_device: 'Be direct and factual.',
      structure: 'What changed -> who is affected -> implication.',
      closing_approach: 'End with what to watch for.',
      _meta: { poolKey, frame, fallback: true }
    };
  }

  // Build deterministic seed
  const seed = `${contentId}:${promptVersion}:${poolKey}:${frame}`;
  const hash = fnv1a32(seed);

  // Initial index from hash
  let idx = hash % patterns.length;

  // Collision step: walk through pool to find unused pattern
  const recentSet = new Set(recentIds);
  for (let step = 0; step < patterns.length; step++) {
    const candidate = patterns[idx];
    if (!recentSet.has(candidate.id)) {
      return { ...candidate, _meta: { poolKey, frame, seed, hash, idx } };
    }
    idx = (idx + 1) % patterns.length;
  }

  // If all patterns used recently, return the hash-selected one anyway
  const fallbackPattern = patterns[hash % patterns.length];
  return { ...fallbackPattern, _meta: { poolKey, frame, seed, hash, collision: true } };
}

// ============================================================================
// VARIATION INJECTION BUILDER
// ============================================================================

/**
 * Build the REQUIRED VARIATION injection text for the prompt
 *
 * @param {Object} variation - Pattern from selectVariation()
 * @param {'alarmed' | 'critical' | 'grudging_credit'} frame - Frame bucket
 * @returns {string} Text to inject into prompt
 */
export function buildVariationInjection(variation, frame) {
  const frameGuidance = {
    alarmed: 'FRAME: ALARMED - This is a crisis. Write with cold fury and prosecutorial precision.',
    critical: 'FRAME: CRITICAL - Standard sardonic TrumpyTracker voice. Weary, pointed, dark humor.',
    grudging_credit: 'FRAME: GRUDGING CREDIT - Credit where due. The system worked, do not get used to it.'
  };

  return `═══════════════════════════════════════════════════════════════════════════════
REQUIRED VARIATION (do not ignore)
═══════════════════════════════════════════════════════════════════════════════

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
  section_what_it_means: [
    'Beneath the surface',
    "What they don't say",
    "What they don't tell you",
    'The real story is',
    "Here's what's really going on",
    'Dig deeper and'
  ],
  section_reality_check: [
    'The truth is',
    "Let's be clear",
    "Here's the reality",
    'In reality',
    'The reality is'
  ],
  section_why_it_matters: [
    "The stakes couldn't be higher",
    'This sets the stage',
    'The implications are',
    'This matters because'
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

/**
 * Check if text starts with a banned phrase (case-insensitive)
 * @param {string} text - Text to check
 * @param {string[]} bannedPhrases - Phrases to check for
 * @returns {string|null} The banned phrase found, or null
 */
export function findBannedStarter(text, bannedPhrases) {
  const normalized = text.trim().toLowerCase();
  for (const phrase of bannedPhrases) {
    if (normalized.startsWith(phrase.toLowerCase())) {
      return phrase;
    }
  }
  return null;
}

/**
 * Attempt to repair a banned starter with a template
 * @param {string} section - Section name (for deterministic template selection)
 * @param {string} content - Original content
 * @param {string} bannedPhrase - The banned phrase found
 * @returns {{ success: boolean, content: string|null }}
 */
export function repairBannedStarter(section, content, bannedPhrase) {
  // Find where the banned phrase ends
  const phraseEnd = content.toLowerCase().indexOf(bannedPhrase.toLowerCase()) + bannedPhrase.length;
  let remainder = content.slice(phraseEnd).replace(/^[,\s]+/, '').trim();

  if (remainder.length < 20) {
    // Not enough content left after removing banned phrase
    return { success: false, content: null };
  }

  // Select template deterministically based on section
  const templateIdx = fnv1a32(section) % REPAIR_TEMPLATES.length;
  const template = REPAIR_TEMPLATES[templateIdx];

  // Rebuild with lowercase first letter of remainder
  const repaired = `${template} ${remainder.charAt(0).toLowerCase()}${remainder.slice(1)}`;

  // Verify repair doesn't also start with banned phrase for THIS section only
  const bannedList = SECTION_BANS[section] || [];
  const stillBanned = findBannedStarter(repaired, bannedList);
  if (stillBanned) {
    return { success: false, content: null };
  }

  return { success: true, content: repaired };
}

// ============================================================================
// LEGACY COMPATIBILITY EXPORTS
// ============================================================================

/**
 * Convert alarm level (0-5) to legacy severity_rating text
 * @param {number} alarmLevel - Numeric 0-5
 * @returns {string|null} Legacy severity or null for levels 0-1
 */
export function alarmLevelToLegacySeverity(alarmLevel) {
  if (alarmLevel === 5) return 'critical';
  if (alarmLevel === 4) return 'high';
  if (alarmLevel === 3) return 'medium';
  if (alarmLevel === 2) return 'low';
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

/**
 * Get content ID for an EO (for deterministic selection)
 * @param {Object} eo - Executive order object
 * @returns {string} Stable content identifier
 */
export function getEOContentId(eo) {
  // Prefer database ID
  if (eo.id) return `eo:${eo.id}`;

  // Fallback: composite of order_number and signing_date
  if (eo.order_number && eo.date) {
    return `eo:${eo.order_number}:${eo.date}`;
  }

  // Last resort: hash of title
  console.warn('Using unstable title hash for EO content_id');
  return `eo:title:${fnv1a32(eo.title || 'unknown')}`;
}
