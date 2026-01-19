/**
 * Variation Pools for Stories GPT Enrichment (ADO-270)
 *
 * Provides stratified opening patterns, rhetorical devices, and structures
 * to prevent repetitive outputs across story summaries.
 *
 * Voice: "The Chaos" - Look at this specific dumpster fire inside the larger dumpster fire.
 *
 * Pool selection based on category (discriminator):
 * - donor: corruption_scandals, corporate_financial
 * - state_power: justice_legal, executive_actions, civil_liberties
 * - democracy: democracy_elections, media_disinformation
 * - default: policy_legislation, foreign_policy, epstein_associates, other
 *
 * Usage:
 *   import { selectVariation, buildVariationInjection, getPoolKey } from './stories-variation-pools.js';
 *   const poolKey = getPoolKey(category);
 *   const variation = selectVariation(poolKey, alarm_level, recentlyUsedIds);
 *   const injection = buildVariationInjection(variation, recentOpeningTexts);
 */

// ============================================================================
// POOL KEY SELECTION (category → pool)
// ============================================================================

/**
 * Map story category to appropriate pool key
 * @param {string} category - Story category from enrichment
 * @returns {string} Pool key: 'donor' | 'state_power' | 'democracy' | 'default'
 */
export function getPoolKey(category) {
  const POOL_MAP = {
    // Donor/corruption framing - follow the money
    corruption_scandals: 'donor',
    corporate_financial: 'donor',

    // State power / authoritarian framing - the boot on the neck
    justice_legal: 'state_power',
    executive_actions: 'state_power',
    civil_liberties: 'state_power',

    // Democracy under attack framing - the system is rigged
    democracy_elections: 'democracy',
    media_disinformation: 'democracy',

    // Default chaos framing - general dumpster fire
    policy_legislation: 'default',
    foreign_policy: 'default',
    epstein_associates: 'default',
    other: 'default'
  };

  return POOL_MAP[category] || 'default';
}

// ============================================================================
// OPENING PATTERNS BY POOL AND LEVEL
// ============================================================================

export const OPENING_PATTERNS = {
  // -------------------------------------------------------------------------
  // DONOR POOL: Corruption, corporate, follow-the-money stories
  // -------------------------------------------------------------------------
  donor: {
    5: [
      { id: 'donor-5-bought', instruction: "Lead with the price tag: 'X million to the campaign. Now they're writing the policy. Connect the dots.'" },
      { id: 'donor-5-roi', instruction: "ROI framing: 'Best investment they ever made. Donated X, got Y in contracts/tax breaks/deregulation.'" },
      { id: 'donor-5-receipt', instruction: "Receipt framing: 'This isn't policy. This is a transaction. Here's the receipt.'" },
      { id: 'donor-5-auction', instruction: "Auction framing: 'Democracy went to the highest bidder. Here's what they bought.'" },
      { id: 'donor-5-quid', instruction: "Quid pro quo: 'Donation. Lobbying. Policy change. The timeline speaks for itself.'" }
    ],
    4: [
      { id: 'donor-4-cronies', instruction: "Crony capitalism: 'Another day, another policy written by the people who paid for it.'" },
      { id: 'donor-4-revolving', instruction: "Revolving door: 'From lobbying firm to policy position and back. The swamp is a loop.'" },
      { id: 'donor-4-whose', instruction: "Whose interests: 'Ask yourself who benefits. Then check the donor list. Notice anything?'" },
      { id: 'donor-4-grift', instruction: "Grift framing: 'The grift continues. Here's today's installment.'" }
    ],
    3: [
      { id: 'donor-3-routine', instruction: "Routine corruption: 'Standard operating procedure. Money talks, policy follows.'" },
      { id: 'donor-3-pattern', instruction: "Pattern: 'Add it to the list of policies that mysteriously benefit major donors.'" },
      { id: 'donor-3-swamp', instruction: "Swamp: 'The swamp is thriving. Here's the latest evidence.'" }
    ],
    2: [
      { id: 'donor-2-optics', instruction: "Bad optics: 'The appearance of corruption is almost worse than the real thing. Almost.'" },
      { id: 'donor-2-questions', instruction: "Questions raised: 'Maybe it's innocent. But the timing raises questions.'" }
    ],
    1: [
      { id: 'donor-1-exception', instruction: "Rare exception: 'Against expectations, corporate interests didn't win this one.'" },
      { id: 'donor-1-oversight', instruction: "Oversight worked: 'Someone did their job. Mark your calendar.'" }
    ],
    0: [
      { id: 'donor-0-accountability', instruction: "Accountability: 'The system actually worked. Don't get used to it.'" },
      { id: 'donor-0-transparency', instruction: "Transparency win: 'Sunlight is the best disinfectant. Today it worked.'" }
    ]
  },

  // -------------------------------------------------------------------------
  // STATE POWER POOL: Justice, executive actions, civil liberties
  // -------------------------------------------------------------------------
  state_power: {
    5: [
      { id: 'state-5-fascism', instruction: "Name it: 'This is what creeping authoritarianism looks like. Name it.'" },
      { id: 'state-5-rights', instruction: "Rights stripped: 'Another right you used to have. Used to.'" },
      { id: 'state-5-weaponized', instruction: "Weaponized: 'The government just weaponized [agency/power] against [group]. This is not normal.'" },
      { id: 'state-5-constitution', instruction: "Constitutional crisis: 'The Constitution is clear. They don't care.'" },
      { id: 'state-5-precedent', instruction: "Dangerous precedent: 'Future administrations are watching. And taking notes.'" }
    ],
    4: [
      { id: 'state-4-overreach', instruction: "Overreach: 'Government power expanded. Your rights didn't.'" },
      { id: 'state-4-selective', instruction: "Selective enforcement: 'Laws for thee, not for me. The two-tier system in action.'" },
      { id: 'state-4-abuse', instruction: "Abuse of power: 'This is what happens when checks and balances fail.'" },
      { id: 'state-4-quiet', instruction: "Quiet cruelty: 'No headlines, just bureaucratic brutality.'" }
    ],
    3: [
      { id: 'state-3-erosion', instruction: "Erosion: 'Not a knockout blow. Just another cut. The bleeding continues.'" },
      { id: 'state-3-normal', instruction: "Normalization: 'This would have been a scandal five years ago. Now it's Tuesday.'" },
      { id: 'state-3-termites', instruction: "Termites: 'The foundation is being eaten away. You won't notice until it collapses.'" }
    ],
    2: [
      { id: 'state-2-bureaucracy', instruction: "Bureaucratic drift: 'The machine grinds on. Slowly, in the wrong direction.'" },
      { id: 'state-2-inertia', instruction: "Inertia: 'Not malice, just incompetence. Cold comfort.'" }
    ],
    1: [
      { id: 'state-1-guardrails', instruction: "Guardrails held: 'The system pushed back. This time.'" },
      { id: 'state-1-courts', instruction: "Courts intervened: 'A judge remembered what the Constitution says.'" }
    ],
    0: [
      { id: 'state-0-accountability', instruction: "Accountability worked: 'Someone in power faced consequences. Mark the date.'" },
      { id: 'state-0-rights-protected', instruction: "Rights protected: 'Your rights survived another day. Don't take it for granted.'" }
    ]
  },

  // -------------------------------------------------------------------------
  // DEMOCRACY POOL: Elections, voting, media, disinformation
  // -------------------------------------------------------------------------
  democracy: {
    5: [
      { id: 'dem-5-rigged', instruction: "Rigging in progress: 'They're not hiding it anymore. This is how you steal elections legally.'" },
      { id: 'dem-5-voter-suppression', instruction: "Suppression: 'Ask yourself who can't vote now. That's the point.'" },
      { id: 'dem-5-disinformation', instruction: "Disinformation: 'The lie travels faster than the truth. By design.'" },
      { id: 'dem-5-institutions', instruction: "Institutions failing: 'The guardrails are gone. We're in freefall.'" }
    ],
    4: [
      { id: 'dem-4-attack', instruction: "Under attack: 'Democracy doesn't die in darkness. It dies in broad daylight while we watch.'" },
      { id: 'dem-4-propaganda', instruction: "Propaganda: 'This isn't news. It's messaging. Know the difference.'" },
      { id: 'dem-4-access', instruction: "Access restricted: 'Voting just got harder for exactly the people they wanted to stop.'" }
    ],
    3: [
      { id: 'dem-3-both-sides', instruction: "False equivalence: 'The 'both sides' framing is doing heavy lifting for one side.'" },
      { id: 'dem-3-noise', instruction: "Noise: 'The outrage machine is working overtime. Here's what they don't want you focusing on.'" },
      { id: 'dem-3-narrative', instruction: "Narrative control: 'The story isn't what happened. It's how they want you to remember it.'" }
    ],
    2: [
      { id: 'dem-2-spin', instruction: "Spin cycle: 'The PR machine is running. Here's what's actually true.'" },
      { id: 'dem-2-distraction', instruction: "Distraction: 'Look over here while the real damage happens over there.'" }
    ],
    1: [
      { id: 'dem-1-truth-won', instruction: "Truth won: 'The lie got caught. Eventually.'" },
      { id: 'dem-1-transparency', instruction: "Sunlight: 'Someone told the truth. It matters.'" }
    ],
    0: [
      { id: 'dem-0-democracy-worked', instruction: "Democracy worked: 'The system functioned as designed. Savor it.'" },
      { id: 'dem-0-accountability', instruction: "Accountability: 'The truth came out. People listened. Change happened.'" }
    ]
  },

  // -------------------------------------------------------------------------
  // DEFAULT POOL: Policy, foreign policy, general chaos
  // -------------------------------------------------------------------------
  default: {
    5: [
      { id: 'def-5-dumpster', instruction: "Dumpster fire: 'Look at this specific dumpster fire inside the larger dumpster fire.'" },
      { id: 'def-5-crisis', instruction: "Crisis: 'This is a crisis. Treat it like one.'" },
      { id: 'def-5-incompetence', instruction: "Malice or incompetence: 'Does it matter? The damage is the same.'" },
      { id: 'def-5-consequences', instruction: "Consequences: 'Elections have consequences. Here they are.'" }
    ],
    4: [
      { id: 'def-4-predictable', instruction: "Predictable: 'Anyone paying attention saw this coming. Here's the damage.'" },
      { id: 'def-4-chaos', instruction: "Chaos: 'The quiet part out loud. Again.'" },
      { id: 'def-4-harm', instruction: "Real harm: 'Policy isn't abstract. Here's who gets hurt.'" }
    ],
    3: [
      { id: 'def-3-absurdity', instruction: "Absurdity: 'Let the absurdity speak for itself.'" },
      { id: 'def-3-weary', instruction: "Weary: 'Another day, another disaster. Here's the latest.'" },
      { id: 'def-3-pattern', instruction: "Pattern recognition: 'If this seems familiar, that's because it is.'" }
    ],
    2: [
      { id: 'def-2-shrug', instruction: "Shrug: 'Not great, not catastrophic. Just... bad.'" },
      { id: 'def-2-dysfunction', instruction: "Dysfunction: 'The system is working exactly as poorly as designed.'" }
    ],
    1: [
      { id: 'def-1-broken-clock', instruction: "Broken clock: 'Even a broken clock is right twice a day.'" },
      { id: 'def-1-low-bar', instruction: "Low bar: 'The bar was on the ground. They managed to clear it.'" }
    ],
    0: [
      { id: 'def-0-actual-good', instruction: "Actually good: 'We checked twice. This is actually... good news?'" },
      { id: 'def-0-system-worked', instruction: "System worked: 'Don't get used to it, but the system actually worked here.'" }
    ]
  }
};

// ============================================================================
// RHETORICAL DEVICES
// ============================================================================

export const RHETORICAL_DEVICES = [
  { id: 'juxtaposition', instruction: "Use juxtaposition: 'They said X. They did Y. See the gap?'" },
  { id: 'rhetorical-q', instruction: "Open with rhetorical question that exposes the absurdity." },
  { id: 'understatement', instruction: "Use understatement: Let the facts do the heavy lifting." },
  { id: 'direct', instruction: "Be direct: State the damage plainly. No softening." },
  { id: 'flat-sequence', instruction: "Flat sequence: List events in order. The sequence IS the commentary." },
  { id: 'dark-humor', instruction: "Dark humor: Let the absurdity speak for itself." },
  { id: 'personal', instruction: "Make it personal: 'YOUR taxes,' 'YOUR healthcare,' 'YOUR rights.'" },
  { id: 'follow-money', instruction: "Follow the money: Who benefits? Who paid? Name names." }
];

// ============================================================================
// SENTENCE STRUCTURES
// ============================================================================

export const SENTENCE_STRUCTURES = [
  { id: 'punchy', instruction: "Punchy one-liner opening, then expand with context." },
  { id: 'setup-payoff', instruction: "Setup the official line, then hit with reality." },
  { id: 'who-wins-loses', instruction: "Lead with who wins and who loses. Then explain." },
  { id: 'question-answer', instruction: "Pose the question everyone's asking, then answer it." },
  { id: 'contrast-pivot', instruction: "Start with what they claim, pivot to what's actually happening." },
  { id: 'timeline', instruction: "Walk through chronologically: Then... Then... Now..." }
];

// ============================================================================
// CLOSING APPROACHES
// ============================================================================

export const CLOSING_APPROACHES = [
  { id: 'pattern-note', instruction: "Note the pattern: 'Add it to the list.'" },
  { id: 'what-next', instruction: "What to watch for: 'Keep an eye on [specific consequence].'" },
  { id: 'who-pays', instruction: "Who pays: 'And guess who foots the bill?'" },
  { id: 'call-to-action', instruction: "Action: One concrete thing readers can do." },
  { id: 'question', instruction: "End with pointed question that lingers." },
  { id: 'systemic', instruction: "Systemic note: 'This is how the system works. For them, not you.'" }
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
 * @param {string[]} recentOpenings - First ~50 chars of recent summary_spicy outputs
 * @returns {string} Text to inject into prompt
 */
export function buildVariationInjection(variation, recentOpenings = []) {
  let injection = `CREATIVE DIRECTION FOR THIS STORY:
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
 * Convert alarm level (0-5) to legacy severity text
 * @param {number} alarmLevel - Numeric 0-5
 * @returns {string|null} Legacy severity or null for levels 0-1
 */
export function alarmLevelToLegacySeverity(alarmLevel) {
  if (alarmLevel === 5) return 'critical';
  if (alarmLevel === 4) return 'severe';
  if (alarmLevel === 3) return 'moderate';
  if (alarmLevel === 2) return 'minor';
  return null; // 0-1 can't be represented in legacy enum
}

/**
 * Convert legacy severity text to alarm level
 * @param {string} severity - Legacy text severity
 * @returns {number|null} Alarm level or null if unknown
 */
export function legacySeverityToAlarmLevel(severity) {
  const map = { critical: 5, severe: 4, moderate: 3, minor: 2 };
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
