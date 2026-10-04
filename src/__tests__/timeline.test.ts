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
  fetchTrackerTally,
  fetchTrackerPins,
  forceShowIdsBySource,
  pinKey,
  coverageFrontier,
  visibleEntries,
  allOnExhausted,
  allOnErrored,
  anyOnErrored,
  retryErrored,
  catchUpSource,
  displayedFrontier,
  rememberFrontier,
  olderFrontier,
  behindSources,
  trackerProgress,
  countScope,
  coverageGaps,
  CATCH_UP_MAX_PAGES,
  FRONTIER_PENDING,
  holdFrontier,
  SOURCE_ROUTES,
  TERM_START,
  TIMELINE_SOURCES,
  type TimelineEntry,
  type TimelineSource,
  type TrackerPins,
  type TrackerState,
} from '../lib/timeline';

describe('timeline row adapters', () => {
  it('maps a story row, preferring alarm_level over severity', () => {
    const e = storyRowToEntry({
      id: 12, primary_headline: 'He did a thing', first_seen_at: '2026-08-01T10:00:00Z',
      alarm_level: 4, severity: 'low',
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

  it('maps every DB severity value - moderate is alarm 3, not the fallback (Codex P1)', () => {
    const alarmFor = (severity: string) =>
      storyRowToEntry({ id: 1, primary_headline: 'x', first_seen_at: '2026-01-01', alarm_level: null, severity }).alarm;
    expect(alarmFor('critical')).toBe(5);
    expect(alarmFor('severe')).toBe(4);
    expect(alarmFor('moderate')).toBe(3);
    expect(alarmFor('minor')).toBe(2);
    expect(alarmFor('low')).toBe(1);
    expect(alarmFor('positive')).toBe(0);
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

  it('keeps one entry per source + id (backstop against double injection)', () => {
    const merged = mergeEntries([
      [mk({ id: 'eo_1', source: 'eos', date: '2026-03-01' })],
      [mk({ id: 'eo_1', source: 'eos', date: '2026-03-01' }), mk({ id: 'eo_1', source: 'stories', date: '2026-03-01' })],
    ]);
    expect(merged.map(e => `${e.source}:${e.id}`)).toEqual(['eos:eo_1', 'stories:eo_1']);
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
    // status/enrichment predicates are baked into v_tracker_stories (ADO-554)
    expect(p).toContain('v_tracker_stories?');
    expect(p).not.toContain('status=');
  });

  it("main view: stories filter on the server-computed main_line, others get the alarm-5 loose-end bar", () => {
    expect(dec(buildSourcePath('stories', 'main', null))).toContain('and=(main_line.is.true)');
    expect(dec(buildSourcePath('eos', 'main', null))).toContain('and=(alarm_level.gte.5)');
    expect(dec(buildSourcePath('scotus', 'main', null))).toContain('ruling_impact_level.gte.5');
    expect(dec(buildSourcePath('pardons', 'main', null))).toContain('corruption_level.gte.5');
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
      .toContain('severity.in.(critical,severe,moderate)');
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

  it('ignores sources whose chip is switched off (ADO-593)', () => {
    const state: TrackerState = {
      stories: st({ cursor: { date: '2026-08-10', id: 1 } }),
      eos: st({ cursor: { date: '2026-06-01', id: 1 } }),
      scotus: st({ exhausted: true }),
      pardons: st({ cursor: { date: '2026-03-01', id: 1 } }),
    };
    expect(coverageFrontier(state, new Set<TimelineSource>(['stories']))).toBe('2026-06-01');
    expect(coverageFrontier(state, new Set<TimelineSource>(['stories', 'eos']))).toBe('2026-03-01');
    expect(coverageFrontier(state, new Set<TimelineSource>(TIMELINE_SOURCES))).toBeNull();
  });

  it('keeps the list exactly as it was while a chip switched back on waits for its first page (ADO-593 review)', () => {
    // Pardons reach back to March; stories were off for the load, so no cursor yet
    const state: TrackerState = {
      stories: st({}),
      eos: st({ exhausted: true }),
      scotus: st({ exhausted: true }),
      pardons: st({ cursor: { date: '2026-03-01', id: 1 } }),
    };
    const pardonsOnly = new Set<TimelineSource>(['stories', 'eos', 'scotus']);
    const storiesBackOn = new Set<TimelineSource>(['eos', 'scotus']);
    const entries: TimelineEntry[] = [
      { id: 1, source: 'pardons', date: '2026-03-01', headline: 'p', alarm: 5 },
      { id: 2, source: 'pardons', date: '2026-09-30T23:59:59+00:00', headline: 'p2', alarm: 5 },
    ];
    const shownIds = (frontier: string | null, off: ReadonlySet<TimelineSource>) =>
      visibleEntries(entries, { frontier, min: 0, off, query: '' }).map(e => e.id);

    const before = holdFrontier(state, pardonsOnly, null);
    expect(before).toBe('2026-03-01');
    expect(shownIds(before, pardonsOnly)).toEqual([2, 1]);

    // Stories back on: its first page is pending, so the previous frontier is
    // kept and the list does not collapse or move while it loads
    expect(coverageFrontier(state, storiesBackOn)).toBe(FRONTIER_PENDING);
    const pending = holdFrontier(state, storiesBackOn, before);
    expect(pending).toBe('2026-03-01');
    expect(shownIds(pending, storiesBackOn)).toEqual([2, 1]);

    // Once the first page lands, the stories cursor sets the frontier as usual
    state.stories = st({ cursor: { date: '2026-08-07', id: 9 } });
    expect(holdFrontier(state, storiesBackOn, pending)).toBe('2026-08-07');
  });

  it('never falls back to "show everything" while a chip is pending and nothing is held yet (ADO-593 review)', () => {
    const storiesBackOn = new Set<TimelineSource>(['eos', 'scotus']);
    // A chip switched on mid-load: no frontier rendered yet for this view.
    // Hold at the most restrictive cursor of the sources already on.
    const loading: TrackerState = {
      stories: st({}),
      eos: st({ exhausted: true }),
      scotus: st({ exhausted: true }),
      pardons: st({ cursor: { date: '2026-03-01', id: 1 } }),
    };
    expect(holdFrontier(loading, storiesBackOn, null)).toBe('2026-03-01');

    // Exhausted and errored sources are skipped exactly as coverageFrontier
    // skips them: their newer cursors must not tighten the hold
    const mixed: TrackerState = {
      stories: st({}),
      eos: st({ exhausted: true, errored: true, cursor: { date: '2026-08-01', id: 'eo_1' } }),
      scotus: st({ exhausted: true, cursor: { date: '2026-07-01', id: 2 } }),
      pardons: st({ cursor: { date: '2026-03-01', id: 1 } }),
    };
    expect(holdFrontier(mixed, new Set(), null)).toBe('2026-03-01');
    expect(holdFrontier(mixed, new Set(), null))
      .toBe(coverageFrontier(mixed, new Set<TimelineSource>(['stories'])));

    // Every loaded source on is exhausted (the held value was a genuine null):
    // nothing is known about the pending one, so show nothing, never everything
    const doneOn: TrackerState = {
      stories: st({}),
      eos: st({ exhausted: true, cursor: { date: '2025-02-01', id: 'eo_1' } }),
      scotus: st({ exhausted: true }),
      pardons: st({ exhausted: true, cursor: { date: '2025-03-15', id: 1 } }),
    };
    expect(holdFrontier(doneOn, new Set(), null)).toBe(FRONTIER_PENDING);

    // No source on has loaded anything: show nothing, never everything
    const empty: TrackerState = { stories: st({}), eos: st({}), scotus: st({ exhausted: true }), pardons: st({ exhausted: true }) };
    expect(holdFrontier(empty, new Set(), null)).toBe(FRONTIER_PENDING);
  });
});

describe('allOnExhausted / allOnErrored (only switched-on sources count)', () => {
  const st = (over: Partial<TrackerState[keyof TrackerState]>) =>
    ({ cursor: null, exhausted: false, errored: false, ...over });
  const failed = st({ exhausted: true, errored: true });

  it('every switched-on source failed counts as an outage, even though off sources were never fetched', () => {
    const state: TrackerState = { stories: st({}), eos: st({}), scotus: failed, pardons: failed };
    const off = new Set<TimelineSource>(['stories', 'eos']);
    expect(allOnErrored(state, off)).toBe(true);
    expect(allOnExhausted(state, off)).toBe(true);
    expect(allOnErrored(state, new Set())).toBe(false);
  });

  it('one switched-on source still up is not an outage', () => {
    const state: TrackerState = { stories: st({ cursor: { date: '2026-08-07', id: 1 } }), eos: failed, scotus: failed, pardons: failed };
    expect(allOnErrored(state, new Set())).toBe(false);
    expect(allOnExhausted(state, new Set())).toBe(false);
  });

  it('every chip switched off is a choice, not an outage, and leaves nothing to load', () => {
    const state: TrackerState = { stories: failed, eos: failed, scotus: failed, pardons: failed };
    const allOff = new Set<TimelineSource>(TIMELINE_SOURCES);
    expect(allOnErrored(state, allOff)).toBe(false);
    expect(allOnExhausted(state, allOff)).toBe(true);
  });

  it('only EOs on and EOs failed is an inline error, never a hidden Tracker (ADO-593 review)', () => {
    // EOs errored on load, the rest loaded; the reader leaves only EOs on.
    // The section (and its chips) hides only when ALL four sources failed,
    // whatever the chips say, so the reader can always switch back.
    const ok = st({ cursor: { date: '2026-08-07', id: 1 } });
    const state: TrackerState = { stories: ok, eos: failed, scotus: ok, pardons: ok };
    const onlyEos = new Set<TimelineSource>(['stories', 'scotus', 'pardons']);
    expect(allOnErrored(state, onlyEos)).toBe(true);           // inline message under the chips
    expect(allOnErrored(state, new Set())).toBe(false);        // the hide check: not every source failed
    const allDown: TrackerState = { stories: failed, eos: failed, scotus: failed, pardons: failed };
    expect(allOnErrored(allDown, new Set())).toBe(true);
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
      if (input.includes('/v_tracker_stories?')) {
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
    expect(calls[0]).toContain('/v_tracker_stories?');
    expect(decodeURIComponent(calls[0])).toContain('id.lt."941"');
  });

  it('a failed LATER page is retryable, not "the whole record" (Codex P1 on PR #158)', async () => {
    const { state: first } = await fetchTrackerPage(4, null);
    // Page 2 of stories fails: the source degrades to errored + exhausted
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      calls.push(input);
      return { ok: false, json: async () => [] };
    }));
    const { state: failedState } = await fetchTrackerPage(4, first);
    expect(failedState.stories).toMatchObject({ exhausted: true, errored: true, cursor: { id: 941 } });

    const none = new Set<TimelineSource>();
    // Every source now reads exhausted, but the errored ones are owed a retry
    expect(allOnExhausted(failedState, none)).toBe(true);
    expect(anyOnErrored(failedState, none)).toBe(true);
    const retry = retryErrored(failedState, none);
    expect(allOnExhausted(retry, none)).toBe(false);
    // The retry resumes from the failed page's cursor; healthy sources are untouched
    expect(retry.stories).toEqual({ cursor: first.stories.cursor, exhausted: false, errored: false });
    expect(retry.eos).toEqual(failedState.eos);

    // Retrying refetches only the errored sources, from where they stopped
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      calls.push(input);
      return { ok: true, json: async () => [] };
    }));
    calls = [];
    const { state: after } = await fetchTrackerPage(4, retry);
    expect(calls.map(c => c.split('/rest/v1/')[1].split('?')[0]).sort())
      .toEqual(['pardons', 'scotus_cases', 'v_tracker_stories']);
    expect(decodeURIComponent(calls.find(c => c.includes('/v_tracker_stories?'))!)).toContain('id.lt."941"');
    expect(anyOnErrored(after, none)).toBe(false);
  });

  it('retryErrored leaves switched-off sources alone', () => {
    const state = initialTrackerState();
    state.eos = { cursor: null, exhausted: true, errored: true };
    state.pardons = { cursor: null, exhausted: true, errored: true };
    const eosOff = new Set<TimelineSource>(['eos']);
    expect(anyOnErrored(state, new Set<TimelineSource>(['eos', 'pardons']))).toBe(false);
    const retry = retryErrored(state, eosOff);
    expect(retry.eos).toEqual(state.eos);
    expect(retry.pardons).toEqual({ cursor: null, exhausted: false, errored: false });
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

describe('source chips (ADO-593): switched-off sources are not paged or counted', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  let calls: string[];
  const ONLY_PARDONS = new Set<TimelineSource>(['stories', 'eos', 'scotus']);
  const NONE_OFF = new Set<TimelineSource>();

  // Shaped like PROD "All": a full page of 60 stories reaches back only to
  // August 8, while a full page of 25 pardons reaches back to April.
  const storyRows = Array.from({ length: 60 }, (_, i) => ({
    id: 1000 - i,
    primary_headline: `Story ${i}`,
    first_seen_at: new Date(Date.UTC(2026, 7, 10) - i * 3600_000).toISOString(),
    alarm_level: 4,
    severity: null,
  }));
  const pardonRows = Array.from({ length: 25 }, (_, i) => ({
    id: 500 - i,
    recipient_name: `Donor ${i}`,
    pardon_date: new Date(Date.UTC(2026, 5, 30) - i * 3 * 86400_000).toISOString().slice(0, 10),
    corruption_level: 5,
  }));
  const storyFrontier = storyRows[storyRows.length - 1].first_seen_at;

  beforeEach(() => {
    calls = [];
    vi.stubGlobal('window', { location: { hostname: 'localhost', search: '' } });
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      calls.push(input);
      if (input.includes('/v_tracker_stories?')) return { ok: true, json: async () => storyRows };
      if (input.includes('/pardons?')) return { ok: true, json: async () => pardonRows };
      if (input.includes('/executive_orders?')) {
        return { ok: true, json: async () => [{ id: 'eo_1', title: 'Order one', date: '2026-07-01', alarm_level: 5 }] };
      }
      return { ok: true, json: async () => [] }; // scotus
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
  });

  const shown = (entries: TimelineEntry[], state: TrackerState, off: ReadonlySet<TimelineSource>, min: 0 | 5 = 0) =>
    visibleEntries(entries, { frontier: coverageFrontier(state, off), min, off, query: '' });

  it('All with only Pardons on shows pardons older than the story frontier', async () => {
    const { entries, state } = await fetchTrackerPage(0, null, undefined, undefined, ONLY_PARDONS);
    const out = shown(entries, state, ONLY_PARDONS);
    expect(out).toHaveLength(25);
    expect(out.every(e => e.source === 'pardons')).toBe(true);
    expect(out.every(e => e.date < storyFrontier)).toBe(true);
  });

  it('switching the other chips off after an All load shows the older pardons too', async () => {
    // The reported case: everything loads, then the reader switches chips off.
    const { entries, state } = await fetchTrackerPage(0, null, undefined, undefined, NONE_OFF);
    expect(coverageFrontier(state, NONE_OFF)).toBe(storyFrontier);
    const out = shown(entries, state, ONLY_PARDONS);
    expect(out).toHaveLength(25);
    expect(out.every(e => e.source === 'pardons')).toBe(true);
  });

  it('switched-off sources are not fetched, on the first page or on load earlier', async () => {
    const { state } = await fetchTrackerPage(0, null, undefined, undefined, ONLY_PARDONS);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/pardons?');
    // Untouched, so switching the chip back on starts from its first page
    expect(state.stories).toEqual({ cursor: null, exhausted: false, errored: false });

    calls = [];
    await fetchTrackerPage(0, state, undefined, undefined, ONLY_PARDONS);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/pardons?');
    expect(decodeURIComponent(calls[0])).toContain('id.lt."476"');
  });

  it('switching a chip back on fetches it', async () => {
    const { state } = await fetchTrackerPage(0, null, undefined, undefined, ONLY_PARDONS);
    calls = [];
    // Stories back on: its first page (no cursor) is fetched
    const stillOff = new Set<TimelineSource>(['eos', 'scotus', 'pardons']);
    const { entries, state: next } = await fetchTrackerPage(0, state, undefined, undefined, stillOff);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/v_tracker_stories?');
    expect(decodeURIComponent(calls[0])).not.toContain('id.lt.');
    expect(entries).toHaveLength(60);
    expect(next.stories.cursor?.id).toBe(941);
    expect(next.pardons).toEqual(state.pardons);
  });

  it('switching a chip back on in the main line still surfaces its force_shown pins', async () => {
    const pins: TrackerPins = new Map([[pinKey('eos', 'eo_low'), 'force_show']]);
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      calls.push(input);
      if (input.includes('/executive_orders?') && input.includes('id=in.')) {
        return { ok: true, json: async () => [{ id: 'eo_low', title: 'Quiet order', date: '2026-03-01', alarm_level: 2 }] };
      }
      return { ok: true, json: async () => [] };
    }));
    const eosOff = new Set<TimelineSource>(['eos']);
    const { entries, state } = await fetchTrackerPage('main', null, undefined, pins, eosOff);
    expect(calls.some(c => c.includes('/executive_orders?'))).toBe(false);
    expect(entries.some(e => e.id === 'eo_low')).toBe(false);

    calls = [];
    const { entries: more } = await fetchTrackerPage('main', state, undefined, pins, NONE_OFF);
    expect(calls.some(c => c.includes('/executive_orders?') && !c.includes('id=in.'))).toBe(true);
    expect(more.map(e => e.id)).toEqual(['eo_low']);
  });

  it('Only 5 behaves as before', async () => {
    const { entries, state } = await fetchTrackerPage(5, null, undefined, undefined, ONLY_PARDONS);
    expect(shown(entries, state, ONLY_PARDONS, 5)).toHaveLength(25);

    // With every chip on, the off set changes nothing: same requests, same frontier
    calls = [];
    const plain = await fetchTrackerPage(5, null);
    const plainCalls = calls;
    calls = [];
    const withSet = await fetchTrackerPage(5, null, undefined, undefined, NONE_OFF);
    expect(calls).toEqual(plainCalls);
    expect(calls).toHaveLength(4);
    expect(withSet.state).toEqual(plain.state);
    expect(coverageFrontier(withSet.state, NONE_OFF)).toBe(coverageFrontier(plain.state));
  });

  it('everything switched off shows nothing and fetches nothing', async () => {
    const allOff = new Set<TimelineSource>(TIMELINE_SOURCES);
    const { entries, state } = await fetchTrackerPage(0, null, undefined, undefined, allOff);
    expect(calls).toHaveLength(0);
    expect(entries).toHaveLength(0);
    expect(state).toEqual(initialTrackerState());

    // Rows already loaded stay hidden while every chip is off
    const loaded = await fetchTrackerPage(0, null, undefined, undefined, NONE_OFF);
    expect(shown(loaded.entries, loaded.state, allOff)).toHaveLength(0);
  });
});

describe('catch-up when a chip is switched back on (ADO-593, Josh approved)', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  let calls: string[];
  let failStoriesAfter: number;
  const DAY = 86400_000;

  // Keyset-aware mock: each table is a long newest-first list, and a request
  // with `id.lt."N"` returns the next page after id N.
  const storyAt = (i: number) => ({
    id: 5000 - i, primary_headline: `Story ${i}`, alarm_level: 4, severity: null,
    first_seen_at: new Date(Date.UTC(2026, 7, 10) - i * DAY / 2).toISOString(), // every 12 hours
  });
  const pardonAt = (i: number) => ({
    id: 900 - i, recipient_name: `Donor ${i}`, corruption_level: 5,
    pardon_date: new Date(Date.UTC(2026, 5, 30) - i * 3 * DAY).toISOString().slice(0, 10), // every 3 days
  });
  const page = (input: string, base: number, total: number, limit: number, at: (i: number) => object) => {
    const m = /id\.lt\."(\d+)"/.exec(decodeURIComponent(input));
    const start = m ? base - Number(m[1]) + 1 : 0;
    return Array.from({ length: Math.max(0, Math.min(limit, total - start)) }, (_, k) => at(start + k));
  };
  let storyPages: number;

  beforeEach(() => {
    calls = [];
    storyPages = 0;
    failStoriesAfter = Infinity;
    vi.stubGlobal('window', { location: { hostname: 'localhost', search: '' } });
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: { signal?: AbortSignal }) => {
      if (init?.signal?.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
      calls.push(input);
      if (input.includes('/v_tracker_stories?')) {
        if (++storyPages > failStoriesAfter) return { ok: false, json: async () => [] };
        return { ok: true, json: async () => page(input, 5000, 1000, 60, storyAt) };
      }
      if (input.includes('/pardons?')) return { ok: true, json: async () => page(input, 900, 100, 25, pardonAt) };
      return { ok: true, json: async () => [] }; // eos, scotus: nothing
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
  });

  const STORIES_OFF = new Set<TimelineSource>(['stories']);
  const NONE_OFF = new Set<TimelineSource>();
  // Only pardons on (eos and scotus are empty in this mock anyway)
  const STORIES_OFF_AND_EMPTY = new Set<TimelineSource>(['stories', 'eos', 'scotus']);
  const key = (e: TimelineEntry) => `${e.source}:${e.id}`;

  /** Everything on, then Stories off and "load earlier" once: pardons reach back to February. */
  async function storiesOffAndPagedBack() {
    const first = await fetchTrackerPage(0, null);
    const more = await fetchTrackerPage(0, first.state, undefined, undefined, STORIES_OFF);
    return { entries: mergeEntries([first.entries, more.entries]), state: more.state };
  }

  it('(a) Stories back on: Stories pages until it reaches the frontier on screen, and no shown row disappears', async () => {
    const { entries, state } = await storiesOffAndPagedBack();
    const target = coverageFrontier(state, STORIES_OFF);
    expect(target).toBe(pardonAt(49).pardon_date);
    const shownBefore = visibleEntries(entries, { frontier: target, min: 0, off: STORIES_OFF, query: '' }).map(key);
    expect(state.stories.cursor!.date > target!).toBe(true); // stale cursor: the jump this fixes

    calls = [];
    const caught = await catchUpSource(0, state, 'stories', target);
    expect(calls.every(c => c.includes('/v_tracker_stories?'))).toBe(true);
    expect(caught.pages).toBeGreaterThan(1);
    expect(caught.pages).toBeLessThanOrEqual(CATCH_UP_MAX_PAGES);
    expect(caught.state.stories.cursor!.date <= target!).toBe(true);
    expect(caught.state.pardons).toEqual(state.pardons);

    const all = mergeEntries([entries, caught.entries]);
    const frontierAfter = coverageFrontier(caught.state, NONE_OFF);
    const shownAfter = new Set(visibleEntries(all, { frontier: frontierAfter, min: 0, off: NONE_OFF, query: '' }).map(key));
    expect(shownBefore.filter(k => !shownAfter.has(k))).toEqual([]);
  });

  it('(b) stops at the 10-page cap when the target is further back', async () => {
    const { state } = await storiesOffAndPagedBack();
    calls = [];
    const caught = await catchUpSource(0, state, 'stories', '2025-03-01');
    expect(CATCH_UP_MAX_PAGES).toBe(10);
    expect(caught.pages).toBe(10);
    expect(calls).toHaveLength(10);
    expect(caught.state.stories.exhausted).toBe(false); // "load earlier" carries on from here
  });

  it('(c) switching the chip off mid-catch-up stops fetching; a view change aborts it', async () => {
    const { state } = await storiesOffAndPagedBack();
    calls = [];
    let checks = 0;
    const caught = await catchUpSource(0, state, 'stories', '2025-03-01', { stillOn: () => ++checks <= 2 });
    expect(calls).toHaveLength(2);
    expect(caught.pages).toBe(2);

    calls = [];
    const ac = new AbortController();
    let n = 0;
    const run = catchUpSource(0, state, 'stories', '2025-03-01', {
      signal: ac.signal,
      stillOn: () => { if (++n === 3) ac.abort(); return true; },
    });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toHaveLength(2);
  });

  it('(d) a failed catch-up page stops it and leaves the retry footer, never "the whole record"', async () => {
    const { state } = await storiesOffAndPagedBack();
    failStoriesAfter = storyPages + 2; // the third catch-up page fails
    const caught = await catchUpSource(0, state, 'stories', '2025-03-01');
    expect(caught.pages).toBe(3);
    expect(caught.state.stories).toMatchObject({ errored: true, exhausted: true });
    expect(anyOnErrored(caught.state, NONE_OFF)).toBe(true);
    expect(allOnExhausted(retryErrored(caught.state, NONE_OFF), NONE_OFF)).toBe(false);
  });

  const shownKeys = (entries: TimelineEntry[], frontier: string | null, off: ReadonlySet<TimelineSource>) =>
    visibleEntries(entries, { frontier, min: 0, off, query: '' }).map(key);

  it('cap hit before the target: the displayed frontier does not move newer, no row disappears', async () => {
    const { entries, state } = await storiesOffAndPagedBack();
    const shown = displayedFrontier(state, STORIES_OFF, undefined);
    const shownBefore = shownKeys(entries, shown, STORIES_OFF);

    const caught = await catchUpSource(0, state, 'stories', shown, { maxPages: 2 });
    expect(caught.state.stories.cursor!.date > shown!).toBe(true); // cap hit short of the target
    const all = mergeEntries([entries, caught.entries]);
    const after = displayedFrontier(caught.state, NONE_OFF, shown);
    expect(after).toBe(shown);
    const shownAfter = new Set(shownKeys(all, after, NONE_OFF));
    expect(shownBefore.filter(k => !shownAfter.has(k))).toEqual([]);
    // Stories is still behind, so "load earlier" pages it first and the count says "Updating…"
    expect(behindSources(caught.state, NONE_OFF, after)).toEqual(['stories']);
  });

  it('a successful retry from an old cursor does not move the displayed frontier newer', async () => {
    const first = await fetchTrackerPage(0, null);
    let shown = displayedFrontier(first.state, NONE_OFF, undefined);
    // Stories page 2 fails while pardons page on, so the frontier moves older to February
    failStoriesAfter = storyPages;
    const failed = await fetchTrackerPage(0, first.state);
    expect(failed.state.stories).toMatchObject({ errored: true, exhausted: true });
    const entries = mergeEntries([first.entries, failed.entries]);
    shown = displayedFrontier(failed.state, NONE_OFF, shown);
    expect(shown).toBe(pardonAt(49).pardon_date);
    const shownBefore = shownKeys(entries, shown, NONE_OFF);

    // Retry succeeds: Stories gets one page from its July cursor
    failStoriesAfter = Infinity;
    const retry = retryErrored(failed.state, NONE_OFF);
    expect(behindSources(retry, NONE_OFF, shown)).toEqual(['stories']); // "load earlier" pages it alone
    const retried = await fetchTrackerPage(0, retry, undefined, undefined, new Set(['eos', 'scotus', 'pardons']));
    expect(coverageFrontier(retried.state, NONE_OFF)! > shown!).toBe(true); // what used to jump
    const after = displayedFrontier(retried.state, NONE_OFF, shown);
    expect(after).toBe(shown);
    const shownAfter = new Set(shownKeys(mergeEntries([entries, retried.entries]), after, NONE_OFF));
    expect(shownBefore.filter(k => !shownAfter.has(k))).toEqual([]);
  });

  it('a view change resets the displayed frontier; within a view it only moves older', () => {
    const st = (over: Partial<TrackerState[keyof TrackerState]>) =>
      ({ cursor: null, exhausted: false, errored: false, ...over });
    const state: TrackerState = {
      stories: st({ cursor: { date: '2026-08-07', id: 1 } }),
      eos: st({ exhausted: true }),
      scotus: st({ exhausted: true }),
      pardons: st({ cursor: { date: '2026-03-01', id: 1 } }),
    };
    // Same view, older frontier already on screen: it stays
    expect(displayedFrontier(state, NONE_OFF, '2026-02-01')).toBe('2026-02-01');
    // Same view, the computed frontier is older: it moves older
    expect(displayedFrontier(state, NONE_OFF, '2026-09-01')).toBe('2026-08-07');
    // Null (everything shown) stays null within the view
    expect(displayedFrontier(state, NONE_OFF, null)).toBeNull();
    // New view (nothing displayed yet): starts from the computed frontier
    expect(displayedFrontier(state, NONE_OFF, undefined)).toBe('2026-08-07');
    expect(olderFrontier('2026-03-01', FRONTIER_PENDING)).toBe('2026-03-01');
    expect(olderFrontier(null, '2026-03-01')).toBeNull();
  });

  it('a null frontier from "no switched-on source can constrain" never sticks (ADO-593 review, HIGH)', async () => {
    const ALL_OFF = new Set<TimelineSource>(TIMELINE_SOURCES);

    // 1. View loaded with every chip off: nothing to show, nothing remembered
    const empty = await fetchTrackerPage(0, null, undefined, undefined, ALL_OFF);
    let prev: string | null | undefined = undefined;
    let shown = displayedFrontier(empty.state, ALL_OFF, prev);
    expect(shown).toBeNull();
    prev = rememberFrontier(empty.state, ALL_OFF, prev, shown);
    expect(prev).toBeUndefined();
    // Pardons on: its first page sets a real frontier, and nothing is "behind"
    const pardonsOn = await fetchTrackerPage(0, empty.state, undefined, undefined, STORIES_OFF_AND_EMPTY);
    shown = displayedFrontier(pardonsOn.state, STORIES_OFF_AND_EMPTY, prev);
    expect(shown).toBe(pardonAt(24).pardon_date);
    expect(behindSources(pardonsOn.state, STORIES_OFF_AND_EMPTY, shown)).toEqual([]);
    prev = rememberFrontier(pardonsOn.state, STORIES_OFF_AND_EMPTY, prev, shown);

    // 2. Every chip switched off: the frontier on screen is kept, not nulled
    expect(displayedFrontier(pardonsOn.state, ALL_OFF, prev)).toBe(prev);
    expect(rememberFrontier(pardonsOn.state, ALL_OFF, prev, shown)).toBe(prev);

    // 3. Every switched-on source failed: also kept, so a later success is not stuck at null
    const failed: TrackerState = { ...pardonsOn.state, pardons: { ...pardonsOn.state.pardons, exhausted: true, errored: true } };
    expect(coverageFrontier(failed, STORIES_OFF_AND_EMPTY)).toBeNull();
    expect(displayedFrontier(failed, STORIES_OFF_AND_EMPTY, prev)).toBe(prev);
    expect(rememberFrontier(failed, STORIES_OFF_AND_EMPTY, prev, shown)).toBe(prev);

    // 4. Real "everything loaded" (sources on, exhausted, with rows) may be null
    const done: TrackerState = { ...pardonsOn.state, pardons: { ...pardonsOn.state.pardons, exhausted: true } };
    expect(displayedFrontier(done, STORIES_OFF_AND_EMPTY, prev)).toBeNull();
    expect(rememberFrontier(done, STORIES_OFF_AND_EMPTY, prev, null)).toBeNull();
  });

  it('a null target means no catch-up: nothing is fetched', async () => {
    const { state } = await storiesOffAndPagedBack();
    calls = [];
    const caught = await catchUpSource(0, state, 'stories', null);
    expect(calls).toHaveLength(0);
    expect(caught.pages).toBe(0);
    expect(caught.state).toEqual(state);
  });

  it('idle but behind: normal count line, button says which source is catching up', async () => {
    const { state } = await storiesOffAndPagedBack();
    const shown = displayedFrontier(state, STORIES_OFF, undefined);
    const caught = await catchUpSource(0, state, 'stories', shown, { maxPages: 2 });
    const behind = behindSources(caught.state, NONE_OFF, displayedFrontier(caught.state, NONE_OFF, shown));
    expect(behind).toEqual(['stories']);

    // Idle (nothing in flight): no "Updating…", the button explains itself, and
    // not busy, so an empty search still gets its "nothing matches" message
    expect(trackerProgress({ refreshing: false, loadingMore: false, failed: false, behind }))
      .toEqual({ updating: false, busy: false, button: 'Load earlier · catching up Stories ↓' });
    // A catch-up page in flight: "Updating…"
    expect(trackerProgress({ refreshing: false, loadingMore: true, failed: false, behind }))
      .toEqual({ updating: true, busy: true, button: 'Loading earlier…' });
    // Plain "load earlier" with nothing behind keeps the count line, but is busy
    expect(trackerProgress({ refreshing: false, loadingMore: true, failed: false, behind: [] }))
      .toMatchObject({ updating: false, busy: true });
    expect(trackerProgress({ refreshing: false, loadingMore: false, failed: false, behind: [] }).button)
      .toBe('Keep going · load earlier ↓');
    // A failure wins: retry first
    expect(trackerProgress({ refreshing: false, loadingMore: false, failed: true, behind }).button)
      .toBe('Try again · load earlier ↓');
    expect(trackerProgress({ refreshing: false, loadingMore: false, failed: false, behind: ['stories', 'pardons'] }).button)
      .toBe('Load earlier · catching up Stories, Pardons ↓');
    expect(trackerProgress({ refreshing: true, loadingMore: false, failed: false, behind: [] }).updating).toBe(true);
  });

  it('cap hit before the target: the gap is marked on the spine and the count never says "the complete record" (Codex P1 on #158)', async () => {
    const { entries, state } = await storiesOffAndPagedBack();
    const shown = displayedFrontier(state, STORIES_OFF, undefined);
    const caught = await catchUpSource(0, state, 'stories', shown, { maxPages: 2 });
    const after = displayedFrontier(caught.state, NONE_OFF, shown);
    const behind = behindSources(caught.state, NONE_OFF, after);
    const visible = visibleEntries(mergeEntries([entries, caught.entries]), { frontier: after, min: 0, off: NONE_OFF, query: '' });

    const gaps = coverageGaps(visible, caught.state, behind);
    const reached = caught.state.stories.cursor!.date;
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ source: 'stories', from: reached });
    // Everything above the marker is at or after the date Stories reached; below it, only older rows
    expect(visible.slice(0, gaps[0].index).every(e => e.date >= reached)).toBe(true);
    expect(visible.slice(gaps[0].index).every(e => e.date < reached && e.source !== 'stories')).toBe(true);
    expect(gaps[0].index).toBeLessThan(visible.length); // pardons carry on below it

    expect(countScope(0, behind)).toBe(' · catching up Stories');
    expect(countScope('main', behind)).toBe(' · the main line · catching up Stories');
    expect(countScope(3, behind)).toBe(' at alarm 3+ · catching up Stories');
    expect(countScope(0, [])).toBe(' · the complete record');

    // Caught up all the way: no marker
    const done = await catchUpSource(0, caught.state, 'stories', shown);
    expect(coverageGaps(visible, done.state, behindSources(done.state, NONE_OFF, after))).toEqual([]);
  });

  it('coverage gap placement: nothing loaded goes on top, past the last row goes at the end', () => {
    const st = (over: Partial<TrackerState[keyof TrackerState]>) =>
      ({ cursor: null, exhausted: false, errored: false, ...over });
    const state: TrackerState = {
      stories: st({ cursor: { date: '2026-01-01', id: 1 } }),
      eos: st({}),
      scotus: st({ exhausted: true }),
      pardons: st({ cursor: { date: '2026-05-01', id: 1 } }),
    };
    const row = (date: string): TimelineEntry =>
      ({ source: 'pardons', id: date, date, headline: date, alarm: 3 });
    const visible = [row('2026-06-01'), row('2026-05-01')];
    expect(coverageGaps(visible, state, ['eos', 'stories'])).toEqual([
      { source: 'eos', from: null, index: 0 },
      { source: 'stories', from: '2026-01-01', index: 2 },
    ]);
    expect(coverageGaps(visible, state, [])).toEqual([]);
  });

  it('a never-fetched source catches up from its first page', async () => {
    const first = await fetchTrackerPage(0, null, undefined, undefined, STORIES_OFF);
    const more = await fetchTrackerPage(0, first.state, undefined, undefined, STORIES_OFF);
    const target = coverageFrontier(more.state, STORIES_OFF);
    calls = [];
    const caught = await catchUpSource(0, more.state, 'stories', target);
    expect(decodeURIComponent(calls[0])).not.toContain('id.lt.');
    expect(caught.state.stories.cursor!.date <= target!).toBe(true);
  });
});

describe('tracker pins (ADO-554)', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  let calls: string[];

  beforeEach(() => {
    calls = [];
    vi.stubGlobal('window', { location: { hostname: 'localhost', search: '' } });
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      calls.push(input);
      if (input.includes('/tracker_pin?')) {
        return {
          ok: true,
          json: async () => [
            { source: 'eos', entity_id: 'eo_low', pin: 'force_show' },
            { source: 'eos', entity_id: 'eo_bad', pin: 'force_hide' },
            { source: 'pardons', entity_id: '77', pin: 'force_show' },
            { source: 'stories', entity_id: '5', pin: 'force_show' },
          ],
        };
      }
      if (input.includes('/v_tracker_stories?')) {
        return { ok: true, json: async () => [] };
      }
      if (input.includes('/executive_orders?') && input.includes('id=in.')) {
        return {
          ok: true,
          json: async () => [
            { id: 'eo_low', title: 'Quiet but nasty order', date: '2026-03-01', alarm_level: 2 },
          ],
        };
      }
      if (input.includes('/executive_orders?')) {
        return {
          ok: true,
          json: async () => [
            { id: 'eo_bad', title: 'Hidden order', date: '2026-06-01', alarm_level: 5 },
            { id: 'eo_kept', title: 'Visible order', date: '2026-05-01', alarm_level: 5 },
          ],
        };
      }
      if (input.includes('/pardons?') && input.includes('id=in.')) {
        // the pinned pardon is ALSO in the alarm-5 stream: must not be injected twice
        return {
          ok: true,
          json: async () => [{ id: 77, recipient_name: 'Big Donor', pardon_date: '2026-04-01', corruption_level: 5 }],
        };
      }
      if (input.includes('/pardons?')) {
        return {
          ok: true,
          json: async () => [{ id: 77, recipient_name: 'Big Donor', pardon_date: '2026-04-01', corruption_level: 5 }],
        };
      }
      return { ok: true, json: async () => [] }; // scotus
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
  });

  it('fetchTrackerPins maps rows and degrades to empty on failure', async () => {
    const pins = await fetchTrackerPins();
    expect(pins.get(pinKey('eos', 'eo_low'))).toBe('force_show');
    expect(pins.get(pinKey('eos', 'eo_bad'))).toBe('force_hide');

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => [] })));
    expect((await fetchTrackerPins()).size).toBe(0);
  });

  it('forceShowIdsBySource groups non-stories force_show pins only', () => {
    const pins: TrackerPins = new Map([
      [pinKey('eos', 'eo_low'), 'force_show'],
      [pinKey('eos', 'eo_bad'), 'force_hide'],
      [pinKey('pardons', 77), 'force_show'],
      [pinKey('stories', 5), 'force_show'], // server-side, excluded here
    ]);
    expect(forceShowIdsBySource(pins)).toEqual({ eos: ['eo_low'], pardons: ['77'] });
  });

  it('main view drops force_hidden non-stories entries and injects force_shown ones once', async () => {
    const pins = await fetchTrackerPins();
    const { entries } = await fetchTrackerPage('main', null, undefined, pins);

    const ids = entries.map(e => `${e.source}:${e.id}`);
    expect(ids).not.toContain('eos:eo_bad');            // force_hide dropped
    expect(ids).toContain('eos:eo_kept');               // untouched stream row
    expect(ids).toContain('eos:eo_low');                // alarm 2, injected by pin
    // pinned pardon at alarm 5 arrives via the stream — exactly once
    expect(ids.filter(id => id === 'pardons:77')).toHaveLength(1);
  });

  it('buffers an injected old pin behind the coverage frontier, then renders it at its date (Codex P1 on PR #128)', async () => {
    // A pinned row surfaces AT ITS DATE, by design: the frontier must not be
    // bypassed (that would fake completeness of an unloaded range). This pins
    // down the full pipeline: fetchTrackerPage → coverageFrontier → visibleEntries.
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.includes('/tracker_pin?')) {
        return { ok: true, json: async () => [{ source: 'eos', entity_id: 'eo_low', pin: 'force_show' }] };
      }
      if (input.includes('/executive_orders?') && input.includes('id=in.')) {
        return {
          ok: true,
          json: async () => [{ id: 'eo_low', title: 'Quiet but nasty order', date: '2026-03-01', alarm_level: 4 }],
        };
      }
      if (input.includes('/executive_orders?')) {
        // A FULL page (limit 25) → eos stays non-exhausted with cursor 2026-06-01,
        // so the frontier sits months after the injected pin's date.
        return {
          ok: true,
          json: async () => Array.from({ length: 25 }, (_, i) => ({
            id: `eo_s${i}`, title: `Order ${i}`, alarm_level: 5,
            date: `2026-06-${String(25 - i).padStart(2, '0')}`,
          })),
        };
      }
      return { ok: true, json: async () => [] }; // stories view, scotus, pardons
    }));

    const pins = await fetchTrackerPins();
    const { entries, state } = await fetchTrackerPage('main', null, undefined, pins);

    const frontier = coverageFrontier(state);
    expect(frontier).toBe('2026-06-01');

    const opts = { min: 0 as const, off: new Set<TimelineSource>(), query: '' };
    // While coverage stops at June, the March pin is buffered — not lost, not shown.
    const early = visibleEntries(entries, { ...opts, frontier });
    expect(early.some(e => e.id === 'eo_low')).toBe(false);
    expect(entries.some(e => e.id === 'eo_low')).toBe(true);

    // Once every source is exhausted (frontier null), the pin renders at its date.
    const done = visibleEntries(entries, { ...opts, frontier: null });
    const ids = done.map(e => e.id);
    expect(ids).toContain('eo_low');
    expect(ids.indexOf('eo_low')).toBe(ids.length - 1); // oldest → rendered last (newest first)
  });

  it('a failed first page injects no pins, and its retry injects them exactly once (ADO-593 review)', async () => {
    let eosUp = false;
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.includes('/tracker_pin?')) {
        return { ok: true, json: async () => [{ source: 'eos', entity_id: 'eo_low', pin: 'force_show' }] };
      }
      if (input.includes('/executive_orders?') && input.includes('id=in.')) {
        return { ok: true, json: async () => [{ id: 'eo_low', title: 'Quiet order', date: '2026-03-01', alarm_level: 2 }] };
      }
      if (input.includes('/executive_orders?')) {
        return eosUp ? { ok: true, json: async () => [] } : { ok: false, json: async () => [] };
      }
      return { ok: true, json: async () => [] };
    }));
    const pins = await fetchTrackerPins();
    const none = new Set<TimelineSource>();

    const first = await fetchTrackerPage('main', null, undefined, pins);
    expect(first.state.eos).toMatchObject({ errored: true, cursor: null });
    expect(first.entries.some(e => e.id === 'eo_low')).toBe(false);

    eosUp = true;
    const retry = await fetchTrackerPage('main', retryErrored(first.state, none), undefined, pins);
    const all = mergeEntries([first.entries, retry.entries]);
    expect(all.filter(e => e.source === 'eos' && e.id === 'eo_low')).toHaveLength(1);
  });

  it('starts the force_show lookup before the source pages answer (ADO-605: no serial round trip)', async () => {
    let releasePages!: () => void;
    const pagesHeld = new Promise<void>(r => { releasePages = r; });
    const order: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.includes('id=in.')) {
        order.push('pin lookup');
        return { ok: true, json: async () => [{ id: 'eo_low', title: 'Quiet order', date: '2026-03-01', alarm_level: 2 }] };
      }
      order.push('page');
      await pagesHeld; // no page answers until the lookup has had its chance to start
      return { ok: true, json: async () => [] };
    }));
    const pins: TrackerPins = new Map([[pinKey('eos', 'eo_low'), 'force_show']]);
    const pending = fetchTrackerPage('main', null, undefined, Promise.resolve(pins));
    await vi.waitFor(() => expect(order).toContain('pin lookup'));
    releasePages();
    const { entries } = await pending;
    expect(entries.map(e => e.id)).toContain('eo_low');
  });

  it('does not re-inject force_shown rows on later pages', async () => {
    const pins = await fetchTrackerPins();
    const { state } = await fetchTrackerPage('main', null, undefined, pins);
    calls = [];
    await fetchTrackerPage('main', state, undefined, pins);
    expect(calls.some(c => c.includes('id=in.'))).toBe(false);
  });
});

describe('fetchTrackerTally (ADO-570: one GET on tracker_stats)', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  let calls: string[];

  beforeEach(() => {
    calls = [];
    vi.stubGlobal('window', { location: { hostname: 'localhost', search: '' } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  it('reads the precomputed row with a single request', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      calls.push(input);
      return { ok: true, json: async () => [{ developments: 1234, alarm5_last30: 7, open_fronts: 8 }] };
    }));
    const t = await fetchTrackerTally();
    expect(t).toEqual({ developments: 1234, alarm5Last30: 7, openFronts: 8 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/rest/v1/tracker_stats?');
    expect(calls[0]).not.toContain('v_tracker_stories');
  });

  it('yields nulls (tiles hidden, no crash) when the row is missing or the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
    expect(await fetchTrackerTally()).toEqual({ developments: null, alarm5Last30: null, openFronts: null });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => [] })));
    expect(await fetchTrackerTally()).toEqual({ developments: null, alarm5Last30: null, openFronts: null });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    expect(await fetchTrackerTally()).toEqual({ developments: null, alarm5Last30: null, openFronts: null });
  });

  it('rethrows AbortError so navigation cancels cleanly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }));
    await expect(fetchTrackerTally()).rejects.toMatchObject({ name: 'AbortError' });
  });
});
