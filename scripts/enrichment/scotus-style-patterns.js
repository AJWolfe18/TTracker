/**
 * SCOTUS Style Patterns (ADO-275)
 *
 * Frame-based variation system for SCOTUS enrichment to prevent repetitive GPT outputs.
 * Replaces scotus-variation-pools.js (deprecated) which used Math.random() and literal text openers.
 *
 * Architecture:
 * - 6 pools: procedural | alarmed | critical | grudging_credit | voting_rights_override | agency_power_override
 * - Frame selection priority: clamp_reason → inferIssueOverride() → Pass1 facts → estimateImpactLevel
 * - Patterns from shared core + SCOTUS-specific additions
 * - Deterministic selection via FNV-1a hash
 * - Post-gen validation with regex-based banned starter detection
 *
 * Frame vs Label (orthogonal):
 * - Frame (ADO-275) = how we write (voice, structure, rhetorical approach)
 * - Label (ADO-300) = what we call it (Judicial Sidestepping, etc.)
 *
 * Critical Rule:
 * Clamped cases must use procedural frame even if Pass 2 would choose a high alarm label;
 * mismatch fuse is disabled when clamped.
 *
 * Usage:
 *   import { selectFrame, selectVariation, buildVariationInjection, PROMPT_VERSION } from './scotus-style-patterns.js';
 *   const { frame, poolKey } = selectFrame(clampedFacts, scotusCase);
 *   const variation = selectVariation(poolKey, caseId, PROMPT_VERSION, recentIds);
 *   const injection = buildVariationInjection(variation, frame, clampedFacts.clamp_reason);
 */

import { CORE_STYLE_PATTERNS, fnv1a32 } from '../shared/style-patterns-core.js';

// ============================================================================
// PROMPT VERSION (update when patterns change significantly)
// ============================================================================

export const PROMPT_VERSION = 'v4-ado275';

// ============================================================================
// TUNING KNOBS
// ============================================================================

// Threshold for SCOTUS-specific pattern bias (0-100)
// Below threshold: pick from SCOTUS-specific patterns
// At or above threshold: pick from core patterns
export const SCOTUS_SPECIFIC_BIAS_THRESHOLD = 50;

// ============================================================================
// SCOTUS-SPECIFIC STYLE PATTERNS (~15 patterns)
// ============================================================================

export const SCOTUS_SPECIFIC_PATTERNS = [
  // --- PROCEDURAL FRAME PATTERNS (for clamped cases) ---
  {
    id: 'scotus-procedural-posture',
    opening_approach: 'Lead with the procedural posture and what it means.',
    rhetorical_device: 'Explain procedural outcome without implying merits.',
    structure: 'What the Court did -> what it did NOT decide -> practical effect -> what stands.',
    closing_approach: 'End with what this procedural move allows to continue.'
  },
  {
    id: 'scotus-cert-denied-impact',
    opening_approach: 'Open with what lower court ruling now stands unchallenged.',
    rhetorical_device: 'Frame the non-decision as its own decision.',
    structure: 'Cert denied -> lower ruling stands -> who benefits -> geographic scope.',
    closing_approach: 'End with whether this creates circuit split or allows status quo.'
  },
  {
    id: 'scotus-standing-dodge',
    opening_approach: 'Open with what the Court refused to decide by finding no standing.',
    rhetorical_device: 'Frame the avoidance itself as the story.',
    structure: 'Standing rejected -> question left unanswered -> who benefited from delay -> precedent.',
    closing_approach: 'End with what this means for future challenges.'
  },

  // --- ALARMED FRAME PATTERNS ---
  {
    id: 'scotus-legitimacy-crisis',
    opening_approach: 'Open with the Court legitimacy angle.',
    rhetorical_device: 'Frame as institutional betrayal without stock catchphrases.',
    structure: 'What the Court did -> how it undermines public trust -> who benefits -> pattern.',
    closing_approach: 'End with the trajectory for Court credibility.'
  },
  {
    id: 'scotus-precedent-killed',
    opening_approach: 'Lead with the specific precedent being weakened or overturned.',
    rhetorical_device: 'Name the dead precedent and what protection died with it.',
    structure: 'Precedent name -> years of reliance -> what died -> who loses protection.',
    closing_approach: 'End with what this precedent death enables.'
  },
  {
    id: 'scotus-power-blessed',
    opening_approach: 'Name the power center and what the Court just enabled.',
    rhetorical_device: 'Frame as Court blessing authoritarianism.',
    structure: 'Power center named -> what Court enabled -> who has less recourse -> pattern.',
    closing_approach: 'End with what this power can now do unchecked.'
  },

  // --- CRITICAL FRAME PATTERNS ---
  {
    id: 'scotus-technical-trap',
    opening_approach: 'Open with the technical move that sounds boring but matters.',
    rhetorical_device: 'Explain the trick without using tired templates.',
    structure: 'Technical issue -> what it actually means -> who exploits it -> practical harm.',
    closing_approach: 'End with why the boring technicality is the point.'
  },
  {
    id: 'scotus-vote-fracture',
    opening_approach: 'Open with the vote split and what it signals.',
    rhetorical_device: 'Use the vote pattern as diagnostic.',
    structure: 'Vote split -> unusual alignments -> what this signals -> durability.',
    closing_approach: 'End with what the fracture pattern predicts.'
  },
  {
    id: 'scotus-dissent-prophecy',
    opening_approach: 'Frame around what the dissent warned.',
    rhetorical_device: 'Let the dissent speak truth to majority.',
    structure: 'Dissent warning -> what majority ignored -> practical consequence -> vindication timeline.',
    closing_approach: 'End with when the dissent will be proven right.'
  },

  // --- GRUDGING CREDIT PATTERNS ---
  {
    id: 'scotus-unanimous-surprise',
    opening_approach: 'Open with genuine acknowledgment of unexpected good outcome.',
    rhetorical_device: 'Suspicious optimism without abandoning skepticism.',
    structure: 'Good outcome -> why unexpected -> the caveats -> durability assessment.',
    closing_approach: 'End with do not get used to it but appreciate this one.'
  },
  {
    id: 'scotus-rights-held',
    opening_approach: 'Acknowledge that rights were actually protected.',
    rhetorical_device: 'Credit while noting the narrowness.',
    structure: 'Right protected -> scope of protection -> limiting language -> sustainability.',
    closing_approach: 'End with whether this protection will last.'
  },
  {
    id: 'scotus-system-worked-once',
    opening_approach: 'Lead with which guardrail actually functioned.',
    rhetorical_device: 'Frame as guardrails holding, not Court goodness.',
    structure: 'What was blocked -> mechanism that worked -> fragility -> next test.',
    closing_approach: 'End with whether the guardrail is still secure.'
  },

  // --- ISSUE OVERRIDE PATTERNS (voting rights) ---
  {
    id: 'scotus-vra-erosion',
    opening_approach: 'Open with the specific Voting Rights Act provision affected.',
    rhetorical_device: 'Frame as continued dismantling post-Shelby.',
    structure: 'VRA provision -> what protection lost -> geographic impact -> disenfranchisement count.',
    closing_approach: 'End with what recourse remains for voters.'
  },
  {
    id: 'scotus-gerrymander-blessed',
    opening_approach: 'Lead with the specific districts or map affected.',
    rhetorical_device: 'Frame as democracy math problem.',
    structure: 'Map/districts -> vote dilution effect -> who loses representation -> precedent.',
    closing_approach: 'End with what this means for future challenges.'
  },

  // --- ISSUE OVERRIDE PATTERNS (agency power) ---
  {
    id: 'scotus-chevron-erosion',
    opening_approach: 'Open with the specific agency authority diminished.',
    rhetorical_device: 'Frame as expertise overruled by judicial fiat.',
    structure: 'Agency named -> authority lost -> regulatory gap created -> who exploits.',
    closing_approach: 'End with what the agency can no longer do.'
  },
  {
    id: 'scotus-major-questions',
    opening_approach: 'Lead with what was deemed too major for agencies.',
    rhetorical_device: 'Frame the Catch-22: too major for agency, Congress won\'t act.',
    structure: 'Issue deemed major -> agency blocked -> Congressional inaction -> regulatory vacuum.',
    closing_approach: 'End with who benefits from the vacuum.'
  }
];

// ============================================================================
// COMBINED PATTERN POOLS (Core + SCOTUS-Specific)
// ============================================================================

export const ALL_SCOTUS_PATTERNS = [...CORE_STYLE_PATTERNS, ...SCOTUS_SPECIFIC_PATTERNS];

// Build pattern lookup by ID with collision check
const PATTERN_BY_ID = {};
for (const p of ALL_SCOTUS_PATTERNS) {
  if (!p?.id) {
    throw new Error(`Pattern missing 'id' field: ${JSON.stringify(p).substring(0, 100)}`);
  }
  if (PATTERN_BY_ID[p.id]) {
    throw new Error(`Duplicate pattern ID detected: "${p.id}" - check CORE_STYLE_PATTERNS and SCOTUS_SPECIFIC_PATTERNS`);
  }
  PATTERN_BY_ID[p.id] = p;
}

// Verify all required pattern IDs exist (fail-fast on typos)
const REQUIRED_PATTERN_IDS = [
  // Procedural pool
  'scotus-procedural-posture', 'scotus-cert-denied-impact', 'scotus-standing-dodge',
  // Alarmed pool
  'scotus-legitimacy-crisis', 'scotus-precedent-killed', 'scotus-power-blessed',
  // Critical pool
  'scotus-technical-trap', 'scotus-vote-fracture', 'scotus-dissent-prophecy',
  // Grudging credit pool
  'scotus-unanimous-surprise', 'scotus-rights-held', 'scotus-system-worked-once',
  // Issue override pools
  'scotus-vra-erosion', 'scotus-gerrymander-blessed', 'scotus-chevron-erosion', 'scotus-major-questions'
];

for (const id of REQUIRED_PATTERN_IDS) {
  if (!PATTERN_BY_ID[id]) {
    throw new Error(`Required pattern ID "${id}" not found in PATTERN_BY_ID - check SCOTUS_SPECIFIC_PATTERNS`);
  }
}

// ============================================================================
// ISSUE OVERRIDE FALLBACK DETECTOR
// ============================================================================

/**
 * Infer issue area override from case text (since issue_area is 100% NULL in DB)
 * Better recall than precision - these are override pools, not classification.
 *
 * @param {Object} scotusCase - Case record
 * @returns {'voting_rights' | 'agency_power' | null}
 */
export function inferIssueOverride(scotusCase) {
  const text = [
    scotusCase.case_name,
    scotusCase.syllabus,
    scotusCase.opinion_excerpt
  ].filter(Boolean).join(' ').toLowerCase();

  // Voting rights signals (expanded for recall)
  // Multi-word phrases don't need word boundaries, single words/acronyms do
  if (/voting rights act|vra\b|section 2|preclearance|gerrymandering|redistricting|voter id|ballot access|one person one vote|racial gerrymander|districting plan|vote dilution/.test(text)) {
    return 'voting_rights';
  }

  // Agency power / Chevron signals (expanded for recall)
  // Word boundaries on short acronyms to avoid false positives (sec->second, epa->separate)
  if (/chevron|agency deference|major questions|nondelegation|\bepa\b|\bosha\b|\bfda\b|\bsec\b|\bftc\b|\bnlrb\b|administrative procedure act|\bapa\b|arbitrary and capricious|rulemaking|deference/.test(text)) {
    return 'agency_power';
  }

  return null;
}

// ============================================================================
// FRAME ESTIMATION (metadata heuristic fallback)
// ============================================================================

/**
 * Estimate frame from case metadata (heuristic for when no clamp/issue override)
 * This is a hint - mismatch fuse allows GPT to correct.
 *
 * @param {Object} scotusCase - Case record
 * @returns {'alarmed' | 'critical' | 'grudging_credit'}
 */
export function estimateFrameFromMetadata(scotusCase) {
  const name = (scotusCase.case_name || '').toLowerCase();
  const syllabusOrExcerpt = (scotusCase.syllabus || scotusCase.opinion_excerpt || '').toLowerCase();
  const combined = `${name} ${syllabusOrExcerpt}`;

  // ALARMED: Crisis signals
  const alarmedSignals = [
    /overturn/,
    /overrule/,
    /precedent.*dead/,
    /constitutional crisis/,
    /insurrection/,
    /immunity.*absolute/,
    /executive power/
  ];
  for (const pattern of alarmedSignals) {
    if (pattern.test(combined)) return 'alarmed';
  }

  // GRUDGING_CREDIT: Positive signals (rare)
  const creditSignals = [
    /affirm.*plaintiff/,
    /unanimous.*for.*worker/,
    /protected.*rights/,
    /blocked.*government/,
    /victory for/,
    /rights.*upheld/
  ];
  for (const pattern of creditSignals) {
    if (pattern.test(combined)) return 'grudging_credit';
  }

  // DEFAULT: Critical (standard sardonic voice)
  return 'critical';
}

// ============================================================================
// FRAME SELECTION (priority order)
// ============================================================================

/**
 * Select frame and pool key using priority order:
 * 1. clamp_reason → procedural (authoritative, not a hint)
 * 2. inferIssueOverride → voting_rights_override or agency_power_override
 * 3. Pass 1 facts heuristic (merits_reached, disposition)
 * 4. estimateFrameFromMetadata → alarmed | critical | grudging_credit
 *
 * @param {Object} clampedFacts - Facts with clamp_reason from clampAndLabel()
 * @param {Object} scotusCase - Case record
 * @returns {{ frame: string, poolKey: string, frameSource: string }}
 */
export function selectFrame(clampedFacts, scotusCase) {
  // Priority 1: Clamp reason (authoritative)
  // Note: 'missing_text' cases are skipped in Pass 0 and never reach selectFrame()
  if (clampedFacts?.clamp_reason) {
    const clampReason = clampedFacts.clamp_reason;
    if (['cert_no_merits', 'procedural_no_merits'].includes(clampReason)) {
      return {
        frame: 'procedural',
        poolKey: 'procedural',
        frameSource: `clamp:${clampReason}`
      };
    }
  }

  // Priority 2: Issue override (replaces frame-based pool entirely)
  const issueOverride = inferIssueOverride(scotusCase);
  if (issueOverride === 'voting_rights') {
    return {
      frame: 'critical', // Default frame for issue pools
      poolKey: 'voting_rights_override',
      frameSource: 'issue:voting_rights'
    };
  }
  if (issueOverride === 'agency_power') {
    return {
      frame: 'critical',
      poolKey: 'agency_power_override',
      frameSource: 'issue:agency_power'
    };
  }

  // Priority 3: Pass 1 facts heuristic
  if (clampedFacts?.merits_reached === false) {
    return {
      frame: 'critical',
      poolKey: 'critical',
      frameSource: 'facts:no_merits'
    };
  }

  // Priority 4: Metadata heuristic
  const metadataFrame = estimateFrameFromMetadata(scotusCase);
  return {
    frame: metadataFrame,
    poolKey: metadataFrame,
    frameSource: `metadata:${metadataFrame}`
  };
}

// ============================================================================
// PATTERN SELECTION BY POOL
// ============================================================================

/**
 * Get SCOTUS-specific patterns for a given pool
 * @param {string} poolKey - Pool key
 * @returns {Object[]} Array of pattern objects
 */
function getScotusSpecificPatterns(poolKey) {
  const patterns = [];

  switch (poolKey) {
    case 'procedural':
      patterns.push(PATTERN_BY_ID['scotus-procedural-posture']);
      patterns.push(PATTERN_BY_ID['scotus-cert-denied-impact']);
      patterns.push(PATTERN_BY_ID['scotus-standing-dodge']);
      break;

    case 'alarmed':
      patterns.push(PATTERN_BY_ID['scotus-legitimacy-crisis']);
      patterns.push(PATTERN_BY_ID['scotus-precedent-killed']);
      patterns.push(PATTERN_BY_ID['scotus-power-blessed']);
      break;

    case 'critical':
      patterns.push(PATTERN_BY_ID['scotus-technical-trap']);
      patterns.push(PATTERN_BY_ID['scotus-vote-fracture']);
      patterns.push(PATTERN_BY_ID['scotus-dissent-prophecy']);
      break;

    case 'grudging_credit':
      patterns.push(PATTERN_BY_ID['scotus-unanimous-surprise']);
      patterns.push(PATTERN_BY_ID['scotus-rights-held']);
      patterns.push(PATTERN_BY_ID['scotus-system-worked-once']);
      break;

    case 'voting_rights_override':
      patterns.push(PATTERN_BY_ID['scotus-vra-erosion']);
      patterns.push(PATTERN_BY_ID['scotus-gerrymander-blessed']);
      // Also add critical patterns for variety
      patterns.push(PATTERN_BY_ID['scotus-technical-trap']);
      patterns.push(PATTERN_BY_ID['scotus-dissent-prophecy']);
      break;

    case 'agency_power_override':
      patterns.push(PATTERN_BY_ID['scotus-chevron-erosion']);
      patterns.push(PATTERN_BY_ID['scotus-major-questions']);
      // Also add critical patterns for variety
      patterns.push(PATTERN_BY_ID['scotus-technical-trap']);
      patterns.push(PATTERN_BY_ID['scotus-vote-fracture']);
      break;

    default:
      // Fallback to critical patterns
      patterns.push(PATTERN_BY_ID['scotus-technical-trap']);
      patterns.push(PATTERN_BY_ID['scotus-vote-fracture']);
  }

  return patterns.filter(Boolean);
}

/**
 * Get core patterns appropriate for a given frame
 * @param {string} poolKey - Pool key
 * @returns {Object[]} Array of core pattern objects
 */
function getCorePatterns(poolKey) {
  const patterns = [];

  // Procedural and grudging_credit get limited core patterns
  const limitedPools = ['procedural', 'grudging_credit'];

  for (const p of CORE_STYLE_PATTERNS) {
    if (limitedPools.includes(poolKey)) {
      // Only some core patterns work for these pools
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
 * Get all patterns for a pool (for fallback/collision walking)
 * @param {string} poolKey - Pool key
 * @returns {Object[]} Array of pattern objects
 */
function getAllPatternsForPool(poolKey) {
  const scotusPatterns = getScotusSpecificPatterns(poolKey);
  const corePatterns = getCorePatterns(poolKey);

  // Dedupe by ID
  const seen = new Set();
  const combined = [];
  for (const p of [...scotusPatterns, ...corePatterns]) {
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
 * Select a variation deterministically based on case ID
 *
 * Seed recipe: {caseId}:{promptVersion}:{poolKey}
 *
 * @param {string} poolKey - Pool key from selectFrame()
 * @param {string|number} caseId - Stable case identifier (database ID)
 * @param {string} promptVersion - Current prompt version
 * @param {string[]} recentIds - IDs of recently used patterns (for batch deduplication)
 * @returns {Object} Selected pattern with metadata
 */
export function selectVariation(poolKey, caseId, promptVersion, recentIds = []) {
  // Input validation
  if (!poolKey || typeof poolKey !== 'string') {
    throw new Error('selectVariation: poolKey must be a non-empty string');
  }
  if (caseId === undefined || caseId === null) {
    throw new Error('selectVariation: caseId must be provided');
  }
  if (!promptVersion) {
    throw new Error('selectVariation: promptVersion must be provided');
  }

  // Build deterministic seed
  const seed = `${caseId}:${promptVersion}:${poolKey}`;

  // Use separate derived hashes for bias and index to avoid correlation
  const hashBias = fnv1a32(`${seed}:bias`);
  const hashIdx = fnv1a32(`${seed}:idx`);

  // Determine which sub-pool to select from (biased toward SCOTUS-specific)
  const biasRoll = hashBias % 100;
  const useScotusSpecific = biasRoll < SCOTUS_SPECIFIC_BIAS_THRESHOLD;

  // Get the appropriate pattern pools
  const scotusPatterns = getScotusSpecificPatterns(poolKey);
  const corePatterns = getCorePatterns(poolKey);

  let primaryPool = useScotusSpecific ? scotusPatterns : corePatterns;
  let fallbackPool = useScotusSpecific ? corePatterns : scotusPatterns;

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
      opening_approach: 'Lead with the key change this ruling represents.',
      rhetorical_device: 'Be direct and factual.',
      structure: 'What the Court did -> who is affected -> implication.',
      closing_approach: 'End with the practical effect going forward.',
      _meta: { poolKey, fallback: true }
    };
  }

  // Initial index from hash
  let idx = hashIdx % primaryPool.length;

  // Collision step: walk through pool to find unused pattern
  const recentSet = new Set(recentIds);
  for (let step = 0; step < primaryPool.length; step++) {
    const candidate = primaryPool[idx];
    if (!recentSet.has(candidate.id)) {
      return {
        ...candidate,
        _meta: { poolKey, seed, hashBias, hashIdx, idx, subpool: useScotusSpecific ? 'scotus' : 'core' }
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
          _meta: { poolKey, seed, hashBias, hashIdx, idx, subpool: useScotusSpecific ? 'core' : 'scotus', spillover: true }
        };
      }
      idx = (idx + 1) % fallbackPool.length;
    }
  }

  // If all patterns used recently, return the hash-selected one anyway
  const allPatterns = getAllPatternsForPool(poolKey);
  const fallbackPattern = allPatterns[hashIdx % allPatterns.length];
  return { ...fallbackPattern, _meta: { poolKey, seed, hashBias, hashIdx, collision: true } };
}

// ============================================================================
// VARIATION INJECTION BUILDER
// ============================================================================

/**
 * Build the REQUIRED VARIATION injection text for the prompt
 *
 * @param {Object} variation - Pattern from selectVariation()
 * @param {string} frame - Frame from selectFrame()
 * @param {string|null} clampReason - If set, mismatch fuse is disabled
 * @returns {string} Text to inject into prompt
 */
export function buildVariationInjection(variation, frame, clampReason = null) {
  // Stance-only guidance (intensity controlled by ruling_impact_level in main prompt)
  const frameGuidance = {
    procedural: 'FRAME: PROCEDURAL - This is a procedural ruling, NOT a merits decision. Describe process, not victory/defeat.',
    alarmed: 'FRAME: ALARMED - Treat this as a crisis. An attack on democracy, rights, or precedent.',
    critical: 'FRAME: CRITICAL - Standard sardonic voice. Typical Court dysfunction or corporate favoritism.',
    grudging_credit: 'FRAME: GRUDGING CREDIT - Credit where due, with skepticism. The system worked this time.'
  };

  let injection = `REQUIRED VARIATION (do not ignore)

${frameGuidance[frame] || frameGuidance.critical}

STYLE PATTERN: ${variation.id}
- Opening approach: ${variation.opening_approach}
- Rhetorical device: ${variation.rhetorical_device}
- Structure: ${variation.structure}
- Closing approach: ${variation.closing_approach}

MUST follow this pattern's APPROACH and SPIRIT.
DO NOT copy any literal example lines or template phrases.
DO NOT reuse opener structures recently used in this batch.
MUST create a fresh opener unique to this case.`;

  // Mismatch fuse - disabled for clamped cases
  if (clampReason) {
    injection += `

MISMATCH FUSE: DISABLED for clamped cases.
This is a ${clampReason.replace(/_/g, ' ')} case. The procedural frame is authoritative.
Do NOT adjust stance based on ruling_impact_level - keep procedural framing.`;
  } else {
    injection += `

MISMATCH FUSE: If your determined ruling_impact_level conflicts with this frame
(e.g., you determine level 0-1 but received "alarmed" frame), keep the
style pattern structure but adjust stance to match your actual ruling_impact_level.`;
  }

  return injection;
}

// ============================================================================
// SECTION BANNED OPENERS (regex-based for SCOTUS)
// ============================================================================

export const SCOTUS_SECTION_BANS = {
  summary_spicy: [
    // Literal template patterns from old variation pools
    /^.{0,5}years? of precedent\.? gone/i,
    /^the game was rigged/i,
    /^this ruling sounds boring/i,
    /^history will remember this as/i,
    /^this is how the system is designed/i,
    /^leonard leo.?s wishlist/i,
    /^they.?re not even pretending/i,
    /^the constitution means whatever/i,
    /^another ruling from the billionaire/i,
    /^good news for cops who shoot/i,
    /^your fourth amendment rights just/i,
    /^the court just gave/i,
    // Generic banned starters
    /^beneath the surface/i,
    /^what they don.?t (say|tell)/i,
    /^the real story is/i,
    /^here.?s what.?s really going on/i,
    /^the truth is/i,
    /^let.?s be clear/i,
    /^here.?s the reality/i,
    /^the stakes couldn.?t be higher/i,
    /^this sets the stage/i
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
 * Strip leading punctuation, quotes, dashes for consistent comparison
 * @param {string} s - Input string
 * @returns {string} Stripped string
 */
function stripLeadingJunk(s) {
  return String(s || '').trim().replace(/^[\s"'""''—–\-:>]+/, '');
}

/**
 * Normalize text for duplicate detection
 * Lowercase, strip punctuation, replace numbers with X
 * @param {string} s - Input string
 * @returns {string} Normalized string
 */
export function normalizeForDuplicateCheck(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\d+/g, 'X')
    .trim();
}

/**
 * Extract signature sentence (first 2-3 sentences) for duplicate detection
 * @param {string} text - Full text
 * @returns {string} Signature portion
 */
export function extractSignatureSentence(text) {
  const stripped = stripLeadingJunk(text);
  // Get first 2 sentences (rough split on . ! ?)
  const sentences = stripped.split(/(?<=[.!?])\s+/).slice(0, 2);
  return normalizeForDuplicateCheck(sentences.join(' '));
}

/**
 * Check if text starts with a banned pattern (regex-based)
 * @param {string} text - Text to check
 * @param {RegExp[]} bannedPatterns - Regex patterns to check
 * @returns {RegExp|null} The matching pattern, or null
 */
export function findBannedStarter(text, bannedPatterns) {
  const stripped = stripLeadingJunk(text);

  for (const pattern of bannedPatterns) {
    if (pattern.test(stripped)) {
      return pattern;
    }
  }
  return null;
}

/**
 * Attempt to repair a banned starter by removing matched portion and prepending template
 * @param {string} sectionName - Section name (for deterministic template selection)
 * @param {string} content - Original content
 * @param {RegExp} matchedPattern - The pattern that matched
 * @returns {{ success: boolean, content: string|null, reason: string|null }}
 */
export function repairBannedStarter(sectionName, content, matchedPattern) {
  // Validate matchedPattern is a RegExp
  if (!(matchedPattern instanceof RegExp)) {
    return { success: false, content: null, reason: 'INVALID_PATTERN' };
  }

  const stripped = stripLeadingJunk(content);
  const match = stripped.match(matchedPattern);

  if (!match) {
    return { success: false, content: null, reason: 'PATTERN_NOT_FOUND' };
  }

  const matchedText = match[0];
  const matchEnd = stripped.indexOf(matchedText) + matchedText.length;
  let remainder = stripped.slice(matchEnd).replace(/^[,\s]+/, '').trim();

  if (remainder.length < 20) {
    return { success: false, content: null, reason: 'REMAINDER_TOO_SHORT' };
  }

  // Select template deterministically based on section
  const templateIdx = fnv1a32(sectionName) % REPAIR_TEMPLATES.length;
  const template = REPAIR_TEMPLATES[templateIdx];

  // Rebuild
  const repaired = `${template} ${remainder}`;

  // Verify repair doesn't also match a banned pattern
  const bannedList = SCOTUS_SECTION_BANS[sectionName] || [];
  const stillBanned = findBannedStarter(repaired, bannedList);
  if (stillBanned) {
    return { success: false, content: null, reason: 'STILL_BANNED' };
  }

  return { success: true, content: repaired, reason: null };
}

// ============================================================================
// POST-GEN VALIDATION
// ============================================================================

/**
 * Validate summary_spicy for banned starters and duplicates
 * @param {string} summarySpicy - The generated summary
 * @param {string[]} recentSignatures - Normalized signatures from recent batch items
 * @returns {{ valid: boolean, reason: string|null, matchedPattern: RegExp|null, isDuplicate: boolean }}
 */
export function validateSummarySpicy(summarySpicy, recentSignatures = []) {
  // Check for banned starters
  const bannedPatterns = SCOTUS_SECTION_BANS.summary_spicy || [];
  const matchedBan = findBannedStarter(summarySpicy, bannedPatterns);

  if (matchedBan) {
    return {
      valid: false,
      reason: `Banned starter: ${matchedBan.source || matchedBan.toString()}`,
      matchedPattern: matchedBan,
      isDuplicate: false
    };
  }

  // Check for duplicate signature sentence
  const signature = extractSignatureSentence(summarySpicy);
  if (recentSignatures.includes(signature)) {
    return {
      valid: false,
      reason: 'Duplicate signature sentence',
      matchedPattern: null,
      isDuplicate: true
    };
  }

  return { valid: true, reason: null, matchedPattern: null, isDuplicate: false };
}

// ============================================================================
// CONTENT ID GENERATION
// ============================================================================

/**
 * Get stable content ID for a SCOTUS case (for deterministic selection)
 *
 * Priority:
 * 1. Database ID (most stable)
 * 2. Docket number + term (fallback)
 * 3. Hash of case name (last resort)
 *
 * @param {Object} scotusCase - Case object
 * @returns {string} Stable content identifier
 */
export function getScotusContentId(scotusCase) {
  // Prefer database ID
  if (scotusCase?.id != null) return `scotus:${scotusCase.id}`;

  // Fallback: docket + term
  if (scotusCase?.docket_number && scotusCase?.term) {
    return `scotus:docket:${scotusCase.docket_number}:${scotusCase.term}`;
  }

  // Last resort: hash of case name
  console.warn('Using unstable case name hash for SCOTUS content_id');
  return `scotus:name:${fnv1a32(String(scotusCase?.case_name || 'unknown'))}`;
}
