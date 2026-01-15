/**
 * GPT Enrichment Prompt for Pardons (ADO-246)
 *
 * This prompt transforms Perplexity research data into reader-facing copy.
 * Uses corruption_level to set tone intensity (profanity at 4-5 only).
 *
 * Dependencies:
 *   - Business logic: docs/architecture/business-logic-mapping.md
 *   - Variation pools: scripts/enrichment/pardons-variation-pools.js
 */

// ============================================================================
// CORRUPTION LABELS (for GPT context)
// ============================================================================

export const CORRUPTION_LABELS = {
  5: { spicy: 'Paid-to-Play', neutral: 'Direct Financial Connection' },
  4: { spicy: 'Friends & Family', neutral: 'Personal/Inner Circle' },
  3: { spicy: 'Swamp Creature', neutral: 'Political Alliance' },
  2: { spicy: 'Celebrity Request', neutral: 'Public Campaign' },
  1: { spicy: 'Broken Clock', neutral: 'Policy-Based' }
};

export const CONNECTION_TYPE_LABELS = {
  major_donor: 'Documented campaign/PAC/fund donor',
  political_ally: 'Political ally who endorsed or fundraised',
  family: 'Trump family member',
  business_associate: 'Trump Organization business relationship',
  celebrity: 'Famous person with media platform',
  jan6_defendant: 'Charged in January 6 investigation',
  fake_electors: 'Involved in fake electors scheme',
  mar_a_lago_vip: 'Mar-a-Lago member or frequent guest',
  campaign_staff: 'Worked on Trump campaign',
  cabinet_connection: 'Cabinet member or appointee',
  lobbyist: 'Lobbyist or industry connection',
  no_connection: 'No documented Trump relationship'
};

// ============================================================================
// PROFANITY RULES
// ============================================================================

export const PROFANITY_ALLOWED = {
  5: true,   // Paid-to-Play - full spice allowed
  4: true,   // Friends & Family - allowed
  3: false,  // Swamp Creature - sardonic, not profane
  2: false,  // Celebrity Request - measured critique
  1: false   // Broken Clock - respectful acknowledgment
};

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

export const SYSTEM_PROMPT = `You are writing for TrumpyTracker, an accountability site tracking Trump administration pardons.

Your job: Transform research data into sharp, factual, reader-facing copy.

TONE CALIBRATION:
- Levels 5 & 4: Profanity allowed. Be angry. The corruption is documented.
- Level 3: Sardonic and pointed, but no swearing. Skeptical voice.
- Level 2: Measured critique of the system. Don't attack the individual.
- Level 1: Acknowledge legitimacy. Can express cautious approval. Contrast with corrupt pardons.

CORE RULES:
1. Every claim must be sourced from the provided research data
2. Never invent facts or connections not in the input
3. Lead with the most damning documented fact
4. Use "documented," "records show," "according to" to ground claims
5. Rhetorical questions are allowed but must be answerable from the data
6. Timeline events should reinforce the narrative (donations before pardon, etc.)
7. For group pardons, focus on the signal/message, not individuals
8. For Jan 6 / fake electors: emphasize impunity and future deterrence effects

WHAT TO AVOID:
- Speculation beyond what's documented
- "What we don't know" framing (just omit missing info)
- Repeating the same opening pattern across pardons
- Listing facts without connecting them to corruption narrative
- Profanity at levels 1-3

OUTPUT FORMAT:
Return ONLY valid JSON with no additional text, markdown, or explanation.
Do not wrap the JSON in code blocks or add any prose before/after.

{
  "summary_spicy": "2-4 sentences. The hook + key facts + why it matters. Sharp, memorable.",
  "why_it_matters": "1-2 sentences. Broader implications: precedent, signal, system critique.",
  "pattern_analysis": "1 sentence. How this fits the overall pardon pattern."
}`;

// ============================================================================
// USER PROMPT BUILDER
// ============================================================================

/**
 * Build the user message for GPT enrichment
 * @param {Object} pardon - Pardon record with research data
 * @param {string} variationInjection - Creative direction from variation pools
 * @returns {string} User prompt
 */
export function buildUserPrompt(pardon, variationInjection = '') {
  const {
    recipient_name,
    recipient_type,
    recipient_count,
    recipient_criteria,
    pardon_date,
    clemency_type,
    offense_raw,
    conviction_district,
    crime_category,
    primary_connection_type,
    secondary_connection_types,
    corruption_level,
    corruption_reasoning,
    trump_connection_detail,
    donation_amount_usd,
    receipts_timeline,
    pardon_advocates
  } = pardon;

  // Format receipts timeline for prompt
  const timelineText = formatTimeline(receipts_timeline);

  // Format advocates if present
  const advocatesText = pardon_advocates?.length > 0
    ? `\nADVOCATES: ${pardon_advocates.join(', ')}`
    : '';

  // Group pardon context
  const groupContext = recipient_type === 'group'
    ? `\nGROUP PARDON: ${recipient_count} recipients matching "${recipient_criteria}"`
    : '';

  // Connection type label
  const connectionLabel = CONNECTION_TYPE_LABELS[primary_connection_type] || primary_connection_type;
  const corruptionLabel = CORRUPTION_LABELS[corruption_level]?.spicy || `Level ${corruption_level}`;

  // Secondary connections if any
  const secondaryText = secondary_connection_types?.length > 0
    ? `\nSecondary connections: ${secondary_connection_types.join(', ')}`
    : '';

  let prompt = `PARDON DATA:
Recipient: ${recipient_name}${groupContext}
Pardon Date: ${pardon_date}
Clemency Type: ${clemency_type}
Offense: ${offense_raw || 'Not specified'}
District: ${conviction_district || 'Not specified'}
Crime Category: ${crime_category || 'Not categorized'}

CLASSIFICATION:
Corruption Level: ${corruption_level} (${corruptionLabel})
Corruption Reasoning: ${corruption_reasoning || 'See connection detail'}
Primary Connection: ${primary_connection_type} - ${connectionLabel}${secondaryText}

RESEARCH FINDINGS:
Trump Connection: ${trump_connection_detail || 'No detailed connection found'}
${donation_amount_usd ? `Documented Donation: $${new Intl.NumberFormat('en-US').format(donation_amount_usd)}` : ''}
${advocatesText}

RECEIPTS TIMELINE:
${timelineText || 'No timeline events documented'}

${variationInjection ? `\n${variationInjection}\n` : ''}
Generate the enrichment JSON. Remember:
- Profanity allowed: ${PROFANITY_ALLOWED[corruption_level] ? 'YES' : 'NO'}
- Lead with the strongest documented fact
- Every claim must trace back to the data above`;

  return prompt;
}

/**
 * Format receipts timeline for prompt
 * @param {Array} timeline - Array of timeline events
 * @returns {string} Formatted timeline text
 */
function formatTimeline(timeline) {
  if (!Array.isArray(timeline) || timeline.length === 0) {
    return null;
  }

  return timeline
    .map(event => {
      const parts = [];
      if (event.date) parts.push(event.date);
      if (event.event_type) parts.push(`[${event.event_type}]`);
      if (event.description) parts.push(event.description);
      if (event.amount_usd) parts.push(`($${new Intl.NumberFormat('en-US').format(event.amount_usd)})`);
      return `- ${parts.join(' ')}`;
    })
    .join('\n');
}

// ============================================================================
// RESPONSE VALIDATION
// ============================================================================

/**
 * Validate GPT response structure
 * @param {Object} response - Parsed JSON response
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateEnrichmentResponse(response) {
  const errors = [];

  // Required fields
  if (!response.summary_spicy || typeof response.summary_spicy !== 'string') {
    errors.push('Missing or invalid summary_spicy');
  } else if (response.summary_spicy.length < 50) {
    errors.push('summary_spicy too short (min 50 chars)');
  } else if (response.summary_spicy.length > 1000) {
    errors.push('summary_spicy too long (max 1000 chars)');
  }

  if (!response.why_it_matters || typeof response.why_it_matters !== 'string') {
    errors.push('Missing or invalid why_it_matters');
  } else if (response.why_it_matters.length < 30) {
    errors.push('why_it_matters too short (min 30 chars)');
  } else if (response.why_it_matters.length > 500) {
    errors.push('why_it_matters too long (max 500 chars)');
  }

  if (!response.pattern_analysis || typeof response.pattern_analysis !== 'string') {
    errors.push('Missing or invalid pattern_analysis');
  } else if (response.pattern_analysis.length < 20) {
    errors.push('pattern_analysis too short (min 20 chars)');
  } else if (response.pattern_analysis.length > 300) {
    errors.push('pattern_analysis too long (max 300 chars)');
  }

  return { valid: errors.length === 0, errors };
}
