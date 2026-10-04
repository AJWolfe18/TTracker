import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { useTheme } from '@/hooks/useTheme';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { ErrorState } from '@/edge-states/ErrorState';
import { alarmPalette } from '@/tokens';
import { fmtDate } from '@/lib/date-utils';
import { track, toAnalyticsItemType } from '@/lib/analytics';
import {
  fetchTrackerPage,
  fetchTrackerPins,
  fetchTrackerTally,
  displayedFrontier,
  rememberFrontier,
  behindSources,
  visibleEntries,
  allOnExhausted,
  allOnErrored,
  anyOnErrored,
  retryErrored,
  catchUpSource,
  countScope,
  coverageGaps,
  trackerProgress,
  mergeEntries,
  alignStoryLabels,
  effectiveOff,
  entryKind,
  kindsEmptyMessage,
  labelKey,
  ACTION_KINDS,
  ACTION_KIND_LABELS,
  FRONTIER_PENDING,
  SOURCE_LABELS,
  ENTRY_TYPE_LABELS,
  SOURCE_ROUTES,
  TERM_START,
  TIMELINE_SOURCES,
  type ActionKind,
  type TimelineEntry,
  type TimelineSource,
  type TrackerPins,
  type TrackerState,
  type TrackerTally,
  type TrackerView,
} from '@/lib/timeline';
import { takeBootTally, takeBootTracker } from '@/lib/tracker-boot';

/** Every Tracker event is tagged with this tab so it never blends into the News feed. */
const TRACKER_TAB = 'tracker';

// The Tracker (ADO-545): the homepage rap sheet as a vertical center-spine
// timeline, replacing the W1.1 horizontal strip. The bar is the timeline;
// entries alternate left/right, newest first, with month markers on the bar.
// Type and dot size follow alarm level. Default view = the curated main line
// (ADO-554: PRD §12 anchor rule + tracker_pin overrides, computed server-side
// for stories, pins client-side for the rest); "All" recovers the complete
// record. Below 760px it collapses to a single column with the spine on the
// left. Approved design: mockup rev 6.

const VIEW_STOPS: { label: string; view: TrackerView }[] = [
  { label: 'Main line', view: 'main' },
  { label: 'All', view: 0 },
  { label: 'Alarm 3+', view: 3 },
  { label: 'Only 5', view: 5 },
];

const INAUGURATION = new Date(`${TERM_START}T00:00:00`);

function useIsNarrow(px: number): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width: ${px}px)`).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${px}px)`);
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [px]);
  return narrow;
}

/** The "said" marker (PRD §14.5): a small speech bubble, never a hollow dot (hollow = EO/SCOTUS/pardon). */
function SpeechBubble({ size, fill, stroke, style }: {
  size: number; fill: string; stroke?: string; style?: React.CSSProperties;
}) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" style={{ flex: 'none', overflow: 'visible', ...style }}>
      <path
        d="M8 1.5C4.1 1.5 1 4.1 1 7.3c0 1.8 1 3.4 2.6 4.4L2.8 15l3.9-2.2c.4.1.9.1 1.3.1 3.9 0 7-2.6 7-5.7S11.9 1.5 8 1.5z"
        fill={fill}
        {...(stroke ? { stroke, strokeWidth: 2.5, paintOrder: 'stroke', strokeLinejoin: 'round' as const } : {})}
      />
    </svg>
  );
}

const monthLabel = (ym: string) =>
  new Date(ym + '-01T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

interface TrackerSpineProps {
  /**
   * Set when the spine IS the page (TrackerHome): a total fetch failure renders
   * the error state instead of the section quietly removing itself, which is
   * the right behavior only when other content sits below it.
   */
  standalone?: boolean;
}

export function TrackerSpine({ standalone = false }: TrackerSpineProps) {
  const enabled = useFeatureFlag('rap_sheet');
  // Did / Said / Analysis (ADO-594 S6, PRD §14.5). Off: no label column is
  // selected and every query, row and control is exactly as before.
  const labelsOn = useFeatureFlag('did_said');
  const { theme, headType, mode } = useTheme();
  const [, navigate] = useLocation();
  const narrow = useIsNarrow(760);

  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [pageState, setPageState] = useState<TrackerState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [view, setView] = useState<TrackerView>('main');
  const [off, setOff] = useState<Set<TimelineSource>>(new Set());
  const [query, setQuery] = useState('');
  const [tally, setTally] = useState<TrackerTally | null>(null);
  // Chips switched back on that are paging to catch up with the frontier that
  // was on screen when they went on; the first one's target is held meanwhile
  // (`labels`: the Did/Said/Analysis filter a stories catch-up pages under)
  const [catchUps, setCatchUps] = useState<{ id: number; source: TimelineSource; target: string; labels?: string }[]>([]);
  const catchUpIdRef = useRef(0);
  // Did/Said/Analysis chips switched off; undefined with the did_said flag off
  const [kindsOffState, setKindsOff] = useState<Set<ActionKind>>(new Set());
  const kindsOff = labelsOn ? kindsOffState : undefined;
  const kindsOffRef = useRef(kindsOff);
  kindsOffRef.current = kindsOff;
  // The sources not fetched or counted: the source chips, plus EOs, SCOTUS and
  // pardons while Did is off (all of it is `off` itself with the flag off)
  const effOff = useMemo(() => effectiveOff(off, kindsOff), [off, kindsOff]);

  const acRef = useRef<AbortController | null>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  // Pins are fetched once per mount (tiny table) and reused across view
  // changes and paging; a failed fetch degrades to "no pins" for the session.
  const pinsRef = useRef<TrackerPins | null>(null);
  // Switched-off sources are not fetched (ADO-593). The first-page effect reads
  // the chips through a ref so toggling one never refetches the whole view.
  const offRef = useRef(off);
  offRef.current = off;
  // The view pageState was fetched for, so a chip switched back on is never
  // paged with a stale view's cursors while the new view loads.
  const pageViewRef = useRef<TrackerView | null>(null);
  // The frontier on screen: it never moves newer until the next first-page
  // load, which clears it (undefined = nothing displayed yet for this load)
  const displayedRef = useRef<string | null | undefined>(undefined);
  // pageState as the chips see it: a stories stream paged under other
  // Did/Said/Analysis chips reads as not fetched yet, so it is paged afresh
  // exactly like a source chip switched back on (pageState itself with the flag off)
  const ps = useMemo(
    () => (pageState ? alignStoryLabels(pageState, kindsOff) : null),
    [pageState, kindsOff],
  );

  // First page — refetched whenever the view changes, because the server-side
  // predicate (main_line or alarm floor) is baked into every source's cursor
  // stream. The current list stays on screen until the new one arrives:
  // clearing it collapses the page height and scroll-anchoring yanks the
  // viewport around.
  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    acRef.current = ac;
    setLoadingMore(false);
    setCatchUps([]); // a view change aborts any catch-up (its cursors belong to the old view)
    setRefreshing(true);
    (async () => {
      // The default view's first load was already started at boot, alongside
      // the flag file (ADO-605); later loads and other views fetch here. The
      // boot page carries action_label with every chip on, so it serves the
      // did_said flag on or off.
      const boot = view === 'main' && offRef.current.size === 0 && (kindsOffRef.current?.size ?? 0) === 0 ? takeBootTracker() : null;
      // Pins and source pages fetch CONCURRENTLY (the pins promise is only
      // awaited inside fetchTrackerPage after every page response arrives) —
      // serializing them added a full round-trip to first paint (ADO-568).
      const pins = view === 'main'
        ? (pinsRef.current
            ? Promise.resolve(pinsRef.current)
            : (boot?.pins ?? fetchTrackerPins(ac.signal))
                .then(p => (pinsRef.current = p))
                .catch(() => undefined))
        : undefined;
      const { entries: page, state } = (boot && await boot.page)
        ?? await fetchTrackerPage(view, null, ac.signal, pins, offRef.current, kindsOffRef.current);
      if (ac.signal.aborted) return;
      setEntries(page);
      setPageState(state);
      pageViewRef.current = view;
      // Every completed first page starts the frontier afresh, even for the
      // same view (main → All → main before All lands, or the flag toggling)
      displayedRef.current = undefined;
      setLoaded(true);
      setRefreshing(false);
    })().catch(() => { /* the Tracker is additive — never break the homepage */ });
    return () => ac.abort();
  }, [enabled, view, labelsOn]);

  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    (takeBootTally() ?? fetchTrackerTally(ac.signal))
      .then(t => { if (!ac.signal.aborted && t) setTally(t); })
      .catch(() => {});
    return () => ac.abort();
  }, [enabled]);

  // One more page for every source not in `skip`, merged into what is held.
  // Shared by "load earlier" and a chip switched back on.
  const fetchMore = (state: TrackerState, skip: ReadonlySet<TimelineSource>) => {
    const ac = acRef.current;
    setLoadingMore(true);
    fetchTrackerPage(view, state, ac?.signal, view === 'main' ? pinsRef.current ?? undefined : undefined, skip, kindsOff)
      .then(({ entries: more, state: next }) => {
        if (ac?.signal.aborted) return;
        setEntries(prev => mergeEntries([prev, more]));
        setPageState(next);
      })
      .catch(() => {})
      // unconditional: an abort mid-flight must not leave the button stuck
      .finally(() => setLoadingMore(false));
  };

  // Chips switched back on, one fetch at a time (one effect, so two fetches
  // never race on pageState):
  // - a queued catch-up pages only its source until it reaches the frontier
  //   that was on screen (capped; "load earlier" carries on after the cap).
  //   The displayed frontier never moves newer, so nothing on screen
  //   disappears either way.
  // - otherwise a source switched on that was never fetched (it was off when
  //   the view loaded, and no catch-up was queued) gets its first page.
  useEffect(() => {
    // An aborted load (flag switched off mid-session) must not retry on a dead signal forever
    if (!enabled || acRef.current?.signal.aborted) return;
    if (!ps || refreshing || loadingMore || pageViewRef.current !== view) return;
    const pins = view === 'main' ? pinsRef.current ?? undefined : undefined;
    if (catchUps.length > 0) {
      const { id, source, target, labels } = catchUps[0];
      const ac = acRef.current;
      setLoadingMore(true);
      catchUpSource(view, ps, source, target, {
        signal: ac?.signal,
        pins,
        kindsOff,
        // A Did/Said/Analysis change re-pages stories under the new filter, so
        // a stories catch-up under the old one stops too
        stillOn: () => !effectiveOff(offRef.current, kindsOffRef.current).has(source)
          && (labels === undefined || !kindsOffRef.current || labelKey(kindsOffRef.current) === labels),
      })
        .then(({ entries: more, state: next }) => {
          if (ac?.signal.aborted) return;
          setEntries(prev => mergeEntries([prev, more]));
          setPageState(next);
        })
        .catch(() => {})
        .finally(() => {
          // Only the entry that ran: an off-then-on toggle mid-run queued a fresh one
          if (!ac?.signal.aborted) setCatchUps(q => q.filter(c => c.id !== id));
          setLoadingMore(false);
        });
      return;
    }
    const unfetched = TIMELINE_SOURCES.filter(s => !effOff.has(s) && !ps[s].exhausted && !ps[s].cursor);
    if (unfetched.length === 0) return;
    fetchMore(ps, new Set(TIMELINE_SOURCES.filter(s => !unfetched.includes(s))));
  }, [enabled, ps, effOff, kindsOff, refreshing, loadingMore, view, catchUps]);

  // The frontier on screen only moves older within a view (a chip switched
  // back on, a capped catch-up or a retry from an old cursor would otherwise
  // pull rows out from under the reader); every first-page load starts afresh.
  const frontier = ps ? displayedFrontier(ps, effOff, displayedRef.current) : null;
  if (ps) displayedRef.current = rememberFrontier(ps, effOff, displayedRef.current, frontier);
  // Sources switched on that are short of that frontier: "load earlier" pages
  // them first; the count line says "Updating…" only while one is loading
  const behind = ps ? behindSources(ps, effOff, frontier) : [];
  // In the main-line view the server (plus pins) already decided inclusion —
  // the client alarm floor must be 0 or it would drop low-alarm front
  // openings and force_shown entries the rule deliberately included.
  const minAlarm = view === 'main' ? 0 : view;
  const visible = useMemo(
    () => visibleEntries(entries, { frontier, min: minAlarm, off: effOff, query, kindsOff }),
    [entries, frontier, minAlarm, effOff, query, kindsOff],
  );

  // "Load earlier" pages from here: a source that failed (on any page) is
  // reopened at its last good cursor, so the same button retries it
  const pageFrom = ps ? retryErrored(ps, effOff) : null;
  // Only the sources switched on count (off sources are never fetched), and a
  // failed source is never "the whole record"
  const allExhausted = pageFrom !== null && allOnExhausted(pageFrom, effOff);
  const someOnFailed = ps !== null && anyOnErrored(ps, effOff);
  // Every source switched on failed: an inline message under the chips, so the
  // reader can switch another source on
  const onSourcesFailed = ps !== null && allOnErrored(ps, effOff);
  // All four sources failed, whatever the chips say
  const allErrored = ps !== null && allOnErrored(ps, new Set());

  if (!enabled) return null;
  // Every source down and nothing to show: hide the surface (or, standalone, say so)
  if (loaded && allErrored && entries.length === 0) {
    return standalone ? <ErrorState /> : null;
  }

  const loadEarlier = () => {
    if (!pageFrom || loadingMore || refreshing || allExhausted) return;
    // Sources behind the frontier on screen (including a retried one) catch
    // up before the others advance
    const first = behindSources(pageFrom, effOff, frontier);
    fetchMore(pageFrom, first.length ? new Set(TIMELINE_SOURCES.filter(s => !first.includes(s))) : off);
  };

  // Changing the view swaps in a list of a different length; if the reader is
  // scrolled deep, snap back to the controls so the change is legible instead
  // of the browser clamping scroll somewhere arbitrary.
  const changeView = (v: TrackerView) => {
    track('filter_apply', { tab: TRACKER_TAB, filter_key: 'view', filter_value: String(v) });
    setView(v);
    const el = controlsRef.current;
    if (el && el.getBoundingClientRect().top < 0) {
      el.scrollIntoView({ block: 'start', behavior: 'instant' as ScrollBehavior });
    }
  };

  // A catch-up for a source switched on, or null: only when it is behind the
  // frontier on screen (never fetched, or its cursor is newer than that
  // frontier). With everything showing (null) there is nothing to catch up
  // to; "load earlier" catches it up instead.
  const catchUpFor = (s: TimelineSource, st: TrackerState[TimelineSource] | undefined, labels?: string) => {
    if (st && !st.exhausted && !refreshing && pageViewRef.current === view
      && frontier !== null && frontier !== FRONTIER_PENDING
      && (!st.cursor || st.cursor.date > frontier)) {
      return { id: ++catchUpIdRef.current, source: s, target: frontier, labels };
    }
    return null;
  };

  const toggleSource = (s: TimelineSource) => {
    // filter_value records the resulting state, not the click itself.
    track('filter_apply', { tab: TRACKER_TAB, filter_key: `source_${s}`, filter_value: off.has(s) ? 'on' : 'off' });
    if (!off.has(s)) {
      // Switched off: drop any catch-up for it (a running one stops before its next page)
      setCatchUps(q => q.filter(c => c.source !== s));
    } else if (!effectiveOff(new Set([...off].filter(x => x !== s)), kindsOff).has(s)) {
      // Switched on (and not held off by the Did chip): catch it up to the
      // frontier on screen if it is behind it
      const c = catchUpFor(s, ps?.[s], s === 'stories' && kindsOff ? labelKey(kindsOff) : undefined);
      if (c) setCatchUps(q => (q.some(x => x.source === s) ? q : [...q, c]));
    }
    setOff(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };

  // Did / Said / Analysis (did_said flag): the same rules as the source chips.
  // Stories are re-paged under the new filter and caught up to the frontier on
  // screen; Did also switches EOs, SCOTUS and pardons off or back on.
  const toggleKind = (k: ActionKind) => {
    if (!kindsOff) return;
    track('filter_apply', { tab: TRACKER_TAB, filter_key: `kind_${k}`, filter_value: kindsOff.has(k) ? 'on' : 'off' });
    const nextKinds = new Set(kindsOff);
    if (nextKinds.has(k)) nextKinds.delete(k); else nextKinds.add(k);
    const nextOff = effectiveOff(off, nextKinds);
    const adds = TIMELINE_SOURCES.flatMap(s => {
      if (nextOff.has(s)) return [];
      if (s === 'stories') {
        // The stories stream restarts from its first page under the new filter
        const fresh = ps && alignStoryLabels(ps, nextKinds).stories;
        return catchUpFor(s, fresh ?? undefined, labelKey(nextKinds)) ?? [];
      }
      return effOff.has(s) ? catchUpFor(s, ps?.[s]) ?? [] : [];
    });
    // Stories catch-ups under the old filter, and sources now off, are dropped
    // (a running one stops before its next page)
    setCatchUps(q => {
      const kept = q.filter(c => c.source !== 'stories' && !nextOff.has(c.source));
      return [...kept, ...adds.filter(a => !kept.some(c => c.source === a.source))];
    });
    setKindsOff(nextKinds);
  };

  const open = (e: TimelineEntry, position: number) => {
    const item_type = toAnalyticsItemType(e.source);
    if (item_type) track('card_open', { item_type, alarm_level: e.alarm, feed_position: position, tab: TRACKER_TAB });
    navigate(`/${SOURCE_ROUTES[e.source]}/${encodeURIComponent(String(e.id))}`);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const mono: React.CSSProperties = {
    fontFamily: headType.mono,
    textTransform: 'uppercase',
    letterSpacing: '0.09em',
  };
  const accentOf = (alarm: number) => alarmPalette(alarm, 'restrained', mode, 'midnight').accent;

  // ── Tally ──
  const dayCount = Math.round((Date.now() - INAUGURATION.getTime()) / 86400000);
  const tallyTiles: { n: string; label: string; bad?: boolean }[] = [
    { n: String(dayCount), label: 'Days into term 2' },
  ];
  if (tally?.openFronts != null && tally.openFronts > 0) {
    tallyTiles.push({ n: String(tally.openFronts), label: 'Open fronts' });
  }
  // "Developments logged" hidden for now (Josh, August 31, 2026) — may return
  // later to show the breadth of the tracked record. tracker_stats still
  // computes it; re-enable by uncommenting.
  // if (tally?.developments != null) {
  //   tallyTiles.push({ n: tally.developments.toLocaleString('en-US'), label: 'Developments logged' });
  // }
  if (tally?.alarm5Last30 != null) {
    tallyTiles.push({ n: String(tally.alarm5Last30), label: 'At alarm 5 · last 30 days', bad: true });
  }

  // ── Controls ──
  const seg = (
    <span role="group" aria-label="Timeline view filter" style={{ display: 'inline-flex', border: `1px solid ${theme.line}` }}>
      {VIEW_STOPS.map(({ label, view: v }) => {
        const on = view === v;
        return (
          <button
            key={String(v)}
            type="button"
            aria-pressed={on}
            onClick={() => changeView(v)}
            className="tt-ts-seg"
            style={{
              ...mono, fontSize: 10, padding: '8px 14px', background: on ? theme.bg2 : 'none',
              border: 'none', cursor: 'pointer',
              color: on ? theme.ink : theme.dim, fontWeight: on ? 600 : 400,
            }}
          >
            {label}
          </button>
        );
      })}
    </span>
  );

  const chips = TIMELINE_SOURCES.map(s => {
    const on = !off.has(s);
    return (
      <button
        key={s}
        type="button"
        aria-pressed={on}
        onClick={() => toggleSource(s)}
        className="tt-ts-chip"
        style={{
          ...mono, fontSize: 10, padding: '6px 11px', background: 'none', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 7,
          color: on ? theme.ink : theme.dim,
          border: `1px solid ${on ? theme.dim : theme.line}`,
        }}
      >
        <i aria-hidden="true" style={{
          width: 7, height: 7, borderRadius: '50%', flex: 'none',
          background: on ? 'currentColor' : theme.line,
          ...(s !== 'stories' && on ? { background: 'transparent', boxShadow: 'inset 0 0 0 2px currentColor' } : {}),
        }} />
        {SOURCE_LABELS[s]}
      </button>
    );
  });

  // Did / Said / Analysis chips (did_said flag), styled like the source chips;
  // each glyph is the row marker it controls
  const kindChips = kindsOff && (
    <span role="group" aria-label="What happened" style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
      {ACTION_KINDS.map(k => {
        const on = !kindsOff.has(k);
        return (
          <button
            key={k}
            type="button"
            aria-pressed={on}
            onClick={() => toggleKind(k)}
            className="tt-ts-chip"
            style={{
              ...mono, fontSize: 10, padding: '6px 11px', background: 'none', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 7,
              color: on ? theme.ink : theme.dim,
              border: `1px solid ${on ? theme.dim : theme.line}`,
            }}
          >
            {k === 'said'
              ? <SpeechBubble size={9} fill={on ? 'currentColor' : theme.line} />
              : <i aria-hidden="true" style={{
                  width: 7, height: 7, borderRadius: '50%', flex: 'none',
                  background: on ? (k === 'coverage' ? theme.dim : 'currentColor') : theme.line,
                }} />}
            {ACTION_KIND_LABELS[k]}
          </button>
        );
      })}
    </span>
  );

  // ── Spine rows ──
  // Where a source that is behind stops: marked on the spine, so its missing
  // stretch never reads as part of a continuous record (Codex P1 on PR #158)
  const gaps = ps ? coverageGaps(visible, ps, behind) : [];
  const gapMarker = (g: (typeof gaps)[number]) => (
    <div key={`gap-${g.source}`} role="note" style={{
      position: 'relative', zIndex: 2, padding: narrow ? '14px 0 14px 28px' : '14px 0',
      textAlign: narrow ? 'left' : 'center',
    }}>
      <span style={{
        ...mono, fontSize: 10, color: theme.dim, background: theme.bg,
        border: `1px dashed ${theme.dim}`, padding: '5px 12px', display: 'inline-block',
      }}>
        {SOURCE_LABELS[g.source]}{g.from === null ? '' : ` before ${fmtDate(g.from)}`} not loaded yet · load earlier ↓
      </span>
    </div>
  );
  const rows: React.ReactNode[] = [];
  let lastYM: string | null = null;
  let side = 0;
  visible.forEach((e, idx) => {
    for (const g of gaps) if (g.index === idx) rows.push(gapMarker(g));
    const ym = e.date.slice(0, 7);
    if (ym !== lastYM) {
      rows.push(
        // The month chip sits ON the spine (interrupting the line) so it reads
        // as a segment boundary of the timeline, not a floating label.
        <div key={`m-${ym}`} aria-hidden="true" style={{
          position: 'relative', zIndex: 2, padding: '18px 0',
          textAlign: narrow ? 'left' : 'center',
        }}>
          <span style={{
            ...mono, fontSize: 12, fontWeight: 600, letterSpacing: '0.14em', color: theme.ink,
            background: theme.bg2, border: `1px solid ${theme.dim}`, padding: '5px 14px',
          }}>
            {monthLabel(ym)}
          </span>
        </div>,
      );
      lastYM = ym;
    }

    const right = side++ % 2 === 1;
    // did_said flag (PRD §14.5): said gets a speech bubble and a "Said" tag;
    // analysis is muted (dim marker and type, no alarm badge) with an
    // "Analysis" tag. Did, unlabeled and flag off: exactly as before.
    const kind = kindsOff ? entryKind(e) : 'did';
    const said = kind === 'said';
    const muted = kind === 'coverage';
    const kindTag = said || muted ? ACTION_KIND_LABELS[kind] : null;
    const accent = muted ? theme.dim : accentOf(e.alarm);
    const dotSize = e.alarm >= 5 ? 16 : e.alarm === 4 ? 13 : 12;
    const hollow = e.source !== 'stories';
    // Analysis never shouts: its type stops at the alarm 2-3 size
    const typeAlarm = muted ? Math.min(e.alarm, 3) : e.alarm;
    const markerSide: React.CSSProperties = narrow
      ? { left: 8, transform: 'translate(-50%, 0)' }
      : right
        ? { left: 0, transform: 'translate(-50%, 0)' }
        : { right: 0, transform: 'translate(50%, 0)' };

    const hlStyle: React.CSSProperties =
      typeAlarm >= 5 ? { fontFamily: headType.display, fontWeight: 600, fontSize: narrow ? 21 : 25, lineHeight: 1.12, letterSpacing: '-0.015em' }
      : typeAlarm === 4 ? { fontFamily: headType.display, fontWeight: 500, fontSize: 18, lineHeight: 1.22 }
      : typeAlarm >= 2 ? { fontFamily: headType.display, fontSize: 15, lineHeight: 1.3 }
      : { fontFamily: headType.display, fontSize: 14, lineHeight: 1.3 };

    rows.push(
      <div
        key={`${e.source}-${e.id}`}
        style={narrow
          ? { position: 'relative', width: '100%', padding: '12px 0 12px 30px', textAlign: 'left' }
          : right
            ? { position: 'relative', width: '50%', marginLeft: '50%', padding: '12px 0 12px 34px', textAlign: 'left' }
            : { position: 'relative', width: '50%', padding: '12px 34px 12px 0', textAlign: 'right' }}
      >
        {/* Narrow: a short tick from the spine to the entry, so each row reads
            as attached to the timeline instead of a plain left-padded list */}
        {narrow && (
          <span aria-hidden="true" style={{
            position: 'absolute', left: 8, top: e.alarm >= 5 ? 18 + dotSize / 2 - 1 : 20 + dotSize / 2 - 1,
            width: 18, height: 2, background: theme.line, zIndex: 1,
          }} />
        )}
        {said ? (
          <SpeechBubble
            size={dotSize + 3}
            fill={accent}
            stroke={theme.bg}
            style={{
              position: 'absolute', top: e.alarm >= 5 ? 18 : 20, zIndex: 3, ...markerSide,
              // the bubble's glow follows its shape (the dots' ring is a box-shadow)
              ...(e.alarm >= 4 ? { filter: `drop-shadow(0 0 ${e.alarm >= 5 ? 4 : 3}px ${accent}66)` } : {}),
            }}
          />
        ) : (
          <span aria-hidden="true" style={{
            position: 'absolute', top: e.alarm >= 5 ? 18 : 20, zIndex: 3,
            width: dotSize, height: dotSize, borderRadius: '50%',
            background: hollow ? theme.bg : accent,
            // alarm 4/5 dots get a glow ring so the big items read at a glance
            boxShadow: [
              hollow ? `inset 0 0 0 3px ${accent}` : '',
              muted ? '' : e.alarm >= 5 ? `0 0 0 5px ${accent}33` : e.alarm === 4 ? `0 0 0 4px ${accent}2e` : '',
            ].filter(Boolean).join(', ') || 'none',
            border: `2px solid ${theme.bg}`,
            ...markerSide,
          }} />
        )}
        <time style={{ ...mono, display: 'block', fontSize: 10, color: accent }}>
          {fmtDate(e.date)}
          {/* Entry type always visible: the front tag below replaces the source
              tag on front members, so without this a reader can't tell a story
              from an EO or a ruling at a glance (Josh, August 29, 2026) */}
          <span style={{ color: theme.ink, fontWeight: 600 }}> · {ENTRY_TYPE_LABELS[e.source]}</span>
          {e.alarm >= 5 && !muted ? (
            <span style={{
              background: accent, color: theme.bg, fontWeight: 600,
              padding: '2px 7px', marginLeft: 8, letterSpacing: '0.1em',
            }}>
              Alarm 5
            </span>
          ) : (
            <> · Alarm {e.alarm}</>
          )}
        </time>
        <a
          href={`/${SOURCE_ROUTES[e.source]}/${encodeURIComponent(String(e.id))}`}
          onClick={ev => { ev.preventDefault(); open(e, idx); }}
          className="tt-ts-hl"
          style={{
            display: 'block', marginTop: 5, textDecoration: 'none',
            color: e.alarm >= 2 && !muted ? theme.ink : theme.dim,
            ...hlStyle,
          }}
        >
          {/* Small, quiet, no box: part of the link so it is read with the headline */}
          {kindTag && (
            <span style={{
              ...mono, fontSize: 9.5, fontWeight: 600, letterSpacing: '0.1em', color: theme.dim,
              marginRight: 8, verticalAlign: '0.15em',
            }}>
              {kindTag}
            </span>
          )}
          {e.headline}
        </a>
        <div style={{
          display: 'flex', gap: 8, marginTop: 7, flexWrap: 'wrap', alignItems: 'center',
          justifyContent: narrow || right ? 'flex-start' : 'flex-end',
        }}>
          {e.front ? (
            // Front tag — navigation to the front's own page arrives with ADO-548
            <span style={{
              ...mono, fontSize: 9, letterSpacing: '0.08em', color: theme.ink, fontWeight: 600,
              border: `1px solid ${theme.dim}`, padding: '2px 8px', whiteSpace: 'nowrap',
            }}>
              {e.front.name}
            </span>
          ) : null}
          {/* Stories with no front get NO tag: the public "Loose end" label
              confused readers (Josh, August 31, 2026) — "loose end" stays
              admin/PRD vocabulary only. The real fix for mis-tagged rows is
              front assignment, not a label. */}
        </div>
      </div>,
    );
  });
  for (const g of gaps) if (g.index >= visible.length) rows.push(gapMarker(g));

  const progress = trackerProgress({ refreshing, loadingMore, failed: someOnFailed, behind });
  const countHint = !loaded
    ? 'Loading the record…'
    : progress.updating
      ? 'Updating…'
      : `${visible.length} development${visible.length === 1 ? '' : 's'}` + countScope(view, behind);

  return (
    <section aria-label="The Tracker timeline" style={{ padding: '8px 0 24px', borderBottom: `1px solid ${theme.line}` }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>

        {/* Masthead: centered tally + title + controls — this IS the homepage */}
        <div style={{
          display: 'flex', justifyContent: 'center', gap: narrow ? 30 : 72, flexWrap: 'wrap',
          padding: narrow ? '30px 0 22px' : '44px 0 30px', borderBottom: `1px solid ${theme.line}`,
        }}>
          {tallyTiles.map(t => (
            <div key={t.label} style={{
              textAlign: 'center',
              ...(t.bad ? { borderLeft: `4px solid ${accentOf(5)}`, paddingLeft: narrow ? 14 : 22 } : {}),
            }}>
              <div style={{
                fontFamily: headType.display, fontWeight: 600, fontSize: narrow ? 42 : 68,
                lineHeight: 1, letterSpacing: '-0.02em',
                color: t.bad ? accentOf(5) : theme.ink,
              }}>
                {t.n}
              </div>
              <div style={{
                ...mono, fontSize: narrow ? 9.5 : 10.5, letterSpacing: '0.12em',
                color: t.bad ? accentOf(5) : theme.dim, marginTop: 8,
              }}>
                {t.label}
              </div>
            </div>
          ))}
        </div>

        {/* Heading */}
        <div style={{ textAlign: 'center', paddingTop: narrow ? 22 : 30 }}>
          <h2 style={{
            fontFamily: headType.display, fontWeight: 600, fontSize: narrow ? 28 : 38,
            letterSpacing: '-0.015em', margin: 0, color: theme.ink,
          }}>
            The Tracker
          </h2>
          <p style={{ ...mono, fontSize: 10.5, color: theme.dim, margin: '10px 0 0' }}>
            Every major development since inauguration, newest first · type size = alarm level
          </p>
          <p aria-live="polite" style={{ ...mono, fontSize: 10, color: theme.dim, margin: '6px 0 0' }}>
            {countHint}
          </p>
        </div>

        {/* Controls */}
        <div ref={controlsRef} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', padding: '18px 0 6px', scrollMarginTop: 70 }}>
          <input
            type="search"
            value={query}
            onChange={ev => setQuery(ev.target.value)}
            placeholder="SEARCH THE RECORD…"
            aria-label="Search the record"
            className="tt-ts-search"
            style={{
              fontFamily: headType.mono, fontSize: 11, letterSpacing: '0.05em',
              background: theme.bg2, border: `1px solid ${theme.line}`, color: theme.ink,
              padding: '8px 12px', minWidth: narrow ? 160 : 220,
            }}
          />
          {seg}
          {chips}
          {kindChips}
        </div>

        {/* Spine */}
        <div style={{ position: 'relative', padding: '18px 0 34px' }}>
          <span aria-hidden="true" style={{
            position: 'absolute', top: 0, bottom: 0, width: 2, background: theme.line,
            // translateX(-50%) in BOTH layouts: the dots center on x=8 (narrow)
            // / 50% (wide), and without it the 2px line sat 1px off-center
            ...(narrow ? { left: 8, transform: 'translateX(-50%)' } : { left: '50%', transform: 'translateX(-50%)' }),
          }} />
          {rows}
          {loaded && !progress.busy && visible.length === 0 && (
            <div style={{ ...mono, position: 'relative', zIndex: 2, fontSize: 10.5, color: theme.dim, textAlign: narrow ? 'left' : 'center', padding: narrow ? '18px 0 18px 28px' : '18px 0', background: theme.bg }}>
              {onSourcesFailed
                ? 'Couldn’t load the sources switched on · switch on another source or try again later.'
                : query
                  ? 'Nothing on the record matches that search at this filter.'
                  : kindsEmptyMessage(kindsOff)
                    ?? (view === 'main'
                      ? 'Nothing on the main line yet · try "All" for the complete record.'
                      : 'Nothing at this alarm level yet · try "All" for the complete record.')}
            </div>
          )}
        </div>

        {/* Load earlier */}
        <div style={{ textAlign: 'center', padding: '6px 0 0' }}>
          {/* Skipped when the empty-list message above already says it */}
          {someOnFailed && !loadingMore && !(onSourcesFailed && visible.length === 0) && (
            <p role="status" style={{ ...mono, fontSize: 10, color: theme.dim, margin: '0 0 10px' }}>
              Part of the record didn’t load · try again below
            </p>
          )}
          {allExhausted ? (
            // visible, not entries: with every chip off, nothing is "the whole record"
            visible.length > 0 && (
              <span style={{ ...mono, fontSize: 10, color: theme.dim }}>
                That's the whole record · back to day one
              </span>
            )
          ) : (
            <button
              type="button"
              onClick={loadEarlier}
              disabled={loadingMore || refreshing || !loaded}
              className="tt-ts-more"
              style={{
                ...mono, fontSize: 11, letterSpacing: '0.1em', color: theme.ink,
                background: 'none', border: `1px solid ${theme.line}`, padding: '10px 18px',
                cursor: loadingMore || refreshing || !loaded ? 'default' : 'pointer',
                opacity: loadingMore || refreshing || !loaded ? 0.5 : 1,
              }}
            >
              {progress.button}
            </button>
          )}
        </div>

        <style>{`
          .tt-ts-hl:hover { color: ${theme.accent} !important; }
          .tt-ts-chip:hover { border-color: ${theme.dim} !important; }
          .tt-ts-seg:hover { color: ${theme.ink} !important; }
          .tt-ts-more:hover:not(:disabled) { border-color: ${theme.accent} !important; color: ${theme.accent} !important; }
          .tt-ts-search::placeholder { color: ${theme.dim}; font-size: 10px; letter-spacing: 0.08em; }
          .tt-ts-search:focus { outline: none; border-color: ${theme.dim}; }
          .tt-ts-hl:focus-visible, .tt-ts-chip:focus-visible, .tt-ts-seg:focus-visible,
          .tt-ts-more:focus-visible, .tt-ts-search:focus-visible {
            outline: 2px solid ${theme.accent}; outline-offset: 3px;
          }
        `}</style>
      </div>
    </section>
  );
}
