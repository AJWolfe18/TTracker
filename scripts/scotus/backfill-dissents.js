/**
 * Backfill dissent_authors from opinion_excerpt text (ADO-429)
 *
 * SCOTUS opinions have a standardized attribution block in the syllabus/excerpt:
 *   "THOMAS, J., filed a dissenting opinion, in which ALITO, J., joined."
 *   "SOTOMAYOR, J., dissented."
 *
 * This script parses that block to fill in missing dissent_authors.
 *
 * Usage:
 *   node scripts/scotus/backfill-dissents.js              # Preview changes (dry run)
 *   node scripts/scotus/backfill-dissents.js --apply       # Apply to DB
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_TEST_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const applyChanges = process.argv.includes('--apply');

// Map SCOTUS justice last names to standard display names
const JUSTICE_NAMES = {
  'ROBERTS': 'John Roberts',
  'THOMAS': 'Clarence Thomas',
  'ALITO': 'Samuel Alito',
  'SOTOMAYOR': 'Sonia Sotomayor',
  'KAGAN': 'Elena Kagan',
  'GORSUCH': 'Neil Gorsuch',
  'KAVANAUGH': 'Brett Kavanaugh',
  'BARRETT': 'Amy Coney Barrett',
  'JACKSON': 'Ketanji Brown Jackson',
  // Retired justices (for older terms)
  'BREYER': 'Stephen Breyer',
  'GINSBURG': 'Ruth Bader Ginsburg',
  'KENNEDY': 'Anthony Kennedy',
  'SCALIA': 'Antonin Scalia',
};

/**
 * Extract dissent authors from the attribution block in opinion text.
 * Handles various SCOTUS patterns including:
 *   "Thomas, J., filed a dissenting opinion, in which Alito and Gorsuch, JJ., joined"
 *   "Sotomayor, J., dissented"
 *   "BARRETT, J., filed an opinion dissenting in part"
 *   "THOMAS, J., and ALITO, J., each filed dissenting opinions"
 *   "Kavanaugh, J., dissenting" (section header)
 * Note: OCR sometimes renders "filed" as "fled"
 */
function extractDissentAuthors(text) {
  if (!text) return [];

  // IMPORTANT: Only parse the ATTRIBUTION BLOCK, not the full opinion body.
  // The attribution block starts with "NAME, J., delivered the opinion"
  // and ends before "Opinion of the Court" or "NOTICE: This opinion"
  // This avoids false positives from lower court dissent discussions.
  const attrStart = text.search(/[A-Z]+,\s*(?:C\.\s*)?J\.\s*,?\s*delivered\s+the\s+opinion/i);
  const attrEnd = text.indexOf('Opinion of the Court', attrStart > -1 ? attrStart : 0);
  const block = attrStart > -1
    ? text.substring(attrStart, attrEnd > attrStart ? attrEnd : attrStart + 1200)
    : '';

  if (!block) return [];

  // Normalize: rejoin hyphenated words across line breaks, then collapse whitespace
  const normalized = block.replace(/-\s*\n\s*/g, '').replace(/\n\s*/g, ' ');
  const authors = new Set();

  function addJustice(name) {
    const upper = name.toUpperCase().trim();
    if (JUSTICE_NAMES[upper]) {
      authors.add(JUSTICE_NAMES[upper]);
    }
  }

  // Extract joiners from "in which X, Y, and Z, JJ., joined" or "in which X, J., joined"
  function extractJoiners(afterText) {
    const joinerMatch = afterText.match(/in\s+which\s+(.+?)(?:JJ\.|J\.)\s*,?\s*joined/i);
    if (joinerMatch) {
      const joinerStr = joinerMatch[1];
      const names = joinerStr.match(/([A-Z][a-z]+)/gi) || [];
      for (const n of names) {
        if (n.toLowerCase() !== 'and' && n.toLowerCase() !== 'in' && n.toLowerCase() !== 'which') {
          addJustice(n);
        }
      }
    }
  }

  // Split attribution block into clauses (separated by ". " or period before uppercase)
  // Then only parse clauses containing "dissent" to avoid concurrence false positives
  const clauses = normalized.split(/\.\s+(?=[A-Z])/).filter(c => /dissent/i.test(c));

  for (const clause of clauses) {
    // Extract ALL justice names mentioned in this dissent clause
    const justicePattern = /([A-Za-z]+),\s*(?:C\.\s*)?J(?:J)?\./gi;
    let match;
    while ((match = justicePattern.exec(clause)) !== null) {
      addJustice(match[1]);
    }

    // Also extract joiners from "in which X, Y, and Z, JJ., joined"
    extractJoiners(clause);
  }

  return [...authors];
}

async function main() {
  console.log(`🔍 Backfill Dissent Authors from Opinion Text`);
  console.log(`Mode: ${applyChanges ? 'APPLY' : 'DRY RUN (use --apply to write)'}\n`);

  // Fetch cases with empty dissent_authors that have opinion text
  const { data: cases, error } = await supabase
    .from('scotus_cases')
    .select('id, case_name, dissent_authors, opinion_excerpt, syllabus')
    .filter('dissent_authors', 'eq', '{}')
    .not('opinion_excerpt', 'is', null)
    .order('id', { ascending: true });

  if (error) {
    console.error('❌ Query error:', error.message);
    process.exit(1);
  }

  console.log(`📋 Found ${cases.length} cases with empty dissent_authors\n`);

  let updated = 0;
  let noChange = 0;
  const results = [];

  for (const c of cases) {
    // Try opinion_excerpt first (has the full attribution block), then syllabus
    const text = (c.opinion_excerpt || '') + '\n' + (c.syllabus || '');
    const dissents = extractDissentAuthors(text);

    if (dissents.length > 0) {
      console.log(`✅ ${c.case_name} (${c.id}): ${dissents.join(', ')}`);
      results.push({ id: c.id, case_name: c.case_name, dissent_authors: dissents });

      if (applyChanges) {
        const { error: updateError } = await supabase
          .from('scotus_cases')
          .update({ dissent_authors: dissents })
          .eq('id', c.id);

        if (updateError) {
          console.error(`   ❌ Update failed: ${updateError.message}`);
        } else {
          updated++;
        }
      } else {
        updated++;
      }
    } else {
      noChange++;
    }
  }

  console.log(`\n📊 Summary`);
  console.log(`   Found dissents: ${updated}`);
  console.log(`   No dissent found (likely unanimous): ${noChange}`);
  console.log(`   Total processed: ${cases.length}`);

  if (!applyChanges && updated > 0) {
    console.log(`\n💡 Run with --apply to write changes to database`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
