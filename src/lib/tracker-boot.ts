// Boot prefetch for the Tracker homepage (ADO-605).
// "/" cannot pick between The Tracker and the classic feed until the flag file
// arrives, and the Tracker used to start its own requests only after that, so
// a phone waited for HTML -> JS -> flags -> data in series. main.tsx starts the
// Tracker's first requests here at the same moment as the flag fetch, and
// TrackerSpine takes the in-flight promises on its first load instead of
// asking again. If rap_sheet turns out off nothing ever takes them, so
// nothing from them is ever shown.

import {
  fetchTrackerPage,
  fetchTrackerPins,
  fetchTrackerTally,
  type TimelineEntry,
  type TrackerPins,
  type TrackerState,
  type TrackerTally,
} from './timeline';

/** A boot result older than this is refetched instead (a reader who wandered off "/" and came back). */
export const BOOT_MAX_AGE_MS = 30_000;

export interface BootTracker {
  /** First page of the default view (the main line, every chip on); null if it failed */
  page: Promise<{ entries: TimelineEntry[]; state: TrackerState } | null>;
  pins: Promise<TrackerPins>;
}

let startedAt = 0;
let tracker: BootTracker | null = null;
let tally: Promise<TrackerTally | null> | null = null;

/** Start the Tracker's first-load requests. Called once from main.tsx, only on "/". */
export function prefetchTrackerHome(now: number = performance.now()): void {
  startedAt = now;
  // No signal: nothing can cancel these, and every failure resolves (never rejects)
  const pins = fetchTrackerPins().catch(() => new Map() as TrackerPins);
  tracker = {
    pins,
    page: fetchTrackerPage('main', null, undefined, pins).catch(() => null),
  };
  tally = fetchTrackerTally().catch(() => null);
}

const fresh = (now: number) => now - startedAt <= BOOT_MAX_AGE_MS;

/** The boot first page + pins, at most once and only while fresh; null means fetch normally. */
export function takeBootTracker(now: number = performance.now()): BootTracker | null {
  const t = tracker;
  tracker = null;
  return t && fresh(now) ? t : null;
}

/** The boot tally request, at most once and only while fresh; null means fetch normally. */
export function takeBootTally(now: number = performance.now()): Promise<TrackerTally | null> | null {
  const t = tally;
  tally = null;
  return t && fresh(now) ? t : null;
}
