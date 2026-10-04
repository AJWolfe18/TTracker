import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prefetchTrackerHome, takeBootTracker, takeBootTally, BOOT_MAX_AGE_MS } from '../lib/tracker-boot';

// ADO-605: the Tracker's first load starts at boot, alongside the flag file,
// and TrackerSpine takes the in-flight promises instead of asking again.

describe('tracker boot prefetch', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  let calls: string[];

  beforeEach(() => {
    calls = [];
    vi.stubGlobal('window', { location: { hostname: 'localhost', search: '' } });
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      calls.push(input);
      if (input.includes('/tracker_stats?')) {
        return { ok: true, json: async () => [{ developments: 10, alarm5_last30: 2, open_fronts: 3 }] };
      }
      return { ok: true, json: async () => [] };
    }));
    // Drain anything a previous test left behind
    takeBootTracker();
    takeBootTally();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
  });

  it('starts the main-line first page, pins and tally without waiting for anything', async () => {
    prefetchTrackerHome(0);
    const boot = takeBootTracker(10)!;
    const tally = takeBootTally(10)!;
    const page = await boot.page;
    expect(page?.state.stories.exhausted).toBe(true);
    expect(await tally).toEqual({ developments: 10, alarm5Last30: 2, openFronts: 3 });
    expect(calls.some(c => c.includes('/tracker_pin?'))).toBe(true);
    // main line: stories filtered on the server-computed main_line column
    expect(calls.some(c => c.includes('/v_tracker_stories?') && c.includes('main_line.is.true'))).toBe(true);
  });

  it('hands each result out once, so a later view or remount fetches fresh', () => {
    prefetchTrackerHome(0);
    expect(takeBootTracker(10)).not.toBeNull();
    expect(takeBootTracker(10)).toBeNull();
    expect(takeBootTally(10)).not.toBeNull();
    expect(takeBootTally(10)).toBeNull();
  });

  it('is not used once stale (a reader who left "/" and came back)', () => {
    prefetchTrackerHome(0);
    expect(takeBootTracker(BOOT_MAX_AGE_MS + 1)).toBeNull();
    expect(takeBootTally(BOOT_MAX_AGE_MS + 1)).toBeNull();
  });

  it('never prefetched (any page but "/") means nothing to take', () => {
    expect(takeBootTracker(0)).toBeNull();
    expect(takeBootTally(0)).toBeNull();
  });

  it('a total network failure resolves to null instead of rejecting', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    prefetchTrackerHome(0);
    const boot = takeBootTracker(1)!;
    // per-source failures degrade inside fetchTrackerPage: a page, every source errored
    const page = await boot.page;
    expect(page === null || Object.values(page.state).every(s => s.errored)).toBe(true);
    expect((await boot.pins).size).toBe(0);
  });
});
