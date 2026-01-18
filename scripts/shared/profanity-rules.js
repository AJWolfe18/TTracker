/**
 * Shared Profanity Rules
 *
 * Controls when profanity is allowed based on severity level.
 * Consistent across all content types: Pardons, Stories, EOs, SCOTUS
 *
 * Philosophy:
 * - Levels 5-4: Constitutional crisis / criminal behavior deserves full intensity
 * - Levels 3-0: Sardonic or positive - profanity undermines the tone
 */

export const PROFANITY_ALLOWED = {
  5: true,   // Full spice - constitutional crisis / corruption - "They actually fucking did it"
  4: true,   // Allowed - criminal / crony / tyranny - anger is appropriate
  3: false,  // Sardonic, no swearing - let absurdity speak
  2: false,  // Measured critique - eye-roll energy
  1: false,  // Cautious/surprised - credit where due
  0: false   // Positive acknowledgment - suspicious celebration
};

/**
 * Check if profanity is allowed at a given severity level
 * @param {number} level - 0-5 severity level
 * @returns {boolean}
 */
export function isProfanityAllowed(level) {
  const validLevel = Math.max(0, Math.min(5, Math.round(level)));
  return PROFANITY_ALLOWED[validLevel] === true;
}

/**
 * Get profanity guidance text for prompt injection
 * @param {number} level - 0-5 severity level
 * @returns {string}
 */
export function getProfanityGuidance(level) {
  if (isProfanityAllowed(level)) {
    return "Profanity is ALLOWED at this severity level. Use it for incredulity and impact, not gratuitous anger.";
  }
  return "Profanity is NOT allowed at this severity level. Channel the energy through wit and sarcasm instead.";
}

/**
 * Get tone calibration text for prompt injection based on level
 * @param {number} level - 0-5 severity level
 * @returns {string}
 */
export function getToneCalibration(level) {
  const tones = {
    5: "Level 5 - ALARM BELLS: Cold fury, prosecutorial. Profanity allowed for INCREDULITY. Example: 'They actually fucking did it.'",
    4: "Level 4 - ANGRY ACCOUNTABILITY: Suspicious, pointed. Name names, focus on victims and beneficiaries. Profanity allowed.",
    3: "Level 3 - SARDONIC CRITIQUE: Weary, 'seen this before' energy. Dark humor, let absurdity speak. NO profanity.",
    2: "Level 2 - EYE-ROLL: 'Lazy employees' energy. Measured critique of system dysfunction. NO profanity.",
    1: "Level 1 - CAUTIOUS SKEPTICISM: Credit where due, but flag the asterisk. 'Read the limiting language.' NO profanity.",
    0: "Level 0 - SUSPICIOUS CELEBRATION: Genuine disbelief the system worked. 'Don't get used to it.' NO profanity."
  };

  const validLevel = Math.max(0, Math.min(5, Math.round(level)));
  return tones[validLevel];
}
