/**
 * DOJ Pardons Scraper - Ingest from Office of Pardon Attorney
 * ADO-250: Story 1.5 - DOJ Scraper - Pardon Ingestion
 *
 * Scrapes the DOJ clemency grants page and inserts pardons into database.
 * Does NOT perform AI enrichment (that's Feature 2).
 *
 * Usage:
 *   npm run ingest:pardons           # Normal run
 *   npm run ingest:pardons -- --dry-run  # Preview without inserting
 *
 * Source: https://www.justice.gov/pardon/clemency-grants-president-donald-j-trump-2025-present
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { JSDOM } from 'jsdom';
import crypto from 'crypto';
import { pathToFileURL } from 'url';
import { recordSkip, PIPELINES, REASONS } from '../lib/skip-reasons.js';
import { postDiscord, COLORS, summarizeList } from '../lib/discord.js';

// ============================================================================
// Configuration
// ============================================================================

const DOJ_URL = 'https://www.justice.gov/pardon/clemency-grants-president-donald-j-trump-2025-present';
const SOURCE_SYSTEM = 'doj_opa';
const USER_AGENT = 'TrumpyTracker/1.0 (Political Accountability Tracker)';

// Parse CLI args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose') || args.includes('-v');

// ============================================================================
// Supabase Client
// ============================================================================

function getSupabaseClient() {
  // Support both TEST and PROD environments
  // Default to TEST if available (development workflow)
  const supabaseUrl = process.env.SUPABASE_TEST_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase credentials. Set SUPABASE_TEST_URL/SUPABASE_TEST_SERVICE_KEY or SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY');
  }

  const isTest = supabaseUrl.includes('wnrjrywpcadwutfykflu');
  console.log(`🔌 Connecting to ${isTest ? 'TEST' : 'PROD'} database`);

  return createClient(supabaseUrl, supabaseKey);
}

// ============================================================================
// HTML Parsing
// ============================================================================

/**
 * Parse clemency type from header text
 * @param {string} headerText - e.g., "January 21, 2025 - 1 Pardon"
 * @returns {'pardon' | 'commutation' | 'pre_emptive'}
 */
function parseClemencyType(headerText) {
  const lower = headerText.toLowerCase();
  if (lower.includes('commutation')) return 'commutation';
  if (lower.includes('pre-emptive') || lower.includes('preemptive')) return 'pre_emptive';
  return 'pardon';
}

/**
 * Parse date from header text
 * @param {string} headerText - e.g., "January 21, 2025 - 1 Pardon" or "May 28, 2025 - 16 Pardons and 6 Commutations"
 * @returns {string} ISO date string (YYYY-MM-DD)
 */
function parsePardonDate(headerText) {
  // ADO-550: DOJ switched newer section headers from hyphen to en dash
  // ("February 12, 2026 – 7 Pardons") which made every 2026+ section parse to
  // null and get silently skipped. Normalize all unicode dash/space variants
  // BEFORE the count-suffix regex so both markups parse.
  const normalized = headerText
    .replace(/[‐-―−]/g, '-') // hyphen/en/em/horizontal-bar dashes, minus sign
    .replace(/ /g, ' ');
  // Remove count suffix patterns:
  // "- 1 Pardon"
  // "- 2 Commutations"
  // "- 16 Pardons and 6 Commutations"
  // "- 1 Commutation (Amended)"
  // "- 1 Pardon and 2 Commutations"
  let cleaned = normalized
    .replace(/\s*-\s*\d+\s*(pardon|commutation)s?(\s*\(amended\))?(\s+and\s+\d+\s*(pardon|commutation)s?)?/gi, '')
    .trim();

  // Parse the date - handle formats like "January 21, 2025"
  const date = new Date(cleaned);

  if (isNaN(date.getTime())) {
    console.warn(`  ⚠️ Could not parse date from: "${headerText}" (cleaned: "${cleaned}")`);
    return null;
  }

  // Return YYYY-MM-DD format
  return date.toISOString().split('T')[0];
}

/**
 * Generate source_key for deduplication
 * Uses combination of name + date to create unique key
 * @param {string} name
 * @param {string} date
 * @returns {string}
 */
function generateSourceKey(name, date) {
  const input = `${name.toLowerCase().trim()}|${date}`;
  return crypto.createHash('sha256').update(input).digest('hex').substring(0, 16);
}

/**
 * Parse the DOJ clemency page HTML (pure — no network, exported for tests).
 * @param {string} html
 * @returns {{ pardons: Array<Object>, unparsedHeaders: string[], newestPageDate: string|null }}
 */
export function parseDOJHtml(html) {
  const dom = new JSDOM(html);
  const document = dom.window.document;

  const pardons = [];
  // Date-looking h3 headers that failed to parse — each one means a whole
  // section of grants is being dropped (the ADO-550 silent-failure class).
  const unparsedHeaders = [];
  // Newest date among PARSED HEADERS (not parsed rows): if DOJ keeps parseable
  // headers but changes the table row shape, sections yield zero rows — a
  // row-derived date would understate page freshness and mask the tripwire.
  let newestPageDate = null;
  let currentDate = null;
  let currentClemencyType = 'pardon';

  // Find the main content area
  const contentDiv = document.querySelector('.field_body, .field-formatter--text-default');

  if (!contentDiv) {
    throw new Error('Could not find content div on DOJ page - structure may have changed');
  }

  // Iterate through h3 headers and tables
  const elements = contentDiv.querySelectorAll('h3, table, p');

  for (const element of elements) {
    // H3 = Date header
    if (element.tagName === 'H3') {
      const headerText = element.textContent.trim();

      // Skip anchor-only h3 elements
      if (!headerText || headerText.length < 5) continue;

      currentDate = parsePardonDate(headerText);
      currentClemencyType = parseClemencyType(headerText);

      // A header that mentions a year but didn't parse means DOJ changed the
      // markup again and we are about to silently drop its section — track it.
      if (!currentDate && /\b20\d{2}\b/.test(headerText)) {
        unparsedHeaders.push(headerText);
      }

      if (currentDate && currentDate > (newestPageDate || '')) {
        newestPageDate = currentDate;
      }

      if (VERBOSE && currentDate) {
        console.log(`  📅 ${headerText} → Date: ${currentDate}, Type: ${currentClemencyType}`);
      }
    }

    // P with link = Mass pardon proclamation (Jan 6, fake electors)
    if (element.tagName === 'P' && element.querySelector('a')) {
      const link = element.querySelector('a');
      const linkText = link.textContent.trim();
      const linkUrl = link.href;

      // Check if this is a proclamation (mass pardon)
      if (linkText.toLowerCase().includes('granting pardon') ||
          linkText.toLowerCase().includes('2020 presidential election') ||
          linkText.toLowerCase().includes('january 6')) {

        // Create group pardon entry
        const groupPardon = {
          recipient_name: linkText,
          recipient_type: 'group',
          recipient_count: linkText.toLowerCase().includes('january 6') ? 1500 : 77,
          recipient_criteria: linkText,
          pardon_date: currentDate,
          clemency_type: 'pardon',
          primary_source_url: linkUrl.startsWith('http') ? linkUrl : `https://www.justice.gov${linkUrl}`,
          source_system: SOURCE_SYSTEM,
          source_key: generateSourceKey(linkText, currentDate)
        };

        pardons.push(groupPardon);
        if (VERBOSE) {
          console.log(`    👥 Group pardon: ${linkText.substring(0, 50)}...`);
        }
      }
    }

    // TABLE = Individual pardons
    if (element.tagName === 'TABLE' && currentDate) {
      const rows = element.querySelectorAll('tbody tr');

      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 4) continue;

        // Extract data from cells
        const nameCell = cells[0];
        const districtCell = cells[1];
        const sentencedCell = cells[2];
        const offenseCell = cells[3];

        // Get name and warrant URL
        const nameLink = nameCell.querySelector('a');
        const recipientName = (nameLink?.textContent || nameCell.textContent).trim();
        let warrantUrl = nameLink?.getAttribute('href') || null;

        // Fix relative URLs
        if (warrantUrl && !warrantUrl.startsWith('http')) {
          warrantUrl = `https://www.justice.gov${warrantUrl}`;
        }

        // Get other fields
        const district = districtCell.textContent.trim();
        const sentenced = sentencedCell.textContent.trim();
        const offense = offenseCell.textContent.trim();

        // Skip if no name
        if (!recipientName) continue;

        const pardon = {
          recipient_name: recipientName,
          recipient_type: 'person',
          pardon_date: currentDate,
          clemency_type: currentClemencyType,
          conviction_district: district || null,
          original_sentence: sentenced || null,
          offense_raw: offense || null,
          primary_source_url: warrantUrl,
          source_system: SOURCE_SYSTEM,
          source_key: generateSourceKey(recipientName, currentDate),
          // Default values
          status: 'confirmed',
          research_status: 'pending',
          post_pardon_status: 'quiet',
          is_public: false
        };

        pardons.push(pardon);

        if (VERBOSE) {
          console.log(`    👤 ${recipientName} (${district?.substring(0, 20) || 'N/A'})`);
        }
      }
    }
  }

  return { pardons, unparsedHeaders, newestPageDate };
}

/**
 * Fetch and parse the DOJ clemency page
 * @returns {Promise<{ pardons: Array<Object>, unparsedHeaders: string[], newestPageDate: string|null }>}
 */
async function scrapeDOJPage() {
  console.log(`📥 Fetching DOJ clemency page...`);

  const response = await fetch(DOJ_URL, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml'
    }
  });

  if (!response.ok) {
    throw new Error(`DOJ fetch failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  console.log(`✅ Page fetched, parsing HTML...`);

  const result = parseDOJHtml(html);
  console.log(`✅ Parsed ${result.pardons.length} pardons from DOJ page (newest date: ${result.newestPageDate || 'none'})`);
  for (const header of result.unparsedHeaders) {
    console.warn(`  ⚠️ Section header did not parse (its grants were NOT ingested): "${header}"`);
  }
  return result;
}

// ============================================================================
// Database Operations
// ============================================================================

/**
 * Insert pardons into database with deduplication
 * @param {Object} supabase - Supabase client
 * @param {Array} pardons - Pardon objects to insert
 * @returns {Object} Stats about the operation
 */
async function insertPardons(supabase, pardons) {
  const stats = {
    total: pardons.length,
    inserted: 0,
    skipped_duplicate: 0,
    errors: 0,
    inserted_names: []   // ADO-577: for the Discord new-work alert
  };

  console.log(`\n📝 Processing ${pardons.length} pardons...`);

  for (const pardon of pardons) {
    try {
      // Check for existing record using source_system + source_key
      const { data: existing } = await supabase
        .from('pardons')
        .select('id, recipient_name')
        .eq('source_system', pardon.source_system)
        .eq('source_key', pardon.source_key)
        .maybeSingle();

      if (existing) {
        stats.skipped_duplicate++;
        if (VERBOSE) {
          console.log(`  ⏭️ Skip duplicate: ${pardon.recipient_name}`);
        }
        continue;
      }

      // Insert new pardon
      const { data, error } = await supabase
        .from('pardons')
        .insert(pardon)
        .select('id')
        .single();

      if (error) {
        console.error(`  ❌ Error inserting ${pardon.recipient_name}:`, error.message);
        stats.errors++;
        continue;
      }

      stats.inserted++;
      stats.inserted_names.push(pardon.recipient_name);
      console.log(`  ✅ Inserted: ${pardon.recipient_name} (ID: ${data.id})`);

    } catch (err) {
      console.error(`  ❌ Exception for ${pardon.recipient_name}:`, err.message);
      stats.errors++;
    }
  }

  return stats;
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  console.log('═'.repeat(60));
  console.log('DOJ Pardons Scraper - ADO-250');
  console.log('═'.repeat(60));

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No database changes will be made\n');
  }

  try {
    // 1. Scrape DOJ page
    const { pardons, unparsedHeaders, newestPageDate } = await scrapeDOJPage();

    if (pardons.length === 0) {
      console.log('\n⚠️ No pardons found - page structure may have changed');
      process.exit(1);
    }

    // 2. Show summary
    console.log('\n📊 Summary by date:');
    const byDate = {};
    for (const p of pardons) {
      byDate[p.pardon_date] = (byDate[p.pardon_date] || 0) + 1;
    }
    Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([date, count]) => {
        console.log(`  ${date}: ${count} pardons`);
      });

    // 3. Insert into database (unless dry run)
    if (DRY_RUN) {
      console.log('\n🔍 Dry run complete. Would have processed:');
      console.log(`  - ${pardons.filter(p => p.recipient_type === 'person').length} individual pardons`);
      console.log(`  - ${pardons.filter(p => p.recipient_type === 'group').length} group pardons`);

      // Show first 5 as sample
      console.log('\n📝 Sample records:');
      pardons.slice(0, 5).forEach(p => {
        console.log(`  - ${p.recipient_name} (${p.pardon_date}, ${p.clemency_type})`);
      });
    } else {
      const supabase = getSupabaseClient();
      const stats = await insertPardons(supabase, pardons);

      console.log('\n═'.repeat(60));
      console.log('Results:');
      console.log('═'.repeat(60));
      console.log(`  Total processed: ${stats.total}`);
      console.log(`  ✅ Inserted:     ${stats.inserted}`);
      console.log(`  ⏭️ Duplicates:   ${stats.skipped_duplicate}`);
      console.log(`  ❌ Errors:       ${stats.errors}`);

      // ADO-577: new rows alert Discord; zero-new runs stay silent.
      if (stats.inserted > 0) {
        await postDiscord({
          title: `Pardons ingest: ${stats.inserted} new pardon${stats.inserted === 1 ? '' : 's'}`,
          description: `${summarizeList(stats.inserted_names)} - pending enrichment (pardons agent runs 20:00 UTC daily).`,
          color: COLORS.info,
        });
      }

      // ADO-550 staleness tripwire: this scraper ran green for 6 months while
      // silently dropping every new section. Fail loudly on either signal so
      // the workflow goes red (and Discord-alerts) instead.
      const tripwires = [];

      if (unparsedHeaders.length > 0) {
        tripwires.push(`${unparsedHeaders.length} date-like section header(s) failed to parse: ${unparsedHeaders.join(' | ')}`);
        await recordSkip(supabase, {
          pipeline: PIPELINES.PARDONS_INGEST,
          reason: REASONS.PARSE_ERROR,
          entity_type: 'doj_page_section',
          metadata: { unparsed_headers: unparsedHeaders },
        });
      }

      if (stats.inserted === 0 && newestPageDate) {
        const { data: newestRows, error: newestErr } = await supabase
          .from('pardons')
          .select('pardon_date')
          .eq('source_system', SOURCE_SYSTEM)
          .not('pardon_date', 'is', null)
          .order('pardon_date', { ascending: false })
          .limit(1);

        if (newestErr) {
          console.warn(`  ⚠️ Staleness check query failed (non-blocking): ${newestErr.message}`);
        } else {
          const newestDbDate = newestRows?.[0]?.pardon_date || null;
          if (!newestDbDate || newestPageDate > newestDbDate) {
            tripwires.push(`inserted 0 but DOJ page has newer grants (page: ${newestPageDate}, db: ${newestDbDate || 'none'})`);
            await recordSkip(supabase, {
              pipeline: PIPELINES.PARDONS_INGEST,
              reason: REASONS.STALENESS_TRIPWIRE,
              entity_type: 'doj_page',
              metadata: { newest_page_date: newestPageDate, newest_db_date: newestDbDate, inserted: stats.inserted },
            });
          }
        }
      }

      if (tripwires.length > 0) {
        console.error('\n🚨 STALENESS TRIPWIRE — failing the run:');
        tripwires.forEach(t => console.error(`  - ${t}`));
        process.exit(1);
      }
    }

    console.log('\n✅ DOJ scraper complete!');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Scraper failed:', error.message);
    if (VERBOSE) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run only when executed directly (parseDOJHtml is imported by unit tests)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
