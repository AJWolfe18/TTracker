/**
 * SCOTUSblog Search + Scrape Module (ADO-429)
 *
 * Searches SCOTUSblog for SCOTUS cases, fetches case file pages and
 * opinion analysis posts, extracts structured data + text content
 * for use as grounded context in the enrichment pipeline.
 *
 * Uses SCOTUSblog's WordPress REST API for search (reliable, no JS rendering)
 * and JSDOM + Readability for HTML content extraction.
 */

import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { fetchWithTimeout, withRetry } from '../utils/network.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const USER_AGENT = 'TrumpyTracker/1.0 (Political Accountability Tracker; +https://trumpytracker.com)';
const SCOTUSBLOG_BASE = 'https://www.scotusblog.com';
const WP_API_SEARCH = `${SCOTUSBLOG_BASE}/wp-json/wp/v2/search`;
const WP_API_POSTS = `${SCOTUSBLOG_BASE}/wp-json/wp/v2/posts`;
const FETCH_TIMEOUT_MS = 15000;
const PER_REQUEST_DELAY_MS = 1500; // Respectful rate limit
const MAX_ANALYSIS_TEXT_CHARS = 8000; // Cap analysis text for prompt injection

const FETCH_OPTS = {
  headers: {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/json',
  }
};

let lastRequestTime = 0;

async function respectRateLimit() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < PER_REQUEST_DELAY_MS) {
    await new Promise(r => setTimeout(r, PER_REQUEST_DELAY_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

// ============================================================================
// WP REST API SEARCH
// ============================================================================

/**
 * Search SCOTUSblog via WordPress REST API.
 * @param {string} query - Search query (case name, docket, topic terms)
 * @param {number} perPage - Results per page (max 10)
 * @returns {Promise<Array>} Search results with id, title, url, subtype
 */
async function wpSearch(query, perPage = 5) {
  await respectRateLimit();
  const url = `${WP_API_SEARCH}?search=${encodeURIComponent(query)}&per_page=${perPage}`;

  const response = await withRetry(
    () => fetchWithTimeout(url, FETCH_OPTS, FETCH_TIMEOUT_MS),
    2, 1000
  );

  if (!response.ok) {
    throw new Error(`WP search failed: HTTP ${response.status}`);
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    console.warn(`[SCOTUSblog] WP search returned non-JSON for "${query}"`);
    return [];
  }
}

/**
 * Search SCOTUSblog WP Posts API with date filtering.
 * More targeted than generic search — finds opinion analysis posts near decided date.
 * @param {string} query - Search terms
 * @param {string} [afterDate] - ISO date string (posts published after this date)
 * @param {string} [beforeDate] - ISO date string (posts published before this date)
 * @param {number} perPage
 * @returns {Promise<Array>} Posts with id, title, link, date
 */
async function wpPostsSearch(query, afterDate, beforeDate, perPage = 5) {
  await respectRateLimit();
  let url = `${WP_API_POSTS}?search=${encodeURIComponent(query)}&per_page=${perPage}`;
  if (afterDate) url += `&after=${afterDate}T00:00:00`;
  if (beforeDate) url += `&before=${beforeDate}T23:59:59`;

  const response = await withRetry(
    () => fetchWithTimeout(url, FETCH_OPTS, FETCH_TIMEOUT_MS),
    2, 1000
  );

  if (!response.ok) {
    throw new Error(`WP posts search failed: HTTP ${response.status}`);
  }

  const text = await response.text();
  try {
    const posts = JSON.parse(text);
    return posts.map(p => ({
      id: p.id,
      title: p.title?.rendered?.replace(/<[^>]+>/g, '') || '',
      url: p.link || '',
      date: p.date || '',
      excerpt: (p.excerpt?.rendered || '').replace(/<[^>]+>/g, '').slice(0, 500),
    }));
  } catch {
    return [];
  }
}

// ============================================================================
// CASE FILE PAGE SCRAPING
// ============================================================================

/**
 * Fetch and parse a SCOTUSblog case file page for structured metadata.
 * @param {string} url - Full URL to the case file page
 * @returns {Promise<Object>} Structured case data
 */
async function fetchCaseFilePage(url) {
  await respectRateLimit();
  const response = await withRetry(
    () => fetchWithTimeout(url, FETCH_OPTS, FETCH_TIMEOUT_MS),
    2, 1000
  );

  if (!response.ok) {
    throw new Error(`Case file page HTTP ${response.status}: ${url}`);
  }

  const html = await response.text();
  const dom = new JSDOM(html, { url });

  const result = {
    url,
    docket_number: null,
    term: null,
    decided_at: null,
    vote_split: null,
    majority_author: null,
    holding: null,
    issue: null,
    analysis_links: [],
  };

  try {
    const doc = dom.window.document;

    // Extract metadata from table (SCOTUSblog uses header row + data row layout)
    // Headers: Docket No. | Op. Below | Argument | Opinion | Vote | Author | Term
    // Values in the corresponding data row
    const tables = doc.querySelectorAll('table');
    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      if (rows.length < 2) continue;

      // Build header-to-column index mapping from first row
      const headerCells = rows[0].querySelectorAll('td, th');
      const headers = [...headerCells].map(c => (c.textContent || '').trim().toLowerCase());

      // Map headers to column indices
      const colMap = {};
      headers.forEach((h, i) => {
        if (h.includes('docket')) colMap.docket = i;
        else if (h === 'term') colMap.term = i;
        else if (h === 'vote') colMap.vote = i;
        else if (h === 'author') colMap.author = i;
        else if (h === 'opinion' || h === 'decided') colMap.decided = i;
      });

      // Extract values from data rows
      for (let r = 1; r < rows.length; r++) {
        const dataCells = rows[r].querySelectorAll('td, th');
        const vals = [...dataCells].map(c => (c.textContent || '').trim());

        if (colMap.docket !== undefined && vals[colMap.docket]) {
          const m = vals[colMap.docket].match(/(\d{2}-\d+)/);
          if (m) result.docket_number = m[1];
        }
        if (colMap.term !== undefined && vals[colMap.term]) {
          const m = vals[colMap.term].match(/(OT\s+\d{4})/i);
          if (m) result.term = m[1];
        }
        if (colMap.decided !== undefined && vals[colMap.decided]) {
          const m = vals[colMap.decided].match(/([A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4})/);
          if (m) result.decided_at = m[1];
        }
        if (colMap.vote !== undefined && vals[colMap.vote]) {
          result.vote_split = vals[colMap.vote].replace(/\s+/g, ' ');
        }
        if (colMap.author !== undefined && vals[colMap.author]) {
          result.majority_author = vals[colMap.author];
        }
      }
    }

    // Extract issue/holding from text content (often in paragraphs, not tables)
    const content = doc.querySelector('.entry-content, .case-content, article, .main-content');
    if (content) {
      const text = content.textContent || '';

      // Holding
      const holdingMatch = text.match(/(?:Held|Holding)[:\s]+(.{20,500}?)(?:\n|\r|$)/i);
      if (holdingMatch) result.holding = holdingMatch[1].trim();

      // Issue/question presented
      const issueMatch = text.match(/(?:Issue|Question\s+Presented)[:\s]+(.{20,500}?)(?:\n|\r|$)/i);
      if (issueMatch) result.issue = issueMatch[1].trim();
    }
  } finally {
    dom.window.close();
  }

  return result;
}

// ============================================================================
// OPINION ANALYSIS POST SCRAPING
// ============================================================================

/**
 * Fetch an opinion analysis post and extract clean text via Readability.
 * @param {string} url - Full URL to the blog post
 * @returns {Promise<Object>} { url, title, text, excerpt }
 */
async function fetchAnalysisPost(url) {
  await respectRateLimit();
  const response = await withRetry(
    () => fetchWithTimeout(url, FETCH_OPTS, FETCH_TIMEOUT_MS),
    2, 1000
  );

  if (!response.ok) {
    throw new Error(`Analysis post HTTP ${response.status}: ${url}`);
  }

  const html = await response.text();
  const dom = new JSDOM(html, { url });

  let title = '';
  let text = '';

  try {
    // Try Readability first
    try {
      const reader = new Readability(dom.window.document.cloneNode(true));
      const article = reader.parse();
      if (article && article.textContent && article.textContent.length > 200) {
        title = article.title || '';
        text = article.textContent.trim();
      }
    } catch {
      // Readability failed, fall through
    }

    // Fallback: extract from article/entry-content
    if (!text || text.length < 200) {
      const content = dom.window.document.querySelector('.entry-content, article, .post-content');
      if (content) {
        title = dom.window.document.querySelector('h1, .entry-title')?.textContent?.trim() || '';
        text = content.textContent.trim();
      }
    }
  } finally {
    dom.window.close();
  }

  // Cap text length
  if (text.length > MAX_ANALYSIS_TEXT_CHARS) {
    text = text.slice(0, MAX_ANALYSIS_TEXT_CHARS) + '\n[...truncated]';
  }

  return { url, title, text, excerpt: text.slice(0, 300) };
}

// ============================================================================
// CASE NAME → URL SLUG
// ============================================================================

/**
 * Generate candidate URL slugs from a case name.
 * Handles common patterns: "v." → "v", strip punctuation, lowercase.
 * @param {string} caseName
 * @returns {string[]} Candidate slugs to try
 */
function generateSlugs(caseName) {
  // "TikTok Inc. v. Garland" → "tiktok-inc-v-garland"
  const base = caseName
    .toLowerCase()
    .replace(/\bv\.\b/g, 'v')           // "v." → "v"
    .replace(/['']/g, '')                // Remove apostrophes
    .replace(/[^a-z0-9\s-]/g, '')       // Strip punctuation
    .replace(/\s+/g, '-')               // Spaces → hyphens
    .replace(/-+/g, '-')                // Collapse multiple hyphens
    .replace(/^-|-$/g, '');             // Trim hyphens

  // Return base slug + common suffixes for duplicates
  return [base, `${base}-2`, `${base}-3`];
}

// ============================================================================
// HIGH-LEVEL ORCHESTRATOR
// ============================================================================

/**
 * Get SCOTUSblog context for a SCOTUS case.
 * Tries multiple strategies: WP API search → direct URL → topic search.
 *
 * @param {Object} opts
 * @param {string} opts.caseName - e.g. "Barrett v. United States"
 * @param {string} [opts.docketNumber] - e.g. "24-5774"
 * @param {string} [opts.term] - e.g. "OT 2025"
 * @param {string[]} [opts.topicTerms] - Fallback search terms, e.g. ["estate tax", "life insurance"]
 * @returns {Promise<Object>} { found, caseData, analysisText, analysisUrl, searchStrategy }
 */
export async function getScotusContext({ caseName, docketNumber, term, topicTerms = [] }) {
  const result = {
    found: false,
    caseData: null,
    analysisText: null,
    analysisUrl: null,
    searchStrategy: null,
    errors: [],
  };

  // --- Phase 1: Find and fetch case file page ---

  // Strategy 1a: WP API search by case name
  try {
    const searchResults = await wpSearch(caseName, 5);
    const caseFileHit = searchResults.find(r => r.subtype === 'case');

    if (caseFileHit) {
      result.searchStrategy = 'wp_api_case_name';
      result.found = true;

      try {
        result.caseData = await fetchCaseFilePage(caseFileHit.url);

        // If multiple case files with same name, verify by docket
        if (docketNumber && result.caseData.docket_number &&
            result.caseData.docket_number !== docketNumber) {
          console.log(`[SCOTUSblog] Docket mismatch: got ${result.caseData.docket_number}, want ${docketNumber}`);
          const otherHits = searchResults.filter(r => r.subtype === 'case' && r.id !== caseFileHit.id);
          for (const alt of otherHits) {
            const altData = await fetchCaseFilePage(alt.url);
            if (altData.docket_number === docketNumber) {
              result.caseData = altData;
              break;
            }
          }
        }
      } catch (err) {
        result.errors.push(`Case file page failed: ${err.message}`);
      }
    }
  } catch (err) {
    result.errors.push(`WP search failed: ${err.message}`);
  }

  // Strategy 1b: Direct URL slug (if no case file found)
  if (!result.caseData) {
    const slugs = generateSlugs(caseName);
    for (const slug of slugs) {
      const url = `${SCOTUSBLOG_BASE}/cases/case-files/${slug}/`;
      try {
        const data = await fetchCaseFilePage(url);
        if (docketNumber && data.docket_number && data.docket_number !== docketNumber) {
          continue;
        }
        result.caseData = data;
        result.found = true;
        result.searchStrategy = result.searchStrategy || 'direct_slug';
        break;
      } catch {
        // 404 or other error — try next slug
      }
    }
  }

  // --- Phase 2: Find opinion analysis post ---
  // Strategy 2a: Date-filtered WP Posts search (most reliable)
  // Search for posts near the decided date that mention the case party names.
  if (!result.analysisText) {
    // Compute date range: decided date -3 days to +30 days
    const decidedStr = result.caseData?.decided_at || null;
    const decidedDate = decidedStr ? new Date(decidedStr) : null;
    let afterDate = null;
    let beforeDate = null;
    if (decidedDate && !isNaN(decidedDate.getTime())) {
      const after = new Date(decidedDate);
      after.setDate(after.getDate() - 3);
      const before = new Date(decidedDate);
      before.setDate(before.getDate() + 30);
      afterDate = after.toISOString().slice(0, 10);
      beforeDate = before.toISOString().slice(0, 10);
    }

    // Extract the first party name (most distinctive): "Barrett v. United States" → "Barrett"
    const firstParty = caseName.split(/\s+v\.\s*/i)[0].trim();
    const SKIP = /^(announcement|opinions for|scotustoday|argument preview|oral argument)/i;

    // Try date-filtered search with various queries
    // Include docket number (analysis posts often reference "No. 24-5774")
    const effectiveDocket = docketNumber || result.caseData?.docket_number;
    const searchQueries = [
      firstParty,
      caseName,
      ...(effectiveDocket ? [effectiveDocket] : []),
      ...(topicTerms || []),
    ];
    for (const query of searchQueries) {
      if (result.analysisText) break;
      try {
        const posts = afterDate
          ? await wpPostsSearch(query, afterDate, beforeDate, 5)
          : [];

        // Also try generic search as fallback
        const genericResults = await wpSearch(query, 5);
        const genericPosts = genericResults
          .filter(r => r.subtype === 'post')
          .map(r => ({ id: r.id, title: r.title, url: r.url, date: '' }));

        // Combine and deduplicate
        const allPosts = [...posts, ...genericPosts];
        const seen = new Set();
        const uniquePosts = allPosts.filter(p => {
          if (seen.has(p.id)) return false;
          seen.add(p.id);
          return true;
        });

        // Filter and score
        const candidates = uniquePosts.filter(p => !SKIP.test(p.title));
        // Build case-specific scoring words
        const parties = caseName.split(/\s+v\.\s*/i);
        const firstPartyWords = (parties[0] || '').toLowerCase().split(/\W+/).filter(w => w.length > 2);
        const caseWords = caseName.toLowerCase().split(/\W+/).filter(w => w.length > 2 && w !== 'the');

        for (const p of candidates) {
          const titleLower = p.title.toLowerCase();
          const excerptLower = (p.excerpt || '').toLowerCase();
          const searchText = titleLower + ' ' + excerptLower;

          // Base score: case word matches in title + excerpt
          p._relevance = caseWords.filter(w => searchText.includes(w)).length;

          // Boost: opinion analysis keywords in title
          if (/\b(holds|sides|rules|ruled|unanimously|strikes|upholds|rejects)\b/i.test(p.title)) {
            p._relevance += 3;
          }

          // Boost: full case name appears in excerpt (strong signal)
          if (excerptLower.includes(caseName.toLowerCase()) ||
              excerptLower.includes(caseName.toLowerCase().replace(' v. ', ' v '))) {
            p._relevance += 5;
          }

          // Penalize: title is about a person with same name (e.g., Justice Barrett), not the case
          // Check if excerpt doesn't mention the case at all but mentions "justice [name]"
          const firstParty = firstPartyWords[0] || '';
          if (firstParty && titleLower.includes('justice ' + firstParty) &&
              !excerptLower.includes(' v. ') && !excerptLower.includes(' v ')) {
            p._relevance -= 5;
          }
        }

        candidates.sort((a, b) => b._relevance - a._relevance);
        const bestHit = candidates[0];

        // Try top candidates, verify each discusses our case
        const topCandidates = candidates
          .filter(c => c._relevance >= 1)
          .sort((a, b) => b._relevance - a._relevance)
          .slice(0, 3);

        for (const candidate of topCandidates) {
          if (result.analysisText) break;
          try {
            const analysis = await fetchAnalysisPost(candidate.url);
            if (analysis.text && analysis.text.length > 200) {
              // Verify the post discusses our case (mentions first party + "v.")
              const textLower = analysis.text.toLowerCase();
              const firstPartyName = firstPartyWords[0] || '';
              const mentionsCase = (
                textLower.includes(caseName.toLowerCase()) ||
                textLower.includes(caseName.toLowerCase().replace(' v. ', ' v ')) ||
                (firstPartyName && textLower.includes(firstPartyName + ' v'))
              );

              if (mentionsCase) {
                result.analysisText = analysis.text;
                result.analysisUrl = analysis.url;
                result.found = true;
                result.searchStrategy = result.searchStrategy || 'wp_api_analysis';
                break;
              }
            }
          } catch (err) {
            result.errors.push(`Analysis fetch failed: ${err.message}`);
          }
        }
      } catch (err) {
        result.errors.push(`Analysis search failed: ${err.message}`);
      }
    }
  }

  return result;
}

// ============================================================================
// CONTEXT FORMATTING FOR ENRICHMENT PROMPT
// ============================================================================

/**
 * Format SCOTUSblog context for injection into the enrichment prompt.
 * @param {Object} ctx - Result from getScotusContext()
 * @returns {string} Formatted text block for prompt injection, or empty string
 */
export function formatContextForPrompt(ctx) {
  if (!ctx.found) return '';

  const parts = [];
  parts.push('SCOTUSBLOG REFERENCE (verified external source — use to ground your analysis):');

  if (ctx.caseData) {
    const d = ctx.caseData;
    if (d.vote_split) parts.push(`Vote: ${d.vote_split}`);
    if (d.majority_author) parts.push(`Author: ${d.majority_author}`);
    if (d.holding) parts.push(`Holding: ${d.holding}`);
    if (d.issue) parts.push(`Issue: ${d.issue}`);
  }

  if (ctx.analysisText) {
    parts.push('');
    parts.push('--- SCOTUSblog Opinion Analysis ---');
    parts.push(ctx.analysisText);
  }

  return parts.join('\n');
}

// ============================================================================
// POST-ENRICHMENT VALIDATION
// ============================================================================

/**
 * Compare enrichment output against SCOTUSblog context for factual consistency.
 * Returns a structured validation report.
 *
 * @param {Object} enrichmentOutput - The GPT enrichment result
 * @param {Object} scotusContext - Result from getScotusContext()
 * @returns {Object} { passed, checks: [{field, status, detail}] }
 */
export function validateAgainstContext(enrichmentOutput, scotusContext) {
  const checks = [];

  if (!scotusContext.found || !scotusContext.caseData) {
    return { passed: true, checks: [{ field: 'context', status: 'skip', detail: 'No SCOTUSblog data to validate against' }] };
  }

  const cd = scotusContext.caseData;
  const eo = enrichmentOutput;

  // Check vote split consistency
  if (cd.vote_split && eo.vote_split) {
    const cdVote = cd.vote_split.replace(/\s+/g, '').toLowerCase();
    const eoVote = (eo.vote_split || '').replace(/\s+/g, '').toLowerCase();
    const match = cdVote.includes(eoVote) || eoVote.includes(cdVote) ||
      cdVote.replace(/[^0-9-]/g, '') === eoVote.replace(/[^0-9-]/g, '');
    checks.push({
      field: 'vote_split',
      status: match ? 'pass' : 'warn',
      detail: match ? 'Consistent' : `SCOTUSblog: "${cd.vote_split}" vs output: "${eo.vote_split}"`
    });
  }

  // Check holding/summary alignment (keyword overlap)
  if (cd.holding && eo.summary_spicy) {
    const holdingWords = new Set(cd.holding.toLowerCase().split(/\W+/).filter(w => w.length > 4));
    const summaryWords = new Set(eo.summary_spicy.toLowerCase().split(/\W+/).filter(w => w.length > 4));
    const overlap = [...holdingWords].filter(w => summaryWords.has(w));
    const overlapRatio = holdingWords.size > 0 ? overlap.length / holdingWords.size : 0;

    checks.push({
      field: 'holding_alignment',
      status: overlapRatio >= 0.15 ? 'pass' : 'warn',
      detail: `${Math.round(overlapRatio * 100)}% keyword overlap with holding (${overlap.length}/${holdingWords.size} words)`
    });
  }

  // Check if analysis text mentions winner alignment
  if (scotusContext.analysisText && eo.who_wins) {
    const analysisLower = scotusContext.analysisText.toLowerCase();
    const winnerWords = eo.who_wins.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    const winnerMentioned = winnerWords.some(w => analysisLower.includes(w));

    checks.push({
      field: 'winner_grounding',
      status: winnerMentioned ? 'pass' : 'warn',
      detail: winnerMentioned ? 'Winner terms found in analysis' : `Winner "${eo.who_wins.slice(0, 60)}" not grounded in analysis text`
    });
  }

  const hasFailure = checks.some(c => c.status === 'fail');
  const hasWarning = checks.some(c => c.status === 'warn');

  return {
    passed: !hasFailure,
    hasWarnings: hasWarning,
    checks
  };
}

export { wpSearch, fetchCaseFilePage, fetchAnalysisPost, generateSlugs };
