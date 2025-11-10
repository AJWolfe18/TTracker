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

// ---------- Configuration ----------
// Default allow-list includes:
// - CSM, PBS, ProPublica (public, non-paywalled)
// - Reuters, AP, Politico (test - may hit paywalls, will fallback)
// - NYT, WaPo excluded (known paywalls, but can test via env var)
const SCRAPE_ALLOWLIST = (process.env.SCRAPE_DOMAINS ?? 'csmonitor.com,pbs.org,propublica.org,reuters.com,apnews.com,politico.com')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const MAX_SCRAPED_PER_CLUSTER = 2;
const MAX_EXCERPT_CHARS = Number(process.env.SCRAPE_MAX_CHARS ?? 5000);  // Increased from 2000 to 5000 for better summary quality
const MAX_BYTES = 1_500_000;       // 1.5 MB
const FETCH_TIMEOUT_MS = 8000;
const PER_HOST_MIN_GAP_MS = Number(process.env.SCRAPE_MIN_GAP_MS ?? 1000);

const lastHit = new Map();

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

  const res = await fetchWithTimeout(url, {
    headers: {
      // Honest UA with contact; many servers block "bare" bots
      'User-Agent': 'Mozilla/5.0 TrumpyTrackerBot/1.0 (+https://trumpytracker.com/contact)',
      'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    redirect: 'follow'
  }, FETCH_TIMEOUT_MS);

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
      console.log(`scraped_ok method=readability host=${host} len=${text.length}`);
      return text.slice(0, MAX_EXCERPT_CHARS);
    }
  } catch (e) {
    console.log(`readability_fail host=${host} err=${e.message}`);
  }

  // Tier 2: Try regex fallback (proven method)
  const alt = extractFallbackWithRegex(html);
  if (alt && alt.length >= 300) {
    console.log(`scraped_ok method=regex_fallback host=${host} len=${alt.length}`);
    return alt.slice(0, MAX_EXCERPT_CHARS);
  }

  // Tier 3: Return empty (RSS fallback handled by caller)
  return '';
}

/**
 * Enrich articles for story enrichment
 * Scrapes up to 2 articles from allowed domains, falls back to RSS for others
 *
 * @param {Array} articles - Array of article objects with url, source_domain, title, description
 * @returns {Promise<Array>} Articles with enriched excerpts
 */
export async function enrichArticlesForSummary(articles) {
  // Choose up to 2 allowed domains (distinct hosts)
  const picks = [];
  const seen = new Set();

  for (let i = 0; i < articles.length && picks.length < MAX_SCRAPED_PER_CLUSTER; i++) {
    const a = articles[i];
    if (!a?.url || !domainAllowed(a.url)) continue;
    const host = new URL(a.url).hostname;
    if (seen.has(host)) continue;
    seen.add(host);
    picks.push(i);
  }

  // Process sequentially to avoid race conditions in rate limiting
  // (max 2 articles scraped, performance impact negligible)
  const results = [];
  for (let idx = 0; idx < articles.length; idx++) {
    const a = articles[idx];
    const fallback = (a.excerpt ?? a.description ?? '').slice(0, MAX_EXCERPT_CHARS);

    if (!picks.includes(idx)) {
      results.push({ ...a, excerpt: fallback });
      continue;
    }

    const host = new URL(a.url).hostname;
    try {
      const scraped = await scrapeArticleBody(a.url);
      if (scraped && scraped.length > 300) {
        // Success already logged in scrapeArticleBody with method info
        results.push({ ...a, excerpt: scraped });
      } else {
        console.log(`scrape_fallback_to_rss host=${host} reason=too_short`);
        results.push({ ...a, excerpt: fallback });
      }
    } catch (e) {
      console.log(`scraped_fail host=${host} err=${e.message}`);
      results.push({ ...a, excerpt: fallback });
    }
  }
  return results;
}
