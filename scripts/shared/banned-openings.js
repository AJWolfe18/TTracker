/**
 * Banned Openings - Node.js wrapper
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
export const BANNED_OPENINGS = toneSystem.bannedOpenings;

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

  for (const banned of toneSystem.bannedOpenings) {
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
  return toneSystem.bannedOpenings.map(b => `- "${b}"`).join('\n');
}
