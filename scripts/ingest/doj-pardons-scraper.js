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
import zlib from 'zlib';
import { pathToFileURL } from 'url';
import { recordSkip, PIPELINES, REASONS } from '../lib/skip-reasons.js';
import { postDiscord, COLORS, summarizeList } from '../lib/discord.js';

// ============================================================================
// Configuration
// ============================================================================

const DOJ_URL = 'https://www.justice.gov/pardon/clemency-grants-president-donald-j-trump-2025-present';
const SOURCE_SYSTEM = 'doj_opa';
const USER_AGENT = 'TrumpyTracker/1.0 (Political Accountability Tracker)';
const WARRANT_FETCH_TIMEOUT_MS = 15000;

// Progress lines for code added after AGENTS.md banned console.log in production code
const out = (line) => process.stdout.write(`${line}\n`);

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
 * ADO-590: DOJ can put both types in ONE table under a heading like
 * "September 3, 2026 - 23 Pardons and 6 Commutations". The heading cannot
 * type those rows; each row's warrant has to.
 * @param {string} headerText
 * @returns {boolean}
 */
function headingNamesBothTypes(headerText) {
  return /pardon/i.test(headerText) && /commutation/i.test(headerText);
}

/**
 * Clemency type named by a warrant label: the page link's title attribute
 * ("2026-09-03_Commutation_Warrant_Bloom", "Pardon Warrant - Mark Bashaw_signed 5.28.25"),
 * the PDF Title metadata ("2025-05-28 Pardon KEVIN ERIC BAISDEN") or the PDF filename.
 * @param {string|null|undefined} text
 * @returns {'pardon' | 'commutation' | null} null when the text names neither type or both
 */
export function clemencyTypeFromWarrantText(text) {
  if (!text) return null;
  const named = new Set();
  // Letter lookarounds instead of \b: "_Pardon_Warrant" has underscores, which \b treats as word characters
  for (const m of String(text).matchAll(/(?<![a-z])(pardon|commutation)(?![a-z])/gi)) {
    named.add(m[1].toLowerCase());
  }
  return named.size === 1 ? [...named][0] : null;
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
 *
 * ADO-590: a row under a heading that names both types gets its type from its
 * warrant link's title attribute. If that does not name exactly one type, the
 * row comes back with clemency_type = null, and the caller must resolve it with
 * typeRowFromWarrant() before inserting. (The column is NOT NULL, so a caller
 * that forgets gets a failed insert, never a silently wrong type.)
 *
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
  let currentHeadingMixed = false;

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
      currentHeadingMixed = headingNamesBothTypes(headerText);

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

        // ADO-590: never type a mixed section's rows from its heading
        const clemencyType = currentHeadingMixed
          ? clemencyTypeFromWarrantText(nameLink?.getAttribute('title'))
          : currentClemencyType;

        const pardon = {
          recipient_name: recipientName,
          recipient_type: 'person',
          pardon_date: currentDate,
          clemency_type: clemencyType,
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
          if (currentHeadingMixed) out(`       type: ${clemencyType || 'not in link title, read from warrant PDF'}`);
        }
      }
    }
  }

  return { pardons, unparsedHeaders, newestPageDate };
}

// ============================================================================
// Warrant type resolution (ADO-590)
// ============================================================================
// Warrant PDFs are scans (HP Scan + Acrobat). The type sits in the document
// Title ("2026-09-03 Commutation Warrant Molly Ann Bloom") and in the download
// filename. Some have no Title and keep their Info dictionary inside a
// compressed object stream, so both places are checked.

/**
 * Read the PDF string (literal or hex) that starts at s[i]. s is the file as latin1.
 * @returns {Buffer|null}
 */
function readPdfString(s, i) {
  if (s[i] === '<') {
    const end = s.indexOf('>', i);
    if (end < 0) return null;
    const hex = s.slice(i + 1, end).replace(/\s+/g, '');
    return Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex');
  }
  if (s[i] !== '(') return null;
  const escapes = { n: 10, r: 13, t: 9, b: 8, f: 12 };
  const bytes = [];
  let depth = 1;
  for (let k = i + 1; k < s.length; k++) {
    const c = s[k];
    if (c === '\\') {
      const n = s[++k];
      if (n === undefined) break;
      if (n in escapes) {
        bytes.push(escapes[n]);
      } else if (n >= '0' && n <= '7') {
        let oct = n;
        while (oct.length < 3 && s[k + 1] >= '0' && s[k + 1] <= '7') oct += s[++k];
        bytes.push(parseInt(oct, 8) & 0xff);
      } else if (n === '\r') {
        if (s[k + 1] === '\n') k++; // escaped line break = continuation
      } else if (n !== '\n') {
        bytes.push(n.charCodeAt(0) & 0xff);
      }
      continue;
    }
    if (c === '(') depth++;
    if (c === ')' && --depth === 0) return Buffer.from(bytes);
    bytes.push(c.charCodeAt(0) & 0xff);
  }
  return null;
}

/** PDF text string bytes → JS string (UTF-16BE with BOM, UTF-8 with BOM, else PDFDocEncoding ≈ latin1). */
function decodePdfText(buf) {
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const body = Buffer.from(buf.subarray(2, 2 + ((buf.length - 2) & ~1)));
    return body.swap16().toString('utf16le');
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString('utf8');
  }
  return buf.toString('latin1');
}

/** Body of object `num` stored directly in the file; the last definition wins (incremental saves append). */
function findDirectObject(s, num) {
  const matches = [...s.matchAll(new RegExp(`(?:^|[^0-9])${num}\\s+\\d+\\s+obj\\b([\\s\\S]*?)endobj`, 'g'))];
  return matches.length ? matches[matches.length - 1][1] : null;
}

/** Body of object `num` stored inside a compressed object stream (/Type /ObjStm). */
function findInObjectStreams(buf, s, num) {
  let from = 0;
  for (;;) {
    const k = s.indexOf('stream', from);
    if (k < 0) return null;
    from = k + 6;
    if (s.slice(k - 3, k) === 'end') continue;
    const dict = s.slice(s.lastIndexOf('obj', k), k);
    if (!/\/Type\s*\/ObjStm/.test(dict)) continue;
    let start = k + 6;
    if (s[start] === '\r') start++;
    if (s[start] === '\n') start++;
    const end = s.indexOf('endstream', start);
    if (end < 0) return null;
    const first = Number(dict.match(/\/First\s+(\d+)/)?.[1]);
    if (!Number.isFinite(first)) continue;
    let body;
    try {
      body = zlib.inflateSync(buf.subarray(start, end)).toString('latin1');
    } catch {
      continue; // not Flate-compressed or damaged: this stream can't hold a readable Info
    }
    const header = body.slice(0, first).trim().split(/\s+/);
    for (let h = 0; h + 1 < header.length; h += 2) {
      if (header[h] !== String(num)) continue;
      const next = h + 3 < header.length ? first + Number(header[h + 3]) : body.length;
      return body.slice(first + Number(header[h + 1]), next);
    }
  }
}

/**
 * Document title of a PDF: the Info dictionary's /Title, else the XMP dc:title.
 * @param {Buffer} buf
 * @returns {string|null}
 */
export function extractPdfTitle(buf) {
  const s = buf.toString('latin1');
  const infoRefs = [...s.matchAll(/\/Info\s+(\d+)\s+\d+\s+R/g)];
  const infoNum = infoRefs.length ? infoRefs[infoRefs.length - 1][1] : null;
  const info = infoNum ? (findDirectObject(s, infoNum) ?? findInObjectStreams(buf, s, infoNum)) : null;
  if (info) {
    const m = /\/Title\s*(?=[(<])/.exec(info);
    const raw = m ? readPdfString(info, m.index + m[0].length) : null;
    const title = raw ? decodePdfText(raw).trim() : '';
    if (title) return title;
  }
  const xmp = s.match(/<dc:title>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/);
  if (xmp) {
    const title = Buffer.from(xmp[1], 'latin1').toString('utf8')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&amp;/g, '&')
      .trim();
    if (title) return title;
  }
  return null;
}

/** Filename from a Content-Disposition header (filename*= or filename=). */
function contentDispositionFilename(header) {
  if (!header) return null;
  const star = header.match(/filename\*\s*=\s*(?:[\w-]+'[^']*')?([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      // malformed percent-encoding: fall through to the plain filename
    }
  }
  const plain = header.match(/filename\s*=\s*(?:"([^"]*)"|([^;]+))/i);
  return plain ? (plain[1] ?? plain[2]).trim() : null;
}

/**
 * Clemency type named by a warrant PDF (Title metadata first, then the download filename).
 * @param {string|null} url - warrant URL (/pardon/media/<id>/dl?inline)
 * @param {{ fetchImpl?: typeof fetch }} [opts] - fetchImpl is injectable for tests
 * @returns {Promise<{ type: 'pardon'|'commutation'|null, detail: string, retryable: boolean }>}
 *   retryable = the warrant could not be read this time (network, timeout, HTTP error, not a PDF)
 */
export async function resolveWarrantClemencyType(url, { fetchImpl = fetch } = {}) {
  if (!url) return { type: null, detail: 'row has no warrant link', retryable: false };

  let res;
  let buf;
  try {
    res = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/pdf' },
      signal: AbortSignal.timeout(WARRANT_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { type: null, detail: `warrant fetch HTTP ${res.status}`, retryable: true };
    buf = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    return { type: null, detail: `warrant fetch failed: ${err.message}`, retryable: true };
  }
  // A bot-check or error page served with 200 is not a warrant
  if (buf.subarray(0, 1024).indexOf('%PDF-') < 0) {
    return { type: null, detail: `warrant response is not a PDF (${res.headers.get('content-type') || 'no content-type'})`, retryable: true };
  }

  const filename = contentDispositionFilename(res.headers.get('content-disposition'));
  const pdfTitle = extractPdfTitle(buf);
  const fromTitle = clemencyTypeFromWarrantText(pdfTitle);
  const fromFilename = clemencyTypeFromWarrantText(filename);
  if (fromTitle && fromFilename && fromTitle !== fromFilename) {
    return { type: null, detail: `PDF Title "${pdfTitle}" and filename "${filename}" disagree`, retryable: false };
  }
  if (fromTitle) return { type: fromTitle, detail: `PDF Title "${pdfTitle}"`, retryable: false };
  if (fromFilename) return { type: fromFilename, detail: `PDF filename "${filename}"`, retryable: false };
  return {
    type: null,
    detail: `no type in PDF Title (${pdfTitle ?? 'none'}) or filename (${filename ?? 'none'})`,
    retryable: false,
  };
}

/**
 * Type a mixed-section row that parseDOJHtml left untyped (clemency_type null)
 * from its warrant PDF.
 * - 'typed': the warrant named the type.
 * - 'fallback': the warrant was read but names no type (or has no link); the row
 *   is set to 'pardon' and the caller must recordSkip (ADO-466).
 * - 'retry': the warrant could not be read this run; clemency_type stays null and
 *   the caller must NOT insert the row. Inserting a guess would be permanent,
 *   because later runs skip existing rows at the duplicate check.
 * @param {Object} pardon - mutated: clemency_type is set unless the outcome is 'retry'
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ outcome: 'typed'|'fallback'|'retry', detail: string }>}
 */
export async function typeRowFromWarrant(pardon, opts) {
  const { type, detail, retryable } = await resolveWarrantClemencyType(pardon.primary_source_url, opts);
  if (type) {
    pardon.clemency_type = type;
    return { outcome: 'typed', detail };
  }
  if (retryable) return { outcome: 'retry', detail };
  pardon.clemency_type = 'pardon';
  return { outcome: 'fallback', detail };
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
 * @param {{ fetchImpl?: typeof fetch }} [opts] - warrant fetch, injectable for tests
 * @returns {Object} Stats about the operation
 */
export async function insertPardons(supabase, pardons, opts) {
  const stats = {
    total: pardons.length,
    inserted: 0,
    skipped_duplicate: 0,
    errors: 0,
    type_fallbacks: 0,   // ADO-590: mixed-section rows inserted as 'pardon' because the warrant named no type
    type_retries: 0,     // ADO-590: mixed-section rows held back because their warrant could not be read
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

      // ADO-590: a mixed-section row its link title could not type. Only new
      // rows get here, so existing rows never cost a warrant fetch.
      let typeFallback = null;
      if (pardon.clemency_type === null) {
        const { outcome, detail } = await typeRowFromWarrant(pardon, opts);
        if (outcome === 'retry') {
          stats.type_retries++;
          console.warn(`  ⚠️ ${pardon.recipient_name}: warrant unreadable, not inserted, next run retries (${detail})`);
          await recordSkip(supabase, {
            pipeline: PIPELINES.PARDONS_INGEST,
            reason: REASONS.API_ERROR,
            entity_type: 'pardon',
            metadata: {
              recipient_name: pardon.recipient_name,
              pardon_date: pardon.pardon_date,
              source_key: pardon.source_key,
              warrant_url: pardon.primary_source_url,
              detail,
            },
          });
          continue;
        }
        if (outcome === 'fallback') {
          typeFallback = detail;
          console.warn(`  ⚠️ ${pardon.recipient_name}: warrant names no clemency type, inserting as 'pardon' (${detail})`);
        }
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

      if (typeFallback) {
        stats.type_fallbacks++;
        await recordSkip(supabase, {
          pipeline: PIPELINES.PARDONS_INGEST,
          reason: REASONS.CLEMENCY_TYPE_UNKNOWN,
          entity_type: 'pardon',
          entity_id: data.id,
          metadata: {
            recipient_name: pardon.recipient_name,
            pardon_date: pardon.pardon_date,
            warrant_url: pardon.primary_source_url,
            inserted_as: pardon.clemency_type,
            detail: typeFallback,
          },
        });
      }

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

    // ADO-590: a dry run types every row the link titles could not, so its
    // summary shows the real split. A normal run fetches warrants for new rows only.
    if (DRY_RUN) {
      for (const p of pardons.filter(row => row.clemency_type === null)) {
        const { outcome, detail } = await typeRowFromWarrant(p);
        if (outcome === 'fallback') out(`  ⚠️ Would insert ${p.recipient_name} as 'pardon' and flag it: ${detail}`);
        if (outcome === 'retry') out(`  ⚠️ Would hold ${p.recipient_name} for the next run: ${detail}`);
      }
    }

    // 2. Show summary (rows still untyped are typed from their warrant at insert)
    out('\n📊 Summary by date:');
    const byDate = {};
    for (const p of pardons) {
      const types = (byDate[p.pardon_date] ||= {});
      const type = p.clemency_type || 'untyped';
      types[type] = (types[type] || 0) + 1;
    }
    Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([date, types]) => {
        out(`  ${date}: ${Object.entries(types).map(([type, n]) => `${n} ${type}`).join(', ')}`);
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
      if (stats.type_fallbacks > 0) {
        out(`  ⚠️ Typed 'pardon' by default: ${stats.type_fallbacks} (warrant named no type, see admin Skips tab)`);
      }
      if (stats.type_retries > 0) {
        out(`  ⚠️ Held for next run: ${stats.type_retries} (warrant could not be read, see admin Skips tab)`);
      }

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
