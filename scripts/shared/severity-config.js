/**
 * Severity Configuration - Node.js wrapper
 *
 * Loads from public/shared/tone-system.json (single source of truth)
 * Provides helper functions for backend scripts
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load from JSON - single source of truth
const jsonPath = join(__dirname, '../../public/shared/tone-system.json');

if (!existsSync(jsonPath)) {
  throw new Error(`Tone system JSON not found at: ${jsonPath}`);
}

let toneSystem;
try {
  toneSystem = JSON.parse(readFileSync(jsonPath, 'utf-8'));
} catch (error) {
  throw new Error(`Failed to parse tone-system.json: ${error.message}`);
}

// Export data from JSON
export const SEVERITY_COLORS = toneSystem.colors;
export const SEVERITY_LABELS = toneSystem.labels;

// Default fallback colors (neutral gray) if level somehow invalid
const DEFAULT_COLORS = { bg: "#f3f4f6", text: "#111827", border: "#9ca3af", emoji: "⚫" };

/**
 * Get severity display info for a content type and level
 * @param {string} contentType - 'pardons' | 'stories' | 'eos' | 'scotus'
 * @param {number} level - 0-5 severity level
 * @returns {{ label: string, colors: object }}
 */
export function getSeverityDisplay(contentType, level) {
  const validLevel = Math.max(0, Math.min(5, Math.round(level || 0)));
  const levelStr = String(validLevel);
  const labels = toneSystem.labels[contentType];

  return {
    label: labels?.[levelStr]?.spicy || `Level ${validLevel}`,
    neutralLabel: labels?.[levelStr]?.neutral || `Level ${validLevel}`,
    colors: toneSystem.colors[levelStr] || DEFAULT_COLORS
  };
}

/**
 * Get the editorial voice for a content type
 * @param {string} contentType - 'pardons' | 'stories' | 'eos' | 'scotus'
 * @returns {{ voice: string, framing: string }}
 */
export function getEditorialVoice(contentType) {
  const labels = toneSystem.labels[contentType];
  return {
    voice: labels?._voice || 'Unknown',
    framing: labels?._framing || ''
  };
}

/**
 * Validate severity level is in range
 * @param {number} level - severity level to validate
 * @returns {number} - clamped 0-5 value
 */
export function clampSeverity(level) {
  return Math.max(0, Math.min(5, Math.round(level || 0)));
}
