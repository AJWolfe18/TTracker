/**
 * Backfill dissent_authors from opinion text (ADO-394)
 *
 * Problem: CourtListener metadata has dissent_authors=[] for cases with real dissents.
 * Two sources of dissent info in opinion_full_text:
 *   1. Canonical headers: === DISSENT (Justice Name) === (from buildCanonicalOpinionText)
 *   2. Raw SCOTUS syllabus: "NAME, J., filed a dissenting opinion, in which NAME2, J., joined"
 *
 * SCOTUS opinions have hyphenated line breaks (e.g., "JACK-\nSON") which must be rejoined.
 *
 * This script:
 * 1. Queries scotus_opinions.opinion_full_text for all cases
 * 2. Parses both canonical headers AND raw SCOTUS dissent attribution patterns
 * 3. Merges with existing dissent_authors (union, no duplicates)
 * 4. Updates scotus_cases.dissent_authors + dissent_exists
 *
 * Usage:
 *   node scripts/scotus/backfill-dissent-authors.js              # Dry run (default)
 *   node scripts/scotus/backfill-dissent-authors.js --apply       # Apply changes
 *   node scripts/scotus/backfill-dissent-authors.js --case-ids=120,133  # Specific cases only
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// ============================================================================
// CONFIG
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_TEST_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_TEST_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_TEST_URL or SUPABASE_TEST_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================================
// CORE LOGIC
// ============================================================================

/**
 * Rejoin hyphenated line breaks common in SCOTUS opinion text.
 * "JACK-\nSON" → "JACKSON", "dis-\nsenting" → "dissenting"
 */
function rejoinHyphens(text) {
  return text.replace(/([A-Za-z])-\s*\n\s*([A-Za-z])/g, '$1$2');
}

/**
 * Normalize a justice name to title case: "JACKSON" → "Jackson"
 */
function titleCase(name) {
  if (!name) return name;
  return name.replace(/\b\w+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/**
 * Parse dissent author names from opinion_full_text.
 * Handles two sources:
 *   1. Canonical headers: === DISSENT (Jackson) ===
 *   2. Raw SCOTUS text: "NAME, J., filed a dissenting opinion, in which NAME2, J., joined"
 *
 * @param {string} rawText - Full canonical opinion text
 * @returns {string[]} Array of unique author names (title-cased)
 */
function parseDissentAuthors(rawText) {
  if (!rawText) return [];

  const authors = new Set();

  // Source 1: Canonical headers (from buildCanonicalOpinionText)
  const headerRe = /===\s*DISSENT\s*\(([^)]+)\)\s*===/g;
  let match;
  while ((match = headerRe.exec(rawText)) !== null) {
    let name = match[1].trim().replace(/,?\s*J\.?\s*$/, '').trim();
    if (name.toLowerCase() !== 'unknown' && name) {
      authors.add(titleCase(name));
    }
  }

  // Source 2: Raw SCOTUS opinion text patterns (first 15K chars = syllabus + header area)
  // Must rejoin hyphenated line breaks first (e.g., "JACK-\nSON" → "JACKSON")
  const cleaned = rejoinHyphens(rawText.slice(0, 15000));

  // Pattern A: "NAME, J., filed a dissenting opinion"
  const filedRe = /([A-Z][A-Z]+),\s*(?:C\.\s*)?J\.?,?\s*filed\s+a\s+dissenting\s+opinion/g;
  while ((match = filedRe.exec(cleaned)) !== null) {
    authors.add(titleCase(match[1]));
  }

  // Pattern B: "in which NAME, J., joined" or "in which NAME, J., and NAME2, J., joined"
  // Only capture after "dissenting opinion" context
  const joinedRe = /dissenting\s+opinion,?\s*in\s+which\s+((?:[A-Z][A-Z]+,\s*(?:C\.\s*)?J\.?,?\s*(?:and\s+)?)+)/g;
  while ((match = joinedRe.exec(cleaned)) !== null) {
    const joiners = match[1];
    const nameRe = /([A-Z][A-Z]+),\s*(?:C\.\s*)?J\./g;
    let nameMatch;
    while ((nameMatch = nameRe.exec(joiners)) !== null) {
      authors.add(titleCase(nameMatch[1]));
    }
  }

  // Pattern C: "NAME, J., dissenting" (standalone, e.g., in per curiam opinions)
  const standaloneRe = /([A-Z][A-Z]+),\s*(?:C\.\s*)?J\.?,?\s*dissenting(?!\s+opinion)/g;
  while ((match = standaloneRe.exec(cleaned)) !== null) {
    authors.add(titleCase(match[1]));
  }

  return [...authors];
}

/**
 * Merge two arrays of author names (union, case-insensitive dedup by last name)
 */
function mergeAuthors(existing, parsed) {
  const merged = [...(existing || [])];
  const lowerNames = merged.map(n => n.toLowerCase());

  for (const name of parsed) {
    if (!lowerNames.includes(name.toLowerCase())) {
      merged.push(name);
      lowerNames.push(name.toLowerCase());
    }
  }

  return merged;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const caseIdsArg = args.find(a => a.startsWith('--case-ids='));
  const caseIds = caseIdsArg
    ? caseIdsArg.split('=')[1].split(',').map(Number).filter(n => Number.isFinite(n))
    : null;

  console.log(`\n📋 Dissent Authors Backfill (ADO-394)`);
  console.log(`   Mode: ${apply ? '🔴 APPLY (writing to DB)' : '🟡 DRY RUN (no writes)'}`);
  if (caseIds) console.log(`   Scope: ${caseIds.length} specific cases: [${caseIds.join(', ')}]`);
  console.log('');

  // Fetch all cases with their opinion text
  let query = supabase
    .from('scotus_cases')
    .select('id, case_name, dissent_authors, dissent_exists, scotus_opinions!left(opinion_full_text)')
    .order('id', { ascending: true });

  if (caseIds) {
    query = query.in('id', caseIds);
  }

  const { data: cases, error } = await query;

  if (error) {
    console.error('Failed to fetch cases:', error.message);
    process.exit(1);
  }

  console.log(`   Found ${cases.length} cases to check\n`);

  let updated = 0;
  let skipped = 0;
  let noOpinion = 0;

  for (const row of cases) {
    // Flatten joined opinion text
    const joined = row.scotus_opinions;
    const opinionText = Array.isArray(joined)
      ? joined[0]?.opinion_full_text
      : joined?.opinion_full_text;

    if (!opinionText) {
      noOpinion++;
      continue;
    }

    const parsedAuthors = parseDissentAuthors(opinionText);
    const existingAuthors = Array.isArray(row.dissent_authors) ? row.dissent_authors : [];
    const merged = mergeAuthors(existingAuthors, parsedAuthors);

    // Check if anything changed
    const existingSet = new Set(existingAuthors.map(n => n.toLowerCase()));
    const mergedSet = new Set(merged.map(n => n.toLowerCase()));
    const hasNewAuthors = mergedSet.size > existingSet.size;

    if (!hasNewAuthors) {
      skipped++;
      continue;
    }

    const newDissents = merged.filter(n => !existingSet.has(n.toLowerCase()));
    const newDissentExists = merged.length > 0;

    console.log(`   ✅ Case ${row.id} (${row.case_name}):`);
    console.log(`      Before: dissent_authors=[${existingAuthors.join(', ')}], dissent_exists=${row.dissent_exists}`);
    console.log(`      After:  dissent_authors=[${merged.join(', ')}], dissent_exists=${newDissentExists}`);
    console.log(`      New:    +[${newDissents.join(', ')}]`);

    if (apply) {
      const { error: updateErr } = await supabase
        .from('scotus_cases')
        .update({
          dissent_authors: merged,
          dissent_exists: newDissentExists,
        })
        .eq('id', row.id);

      if (updateErr) {
        console.log(`      ❌ Update failed: ${updateErr.message}`);
      } else {
        console.log(`      💾 Written to DB`);
      }
    }

    updated++;
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Cases checked: ${cases.length}`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Skipped (no change): ${skipped}`);
  console.log(`   No opinion text: ${noOpinion}`);

  if (!apply && updated > 0) {
    console.log(`\n   ⚠️  DRY RUN — re-run with --apply to write changes`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
