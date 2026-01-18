/**
 * Profanity Rules - Node.js wrapper
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
export const PROFANITY_ALLOWED = toneSystem.profanityAllowed;
export const TONE_CALIBRATION = toneSystem.toneCalibration;

/**
 * Check if profanity is allowed at a given severity level
 * @param {number} level - 0-5 severity level
 * @returns {boolean}
 */
export function isProfanityAllowed(level) {
  const validLevel = Math.max(0, Math.min(5, Math.round(level || 0)));
  return toneSystem.profanityAllowed[String(validLevel)] === true;
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
  const validLevel = Math.max(0, Math.min(5, Math.round(level || 0)));
  return toneSystem.toneCalibration[String(validLevel)] || `Level ${validLevel}`;
}
