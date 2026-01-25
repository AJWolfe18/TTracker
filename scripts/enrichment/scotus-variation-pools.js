/**
 * ========================================================================
 * DEPRECATED - ADO-275 (2026-01-25)
 * ========================================================================
 *
 * This file has been replaced by scotus-style-patterns.js
 *
 * Reasons for deprecation:
 * - Uses Math.random() for selection (non-deterministic, can't reproduce results)
 * - Contains literal text openers that GPT copies verbatim (causes repetition)
 * - No integration with ADO-300 clamp system
 *
 * New implementation (scotus-style-patterns.js) provides:
 * - Deterministic selection via FNV-1a hash
 * - Approach-only patterns (no literal text for GPT to copy)
 * - Frame-based pools with ADO-300 clamp integration
 * - Post-gen validation with banned starter detection
 *
 * DO NOT import from this file. Use scotus-style-patterns.js instead.
 * ========================================================================
 *
 * Original description:
 * Variation Pools for SCOTUS GPT Enrichment (TTRC-340)
 *
 * Provides stratified opening patterns, rhetorical devices, and structures
 * to prevent repetitive outputs across SCOTUS case summaries.
 *
 * Based on pardons-variation-pools.js pattern.
 *
 * Usage: DEPRECATED - see scotus-style-patterns.js
 */

// ============================================================================
// OPENING PATTERNS (Stratified by Ruling Impact Level)
// ============================================================================

export const OPENING_PATTERNS = {
  // Level 5: Constitutional Crisis - Precedent nuked, money/power wins
  constitutional_crisis: [
    { id: 'precedent-killed', instruction: "Lead with what precedent died: '[X] years of precedent. Gone. Because five justices said so.'" },
    { id: 'follow-money', instruction: "Follow the money: 'The Federalist Society spent decades on this. Today: payday.'" },
    { id: 'who-bought-it', instruction: "Name the buyer: 'Leonard Leo's wishlist just got shorter.'" },
    { id: 'body-count', instruction: "Lead with human cost: 'How many people will die because of this ruling? Start counting.'" },
    { id: 'mask-off', instruction: "Mask off: 'They're not even pretending anymore.'" },
    { id: 'history-will', instruction: "Historical framing: 'History will remember this as the day the Court...' " },
    { id: 'billionaire-bench', instruction: "Billionaire framing: 'Another ruling from the billionaire's bench.'" },
    { id: 'corruption-plain', instruction: "Plain statement: 'This is what judicial corruption looks like.'" },
    { id: 'constitution-shredded', instruction: "Constitution angle: 'The Constitution means whatever they say it means now.'" },
    { id: 'game-rigged', instruction: "Rigged game: 'The game was rigged. Now it's official.'" }
  ],

  // Level 4: Rubber-stamping Tyranny - Police/state power blessed
  rubber_stamping: [
    { id: 'cops-won', instruction: "Police state: 'Good news for cops who shoot first. Bad news for everyone else.'" },
    { id: 'your-rights-shrank', instruction: "Personal impact: 'Your Fourth Amendment rights just got smaller. Again.'" },
    { id: 'greenlight', instruction: "Green light framing: 'The Court just gave [agency/cops/president] permission to...'" },
    { id: 'victims-first', instruction: "Lead with victims: 'Another ruling that makes it harder to hold [cops/government] accountable.'" },
    { id: 'immunity-expanded', instruction: "Immunity angle: 'More immunity for those in power. Less recourse for you.'" },
    { id: 'surveillance-blessed', instruction: "Surveillance: 'Big Brother just got the Court's blessing. Again.'" },
    { id: 'dissent-warning', instruction: "Quote dissent warning: 'As Justice [X] warned: [quote the consequence].'" },
    { id: 'authoritarian-playbook', instruction: "Playbook: 'Another page from the authoritarian playbook, now with judicial approval.'" },
    { id: 'who-polices', instruction: "Accountability: 'Who polices the police? According to this Court: nobody.'" },
    { id: 'boot-on-neck', instruction: "Direct: 'The boot just got heavier. The Court made sure of it.'" }
  ],

  // Level 3: Institutional Sabotage - Technical moves that gut rights
  institutional_sabotage: [
    { id: 'boring-deadly', instruction: "Boring but deadly: 'This ruling sounds boring. That's the point. Here's what they actually did...'" },
    { id: 'technical-trick', instruction: "Explain the trick: 'The technical move: [standing/burden/procedure]. The real effect: [outcome].'" },
    { id: 'rights-paper-only', instruction: "Paper rights: 'You still have the right to [X]. You just can't use it anymore.'" },
    { id: 'termites', instruction: "Termite framing: 'Termites in the foundation. You won't notice until the floor collapses.'" },
    { id: 'death-papercuts', instruction: "Papercuts: 'Not a killing blow. Just another cut. The bleeding continues.'" },
    { id: 'sabotage-plain', instruction: "Plain sabotage: 'They didn't overturn it. They just made it impossible to use.'" },
    { id: 'burden-shifted', instruction: "Burden shift: 'The burden just shifted. Guess which direction?'" },
    { id: 'loophole-opened', instruction: "Loophole: 'A new loophole just opened. Corporations are already walking through.'" },
    { id: 'fine-print', instruction: "Fine print: 'The devil is in the [standing requirement/procedural bar/burden of proof].'" },
    { id: 'slow-poison', instruction: "Slow poison: 'This won't make headlines. It'll just quietly poison [regulatory area] for years.'" }
  ],

  // Level 2: Judicial Sidestepping - Punted, avoided, kicked the can
  judicial_sidestepping: [
    { id: 'no-comment', instruction: "No comment: 'The Court's answer to [major question]: ¯\\_(ツ)_/¯'" },
    { id: 'kicked-can', instruction: "Kicked can: 'They punted. The question lives to haunt us another day.'" },
    { id: 'standing-dodge', instruction: "Standing dodge: 'No standing. Translation: we don't want to decide this.'" },
    { id: 'cowards', instruction: "Cowardice: 'Nine justices. Zero courage. Case dismissed.'" },
    { id: 'technical-excuse', instruction: "Technical excuse: 'They found a technicality to avoid the actual question.'" },
    { id: 'remanded', instruction: "Remand: 'Sent back to the lower court. Years more litigation. Problem unsolved.'" },
    { id: 'who-benefits-delay', instruction: "Delay benefits: 'They didn't decide. And that non-decision benefits [who].'" },
    { id: 'moot-convenient', instruction: "Convenient mootness: 'Declared moot. How convenient for [beneficiary].'" },
    { id: 'narrow-nothing', instruction: "Narrow to nothing: 'Decided on the narrowest possible grounds. Translation: nothing changes.'" },
    { id: 'another-day', instruction: "Live to fight: 'Not today, apparently. Maybe next term. Maybe never.'" }
  ],

  // Level 1: Crumbs from the Bench - Win, but fragile
  crumbs_from_bench: [
    { id: 'but-wait', instruction: "But wait: 'A win for [group]. But read the footnotes before celebrating.'" },
    { id: 'fine-print-win', instruction: "Fine print: 'You won. Now read the limiting language that could undo it.'" },
    { id: 'fragile-victory', instruction: "Fragile: 'A win today. A target tomorrow. Here's why it might not last.'" },
    { id: 'narrow-grounds', instruction: "Narrow grounds: 'They ruled in your favor. On the narrowest possible grounds.'" },
    { id: 'dont-celebrate', instruction: "Tempered: 'Good news, sort of. Don't break out the champagne.'" },
    { id: 'asterisk', instruction: "Asterisk: 'You won*. The asterisk matters.'" },
    { id: 'this-time', instruction: "This time: 'This time, the Court got it right. Emphasis on \"this time.\"'" },
    { id: 'small-mercy', instruction: "Small mercy: 'A small mercy in a sea of bad rulings.'" },
    { id: 'temporary', instruction: "Temporary: 'Enjoy it while it lasts. This Court giveth, this Court taketh away.'" },
    { id: 'concurrence-warning', instruction: "Concurrence warning: 'The win is real. But [Justice]'s concurrence signals trouble ahead.'" }
  ],

  // Level 0: Democracy Wins - Actual good ruling (ADO-272: "suspicious celebration" tone)
  democracy_wins: [
    { id: 'actually-worked', instruction: "Suspicious celebration: 'The system actually worked. Mark your calendar. Don't get used to it.'" },
    { id: 'credit-due', instruction: "Credit due: 'Credit where it's due. This ruling actually protects people. We checked twice.'" },
    { id: 'unanimous-good', instruction: "Disbelief: '9-0 for the people. Is this real? Write it down before they change their minds.'" },
    { id: 'rights-protected', instruction: "Rights protected: 'Your [specific right] held. The Constitution worked as intended. For once.'" },
    { id: 'rare-win', instruction: "Rare win: 'A rare win against [corporation/government]. Savor it. This doesn't happen often.'" },
    { id: 'hard-to-undo', instruction: "Durable: 'A strong ruling that's actually hard to weasel out of. They'll try anyway.'" },
    { id: 'dissent-wrong', instruction: "Dissent thin: 'Even the usual suspects couldn't find much to complain about.'" },
    { id: 'template', instruction: "Template: 'This is what SCOTUS rulings should look like. Screenshot it.'" },
    { id: 'corporate-lost', instruction: "Corporate loss: 'Corporate interests lost. The sun is still rising in the east, somehow.'" },
    { id: 'people-first', instruction: "People first: 'For once, the Court put people over profits. Don't get comfortable.'" },
    { id: 'skeptical-joy', instruction: "Skeptical joy: 'Good news. Real good news. Now we wait for the catch.'" },
    { id: 'broken-clock', instruction: "Broken clock: 'Even this Court gets it right sometimes. Enjoy it while it lasts.'" }
  ],

  // Special: Voting Rights cases
  voting_rights: [
    { id: 'vra-ghost', instruction: "VRA ghost: 'The Voting Rights Act's ghost watches another piece die.'" },
    { id: 'who-cant-vote', instruction: "Who can't vote: 'Ask yourself who can't vote now. That's the point.'" },
    { id: 'democracy-math', instruction: "Math: 'Do the math. How many voters just got disenfranchised?'" },
    { id: 'gerrymandering-blessed', instruction: "Gerrymandering: 'Gerrymandering gets another blessing from on high.'" },
    { id: 'shelby-legacy', instruction: "Shelby legacy: 'Shelby County's legacy continues. State by state.'" },
    { id: 'access-harder', instruction: "Access: 'Voting just got harder for [group]. Mission accomplished.'" },
    { id: 'preclearance-gone', instruction: "Preclearance: 'Remember when discrimination required approval? Good times.'" },
    { id: 'democracy-test', instruction: "Test: 'Democracy stress test. We're failing.'" }
  ],

  // Special: Agency Power / Chevron cases
  agency_power: [
    { id: 'chevron-dead', instruction: "Chevron: 'Chevron deference takes another hit. Experts need not apply.'" },
    { id: 'self-regulate', instruction: "Self-regulate: 'Industry can self-regulate now. What could go wrong?'" },
    { id: 'major-questions', instruction: "Major questions: 'Too major for agencies, apparently. Only Congress can act. Congress won't.'" },
    { id: 'regulatory-gap', instruction: "Gap: 'A new regulatory gap just opened. Corporations are already walking through.'" },
    { id: 'experts-overruled', instruction: "Experts: 'Scientists and experts: overruled by lawyers. As intended.'" },
    { id: 'epa-gutted', instruction: "Agency gutted: '[Agency] just lost the ability to [function]. Enjoy the consequences.'" },
    { id: 'deregulation-bingo', instruction: "Bingo: 'Another square on the deregulation bingo card.'" },
    { id: 'industry-wish', instruction: "Industry wish: 'Another item checked off the industry wishlist.'" }
  ]
};

// ============================================================================
// RHETORICAL DEVICES
// ============================================================================

export const RHETORICAL_DEVICES = [
  { id: 'juxtaposition', instruction: "Use juxtaposition: 'The claim: [X]. The reality: [Y].'" },
  { id: 'rhetorical-q', instruction: "Open with rhetorical question based on the ruling." },
  { id: 'understatement', instruction: "Use understatement: 'Interesting timing on this one.'" },
  { id: 'direct', instruction: "Be direct: State the ruling plainly, let it indict itself." },
  { id: 'flat-sequence', instruction: "Flat sequence: State events in order. The sequence IS the commentary." },
  { id: 'dark-humor', instruction: "Dark humor: Let the absurdity speak for itself." },
  { id: 'quote-dissent', instruction: "Lead with dissent quote that captures the stakes." },
  { id: 'follow-money', instruction: "Follow the money: Name donors, dark money groups, or billionaire plaintiffs." }
];

// ============================================================================
// SENTENCE STRUCTURES
// ============================================================================

export const SENTENCE_STRUCTURES = [
  { id: 'punchy', instruction: "Punchy one-liner opening, then expand." },
  { id: 'setup-payoff', instruction: "Setup the official framing, then hit with the real impact." },
  { id: 'who-wins-loses', instruction: "Lead with who wins and who loses. Then explain why." },
  { id: 'question-answer', instruction: "Pose the question the case asked, then give the brutal answer." },
  { id: 'contrast-pivot', instruction: "Start with what they claim the ruling does, pivot to reality." },
  { id: 'dissent-frame', instruction: "Frame around what the dissent warned, then show they were right." }
];

// ============================================================================
// CLOSING APPROACHES
// ============================================================================

export const CLOSING_APPROACHES = [
  { id: 'pattern-note', instruction: "Note the pattern: 'Add it to the list of [theme] rulings.'" },
  { id: 'what-next', instruction: "What comes next: 'Watch for [consequence] in the next term.'" },
  { id: 'who-pays', instruction: "Who pays: 'And who pays for this? [Specific group].'" },
  { id: 'precedent-impact', instruction: "Precedent impact: 'This ruling will be cited to justify [future harm].'" },
  { id: 'dissent-prophecy', instruction: "Dissent as prophecy: 'Remember [Justice]'s warning when [consequence].'" },
  { id: 'system-note', instruction: "System note: 'This is how the system is designed to work. For them, not you.'" }
];

// ============================================================================
// SELECTION LOGIC
// ============================================================================

/**
 * Map ruling_impact_level and issue_area to appropriate pool
 * @param {number} level - Ruling impact level 0-5
 * @param {string} issueArea - Issue area from case metadata
 * @returns {string} Pool type key
 */
export function getPoolType(level, issueArea) {
  // Special issue-area pools override level for certain topics
  if (issueArea === 'voting_rights') return 'voting_rights';
  if (issueArea === 'agency_power') return 'agency_power';

  // Level-based pools
  const poolMap = {
    5: 'constitutional_crisis',
    4: 'rubber_stamping',
    3: 'institutional_sabotage',
    2: 'judicial_sidestepping',
    1: 'crumbs_from_bench',
    0: 'democracy_wins'
  };

  return poolMap[level] || 'institutional_sabotage';
}

/**
 * Select random variation elements for this enrichment call
 * @param {string} poolType - Pool type from getPoolType()
 * @param {string[]} recentOpeningIds - IDs of patterns used recently (to avoid repetition)
 * @returns {Object} Selected variation elements
 */
export function selectVariation(poolType, recentOpeningIds = []) {
  const pool = OPENING_PATTERNS[poolType] || OPENING_PATTERNS.institutional_sabotage;

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
  let injection = `CREATIVE DIRECTION FOR THIS RULING:
- Opening approach: ${variation.opening.instruction}
- Rhetorical device: ${variation.device.instruction}
- Structure: ${variation.structure.instruction}
- Closing approach: ${variation.closing.instruction}

These are suggestions to inspire variety — follow the spirit, not robotically.`;

  if (recentOpenings.length > 0) {
    injection += `

ANTI-REPETITION: These openings were used recently. DO NOT start similarly:
${recentOpenings.map(o => `- "${o}"`).join('\n')}`;
  }

  return injection;
}
