/**
 * Shared utilities for SCOTUS opinion processing
 *
 * Used by:
 * - fetch-cases.js (new case ingestion)
 * - backfill-opinions.js (backfilling existing v1 cases)
 */

import crypto from 'crypto';

/**
 * Compute sha256 hex hash of text
 * Used to detect content changes and skip no-op writes
 */
export function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Upsert opinion only if content changed (hash mismatch)
 * Prevents wasted DB writes during backfill/retries
 *
 * @param {Object} supabase - Supabase client
 * @param {string} caseId - UUID of the case
 * @param {string} canonicalText - Full canonical opinion text
 * @returns {{ changed: boolean, content_hash: string, error?: string }}
 */
export async function upsertOpinionIfChanged(supabase, caseId, canonicalText) {
  const content_hash = sha256Hex(canonicalText);

  // Check existing hash
  const { data: existing, error: readErr } = await supabase
    .from('scotus_opinions')
    .select('content_hash')
    .eq('case_id', caseId)
    .maybeSingle();

  if (readErr) {
    return { changed: false, content_hash, error: readErr.message };
  }

  // Skip if unchanged
  if (existing?.content_hash === content_hash) {
    return { changed: false, content_hash };
  }

  // Upsert with new content
  const { error: upsertErr } = await supabase
    .from('scotus_opinions')
    .upsert({
      case_id: caseId,
      opinion_full_text: canonicalText,
      content_hash,
      updated_at: new Date().toISOString()
    }, { onConflict: 'case_id' });

  if (upsertErr) {
    return { changed: false, content_hash, error: upsertErr.message };
  }

  return { changed: true, content_hash };
}

/**
 * Build canonical opinion text from all opinion documents
 * Order: MAJORITY/LEAD -> CONCURRENCES -> DISSENTS -> UNKNOWN
 * Adds section headers for GPT parsing
 *
 * ROBUST HANDLING:
 * - Includes ALL majority/lead docs (not just first)
 * - Logs unknown opinion types for future tuning
 * - Handles missing type values gracefully
 *
 * @param {Array} opinions - Array of opinion objects from CourtListener
 * @returns {string|null} Concatenated text with section headers
 */
export function buildCanonicalOpinionText(opinions) {
  if (!opinions || opinions.length === 0) return null;

  const sections = [];
  const unknownTypes = [];
  const processed = new Set();  // Track processed opinion IDs to avoid dupes

  // Category patterns (order matters for classification)
  const MAJORITY_PATTERN = /majority|lead|per.?curiam|combined|opinion.of.the.court/i;
  const CONCUR_PATTERN = /concur/i;
  const DISSENT_PATTERN = /dissent/i;
  const STATEMENT_PATTERN = /statement/i;  // "statement of X" - treat as concurrence-like

  // 1. ALL Majority/Lead/Per Curiam opinions (not just first)
  const majorities = opinions.filter(o =>
    MAJORITY_PATTERN.test(o.type || '') && !DISSENT_PATTERN.test(o.type || '')
  );
  for (const op of majorities) {
    if (op.plain_text) {
      const author = op.author_str || '';
      const label = author ? `MAJORITY OPINION (${author})` : 'MAJORITY OPINION';
      sections.push(`=== ${label} ===\n${op.plain_text}`);
      processed.add(op.id);
    }
  }

  // 2. Concurrences (including "statement of")
  const concurrences = opinions.filter(o => {
    const type = o.type || '';
    return (CONCUR_PATTERN.test(type) || STATEMENT_PATTERN.test(type))
      && !DISSENT_PATTERN.test(type)
      && !processed.has(o.id);
  });
  for (const op of concurrences) {
    if (op.plain_text) {
      const author = op.author_str || 'Unknown';
      sections.push(`=== CONCURRENCE (${author}) ===\n${op.plain_text}`);
      processed.add(op.id);
    }
  }

  // 3. Dissents last (critical for Pass 1 dissent extraction)
  const dissents = opinions.filter(o =>
    DISSENT_PATTERN.test(o.type || '') && !processed.has(o.id)
  );
  for (const op of dissents) {
    if (op.plain_text) {
      const author = op.author_str || 'Unknown';
      sections.push(`=== DISSENT (${author}) ===\n${op.plain_text}`);
      processed.add(op.id);
    }
  }

  // 4. Handle unclassified opinions (log for future tuning)
  const unprocessed = opinions.filter(o => !processed.has(o.id) && o.plain_text);
  for (const op of unprocessed) {
    const type = op.type || 'null';
    unknownTypes.push(type);
    const author = op.author_str || 'Unknown';
    sections.push(`=== OTHER (${author}, type: ${type}) ===\n${op.plain_text}`);
  }

  // Log unknown types for debugging/tuning
  if (unknownTypes.length > 0) {
    console.log(`   [CANONICAL] Unknown opinion types encountered: ${unknownTypes.join(', ')}`);
  }

  // Fallback: if somehow nothing matched, use all opinions in order
  if (sections.length === 0) {
    for (const op of opinions) {
      if (op.plain_text) {
        sections.push(op.plain_text);
      }
    }
  }

  return sections.join('\n\n') || null;
}
