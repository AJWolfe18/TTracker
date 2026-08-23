// ── The Tracker timeline (ADO-544 fetch layer, extended for ADO-545) ──
// One flat, chronological list of developments across every tracked domain.
// The spine pages backwards through history with per-source keyset cursors and
// server-side alarm predicates so the default view (alarm 4+) never bulk-fetches
// rows it won't show (egress rule, CLAUDE.md #11).

import { SEVERITY_TO_ALARM } from './adapter';

export type TimelineSource = 'stories' | 'eos' | 'scotus' | 'pardons';

/** The Tracker's scope: term 2 only. Bounds paging AND the tally counts. */
export const TERM_START = '2025-01-20';

/** The alarm segmented filter's positions: All / 3+ / 4+ / Only 5 */
export type AlarmMin = 0 | 3 | 4 | 5;

export interface TimelineEntry {
  id: string | number;
  source: TimelineSource;
  /** ISO date the development happened */
  date: string;
  headline: string;
  alarm: number;
}

export const SOURCE_LABELS: Record<TimelineSource, string> = {
  stories: 'Stories',
  scotus: 'Supreme Court',
  eos: 'Executive Orders',
  pardons: 'Pardons',
};

/** Route prefix for each source's detail page */
export const SOURCE_ROUTES: Record<TimelineSource, string> = {
  stories: 'detail',
  eos: 'eos',
  scotus: 'scotus',
  pardons: 'pardons',
};

function clampAlarm(n: unknown, fallback: number): number {
  // Number(null) is 0, not NaN — nulls must take the fallback, or every
  // null-alarm EO/SCOTUS row reads as alarm 0 and the client filter drops
  // rows the server's null-fallback predicate deliberately included
  if (n == null) return fallback;
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.min(5, v)) : fallback;
}

type Raw = Record<string, unknown>;

export function storyRowToEntry(raw: Raw): TimelineEntry {
  const severity = raw.severity as string | null;
  const alarm = raw.alarm_level != null
    ? clampAlarm(raw.alarm_level, 2)
    : (severity && SEVERITY_TO_ALARM[severity] != null ? SEVERITY_TO_ALARM[severity] : 2);
  return {
    id: raw.id as number,
    source: 'stories',
    date: (raw.first_seen_at as string) || '',
    headline: (raw.primary_headline as string) || '',
    alarm,
  };
}

export function eoRowToEntry(raw: Raw): TimelineEntry {
  return {
    id: raw.id as string | number,
    source: 'eos',
    date: (raw.date as string) || '',
    headline: (raw.title as string) || '',
    alarm: clampAlarm(raw.alarm_level, 3),
  };
}

export function scotusRowToEntry(raw: Raw): TimelineEntry {
  return {
    id: raw.id as number,
    source: 'scotus',
    date: (raw.decided_at as string) || '',
    headline: (raw.case_name as string) || (raw.case_name_short as string) || '',
    alarm: clampAlarm(raw.ruling_impact_level, 3),
  };
}

export function pardonRowToEntry(raw: Raw): TimelineEntry {
  const name = (raw.recipient_name as string) || '';
  const nickname = raw.nickname as string | null;
  return {
    id: raw.id as number,
    source: 'pardons',
    date: (raw.pardon_date as string) || '',
    headline: nickname ? `Pardoned: ${name} ("${nickname}")` : `Pardoned: ${name}`,
    alarm: clampAlarm(raw.corruption_level, 2),
  };
}

/** Merge per-source rows into one ascending chronological list, dropping undated rows. */
export function mergeEntries(groups: TimelineEntry[][]): TimelineEntry[] {
  return groups
    .flat()
    .filter(e => e.date && e.headline)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
}

// ── Per-source query specs ──

interface SourceSpec {
  table: string;
  select: string;
  /** Base row filters that always apply (published/public predicates) */
  base: string;
  dateCol: string;
  limit: number;
  adapter: (raw: Raw) => TimelineEntry;
  /**
   * Alarm predicate in PostgREST logic-tree syntax (goes inside `and=(...)`),
   * or null for "no filter". Null alarm columns follow each adapter's default:
   * stories fall back to severity, EOs/SCOTUS default to 3 (so nulls pass a
   * 3+ filter but not 4+), pardons default to 2 (nulls only pass "All").
   */
  alarm: (min: AlarmMin) => string | null;
}

// Tight selects on purpose — never widen these to * (egress rule, CLAUDE.md #11).
// Key order is the chip display order (mockup rev 6).
const SPECS: Record<TimelineSource, SourceSpec> = {
  stories: {
    table: 'stories',
    select: 'id,primary_headline,first_seen_at,alarm_level,severity',
    base: `status=eq.active&summary_neutral=not.is.null&first_seen_at=gte.${TERM_START}`,
    dateCol: 'first_seen_at',
    limit: 60,
    adapter: storyRowToEntry,
    alarm: min => {
      if (min === 0) return null;
      // Derived from the canonical adapter map so the server predicate can
      // never drift from the client-side severity fallback (Codex P1 on PR #126)
      const severities = Object.keys(SEVERITY_TO_ALARM)
        .filter(s => SEVERITY_TO_ALARM[s] >= min);
      return `or(alarm_level.gte.${min},and(alarm_level.is.null,severity.in.(${severities.join(',')})))`;
    },
  },
  scotus: {
    table: 'scotus_cases',
    select: 'id,case_name,case_name_short,decided_at,ruling_impact_level',
    base: `is_public=eq.true&decided_at=not.is.null&decided_at=gte.${TERM_START}`,
    dateCol: 'decided_at',
    limit: 25,
    adapter: scotusRowToEntry,
    alarm: min => {
      if (min === 0) return null;
      if (min === 3) return 'or(ruling_impact_level.gte.3,ruling_impact_level.is.null)';
      return `ruling_impact_level.gte.${min}`;
    },
  },
  eos: {
    table: 'executive_orders',
    select: 'id,title,date,alarm_level',
    base: `is_public=eq.true&date=gte.${TERM_START}`,
    dateCol: 'date',
    limit: 25,
    adapter: eoRowToEntry,
    alarm: min => {
      if (min === 0) return null;
      if (min === 3) return 'or(alarm_level.gte.3,alarm_level.is.null)';
      return `alarm_level.gte.${min}`;
    },
  },
  pardons: {
    table: 'pardons',
    select: 'id,recipient_name,nickname,pardon_date,corruption_level',
    base: `is_public=eq.true&pardon_date=gte.${TERM_START}`,
    dateCol: 'pardon_date',
    limit: 25,
    adapter: pardonRowToEntry,
    alarm: min => (min === 0 ? null : `corruption_level.gte.${min}`),
  },
};

export const TIMELINE_SOURCES = Object.keys(SPECS) as TimelineSource[];

// ── Keyset cursor paging ──

export interface SourceCursor {
  /** Raw date-column value of the oldest row fetched so far */
  date: string;
  id: string | number;
}

export interface SourceState {
  cursor: SourceCursor | null;
  /** No more rows (or the source errored — degrade to "done", never block the rest) */
  exhausted: boolean;
  /** Last fetch failed; used to hide the surface only when everything is down */
  errored: boolean;
}

export type TrackerState = Record<TimelineSource, SourceState>;

const quoted = (v: string | number) => `"${String(v).replace(/"/g, '')}"`;

/**
 * Build the PostgREST path for one source page. Pure — unit-tested.
 * Keyset pagination: order date desc, id desc; the next page is
 * (date < D) OR (date = D AND id < I). Values are quoted so timestamps
 * with `:`/`+` survive, and the whole logic tree is URL-encoded.
 */
export function buildSourcePath(
  source: TimelineSource,
  min: AlarmMin,
  cursor: SourceCursor | null,
): string {
  const s = SPECS[source];
  const conditions: string[] = [];
  const alarmFrag = s.alarm(min);
  if (alarmFrag) conditions.push(alarmFrag);
  if (cursor) {
    conditions.push(
      `or(${s.dateCol}.lt.${quoted(cursor.date)},`
      + `and(${s.dateCol}.eq.${quoted(cursor.date)},id.lt.${quoted(cursor.id)}))`,
    );
  }
  const logic = conditions.length ? `&and=${encodeURIComponent(`(${conditions.join(',')})`)}` : '';
  return `${s.table}?select=${s.select}&${s.base}${logic}`
    + `&order=${s.dateCol}.desc,id.desc&limit=${s.limit}`;
}

export function initialTrackerState(): TrackerState {
  const state = {} as TrackerState;
  for (const src of TIMELINE_SOURCES) {
    state[src] = { cursor: null, exhausted: false, errored: false };
  }
  return state;
}

/**
 * Fetch the next page for every non-exhausted source and advance its cursor.
 * Returns only the NEW entries (ascending); callers merge with what they hold.
 */
export async function fetchTrackerPage(
  min: AlarmMin,
  state: TrackerState | null,
  signal?: AbortSignal,
): Promise<{ entries: TimelineEntry[]; state: TrackerState }> {
  // Lazy import: lib/supabase reads window.location at module load, which would
  // break node-env unit tests that import this module's pure functions.
  const { url, anonKey } = await import('./supabase');
  const headers = {
    'apikey': anonKey,
    'Authorization': `Bearer ${anonKey}`,
  };

  const prev = state ?? initialTrackerState();
  const next: TrackerState = { ...prev };

  const groups = await Promise.all(
    TIMELINE_SOURCES.map(async source => {
      const st = prev[source];
      if (st.exhausted) return [];
      const spec = SPECS[source];
      try {
        const res = await fetch(`${url}/rest/v1/${buildSourcePath(source, min, st.cursor)}`, { headers, signal });
        if (!res.ok) {
          next[source] = { ...st, exhausted: true, errored: true };
          return [];
        }
        const rows: Raw[] = await res.json();
        const last = rows[rows.length - 1];
        next[source] = {
          cursor: last
            ? { date: (last[spec.dateCol] as string) || '', id: last.id as string | number }
            : st.cursor,
          exhausted: rows.length < spec.limit,
          errored: false,
        };
        return rows.map(spec.adapter);
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw err;
        // One source failing must not blank the whole Tracker
        next[source] = { ...st, exhausted: true, errored: true };
        return [];
      }
    }),
  );

  return { entries: mergeEntries(groups), state: next };
}

/**
 * The oldest date at which coverage is COMPLETE across all sources: the max
 * cursor date among sources that still have unfetched rows. Entries older than
 * this are buffered, not shown — otherwise a sparse source (25 EOs reach back
 * months, 60 stories reach back days) would fake gaps in the record.
 * Null means every source is exhausted: show everything.
 */
export function coverageFrontier(state: TrackerState): string | null {
  let frontier: string | null = null;
  for (const src of TIMELINE_SOURCES) {
    const st = state[src];
    if (st.exhausted || !st.cursor) continue;
    if (frontier === null || st.cursor.date > frontier) frontier = st.cursor.date;
  }
  return frontier;
}

export interface VisibleOptions {
  frontier: string | null;
  min: AlarmMin;
  off: ReadonlySet<TimelineSource>;
  query: string;
}

/** Apply the combined client-side filters. Returns newest-first (render order). */
export function visibleEntries(entries: TimelineEntry[], opts: VisibleOptions): TimelineEntry[] {
  const q = opts.query.trim().toLowerCase();
  const out = entries.filter(e =>
    !opts.off.has(e.source)
    && e.alarm >= opts.min
    && (opts.frontier === null || e.date >= opts.frontier)
    && (!q || e.headline.toLowerCase().includes(q)),
  );
  out.reverse();
  return out;
}

// ── Tally (headline numbers above the spine) ──

export interface TrackerTally {
  /** Total published developments across all four sources */
  developments: number | null;
  /** Alarm-5 developments in the last 30 days */
  alarm5Last30: number | null;
}

async function countRows(
  url: string,
  headers: Record<string, string>,
  path: string,
  signal?: AbortSignal,
): Promise<number | null> {
  try {
    // HEAD + count=exact: the total arrives in Content-Range with zero body egress
    const res = await fetch(`${url}/rest/v1/${path}`, {
      method: 'HEAD',
      headers: { ...headers, 'Prefer': 'count=exact' },
      signal,
    });
    if (!res.ok) return null;
    const range = res.headers.get('content-range') || '';
    const total = Number(range.split('/')[1]);
    return Number.isFinite(total) ? total : null;
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    return null;
  }
}

export async function fetchTrackerTally(signal?: AbortSignal): Promise<TrackerTally> {
  const { url, anonKey } = await import('./supabase');
  const headers = {
    'apikey': anonKey,
    'Authorization': `Bearer ${anonKey}`,
  };

  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const perSource = await Promise.all(
    TIMELINE_SOURCES.map(async source => {
      const s = SPECS[source];
      const alarm5 = s.alarm(5)!;
      const [total, worst] = await Promise.all([
        countRows(url, headers, `${s.table}?select=id&${s.base}`, signal),
        countRows(
          url, headers,
          `${s.table}?select=id&${s.base}&${s.dateCol}=gte.${since}`
          + `&and=${encodeURIComponent(`(${alarm5})`)}`,
          signal,
        ),
      ]);
      return { total, worst };
    }),
  );

  const sum = (vals: (number | null)[]) =>
    vals.every(v => v !== null) ? vals.reduce((a: number, b) => a + (b as number), 0) : null;

  return {
    developments: sum(perSource.map(p => p.total)),
    alarm5Last30: sum(perSource.map(p => p.worst)),
  };
}
