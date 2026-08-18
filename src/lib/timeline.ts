// ── Rap sheet timeline (ADO-544) ──
// One flat, chronological list of developments across every tracked domain.
// Fetches a recent window only: the inline strip must stay cheap (egress) and
// fast (LCP guardrail). The full-term view arrives with the expand overlay (ADO-545).

export type TimelineSource = 'stories' | 'eos' | 'scotus' | 'pardons';

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

const SEVERITY_TO_ALARM: Record<string, number> = {
  critical: 5, severe: 4, serious: 3, notable: 2, watch: 1, win: 0,
};

function clampAlarm(n: unknown, fallback: number): number {
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

interface SourceQuery {
  path: string;
  adapter: (raw: Raw) => TimelineEntry;
}

// Tight selects on purpose — never widen these to * (egress rule, CLAUDE.md #11).
const QUERIES: Record<TimelineSource, SourceQuery> = {
  stories: {
    path: 'stories?select=id,primary_headline,first_seen_at,alarm_level,severity'
      + '&status=eq.active&summary_neutral=not.is.null'
      + '&order=first_seen_at.desc,id.desc&limit=60',
    adapter: storyRowToEntry,
  },
  eos: {
    path: 'executive_orders?select=id,title,date,alarm_level'
      + '&is_public=eq.true&order=date.desc,id.desc&limit=25',
    adapter: eoRowToEntry,
  },
  scotus: {
    path: 'scotus_cases?select=id,case_name,case_name_short,decided_at,ruling_impact_level'
      + '&is_public=eq.true&decided_at=not.is.null'
      + '&order=decided_at.desc,id.desc&limit=25',
    adapter: scotusRowToEntry,
  },
  pardons: {
    path: 'pardons?select=id,recipient_name,nickname,pardon_date,corruption_level'
      + '&is_public=eq.true&order=pardon_date.desc,id.desc&limit=25',
    adapter: pardonRowToEntry,
  },
};

export async function fetchTimelineEntries(signal?: AbortSignal): Promise<TimelineEntry[]> {
  // Lazy import: lib/supabase reads window.location at module load, which would
  // break node-env unit tests that import this module's pure functions.
  const { url, anonKey } = await import('./supabase');
  const headers = {
    'apikey': anonKey,
    'Authorization': `Bearer ${anonKey}`,
  };

  const groups = await Promise.all(
    (Object.keys(QUERIES) as TimelineSource[]).map(async source => {
      const { path, adapter } = QUERIES[source];
      try {
        const res = await fetch(`${url}/rest/v1/${path}`, { headers, signal });
        if (!res.ok) return [];
        const rows: Raw[] = await res.json();
        return rows.map(adapter);
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw err;
        // One source failing must not blank the whole rap sheet
        return [];
      }
    }),
  );

  return mergeEntries(groups);
}
