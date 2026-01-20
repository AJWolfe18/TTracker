/**
 * Core Style Patterns for TrumpyTracker (ADO-273)
 *
 * ~20 universal patterns shared across all content types (EOs, Stories, SCOTUS, Pardons).
 * Each pattern describes an APPROACH, not literal text to copy.
 *
 * Structure per pattern:
 * - id: unique identifier
 * - opening_approach: how to start the analysis
 * - rhetorical_device: structural technique to use
 * - structure: how to organize the sections
 * - closing_approach: how to end/land the point
 *
 * Usage:
 *   import { CORE_STYLE_PATTERNS, fnv1a32 } from '../shared/style-patterns-core.js';
 */

// ============================================================================
// FNV-1a 32-bit Hash for Deterministic Selection
// ============================================================================

/**
 * FNV-1a 32-bit hash function for deterministic pattern selection
 * @param {string} str - Input string to hash
 * @returns {number} 32-bit unsigned integer hash
 */
export function fnv1a32(str) {
  let hash = 2166136261; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 16777619) >>> 0; // FNV prime, keep as 32-bit unsigned
  }
  return hash >>> 0;
}

// ============================================================================
// CORE STYLE PATTERNS (~20 Universal)
// ============================================================================

export const CORE_STYLE_PATTERNS = [
  // --- CONTRAST PATTERNS ---
  {
    id: 'contrast-claim-reality',
    opening_approach: 'Lead with the contrast between official framing and practical effect.',
    rhetorical_device: 'Use tight A/B contrast structure throughout.',
    structure: 'Official claim -> actual effect -> who is affected -> implication.',
    closing_approach: 'End with what this enables going forward.'
  },
  {
    id: 'contrast-rhetoric-action',
    opening_approach: 'Open with what they said they would do versus what they are doing.',
    rhetorical_device: 'Stack contradictions to build pattern evidence.',
    structure: 'Promise -> action -> gap analysis -> consequence.',
    closing_approach: 'Land on the credibility implications.'
  },
  {
    id: 'contrast-then-now',
    opening_approach: 'Start by establishing what the previous state was.',
    rhetorical_device: 'Timeline juxtaposition showing before/after.',
    structure: 'Previous state -> change agent -> new state -> who gains/loses.',
    closing_approach: 'Close with the trajectory this sets.'
  },

  // --- FOLLOW THE MONEY PATTERNS ---
  {
    id: 'money-trail-beneficiaries',
    opening_approach: 'Open with who directly benefits financially.',
    rhetorical_device: 'Follow the money through the policy chain.',
    structure: 'Beneficiary -> mechanism -> cost -> who pays.',
    closing_approach: 'End with the transfer equation plainly stated.'
  },
  {
    id: 'money-donor-timeline',
    opening_approach: 'Lead with the donation/lobbying timeline.',
    rhetorical_device: 'Chronological receipts that speak for themselves.',
    structure: 'Donation date -> lobbying -> policy change -> ROI.',
    closing_approach: 'Let the sequence be the conclusion.'
  },

  // --- MECHANISM PATTERNS ---
  {
    id: 'mechanism-how-it-works',
    opening_approach: 'Open by explaining the mechanism plainly.',
    rhetorical_device: 'Demystify bureaucratic language into plain effect.',
    structure: 'What it does -> how -> who implements -> practical result.',
    closing_approach: 'End with the bottom-line impact on real people.'
  },
  {
    id: 'mechanism-loophole',
    opening_approach: 'Lead with the loophole or exception that matters.',
    rhetorical_device: 'Highlight the gap between headline and fine print.',
    structure: 'Headline claim -> actual text -> exception -> who exploits it.',
    closing_approach: 'Close with what the exception actually permits.'
  },

  // --- SCOPE AND SCALE PATTERNS ---
  {
    id: 'scope-who-affected',
    opening_approach: 'Open with the scale of people affected.',
    rhetorical_device: 'Concrete numbers over abstract descriptions.',
    structure: 'Number affected -> how -> immediate impact -> cascading effects.',
    closing_approach: 'End by making it personal to the reader.'
  },
  {
    id: 'scope-geographic',
    opening_approach: 'Lead with where this hits hardest.',
    rhetorical_device: 'Map the policy to specific places and communities.',
    structure: 'Geographic focus -> local impact -> broader pattern -> precedent.',
    closing_approach: 'Close with whether your area is next.'
  },

  // --- PATTERN RECOGNITION ---
  {
    id: 'pattern-this-again',
    opening_approach: 'Open by noting this fits an established pattern.',
    rhetorical_device: 'Connect to previous similar actions without belaboring.',
    structure: 'Current action -> similar past actions -> pattern diagnosis -> prediction.',
    closing_approach: 'End with what the pattern predicts next.'
  },
  {
    id: 'pattern-playbook',
    opening_approach: 'Lead by identifying which playbook this comes from.',
    rhetorical_device: 'Reference documented strategies without being preachy.',
    structure: 'Action -> playbook reference -> historical parallel -> stakes.',
    closing_approach: 'Close with the playbook end goal.'
  },

  // --- POWER ANALYSIS PATTERNS ---
  {
    id: 'power-who-gains',
    opening_approach: 'Open with the power shift this creates.',
    rhetorical_device: 'Frame as power redistribution, not just policy.',
    structure: 'Power before -> mechanism -> power after -> check/balance impact.',
    closing_approach: 'End with what this enables for future actions.'
  },
  {
    id: 'power-precedent',
    opening_approach: 'Lead with the precedent being set.',
    rhetorical_device: 'Emphasize future implications over current event.',
    structure: 'Current action -> precedent created -> future possibilities -> guardrails status.',
    closing_approach: 'Close with what future actors can now do.'
  },

  // --- ACCOUNTABILITY PATTERNS ---
  {
    id: 'accountability-names',
    opening_approach: 'Open by naming the specific actors responsible.',
    rhetorical_device: 'Attach actions to names, not institutions alone.',
    structure: 'Actor -> decision -> consequence -> accountability status.',
    closing_approach: 'End with whether any accountability is possible.'
  },
  {
    id: 'accountability-timeline',
    opening_approach: 'Lead with a clear chronology of decisions.',
    rhetorical_device: 'Let the timeline reveal the intent.',
    structure: 'Event 1 -> Event 2 -> Event 3 -> what the sequence reveals.',
    closing_approach: 'Close with what the timeline makes obvious.'
  },

  // --- ABSURDITY PATTERNS ---
  {
    id: 'absurdity-let-it-speak',
    opening_approach: 'Open by stating the absurd element flatly.',
    rhetorical_device: 'Deadpan delivery letting absurdity land naturally.',
    structure: 'Absurd fact -> context -> why this is actually happening -> implication.',
    closing_approach: 'End without editorializing, let the fact sit.'
  },
  {
    id: 'absurdity-contrast',
    opening_approach: 'Lead with the logical contradiction.',
    rhetorical_device: 'Use A but also B structure to highlight incoherence.',
    structure: 'Position A -> contradicting action B -> why both exist -> what it reveals.',
    closing_approach: 'Close by noting the contradiction is a feature not a bug.'
  },

  // --- PERSONAL IMPACT PATTERNS ---
  {
    id: 'personal-your-wallet',
    opening_approach: 'Open with direct financial impact on readers.',
    rhetorical_device: 'Make abstract policy concrete with dollars and cents.',
    structure: 'Policy -> your cost -> their benefit -> the trade.',
    closing_approach: 'End with the personal bottom line.'
  },
  {
    id: 'personal-your-rights',
    opening_approach: 'Lead with specific rights or protections affected.',
    rhetorical_device: 'Frame as what you could do before that you cannot now.',
    structure: 'Right/protection -> change -> practical effect -> recourse.',
    closing_approach: 'Close with what this means for your daily life.'
  },

  // --- SYSTEMIC PATTERNS ---
  {
    id: 'systemic-institution',
    opening_approach: 'Open by naming the institution being changed.',
    rhetorical_device: 'Frame as institutional capture or hollowing.',
    structure: 'Institution purpose -> change -> new function -> democratic impact.',
    closing_approach: 'End with what the institution can no longer do.'
  },
  {
    id: 'systemic-norm-erosion',
    opening_approach: 'Lead with the norm being violated or eroded.',
    rhetorical_device: 'Explain why the norm existed before criticizing its violation.',
    structure: 'Norm -> its purpose -> violation -> downstream effects.',
    closing_approach: 'Close with what happens when this norm is fully gone.'
  }
];

// ============================================================================
// PATTERN LOOKUP
// ============================================================================

/**
 * Get a pattern by ID
 * @param {string} id - Pattern ID
 * @returns {Object|null} Pattern object or null if not found
 */
export function getPatternById(id) {
  return CORE_STYLE_PATTERNS.find(p => p.id === id) || null;
}

/**
 * Get all pattern IDs
 * @returns {string[]} Array of pattern IDs
 */
export function getAllPatternIds() {
  return CORE_STYLE_PATTERNS.map(p => p.id);
}
