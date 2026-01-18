/**
 * Shared Banned Openings
 *
 * Master list of cliched/overused phrases that AI summaries should NOT start with.
 * Used across all content types: Pardons, Stories, EOs, SCOTUS
 *
 * These phrases either:
 * - Sound like generic AI output ("In a shocking move...")
 * - Are lazy filler ("So, " / "Well, ")
 * - Show false outrage that numbs readers ("Once again...")
 */

export const BANNED_OPENINGS = [
  // Generic outrage openers
  "This is outrageous",
  "In a shocking move",
  "Once again",
  "It's no surprise",
  "Make no mistake",
  "Let that sink in",

  // Lazy filler openers
  "Guess what?",
  "So, ",
  "Well, ",
  "Look, ",

  // Cliched dramatic openers
  "In a stunning",
  "In a brazen",
  "Shocking absolutely no one",
  "In the latest move",
  "In yet another",

  // Empty phrases
  "It remains to be seen",
  "Crucially",
  "Interestingly",
  "Notably",

  // Tired political commentary
  "The walls are closing in",
  "This is a bombshell",
  "Breaking:",
  "BREAKING:",
  "Just in:",

  // Passive voice starters
  "It has been reported",
  "It was announced",
  "It appears that"
];

/**
 * Check if text starts with any banned opening
 * @param {string} text - text to check
 * @returns {{ banned: boolean, match: string|null }}
 */
export function checkForBannedOpening(text) {
  if (!text || typeof text !== 'string') {
    return { banned: false, match: null };
  }

  const normalized = text.trim().toLowerCase();

  for (const banned of BANNED_OPENINGS) {
    if (normalized.startsWith(banned.toLowerCase())) {
      return { banned: true, match: banned };
    }
  }

  return { banned: false, match: null };
}

/**
 * Get banned openings as formatted string for prompt injection
 * @returns {string}
 */
export function getBannedOpeningsForPrompt() {
  return BANNED_OPENINGS.map(b => `- "${b}"`).join('\n');
}
