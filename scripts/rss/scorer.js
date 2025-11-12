// scripts/rss/scorer.js
import he from 'he';

const FED_ALLOW_RX = [
  /\bcongress\b/i,
  /\bsenate\b/i,
  /\bhouse (of representatives|judiciary|appropriations|oversight|ways and means)\b/i,
  /\bwhite house\b/i,
  /\bsupreme court\b|\bscotus\b/i,
  /\bexecutive order\b/i,
  /\bdepartment of (justice|defense|state|treasury|homeland security)\b/i,
  /\b(doj|dod|dhs|fbi|cia|nsa|ice|cbp|atf|dea)\b/i,
  /\bfederal\b/i,
  /\bfederal court\b/i,
  /\b(5th|9th|dc) circuit\b/i
];

const TRUMP_BOOST_RX = [
  /\btrump\b/i,
  /\bmaga\b/i,
  /mar-a-lago/i
];

const LOCAL_BLOCK_RX = [
  /\bcity council\b/i,
  /\bschool board\b/i,
  /\bborough\b/i,
  /\bcounty (commission|board)\b/i,
  /\bmayor(al)?\b/i,
  /\bgubernatorial\b/i,
  /\bstate legislature\b/i,
  /\btown meeting\b/i
];

const PATH_POS_RX = /(\/us-news\/|\/politics\/|\/elections\/|\/white-house\/|\/congress\/)/i;
const PATH_NEG_RX = /(\/uk-news\/|\/local\/|\/opinion\/|\/live\/|\/podcast\/|\/video\/|\/culture\/)/i;

function escapeRx(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function scoreGovRelevance(item, feedFilter = {}) {
  const url = item.link || item.url || '';
  const title = item.title || '';
  const summary = item.contentSnippet || item.content || item.summary || '';
  const categories = item.categories || [];

  // Decode entities once, normalize to lower-case
  const hay = he.decode(`${title} ${summary} ${categories.join(' ')}`).toLowerCase();
  const path = (() => {
    try { return new URL(url).pathname.toLowerCase(); }
    catch { return ''; }
  })();

  // URL gates (fast + strict)
  const req = (feedFilter.requiredUrlIncludes || []).map(s => s.toLowerCase());
  if (req.length && !req.some(seg => path.includes(seg))) {
    return { keep: false, score: -1, signals: { gate: 'miss', path } };
  }
  const disallow = (feedFilter.disallowedUrlIncludes || []).map(s => s.toLowerCase());
  if (disallow.some(seg => path.includes(seg))) {
    return { keep: false, score: -1, signals: { gate: 'disallowedPath', path } };
  }

  const cfgAllow = (feedFilter.allow || []).map(s => new RegExp(`\\b${escapeRx(s)}\\b`, 'i'));
  const cfgBlock = (feedFilter.block || []).map(s => new RegExp(s, 'i'));

  let score = 0;
  const signals = { allow: [], block: [], trump: false, path: 0 };

  // Positive URL hints
  if (PATH_POS_RX.test(path)) { score += 1; signals.path += 1; }
  if (PATH_NEG_RX.test(path)) { score -= 1; signals.path -= 1; }

  // Federal allows
  const fedHits = [...FED_ALLOW_RX, ...cfgAllow].filter(rx => rx.test(hay));
  if (fedHits.length) {
    score += 2;
    signals.allow = fedHits.map(r => r.toString());
  }

  // Trump boost (strong, applied before local blocks)
  const hasTrump = TRUMP_BOOST_RX.some(rx => rx.test(hay));
  if (hasTrump) {
    score += 2;
    signals.trump = true;
  }

  // Local blocks (softened if Trump present)
  const localHits = [...LOCAL_BLOCK_RX, ...cfgBlock].filter(rx => rx.test(hay));
  if (localHits.length) {
    score += hasTrump ? -1 : -2;
    signals.block = localHits.map(r => r.toString());
  }

  return { keep: score >= 1, score, signals };
}
