// Article scraper for story enrichment with legal/cost guardrails
//
// SCRAPING APPROACH:
// - Tool: Mozilla Readability (intelligent extraction) with regex fallback
// - Three-tier fallback: Readability → Regex → RSS
// - Readability: Firefox Reader Mode algorithm, filters ads/nav automatically
// - Regex fallback: Simple pattern matching for sites where Readability fails
// - RSS fallback: Always works, uses article description
//
// DOCUMENTATION:
// - Why Readability? Battle-tested, 70-80% success rate, clean text
// - Limitations: Can't render JavaScript (PBS fails), falls back to regex
// - For JS-heavy sites: Would need Playwright/Puppeteer (not worth cost/complexity)

import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { withRetry } from '../utils/network.js';

// ---------- Configuration ----------
// Default allow-list includes:
// - CSM, PBS, ProPublica (public, non-paywalled)
// - Reuters, AP, Politico (may hit rate limits, will fallback)
// - NYT, WaPo (paywalled, will extract what's available before paywall)
const SCRAPE_ALLOWLIST = (process.env.SCRAPE_DOMAINS ?? 'csmonitor.com,pbs.org,propublica.org,reuters.com,apnews.com,politico.com,nytimes.com,washingtonpost.com')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const MAX_SCRAPED_PER_CLUSTER = 2;
const MAX_EXCERPT_CHARS = Number(process.env.SCRAPE_MAX_CHARS ?? 5000);  // Increased from 2000 to 5000 for better summary quality
const MAX_BYTES = 1_500_000;       // 1.5 MB
const FETCH_TIMEOUT_MS = 15000;    // Increased from 8000 to 15000 (aligns with RSS fetcher)
const PER_HOST_MIN_GAP_MS = Number(process.env.SCRAPE_MIN_GAP_MS ?? 1000);

const lastHit = new Map();

// Telemetry tracking for scrape failures
const scrapeStats = {
  timeout: 0,
  http403: 0,
  http429: 0,
  http5xx: 0,
  other: 0,
  success: 0
};

// ---------- Utilities ----------

/**
 * Check if domain is on allow-list and uses safe protocol
 */
function domainAllowed(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;  // Only http/https
    const h = u.hostname;
    return SCRAPE_ALLOWLIST.some(d => h === d || h.endsWith('.' + d));
  } catch { return false; }
}

/**
 * Decode common HTML entities
 */
function decodeEntities(str) {
  const map = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' '
  };

  // Named entities
  str = str.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, match => map[match] ?? match);

  // Numeric entities
  str = str.replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)));

  return str;
}

/**
 * Fetch with timeout using native AbortController
 */
async function fetchWithTimeout(url, init, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

/**
 * Stream body to avoid unbounded memory if Content-Length is absent
 */
async function readTextWithCap(res, maxBytes) {
  const reader = res.body?.getReader?.();
  if (!reader) return await res.text(); // Fallback; Node 22 should have web stream

  const dec = new TextDecoder('utf-8');
  let received = 0;
  let out = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) throw new Error(`Too large (> ${maxBytes} bytes)`);
    out += dec.decode(value, { stream: true });
  }
  out += dec.decode();
  return out;
}

/**
 * Respect per-host rate limiting to prevent IP bans
 */
async function respectPerHostRate(url) {
  const host = new URL(url).hostname;
  const now = Date.now();
  const last = lastHit.get(host) ?? 0;
  const delta = now - last;
  if (delta < PER_HOST_MIN_GAP_MS) {
    await new Promise(r => setTimeout(r, PER_HOST_MIN_GAP_MS - delta));
  }
  lastHit.set(host, Date.now());
}

/**
 * Extract article content using Mozilla Readability (Tier 1)
 * Uses Firefox's Reader Mode algorithm to intelligently extract article text
 * Filters ads, navigation, and sidebars automatically
 *
 * @param {string} html - Raw HTML content
 * @param {string} articleUrl - Article URL for context
 * @returns {string} Cleaned article text or empty string
 */
function extractMainTextWithReadability(html, articleUrl) {
  // JSDOM with secure defaults: no script execution, no external resources
  const dom = new JSDOM(html, { url: articleUrl });

  try {
    const reader = new Readability(dom.window.document, {
      keepClasses: false // Cleaner text output
    });

    const article = reader.parse();
    if (!article || !article.textContent) return '';

    return article.textContent.replace(/\s+/g, ' ').trim();
  } finally {
    // Critical: Close JSDOM window to prevent memory leaks
    dom.window.close();
  }
}

/**
 * Extract article content using regex patterns (Tier 2 fallback)
 * Looks for common article containers like <article> or divs with article-related classes
 *
 * @param {string} html - Raw HTML content
 * @returns {string} Cleaned article text or empty string
 */
function extractFallbackWithRegex(html) {
  // Prefer <article>, then common content containers
  let m = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  let chunk = m?.[1];
  if (!chunk) {
    m = html.match(/<(div|section)\b[^>]*(article-body|story-body|entry-content|content__article-body)[^>]*>([\s\S]*?)<\/\1>/i);
    chunk = m?.[3];
  }
  if (!chunk) return '';

  const text = decodeEntities(
    chunk
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );

  return text;
}

/**
 * Scrape article body from URL with three-tier fallback
 * Tier 1: Mozilla Readability (intelligent extraction)
 * Tier 2: Regex patterns (proven fallback)
 * Tier 3: RSS description (handled by caller)
 *
 * Returns cleaned text excerpt or empty string on failure
 */
async function scrapeArticleBody(url) {
  await respectPerHostRate(url);

  // Wrap fetch in retry with exponential backoff (3 attempts, 1s base delay)
  let res;
  try {
    res = await withRetry(async () => {
      return await fetchWithTimeout(url, {
        headers: {
          // Honest UA with contact; many servers block "bare" bots
          'User-Agent': 'Mozilla/5.0 TrumpyTrackerBot/1.0 (+https://trumpytracker.com/contact)',
          'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        redirect: 'follow'
      }, FETCH_TIMEOUT_MS);
    }, 3, 1000); // 3 attempts, 1s base delay (1s, 2s, 4s backoff)
  } catch (e) {
    // Track timeout failures
    if (e.name === 'AbortError' || e.message.includes('aborted')) {
      scrapeStats.timeout++;
      throw new Error(`Timeout after ${FETCH_TIMEOUT_MS}ms`);
    }
    scrapeStats.other++;
    throw e;
  }

  // Smart HTTP status handling
  if (!res.ok) {
    const status = res.status;
    if (status === 429) {
      // Rate limited - retry will handle with backoff
      scrapeStats.http429++;
      throw new Error(`HTTP 429 (rate limited)`);
    }
    if (status === 403) {
      // Forbidden - permanent block, don't retry
      scrapeStats.http403++;
      throw new Error(`HTTP 403 (blocked, no retry)`);
    }
    if (status >= 400 && status < 500) {
      // Other client errors - permanent, don't retry
      scrapeStats.other++;
      throw new Error(`HTTP ${status} (client error, no retry)`);
    }
    if (status >= 500) {
      // Server errors - transient, allow retry
      scrapeStats.http5xx++;
      throw new Error(`HTTP ${status} (server error)`);
    }
    scrapeStats.other++;
    throw new Error(`HTTP ${status}`);
  }
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('text/html')) throw new Error(`Bad content-type: ${ct}`);

  const len = Number(res.headers.get('content-length') ?? 0);
  if (len && len > MAX_BYTES) throw new Error(`Too large: ${len}`);

  const html = await readTextWithCap(res, MAX_BYTES);

  const host = new URL(url).hostname;
  let text = '';

  // Tier 1: Try Mozilla Readability (intelligent extraction)
  try {
    text = extractMainTextWithReadability(html, res.url ?? url);
    if (text && text.length >= 300) {
      scrapeStats.success++;
      console.log(`scraped_ok method=readability host=${host} len=${text.length}`);
      return text.slice(0, MAX_EXCERPT_CHARS);
    }
  } catch (e) {
    console.log(`readability_fail host=${host} err=${e.message}`);
  }

  // Tier 2: Try regex fallback (proven method)
  const alt = extractFallbackWithRegex(html);
  if (alt && alt.length >= 300) {
    scrapeStats.success++;
    console.log(`scraped_ok method=regex_fallback host=${host} len=${alt.length}`);
    return alt.slice(0, MAX_EXCERPT_CHARS);
  }

  // Tier 3: Return empty (RSS fallback handled by caller)
  return '';
}

/**
 * Log scraping telemetry stats
 */
function logScrapeStats() {
  const total = scrapeStats.success + scrapeStats.timeout + scrapeStats.http403 +
                scrapeStats.http429 + scrapeStats.http5xx + scrapeStats.other;
  if (total === 0) return;

  console.log('\n=== Scraper Telemetry ===');
  console.log(`Success: ${scrapeStats.success}/${total} (${Math.round(scrapeStats.success/total*100)}%)`);
  console.log(`Timeouts: ${scrapeStats.timeout}`);
  console.log(`HTTP 403 (blocked): ${scrapeStats.http403}`);
  console.log(`HTTP 429 (rate limited): ${scrapeStats.http429}`);
  console.log(`HTTP 5xx (server errors): ${scrapeStats.http5xx}`);
  console.log(`Other errors: ${scrapeStats.other}`);
  console.log('========================\n');
}

/**
 * Enrich articles for story enrichment
 * Tries to scrape articles from allow-list until 2 successful scrapes or exhausts candidates
 *
 * @param {Array} articles - Array of article objects with url, source_domain, title, description
 * @returns {Promise<Array>} Articles with enriched excerpts
 */
export async function enrichArticlesForSummary(articles) {
  const results = [];
  const triedHosts = new Set(); // Track attempted hosts to avoid duplicates
  let successfulScrapes = 0;

  // Process sequentially to avoid race conditions in rate limiting
  for (let idx = 0; idx < articles.length; idx++) {
    const a = articles[idx];
    const fallback = (a.excerpt ?? a.description ?? '').slice(0, MAX_EXCERPT_CHARS);

    // Check if article is scrapable
    if (!a?.url || !domainAllowed(a.url)) {
      results.push({ ...a, excerpt: fallback });
      continue;
    }

    // Extract host safely
    let host;
    try {
      host = new URL(a.url).hostname;
    } catch {
      results.push({ ...a, excerpt: fallback });
      continue;
    }

    // Skip if we already tried this host (dedup by host)
    if (triedHosts.has(host)) {
      results.push({ ...a, excerpt: fallback });
      continue;
    }

    // Stop scraping if we already have 2 successes
    if (successfulScrapes >= MAX_SCRAPED_PER_CLUSTER) {
      results.push({ ...a, excerpt: fallback });
      continue;
    }

    // Try to scrape this article
    triedHosts.add(host);
    try {
      const scraped = await scrapeArticleBody(a.url);
      if (scraped && scraped.length > 300) {
        // Success already logged in scrapeArticleBody with method info
        results.push({ ...a, excerpt: scraped });
        successfulScrapes++;
      } else {
        console.log(`scrape_fallback_to_rss host=${host} reason=too_short`);
        results.push({ ...a, excerpt: fallback });
        // Don't increment successfulScrapes - will try next candidate
      }
    } catch (e) {
      console.log(`scraped_fail host=${host} err=${e.message}`);
      results.push({ ...a, excerpt: fallback });
      // Don't increment successfulScrapes - will try next candidate
    }
  }

  // Log telemetry stats
  logScrapeStats();

  return results;
}
