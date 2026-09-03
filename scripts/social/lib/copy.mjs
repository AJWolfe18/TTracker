// ADO-572: social post copy builder. Pure functions, no I/O, no AI call.
// Template is PRD section 5 (docs/features/growth/prd-social-automation.md):
//
//   {headline}
//
//   {first sentence of summary_spicy}
//
//   LEVEL {alarm} · {LABEL}  |  {source_count} sources
//   {url}?utm_source=facebook&utm_medium=social&utm_campaign=auto
//
// Labels mirror og-tags / og-card-props ALARM_LABELS. No em dashes anywhere in
// the output (tone-system rule) - they become plain hyphens.

export const LABELS = Object.freeze({ 5: 'CRISIS', 4: 'SEVERE', 3: 'SERIOUS', 2: 'NOTABLE', 1: 'WATCH', 0: 'WIN' });

// entity_type -> public route segment (same names og-tags / og-image use)
export const ROUTE = Object.freeze({ story: 'detail', eo: 'eos', scotus: 'scotus', pardon: 'pardons' });

export const UTM = 'utm_source=facebook&utm_medium=social&utm_campaign=auto';

// Tokens that end with a period but do not end a sentence.
const ABBREVIATIONS = new Set(['u.s', 'd.c', 'mr', 'mrs', 'ms', 'dr', 'jr', 'sr', 'sen', 'rep', 'gov', 'gen', 'inc', 'corp', 'co', 'v', 'vs', 'no', 'st', 'e.g', 'i.e', 'etc']);

const DASHES = /[—–]/g; // em dash, en dash

/** Replace em/en dashes: " — " between words reads as ", " ; anything else becomes "-". */
export function stripDashes(text = '') {
  return String(text).replace(/\s*[—–]\s*/g, (m) => (/\s/.test(m) ? ', ' : '-')).replace(DASHES, '-');
}

/**
 * First sentence of a paragraph. Splits on . ! ? followed by whitespace or
 * end-of-text, skipping common abbreviations ("U.S. policy", "Mr. Smith").
 * Falls back to the first 200 chars when no terminator is found.
 */
export function firstSentence(text = '') {
  const t = String(text).trim();
  if (!t) return '';
  const re = /[.!?]+(?=\s|$)/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const end = m.index + m[0].length;
    const before = t.slice(0, m.index);
    const lastToken = (before.match(/(\S+)$/)?.[1] ?? '').toLowerCase();
    if (m[0] === '.' && (ABBREVIATIONS.has(lastToken) || /^[a-z]$/.test(lastToken))) continue;
    return stripDashes(t.slice(0, end)).trim();
  }
  return stripDashes(t.slice(0, 200)).trim();
}

export function postUrl(origin, type, id) {
  const route = ROUTE[type];
  if (!route) throw new Error(`postUrl: unknown type ${type}`);
  return `${origin}/${route}/${encodeURIComponent(String(id))}?${UTM}`;
}

export function imageUrl(origin, type, id) {
  const route = ROUTE[type];
  if (!route) throw new Error(`imageUrl: unknown type ${type}`);
  return `${origin}/api/og-image/${route}/${encodeURIComponent(String(id))}.png`;
}

/**
 * @param {object} p
 * @param {string} p.headline
 * @param {string} [p.spicy]     summary_spicy / spicy_summary; first sentence is used
 * @param {number} p.alarm       0-5 (alarm_level / corruption_level / ruling_impact_level)
 * @param {number|null} [p.sources]  source_count for stories; omit for EOs/pardons
 * @param {string} p.url         postUrl(...) output (already carries UTM)
 */
export function buildCopy({ headline, spicy = '', alarm, sources = null, url }) {
  const level = Number.isInteger(alarm) && alarm >= 0 && alarm <= 5 ? alarm : 2;
  const meta = [`LEVEL ${level} · ${LABELS[level]}`];
  if (sources != null && Number.isFinite(Number(sources))) {
    const n = Number(sources);
    meta.push(`${n} source${n === 1 ? '' : 's'}`);
  }
  const lines = [
    stripDashes(headline).trim(),
    firstSentence(spicy),
  ].filter(Boolean);
  return `${lines.join('\n\n')}\n\n${meta.join('  |  ')}\n${url}`;
}
