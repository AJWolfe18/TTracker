/**
 * Variation Pools for Pardons GPT Enrichment (ADO-246)
 *
 * Provides stratified opening patterns, rhetorical devices, and structures
 * to prevent repetitive outputs across pardon cards.
 *
 * Usage:
 *   import { selectVariation, buildVariationInjection, getPoolType } from './pardons-variation-pools.js';
 *   const poolType = getPoolType(corruption_level, primary_connection_type);
 *   const variation = selectVariation(poolType, recentlyUsedIds);
 *   const injection = buildVariationInjection(variation, recentOpeningTexts);
 */

// ============================================================================
// OPENING PATTERNS (Stratified by Type)
// ============================================================================

export const OPENING_PATTERNS = {
  // Level 5: Donor connections
  donor: [
    { id: 'fec-timeline', instruction: "Lead with FEC record + timeline: 'Donated $X to [fund]. [Years] later, conviction gone.'" },
    { id: 'inauguration', instruction: "Inauguration fund angle: '$X to the inauguration. Now pardoned. Connect the dots.'" },
    { id: 'bundler', instruction: "Bundler framing: 'Raised $X for the campaign. Guess who just walked free.'" },
    { id: 'stacked-receipts', instruction: "Stack multiple donations: 'PAC. Inauguration. Legal fund. Pardoned. See the pattern?'" },
    { id: 'roi', instruction: "Return on investment framing: 'That donation? Best investment they ever made.'" },
    { id: 'transaction', instruction: "Transaction framing: 'This wasn't clemency. This was a receipt.'" },
    { id: 'price-tag', instruction: "Name the documented amount: 'The donation on record: $X. The outcome: pardoned.'" },
    { id: 'math', instruction: "Let reader do math: 'Donated [year]. Convicted [year]. Pardoned [year]. You do the math.'" }
  ],

  // Level 4: Inner circle
  inner_circle: [
    { id: 'role-lead', instruction: "Lead with their role: 'Trump's [fixer/advisor/campaign chief] just walked.'" },
    { id: 'question-knowledge', instruction: "Question what they know: 'What did they know? We may never find out now.'" },
    { id: 'timing', instruction: "Convenient timing: 'Pardoned right before [investigation/testimony]. Convenient.'" },
    { id: 'access', instruction: "Access framing: 'Was in the room for [X]. Now protected from questions about it.'" },
    { id: 'protection', instruction: "Protection framing: 'Inner circle takes care of its own.'" },
    { id: 'sequence', instruction: "Sequence framing: 'Worked for Trump. Got in trouble. Got pardoned. In that order.'" }
  ],

  // Level 3: Political allies
  political: [
    { id: 'loyalty-list', instruction: "Loyalty list: 'Endorsed. Campaigned. Fundraised. Pardoned. In that order.'" },
    { id: 'routine', instruction: "Routine framing: 'Another ally. Another pardon. This is just how it works now.'" },
    { id: 'party-perks', instruction: "Party perks: 'Loyalty to the party comes with benefits.'" },
    { id: 'pattern-add', instruction: "Pattern addition: 'Add another name to the politically connected pardon list.'" },
    { id: 'predictable', instruction: "Predictable: 'If you guessed a Trump ally would get a pardon, you were right.'" },
    { id: 'swamp-equation', instruction: "Equation: 'Political support in, pardon out. The transaction complete.'" }
  ],

  // Level 3-5: Jan 6 / Fake electors / Anti-democracy
  insurrection: [
    { id: 'impunity-signal', instruction: "Lead with the signal: 'This pardon isn't mercy — it's permission.'" },
    { id: 'deterrence', instruction: "Deterrence framing: 'Accountability is the deterrent. This removes it.'" },
    { id: 'message', instruction: "Message framing: 'Do it for Trump, Trump protects you. That's the message.'" },
    { id: 'precedent', instruction: "Precedent framing: 'Future insurrectionists are watching. And learning.'" },
    { id: 'rule-of-law', instruction: "Rule of law: 'Laws only matter if enforced. This says: not for our side.'" },
    { id: 'two-systems', instruction: "Two systems: 'Storm the Capitol for Trump, walk free. The rules are clear now.'" }
  ],

  // Level 2: Celebrity
  celebrity: [
    { id: 'access', instruction: "Access framing: 'Famous enough to get a meeting. Meeting was enough.'" },
    { id: 'whose-calls', instruction: "Whose calls: 'A celebrity called. Justice answered. Most people don't have that number.'" },
    { id: 'privilege-gap', instruction: "Privilege gap: 'If you had famous friends, maybe you'd get a pardon too.'" },
    { id: 'media-justice', instruction: "Media justice: 'Enough press coverage and suddenly the system pays attention.'" },
    { id: 'spotlight', instruction: "Spotlight effect: 'Fame is access. Access is outcomes. Here's the proof.'" }
  ],

  // Level 1: Legitimate
  legitimate: [
    { id: 'broken-clock', instruction: "Broken clock: 'Even a broken clock is right twice a day. This is one of those times.'" },
    { id: 'credit-due', instruction: "Credit due: 'Credit where it's due: this one actually makes sense.'" },
    { id: 'what-it-should-be', instruction: "What clemency should be: 'This is what the pardon power is supposed to look like.'" },
    { id: 'exception', instruction: "Exception: 'The exception that proves the rule. This pardon is defensible.'" },
    { id: 'contrast', instruction: "Contrast setup: 'Unlike the donor pardons, this one has actual merit.'" },
    { id: 'rare', instruction: "Rare legitimacy: 'A rare case where clemency was used for its intended purpose.'" }
  ]
};

// ============================================================================
// RHETORICAL DEVICES
// ============================================================================

export const RHETORICAL_DEVICES = [
  { id: 'juxtaposition', instruction: "Use juxtaposition: 'Convicted of X. Connected via Y. Result: Z.'" },
  { id: 'rhetorical-q', instruction: "Open with rhetorical question based on the facts." },
  { id: 'understatement', instruction: "Use understatement: 'Interesting timing on this one.'" },
  { id: 'direct', instruction: "Be direct: State the facts plainly, let them indict themselves." },
  { id: 'flat-sequence', instruction: "Flat sequence: State events in order without commentary. The sequence IS the commentary." },
  { id: 'dry-humor', instruction: "Dry humor: Let the absurdity speak for itself." },
  { id: 'list-format', instruction: "List the facts: 'Crime: X. Connection: Y. Outcome: Z.'" }
];

// ============================================================================
// SENTENCE STRUCTURES
// ============================================================================

export const SENTENCE_STRUCTURES = [
  { id: 'punchy', instruction: "Punchy one-liner opening, then expand." },
  { id: 'setup-payoff', instruction: "Setup context, then hit with the punchline." },
  { id: 'timeline-narrative', instruction: "Walk through chronologically: 'First... Then... Now...'" },
  { id: 'question-answer', instruction: "Pose question, then answer it with facts." },
  { id: 'contrast-pivot', instruction: "Start with what they claim, pivot to documented reality." }
];

// ============================================================================
// CLOSING APPROACHES
// ============================================================================

export const CLOSING_APPROACHES = [
  { id: 'pattern-tease', instruction: "End noting the pattern: 'And they're not the only one.'" },
  { id: 'watchlist', instruction: "End with what to watch: 'Keep an eye on [related matter from research].'" },
  { id: 'systemic', instruction: "End with systemic point: 'This is what happens when...'" },
  { id: 'question', instruction: "End with pointed question based on the facts." },
  { id: 'contrast', instruction: "End contrasting with how others are treated." },
  { id: 'future', instruction: "End with what this enables next." }
];

// ============================================================================
// SELECTION LOGIC
// ============================================================================

/**
 * Map corruption_level and connection_type to appropriate pool
 * @param {number} level - Corruption level 1-5
 * @param {string} connectionType - primary_connection_type from research
 * @returns {string} Pool type key
 */
export function getPoolType(level, connectionType) {
  // Level 1 always uses legitimate pool
  if (level === 1) return 'legitimate';

  // Level 2 uses celebrity pool
  if (level === 2) return 'celebrity';

  // Anti-democracy types get their own pool (regardless of level 3-5)
  const antiDemocracyTypes = ['jan6_defendant', 'fake_electors'];
  if (antiDemocracyTypes.includes(connectionType)) {
    return 'insurrection';
  }

  // Donor types
  const donorTypes = ['major_donor', 'mar_a_lago_vip'];
  if (level === 5 || donorTypes.includes(connectionType)) {
    return 'donor';
  }

  // Inner circle types (includes cabinet connections)
  const innerCircleTypes = ['family', 'campaign_staff', 'business_associate', 'cabinet_connection'];
  if (level === 4 || innerCircleTypes.includes(connectionType)) {
    return 'inner_circle';
  }

  // Lobbyist gets political pool (swamp creature energy)
  if (connectionType === 'lobbyist') {
    return 'political';
  }

  // Default for level 3 and political types
  return 'political';
}

/**
 * Select random variation elements for this enrichment call
 * @param {string} poolType - Pool type from getPoolType()
 * @param {string[]} recentOpeningIds - IDs of patterns used recently (to avoid repetition)
 * @returns {Object} Selected variation elements
 */
export function selectVariation(poolType, recentOpeningIds = []) {
  const pool = OPENING_PATTERNS[poolType] || OPENING_PATTERNS.political;

  // Filter out recently used, but keep at least 3 options
  const availableOpenings = pool.filter(p => !recentOpeningIds.includes(p.id));
  const openingPool = availableOpenings.length >= 3 ? availableOpenings : pool;

  return {
    opening: randomFrom(openingPool),
    device: randomFrom(RHETORICAL_DEVICES),
    structure: randomFrom(SENTENCE_STRUCTURES),
    closing: randomFrom(CLOSING_APPROACHES)
  };
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Build the variation injection text for the prompt
 * @param {Object} variation - Output from selectVariation()
 * @param {string[]} recentOpenings - First ~50 chars of recent summary_spicy outputs
 * @returns {string} Text to inject into prompt
 */
export function buildVariationInjection(variation, recentOpenings = []) {
  let injection = `CREATIVE DIRECTION FOR THIS PARDON:
- Opening approach: ${variation.opening.instruction}
- Rhetorical device: ${variation.device.instruction}
- Structure: ${variation.structure.instruction}
- Closing approach: ${variation.closing.instruction}

These are suggestions to inspire variety — don't follow robotically.`;

  if (recentOpenings.length > 0) {
    injection += `

ANTI-REPETITION: These openings were used recently. DO NOT start similarly:
${recentOpenings.map(o => `- "${o}"`).join('\n')}`;
  }

  return injection;
}
