import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  storyRowToEntry,
  eoRowToEntry,
  scotusRowToEntry,
  pardonRowToEntry,
  mergeEntries,
  buildSourcePath,
  initialTrackerState,
  fetchTrackerPage,
  coverageFrontier,
  visibleEntries,
  SOURCE_ROUTES,
  TERM_START,
  TIMELINE_SOURCES,
  type TimelineEntry,
  type TimelineSource,
  type TrackerState,
} from '../lib/timeline';

describe('timeline row adapters', () => {
  it('maps a story row, preferring alarm_level over severity', () => {
    const e = storyRowToEntry({
      id: 12, primary_headline: 'He did a thing', first_seen_at: '2026-08-01T10:00:00Z',
      alarm_level: 4, severity: 'watch',
    });
    expect(e).toEqual({
      id: 12, source: 'stories', date: '2026-08-01T10:00:00Z',
      headline: 'He did a thing', alarm: 4,
    });
  });

  it('falls back to severity mapping when alarm_level is null', () => {
    const e = storyRowToEntry({
      id: 1, primary_headline: 'x', first_seen_at: '2026-01-01', alarm_level: null, severity: 'critical',
    });
    expect(e.alarm).toBe(5);
  });

  it('defaults story alarm to 2 when both fields are missing', () => {
    const e = storyRowToEntry({ id: 1, primary_headline: 'x', first_seen_at: '2026-01-01' });
    expect(e.alarm).toBe(2);
  });

  it('clamps out-of-range alarm values', () => {
    expect(eoRowToEntry({ id: 'eo_1', title: 't', date: '2026-01-01', alarm_level: 99 }).alarm).toBe(5);
    expect(eoRowToEntry({ id: 'eo_1', title: 't', date: '2026-01-01', alarm_level: -3 }).alarm).toBe(0);
  });

  it('null alarm columns take the domain default, never 0 (Number(null) === 0 regression)', () => {
    expect(eoRowToEntry({ id: 'eo_1', title: 't', date: '2026-01-01', alarm_level: null }).alarm).toBe(3);
    expect(scotusRowToEntry({ id: 1, case_name: 'c', decided_at: '2026-01-01', ruling_impact_level: null }).alarm).toBe(3);
    expect(pardonRowToEntry({ id: 1, recipient_name: 'p', pardon_date: '2026-01-01', corruption_level: null }).alarm).toBe(2);
  });

  it('keeps EO string ids intact (PROD uses varchar ids)', () => {
    const e = eoRowToEntry({ id: 'eo_abc123', title: 'Order', date: '2026-02-02', alarm_level: 3 });
    expect(e.id).toBe('eo_abc123');
    expect(e.source).toBe('eos');
  });

  it('uses case_name_short when scotus case_name is missing', () => {
    const e = scotusRowToEntry({
      id: 7, case_name: null, case_name_short: 'Trump v. X',
      decided_at: '2026-06-01', ruling_impact_level: 4,
    });
    expect(e.headline).toBe('Trump v. X');
  });

  it('prefixes pardon headlines and includes nickname when present', () => {
    const plain = pardonRowToEntry({
      id: 3, recipient_name: 'Some Guy', nickname: null, pardon_date: '2026-03-03', corruption_level: 4,
    });
    expect(plain.headline).toBe('Pardoned: Some Guy');
    const nick = pardonRowToEntry({
      id: 4, recipient_name: 'Some Guy', nickname: 'The Fixer', pardon_date: '2026-03-03', corruption_level: 4,
    });
    expect(nick.headline).toBe('Pardoned: Some Guy ("The Fixer")');
  });
});

describe('mergeEntries', () => {
  const mk = (over: Partial<TimelineEntry>): TimelineEntry => ({
    id: 1, source: 'stories', date: '2026-01-01', headline: 'h', alarm: 2, ...over,
  });

  it('merges groups into one ascending chronological list', () => {
    const merged = mergeEntries([
      [mk({ id: 1, date: '2026-03-01' }), mk({ id: 2, date: '2026-01-15' })],
      [mk({ id: 'eo_9', source: 'eos', date: '2026-02-10' })],
    ]);
    expect(merged.map(e => e.date)).toEqual(['2026-01-15', '2026-02-10', '2026-03-01']);
  });

  it('drops entries with no date or no headline', () => {
    const merged = mergeEntries([[
      mk({ id: 1 }),
      mk({ id: 2, date: '' }),
      mk({ id: 3, headline: '' }),
    ]]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe(1);
  });

  it('sorts ties deterministically by id', () => {
    const merged = mergeEntries([[
      mk({ id: 20, date: '2026-01-01' }),
      mk({ id: 10, date: '2026-01-01' }),
    ]]);
    expect(merged.map(e => e.id)).toEqual([10, 20]);
  });
});

describe('SOURCE_ROUTES', () => {
  it('maps every source to its detail route prefix', () => {
    expect(SOURCE_ROUTES).toEqual({
      stories: 'detail', eos: 'eos', scotus: 'scotus', pardons: 'pardons',
    });
  });
});

describe('buildSourcePath', () => {
  const dec = (p: string) => decodeURIComponent(p);

  it('applies no alarm/cursor logic at min 0 with no cursor', () => {
    const p = buildSourcePath('stories', 0, null);
    expect(p).not.toContain('and=');
    expect(p).toContain('order=first_seen_at.desc,id.desc');
    expect(p).toContain('limit=60');
    expect(p).toContain('status=eq.active');
    expect(p).toContain('summary_neutral=not.is.null');
  });

  it('floors every source at inauguration day - the record is term 2 only', () => {
    expect(buildSourcePath('stories', 0, null)).toContain(`first_seen_at=gte.${TERM_START}`);
    expect(buildSourcePath('scotus', 0, null)).toContain(`decided_at=gte.${TERM_START}`);
    expect(buildSourcePath('eos', 0, null)).toContain(`date=gte.${TERM_START}`);
    expect(buildSourcePath('pardons', 0, null)).toContain(`pardon_date=gte.${TERM_START}`);
  });

  it('builds the stories alarm predicate with severity fallback per level', () => {
    expect(dec(buildSourcePath('stories', 4, null)))
      .toContain('or(alarm_level.gte.4,and(alarm_level.is.null,severity.in.(critical,severe)))');
    expect(dec(buildSourcePath('stories', 3, null)))
      .toContain('severity.in.(critical,severe,serious)');
    expect(dec(buildSourcePath('stories', 5, null)))
      .toContain('severity.in.(critical)');
  });

  it('treats null EO/SCOTUS alarm as 3: included at 3+, excluded at 4+', () => {
    expect(dec(buildSourcePath('eos', 3, null)))
      .toContain('or(alarm_level.gte.3,alarm_level.is.null)');
    expect(dec(buildSourcePath('eos', 4, null))).toContain('(alarm_level.gte.4)');
    expect(dec(buildSourcePath('eos', 4, null))).not.toContain('is.null');
    expect(dec(buildSourcePath('scotus', 3, null)))
      .toContain('or(ruling_impact_level.gte.3,ruling_impact_level.is.null)');
  });

  it('excludes null pardons (default alarm 2) from every filtered view', () => {
    expect(dec(buildSourcePath('pardons', 3, null))).toContain('(corruption_level.gte.3)');
    expect(dec(buildSourcePath('pardons', 3, null))).not.toContain('is.null');
  });

  it('adds a quoted keyset cursor: strictly older date, or same date + smaller id', () => {
    const p = dec(buildSourcePath('stories', 0, { date: '2026-08-01T10:00:00+00:00', id: 42 }));
    expect(p).toContain(
      'and=(or(first_seen_at.lt."2026-08-01T10:00:00+00:00",'
      + 'and(first_seen_at.eq."2026-08-01T10:00:00+00:00",id.lt."42")))',
    );
  });

  it('URL-encodes the cursor so timestamp "+" never reads as a space', () => {
    const p = buildSourcePath('stories', 0, { date: '2026-08-01T10:00:00+00:00', id: 42 });
    expect(p).not.toContain('+');
    expect(p).toContain('%2B');
  });

  it('combines alarm predicate and cursor under one and=()', () => {
    const p = dec(buildSourcePath('eos', 4, { date: '2026-05-01', id: 'eo_9' }));
    expect(p).toContain('and=(alarm_level.gte.4,or(date.lt."2026-05-01",and(date.eq."2026-05-01",id.lt."eo_9")))');
  });
});

describe('coverageFrontier', () => {
  const st = (over: Partial<TrackerState[keyof TrackerState]>) =>
    ({ cursor: null, exhausted: false, errored: false, ...over });

  it('returns the max cursor date among non-exhausted sources', () => {
    const state: TrackerState = {
      stories: st({ cursor: { date: '2026-08-10', id: 1 } }),
      eos: st({ cursor: { date: '2026-02-01', id: 1 } }),
      scotus: st({ cursor: { date: '2026-05-01', id: 1 }, exhausted: true }),
      pardons: st({ exhausted: true }),
    };
    expect(coverageFrontier(state)).toBe('2026-08-10');
  });

  it('returns null when every source is exhausted (show everything)', () => {
    const state: TrackerState = {
      stories: st({ cursor: { date: '2026-08-10', id: 1 }, exhausted: true }),
      eos: st({ exhausted: true }),
      scotus: st({ exhausted: true }),
      pardons: st({ exhausted: true }),
    };
    expect(coverageFrontier(state)).toBeNull();
  });
});

describe('visibleEntries', () => {
  const mk = (over: Partial<TimelineEntry>): TimelineEntry => ({
    id: 1, source: 'stories', date: '2026-01-01', headline: 'h', alarm: 4, ...over,
  });
  const base = { frontier: null, min: 0 as const, off: new Set<never>(), query: '' };

  it('combines alarm floor, source chips, and search', () => {
    const entries = [
      mk({ id: 1, alarm: 5, headline: 'Strikes ordered on Iran' }),
      mk({ id: 2, alarm: 3, headline: 'Iran carrier group' }),
      mk({ id: 3, source: 'eos', alarm: 5, headline: 'Iran sanctions order' }),
      mk({ id: 4, alarm: 5, headline: 'Epstein files released' }),
    ];
    const out = visibleEntries(entries, {
      frontier: null, min: 4, off: new Set<TimelineSource>(['eos']), query: 'iran',
    });
    expect(out.map(e => e.id)).toEqual([1]);
  });

  it('clamps to the coverage frontier and returns newest first', () => {
    const entries = mergeEntries([[
      mk({ id: 1, date: '2026-01-05' }),
      mk({ id: 2, date: '2026-03-05' }),
      mk({ id: 3, date: '2026-08-05' }),
    ]]);
    const out = visibleEntries(entries, { ...base, frontier: '2026-03-01' });
    expect(out.map(e => e.id)).toEqual([3, 2]);
  });

  it('shows everything when the frontier is null', () => {
    const entries = [mk({ id: 1, date: '2025-02-01' })];
    expect(visibleEntries(entries, base)).toHaveLength(1);
  });
});

describe('fetchTrackerPage', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  let calls: string[];

  const mkStoryRows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: 1000 - i,
      primary_headline: `Story ${i}`,
      first_seen_at: new Date(Date.UTC(2026, 7, 10) - i * 3600_000).toISOString(),
      alarm_level: 4,
      severity: null,
    }));

  beforeEach(() => {
    calls = [];
    vi.stubGlobal('window', { location: { hostname: 'localhost', search: '' } });
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      calls.push(input);
      if (input.includes('/stories?')) {
        return { ok: true, json: async () => mkStoryRows(60) };
      }
      if (input.includes('/executive_orders?')) {
        return {
          ok: true,
          json: async () => [{ id: 'eo_1', title: 'Order one', date: '2026-06-01', alarm_level: 4 }],
        };
      }
      if (input.includes('/scotus_cases?')) {
        return { ok: false, json: async () => [] };
      }
      throw new Error('network down'); // pardons
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
  });

  it('advances cursors, detects exhaustion, and degrades failed sources', async () => {
    const { entries, state } = await fetchTrackerPage(4, null);

    // stories: full page → not exhausted, cursor = oldest row fetched
    expect(state.stories.exhausted).toBe(false);
    expect(state.stories.cursor?.id).toBe(941);
    // eos: short page → exhausted, cursor still recorded
    expect(state.eos).toMatchObject({ exhausted: true, errored: false });
    expect(state.eos.cursor).toEqual({ date: '2026-06-01', id: 'eo_1' });
    // scotus (HTTP error) and pardons (network error): degraded, never thrown
    expect(state.scotus).toMatchObject({ exhausted: true, errored: true });
    expect(state.pardons).toMatchObject({ exhausted: true, errored: true });

    expect(entries).toHaveLength(61);
    expect(entries[0].date <= entries[entries.length - 1].date).toBe(true);
  });

  it('only refetches non-exhausted sources and pages via the cursor', async () => {
    const { state: first } = await fetchTrackerPage(4, null);
    calls = [];
    await fetchTrackerPage(4, first);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/stories?');
    expect(decodeURIComponent(calls[0])).toContain('id.lt."941"');
  });

  it('never advances an already-exhausted source', async () => {
    const state = initialTrackerState();
    for (const src of TIMELINE_SOURCES) state[src] = { ...state[src], exhausted: true };
    const { entries, state: next } = await fetchTrackerPage(0, state);
    expect(entries).toHaveLength(0);
    expect(calls).toHaveLength(0);
    expect(next).toEqual(state);
  });
});
