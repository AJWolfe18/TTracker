/**
 * Shared Severity Configuration
 *
 * Unified 0-5 numeric scale with consistent colors/emojis across all content types.
 * Each content type uses DIFFERENT labels but SAME colors.
 *
 * Content types: Pardons, Stories, EOs, SCOTUS
 */

export const SEVERITY_COLORS = {
  5: { bg: "#fee2e2", text: "#7f1d1d", border: "#dc2626", emoji: "🔴" }, // red - constitutional crisis
  4: { bg: "#fed7aa", text: "#7c2d12", border: "#ea580c", emoji: "🟠" }, // orange - criminal/crony
  3: { bg: "#fef3c7", text: "#713f12", border: "#f59e0b", emoji: "🟡" }, // yellow - sardonic
  2: { bg: "#dbeafe", text: "#1e3a8a", border: "#3b82f6", emoji: "🔵" }, // blue - eye-roll
  1: { bg: "#cffafe", text: "#155e75", border: "#06b6d4", emoji: "⚪" }, // cyan - cautious
  0: { bg: "#d1fae5", text: "#064e3b", border: "#10b981", emoji: "🟢" }  // green - suspicious celebration
};

/**
 * Labels by content type - ALL DIFFERENT to match editorial voice
 */
export const SEVERITY_LABELS = {
  pardons: {
    5: "Pay 2 Win",
    4: "Cronies-in-Chief",
    3: "The Party Favor",
    2: "The PR Stunt",
    1: "The Ego Discount",
    0: "Actual Mercy"
  },
  stories: {
    5: "Constitutional Dumpster Fire",
    4: "Criminal Bullshit",
    3: "The Deep Swamp",
    2: "The Great Gaslight",
    1: "Accidental Sanity",
    0: "A Broken Clock Moment"
  },
  eos: {
    5: "Authoritarian Power Grab",
    4: "Weaponized Executive",
    3: "Corporate Giveaway",
    2: "Smoke and Mirrors",
    1: "Surprisingly Not Terrible",
    0: "Actually Helpful"
  },
  scotus: {
    5: "Constitutional Crisis",
    4: "Rubber-stamping Tyranny",
    3: "Institutional Sabotage",
    2: "Judicial Sidestepping",
    1: "Crumbs from the Bench",
    0: "Democracy Wins"
  }
};

/**
 * Get severity display info for a content type and level
 * @param {string} contentType - 'pardons' | 'stories' | 'eos' | 'scotus'
 * @param {number} level - 0-5 severity level
 * @returns {{ label: string, colors: object }}
 */
// Default fallback colors (neutral gray) if level somehow invalid
const DEFAULT_COLORS = { bg: "#f3f4f6", text: "#111827", border: "#9ca3af", emoji: "⚫" };

export function getSeverityDisplay(contentType, level) {
  const validLevel = Math.max(0, Math.min(5, Math.round(level || 0)));
  return {
    label: SEVERITY_LABELS[contentType]?.[validLevel] || `Level ${validLevel}`,
    colors: SEVERITY_COLORS[validLevel] || DEFAULT_COLORS
  };
}

/**
 * Validate severity level is in range
 * @param {number} level - severity level to validate
 * @returns {number} - clamped 0-5 value
 */
export function clampSeverity(level) {
  return Math.max(0, Math.min(5, Math.round(level)));
}
