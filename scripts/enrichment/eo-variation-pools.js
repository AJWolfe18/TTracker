/**
 * Variation Pools for Executive Order GPT Enrichment (ADO-271)
 *
 * Provides stratified opening patterns, rhetorical devices, and structures
 * to prevent repetitive outputs across EO analyses.
 *
 * Voice: "The Power Grab" - The King's pen is moving. Here's who gets hurt and who gets rich.
 *
 * Pool selection based on category and eo_impact_type:
 * - miller: authoritarian_overreach, fascist_power_grab, immigration_border
 * - donor: corrupt_grift, economy_jobs_taxes, environment_energy
 * - default: all others (health_care, gov_ops_workforce, justice_civil_rights_voting, etc.)
 *
 * Usage:
 *   import { selectVariation, buildVariationInjection, getPoolKey } from './eo-variation-pools.js';
 *   const poolKey = getPoolKey(category, eo_impact_type);
 *   const variation = selectVariation(poolKey, alarm_level, recentlyUsedIds);
 *   const injection = buildVariationInjection(variation, recentOpeningTexts);
 */

// ============================================================================
// POOL KEY SELECTION (category + impact_type → pool)
// ============================================================================

/**
 * Map EO category and impact type to appropriate pool key
 * @param {string} category - EO category from enrichment
 * @param {string|null} eo_impact_type - EO impact type (may be null)
 * @returns {string} Pool key: 'miller' | 'donor' | 'default'
 */
export function getPoolKey(category, eo_impact_type = null) {
  const impact = eo_impact_type || null;

  // Miller pool: authoritarian/nationalist framing
  if (impact === 'authoritarian_overreach' ||
      impact === 'fascist_power_grab' ||
      category === 'immigration_border') {
    return 'miller';
  }

  // Donor pool: corporate/grift framing
  if (impact === 'corrupt_grift' ||
      category === 'economy_jobs_taxes' ||
      category === 'environment_energy') {
    return 'donor';
  }

  // Default pool: all others (including unknown future categories)
  return 'default';
}

// ============================================================================
// OPENING PATTERNS BY POOL AND LEVEL
// ============================================================================

export const OPENING_PATTERNS = {
  // -------------------------------------------------------------------------
  // MILLER POOL: Authoritarian/nationalist orders (immigration, power grabs)
  // -------------------------------------------------------------------------
  miller: {
    5: [
      { id: 'miller-5-blueprint', instruction: "Authoritarian blueprint: 'This is what fascism looks like with American paperwork.'" },
      { id: 'miller-5-cruelty', instruction: "Cruelty framing: 'The quiet cruelty is the point. Here's who gets hurt.'" },
      { id: 'miller-5-playbook', instruction: "Playbook: 'Another page from the authoritarian playbook. Now with an executive order number.'" },
      { id: 'miller-5-power', instruction: "Power grab: 'The King's pen moves. Your rights shrink.'" },
      { id: 'miller-5-history', instruction: "History rhyming: 'History students: take notes. You've seen this before.'" }
    ],
    4: [
      { id: 'miller-4-targeting', instruction: "Targeting: 'Ask yourself who this targets. That's not a bug. That's the feature.'" },
      { id: 'miller-4-overreach', instruction: "Overreach: 'Executive overreach dressed up as national security.'" },
      { id: 'miller-4-precedent', instruction: "Precedent: 'Future presidents are watching. And taking notes.'" },
      { id: 'miller-4-boot', instruction: "Boot on neck: 'The boot gets heavier. The paperwork makes it legal.'" }
    ],
    3: [
      { id: 'miller-3-normalization', instruction: "Normalization: 'This would have been unthinkable five years ago. Now it's policy.'" },
      { id: 'miller-3-erosion', instruction: "Erosion: 'Not a knockout blow. Just another cut. The bleeding continues.'" },
      { id: 'miller-3-machinery', instruction: "Machinery: 'The machinery of cruelty grinds on. Here's the latest gear.'" }
    ],
    2: [
      { id: 'miller-2-theater', instruction: "Theater: 'More nationalist theater. Loud on rhetoric, light on substance.'" },
      { id: 'miller-2-posturing', instruction: "Posturing: 'Executive posturing for the base. Policy impact: minimal. Signal value: maximum.'" }
    ],
    1: [
      { id: 'miller-1-guardrails', instruction: "Guardrails: 'Courts or Congress pushed back. This time.'" },
      { id: 'miller-1-limited', instruction: "Limited: 'Less terrible than expected. That's the bar now.'" }
    ],
    0: [
      { id: 'miller-0-reversed', instruction: "Reversed: 'Against all odds, a humane outcome. Don't get used to it.'" },
      { id: 'miller-0-sanity', instruction: "Sanity: 'The system actually worked here. Mark your calendar.'" }
    ]
  },

  // -------------------------------------------------------------------------
  // DONOR POOL: Corporate/grift orders (economy, environment, deregulation)
  // -------------------------------------------------------------------------
  donor: {
    5: [
      { id: 'donor-5-purchased', instruction: "Purchased: 'This order was bought and paid for. Here's the receipt.'" },
      { id: 'donor-5-roi', instruction: "ROI framing: 'Best investment they ever made. Campaign donations in, policy out.'" },
      { id: 'donor-5-auction', instruction: "Auction: 'The executive branch went to the highest bidder.'" },
      { id: 'donor-5-transfer', instruction: "Wealth transfer: 'From YOUR pocket to THEIR shareholders.'" },
      { id: 'donor-5-quid', instruction: "Quid pro quo: 'Donation. Lobbying. Executive order. The timeline speaks for itself.'" }
    ],
    4: [
      { id: 'donor-4-giveaway', instruction: "Giveaway: 'Another executive giveaway to corporations. You're paying for it.'" },
      { id: 'donor-4-deregulation', instruction: "Deregulation: 'Regulations existed because people died. Now they don't.'" },
      { id: 'donor-4-revolving', instruction: "Revolving door: 'Written by the industry it's supposed to regulate.'" },
      { id: 'donor-4-whose', instruction: "Whose interests: 'Ask who benefits. Check the donor list. Notice anything?'" }
    ],
    3: [
      { id: 'donor-3-routine', instruction: "Routine corruption: 'Standard operating procedure. Corporations ask, administration delivers.'" },
      { id: 'donor-3-swamp', instruction: "Swamp: 'The swamp is thriving. Here's today's feeding.'" },
      { id: 'donor-3-pattern', instruction: "Pattern: 'Add it to the list of orders that mysteriously benefit major donors.'" }
    ],
    2: [
      { id: 'donor-2-theater', instruction: "Corporate theater: 'Sounds business-friendly. Actual impact: unclear.'" },
      { id: 'donor-2-optics', instruction: "Optics: 'The appearance of corruption is almost worse. Almost.'" }
    ],
    1: [
      { id: 'donor-1-exception', instruction: "Exception: 'Against expectations, corporate interests didn't win this one.'" },
      { id: 'donor-1-oversight', instruction: "Oversight: 'Someone did their job. The system worked. Barely.'" }
    ],
    0: [
      { id: 'donor-0-accountability', instruction: "Accountability: 'Corporate interests lost. The sun is still rising in the east.'" },
      { id: 'donor-0-people', instruction: "People first: 'Policy that actually helps people? Check for asterisks, but yes.'" }
    ]
  },

  // -------------------------------------------------------------------------
  // DEFAULT POOL: General policy orders (healthcare, workforce, infrastructure)
  // -------------------------------------------------------------------------
  default: {
    5: [
      { id: 'def-5-crisis', instruction: "Crisis: 'The King's pen moves. Here's who gets hurt.'" },
      { id: 'def-5-damage', instruction: "Damage: 'Executive action with real-world consequences. Let's count the cost.'" },
      { id: 'def-5-power', instruction: "Power grab: 'Another brick in the authoritarian wall.'" },
      { id: 'def-5-precedent', instruction: "Precedent: 'This order sets a precedent that should terrify you.'" }
    ],
    4: [
      { id: 'def-4-harm', instruction: "Real harm: 'Policy isn't abstract. Here's who gets hurt.'" },
      { id: 'def-4-predictable', instruction: "Predictable: 'Anyone paying attention saw this coming. Here's the damage.'" },
      { id: 'def-4-priorities', instruction: "Priorities: 'What does this order prioritize? Follow the beneficiaries.'" }
    ],
    3: [
      { id: 'def-3-absurdity', instruction: "Absurdity: 'Let the executive absurdity speak for itself.'" },
      { id: 'def-3-weary', instruction: "Weary: 'Another order, another layer of dysfunction.'" },
      { id: 'def-3-pattern', instruction: "Pattern: 'If this seems familiar, that's because it is.'" }
    ],
    2: [
      { id: 'def-2-shrug', instruction: "Shrug: 'Not great, not catastrophic. Just... policy.'" },
      { id: 'def-2-bureaucracy', instruction: "Bureaucracy: 'Executive busywork. Impact unclear, intent performative.'" }
    ],
    1: [
      { id: 'def-1-broken-clock', instruction: "Broken clock: 'Even this administration is right twice a day.'" },
      { id: 'def-1-low-bar', instruction: "Low bar: 'The bar was underground. They managed to find it.'" }
    ],
    0: [
      { id: 'def-0-helpful', instruction: "Actually helpful: 'We checked twice. This is actually... good policy?'" },
      { id: 'def-0-system', instruction: "System worked: 'The executive branch serving the people. Mark your calendar.'" }
    ]
  }
};

// ============================================================================
// RHETORICAL DEVICES
// ============================================================================

export const RHETORICAL_DEVICES = [
  { id: 'juxtaposition', instruction: "Use juxtaposition: 'They said X. The order does Y. See the gap?'" },
  { id: 'rhetorical-q', instruction: "Open with rhetorical question that exposes the power grab." },
  { id: 'understatement', instruction: "Use understatement: Let the facts do the heavy lifting." },
  { id: 'direct', instruction: "Be direct: State the executive action plainly. No softening." },
  { id: 'flat-sequence', instruction: "Flat sequence: Campaign promise → Donor meeting → Executive order." },
  { id: 'dark-humor', instruction: "Dark humor: Let the absurdity speak for itself." },
  { id: 'personal', instruction: "Make it personal: 'YOUR taxes,' 'YOUR healthcare,' 'YOUR rights.'" },
  { id: 'follow-money', instruction: "Follow the money: Who donated? Who lobbied? Who benefits?" }
];

// ============================================================================
// SENTENCE STRUCTURES
// ============================================================================

export const SENTENCE_STRUCTURES = [
  { id: 'punchy', instruction: "Punchy one-liner opening, then expand with impact." },
  { id: 'setup-payoff', instruction: "Setup the official spin, then hit with reality." },
  { id: 'who-wins-loses', instruction: "Lead with who wins and who loses. Then explain." },
  { id: 'question-answer', instruction: "Pose the question everyone's asking, then answer it." },
  { id: 'contrast-pivot', instruction: "Start with what they claim, pivot to what's actually happening." },
  { id: 'timeline', instruction: "Walk through chronologically: Campaign → Donor → Policy → Outcome." }
];

// ============================================================================
// CLOSING APPROACHES
// ============================================================================

export const CLOSING_APPROACHES = [
  { id: 'pattern-note', instruction: "Note the pattern: 'Add it to the executive order pile.'" },
  { id: 'what-next', instruction: "What to watch for: 'Keep an eye on [specific consequence].'" },
  { id: 'who-pays', instruction: "Who pays: 'And guess who foots the bill?'" },
  { id: 'call-to-action', instruction: "Action: One concrete thing readers can do." },
  { id: 'question', instruction: "End with pointed question about power and accountability." },
  { id: 'systemic', instruction: "Systemic note: 'This is how executive power gets abused. For them, not you.'" }
];

// ============================================================================
// SELECTION LOGIC
// ============================================================================

/**
 * Select random variation elements for this enrichment call
 * @param {string} poolKey - Pool key from getPoolKey()
 * @param {number} alarmLevel - Alarm level 0-5
 * @param {string[]} recentOpeningIds - IDs of patterns used recently (to avoid repetition)
 * @returns {Object} Selected variation elements
 */
export function selectVariation(poolKey, alarmLevel, recentOpeningIds = []) {
  // Get the pool, fall back to default
  const pool = OPENING_PATTERNS[poolKey] || OPENING_PATTERNS.default;

  // Normalize alarm level to valid range
  const level = Math.max(0, Math.min(5, Math.trunc(alarmLevel) || 3));

  // Get openings for this level
  const levelOpenings = pool[level] || pool[3] || [];

  // Filter out recently used, but keep at least 2 options
  const availableOpenings = levelOpenings.filter(p => !recentOpeningIds.includes(p.id));
  const openingPool = availableOpenings.length >= 2 ? availableOpenings : levelOpenings;

  return {
    opening: randomFrom(openingPool),
    device: randomFrom(RHETORICAL_DEVICES),
    structure: randomFrom(SENTENCE_STRUCTURES),
    closing: randomFrom(CLOSING_APPROACHES)
  };
}

function randomFrom(arr) {
  if (!arr || arr.length === 0) return { id: 'fallback', instruction: 'Be direct and factual.' };
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Build the variation injection text for the prompt
 * @param {Object} variation - Output from selectVariation()
 * @param {string[]} recentOpenings - First ~50 chars of recent outputs
 * @returns {string} Text to inject into prompt
 */
export function buildVariationInjection(variation, recentOpenings = []) {
  let injection = `CREATIVE DIRECTION FOR THIS ORDER:
- Opening approach: ${variation.opening?.instruction || 'Be direct.'}
- Rhetorical device: ${variation.device?.instruction || 'State facts plainly.'}
- Structure: ${variation.structure?.instruction || 'Lead with impact.'}
- Closing approach: ${variation.closing?.instruction || 'End with what to watch.'}

These are suggestions to inspire variety — follow the spirit, not robotically.`;

  if (recentOpenings.length > 0) {
    injection += `

ANTI-REPETITION: These openings were used recently. DO NOT start similarly:
${recentOpenings.map(o => `- "${o}"`).join('\n')}`;
  }

  return injection;
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
  if (alarmLevel === 5) return 'critical';
  if (alarmLevel === 4) return 'high';
  if (alarmLevel === 3) return 'medium';
  if (alarmLevel === 2) return 'low';
  return null; // 0-1 can't be represented in legacy enum
}

/**
 * Convert legacy severity_rating text to alarm level
 * @param {string} severity - Legacy text severity
 * @returns {number|null} Alarm level or null if unknown
 */
export function legacySeverityToAlarmLevel(severity) {
  const map = { critical: 5, high: 4, medium: 3, low: 2 };
  return map[severity?.toLowerCase()] ?? null;
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
