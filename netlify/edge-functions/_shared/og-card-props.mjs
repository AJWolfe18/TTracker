// ADO-571: record row -> receipt-card props. Plain ESM (no JSX, no Deno APIs) so
// Node tests it (scripts/tests/og-image-card.test.mjs) and the Deno edge function imports it.

export const ALARM_LABELS = { 5: 'CRISIS', 4: 'SEVERE', 3: 'SERIOUS', 2: 'NOTABLE', 1: 'WATCH', 0: 'WIN' };

// Spicy labels copied from public/shared/tone-system.json -> labels.{stories,eos,scotus,pardons}[level].spicy
// (the test asserts parity; edit tone-system.json first, then mirror here - edge functions cannot read /public).
const SPICY = {
  detail:  { 5: 'Constitutional Dumpster Fire', 4: 'Criminal Bullshit', 3: 'The Deep Swamp', 2: 'The Great Gaslight', 1: 'Accidental Sanity', 0: 'A Broken Clock Moment' },
  eos:     { 5: 'Authoritarian Power Grab', 4: 'Weaponized Executive', 3: 'Corporate Giveaway', 2: 'Smoke and Mirrors', 1: 'Surprisingly Not Terrible', 0: 'Actually Helpful' },
  scotus:  { 5: 'Constitutional Crisis', 4: 'Rubber-stamping Tyranny', 3: 'Institutional Sabotage', 2: 'Judicial Sidestepping', 1: 'Crumbs from the Bench', 0: 'Democracy Wins' },
  pardons: { 5: 'Pay 2 Win', 4: 'Cronies-in-Chief', 3: 'The Party Favor', 2: 'The PR Stunt', 1: 'The Ego Discount', 0: 'Actual Mercy' },
};

const TYPE_LABEL = { detail: 'Story', eos: 'Executive Order', scotus: 'SCOTUS', pardons: 'Pardon' };

// Same tables + publish gates as og-tags.ts ROUTE_CONFIGS. The test fails if they drift (AC 2).
export const ROUTES = {
  detail:  { table: 'stories',          select: 'id,primary_headline,alarm_level,last_updated_at',              filters: ['status=eq.active', 'summary_neutral=not.is.null'] },
  eos:     { table: 'executive_orders', select: 'id,title,alarm_level,order_number,updated_at',                 filters: ['is_public=eq.true'] },
  scotus:  { table: 'scotus_cases',     select: 'id,case_name_short,ruling_impact_level,decided_at,updated_at', filters: ['is_public=eq.true'] },
  pardons: { table: 'pardons',          select: 'id,recipient_name,corruption_level,updated_at',                filters: ['is_public=eq.true'] },
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function levelField(type, row) {
  if (type === 'pardons') return row.corruption_level;
  if (type === 'scotus') return row.ruling_impact_level;
  return row.alarm_level;
}

function headlineField(type, row) {
  if (type === 'detail') return row.primary_headline;
  if (type === 'eos') return row.title;
  if (type === 'scotus') return row.case_name_short;
  return row.recipient_name;
}

export function buildCardProps(type, row) {
  const raw = Number(levelField(type, row));
  const alarm = Number.isInteger(raw) && raw >= 0 && raw <= 5 ? raw : 2;
  const headline = String(headlineField(type, row) || 'TrumpyTracker').replace(/—/g, '-');
  const len = headline.length;
  return {
    headline,
    headlineSize: len <= 90 ? 44 : len <= 130 ? 36 : 32,
    alarm,
    label: ALARM_LABELS[alarm] ?? 'NOTABLE',
    badge: `${alarm} · ${SPICY[type]?.[alarm] ?? ALARM_LABELS[alarm]}`,
    typeLabel: TYPE_LABEL[type] ?? 'Story',
    receiptNo: row.id === undefined || row.id === null ? '' : String(row.id),
    dateText: fmtDate(row.decided_at || row.last_updated_at || row.updated_at || null),
  };
}
