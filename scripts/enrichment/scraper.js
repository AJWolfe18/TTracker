// Article scraper for story enrichment with legal/cost guardrails
// Node.js v22+ (uses native fetch + AbortController)
// No external dependencies needed

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
const MAX_EXCERPT_CHARS = 2000;
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
 * Scrape article body from URL
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

  return text.slice(0, MAX_EXCERPT_CHARS);
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

  return await Promise.all(articles.map(async (a, idx) => {
    const fallback = (a.excerpt ?? a.description ?? '').slice(0, MAX_EXCERPT_CHARS);

    if (!picks.includes(idx)) {
      return { ...a, excerpt: fallback };
    }
    try {
      const scraped = await scrapeArticleBody(a.url);
      if (scraped && scraped.length > 300) {
        console.log(`scraped_ok host=${new URL(a.url).hostname} len=${scraped.length}`);
        return { ...a, excerpt: scraped };
      }
      console.log(`scraped_too_short host=${new URL(a.url).hostname}`);
    } catch (e) {
      console.log(`scraped_fail host=${new URL(a.url).hostname} err=${e.message}`);
    }
    return { ...a, excerpt: fallback };
  }));
}
