import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { useTheme } from '@/hooks/useTheme';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { ErrorState } from '@/edge-states/ErrorState';
import { alarmPalette } from '@/tokens';
import { fmtDate } from '@/lib/date-utils';
import {
  fetchTrackerPage,
  fetchTrackerTally,
  coverageFrontier,
  visibleEntries,
  mergeEntries,
  SOURCE_LABELS,
  SOURCE_ROUTES,
  TERM_START,
  TIMELINE_SOURCES,
  type AlarmMin,
  type TimelineEntry,
  type TimelineSource,
  type TrackerState,
  type TrackerTally,
} from '@/lib/timeline';

// The Tracker (ADO-545): the homepage rap sheet as a vertical center-spine
// timeline, replacing the W1.1 horizontal strip. The bar is the timeline;
// entries alternate left/right, newest first, with month markers on the bar.
// Type and dot size follow alarm level. Main line = alarm filter (default 4+);
// "All" recovers the complete record. Below 760px it collapses to a single
// column with the spine on the left. Approved design: mockup rev 6.

const ALARM_STOPS: { label: string; min: AlarmMin }[] = [
  { label: 'All', min: 0 },
  { label: 'Alarm 3+', min: 3 },
  { label: 'Alarm 4+', min: 4 },
  { label: 'Only 5', min: 5 },
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
  const { theme, headType, mode } = useTheme();
  const [, navigate] = useLocation();
  const narrow = useIsNarrow(760);

  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [pageState, setPageState] = useState<TrackerState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [minAlarm, setMinAlarm] = useState<AlarmMin>(4);
  const [off, setOff] = useState<Set<TimelineSource>>(new Set());
  const [query, setQuery] = useState('');
  const [tally, setTally] = useState<TrackerTally | null>(null);

  const acRef = useRef<AbortController | null>(null);
  const controlsRef = useRef<HTMLDivElement>(null);

  // First page — refetched whenever the alarm floor changes, because the
  // server-side alarm predicate is baked into every source's cursor stream.
  // The current list stays on screen until the new one arrives: clearing it
  // collapses the page height and scroll-anchoring yanks the viewport around.
  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    acRef.current = ac;
    setLoadingMore(false);
    setRefreshing(true);
    fetchTrackerPage(minAlarm, null, ac.signal)
      .then(({ entries: page, state }) => {
        if (ac.signal.aborted) return;
        setEntries(page);
        setPageState(state);
        setLoaded(true);
        setRefreshing(false);
      })
      .catch(() => { /* the Tracker is additive — never break the homepage */ });
    return () => ac.abort();
  }, [enabled, minAlarm]);

  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    fetchTrackerTally(ac.signal)
      .then(t => { if (!ac.signal.aborted) setTally(t); })
      .catch(() => {});
    return () => ac.abort();
  }, [enabled]);

  const frontier = pageState ? coverageFrontier(pageState) : null;
  const visible = useMemo(
    () => visibleEntries(entries, { frontier, min: minAlarm, off, query }),
    [entries, frontier, minAlarm, off, query],
  );

  const allExhausted = pageState !== null && TIMELINE_SOURCES.every(s => pageState[s].exhausted);
  const allErrored = pageState !== null && TIMELINE_SOURCES.every(s => pageState[s].errored);

  if (!enabled) return null;
  // Every source down and nothing to show: hide the surface (or, standalone, say so)
  if (loaded && allErrored && entries.length === 0) {
    return standalone ? <ErrorState /> : null;
  }

  const loadEarlier = () => {
    if (!pageState || loadingMore || refreshing || allExhausted) return;
    const ac = acRef.current;
    setLoadingMore(true);
    fetchTrackerPage(minAlarm, pageState, ac?.signal)
      .then(({ entries: more, state }) => {
        if (ac?.signal.aborted) return;
        setEntries(prev => mergeEntries([prev, more]));
        setPageState(state);
      })
      .catch(() => {})
      // unconditional: an abort mid-flight must not leave the button stuck
      .finally(() => setLoadingMore(false));
  };

  // Changing the alarm floor swaps in a list of a different length; if the
  // reader is scrolled deep, snap back to the controls so the change is
  // legible instead of the browser clamping scroll somewhere arbitrary.
  const changeAlarm = (min: AlarmMin) => {
    setMinAlarm(min);
    const el = controlsRef.current;
    if (el && el.getBoundingClientRect().top < 0) {
      el.scrollIntoView({ block: 'start', behavior: 'instant' as ScrollBehavior });
    }
  };

  const toggleSource = (s: TimelineSource) => {
    setOff(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };

  const open = (e: TimelineEntry) => {
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
  if (tally?.developments != null) {
    tallyTiles.push({ n: tally.developments.toLocaleString('en-US'), label: 'Developments logged' });
  }
  if (tally?.alarm5Last30 != null) {
    tallyTiles.push({ n: String(tally.alarm5Last30), label: 'At alarm 5 · last 30 days', bad: true });
  }

  // ── Controls ──
  const seg = (
    <span role="group" aria-label="Alarm level filter" style={{ display: 'inline-flex', border: `1px solid ${theme.line}` }}>
      {ALARM_STOPS.map(({ label, min }) => {
        const on = minAlarm === min;
        return (
          <button
            key={min}
            type="button"
            aria-pressed={on}
            onClick={() => changeAlarm(min)}
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

  // ── Spine rows ──
  const rows: React.ReactNode[] = [];
  let lastYM: string | null = null;
  let side = 0;
  visible.forEach(e => {
    const ym = e.date.slice(0, 7);
    if (ym !== lastYM) {
      rows.push(
        <div key={`m-${ym}`} aria-hidden="true" style={{
          position: 'relative', zIndex: 2, padding: '16px 0',
          textAlign: narrow ? 'left' : 'center',
          ...(narrow ? { paddingLeft: 28 } : {}),
        }}>
          <span style={{
            ...mono, fontSize: 10, letterSpacing: '0.12em', color: theme.ink,
            background: theme.bg, border: `1px solid ${theme.line}`, padding: '4px 12px',
          }}>
            {monthLabel(ym)}
          </span>
        </div>,
      );
      lastYM = ym;
    }

    const right = side++ % 2 === 1;
    const accent = accentOf(e.alarm);
    const dotSize = e.alarm >= 5 ? 16 : e.alarm === 4 ? 13 : 12;
    const hollow = e.source !== 'stories';

    const hlStyle: React.CSSProperties =
      e.alarm >= 5 ? { fontFamily: headType.display, fontWeight: 600, fontSize: narrow ? 21 : 25, lineHeight: 1.12, letterSpacing: '-0.015em' }
      : e.alarm === 4 ? { fontFamily: headType.display, fontWeight: 500, fontSize: 18, lineHeight: 1.22 }
      : e.alarm >= 2 ? { fontFamily: headType.display, fontSize: 15, lineHeight: 1.3 }
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
        <span aria-hidden="true" style={{
          position: 'absolute', top: e.alarm >= 5 ? 18 : 20, zIndex: 3,
          width: dotSize, height: dotSize, borderRadius: '50%',
          background: hollow ? theme.bg : accent,
          // alarm 4/5 dots get a glow ring so the big items read at a glance
          boxShadow: [
            hollow ? `inset 0 0 0 3px ${accent}` : '',
            e.alarm >= 5 ? `0 0 0 5px ${accent}33` : e.alarm === 4 ? `0 0 0 4px ${accent}2e` : '',
          ].filter(Boolean).join(', ') || 'none',
          border: `2px solid ${theme.bg}`,
          ...(narrow
            ? { left: 8, transform: 'translate(-50%, 0)' }
            : right
              ? { left: 0, transform: 'translate(-50%, 0)' }
              : { right: 0, transform: 'translate(50%, 0)' }),
        }} />
        <time style={{ ...mono, display: 'block', fontSize: 10, color: accent }}>
          {fmtDate(e.date)}
          {e.alarm >= 5 ? (
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
          onClick={ev => { ev.preventDefault(); open(e); }}
          className="tt-ts-hl"
          style={{
            display: 'block', marginTop: 5, textDecoration: 'none',
            color: e.alarm >= 2 ? theme.ink : theme.dim,
            ...hlStyle,
          }}
        >
          {e.headline}
        </a>
        <div style={{
          display: 'flex', gap: 8, marginTop: 7, flexWrap: 'wrap', alignItems: 'center',
          justifyContent: narrow || right ? 'flex-start' : 'flex-end',
        }}>
          <span style={{
            ...mono, fontSize: 9, letterSpacing: '0.08em', color: theme.dim,
            border: `1px solid ${theme.line}`, padding: '2px 8px', whiteSpace: 'nowrap',
          }}>
            {e.source === 'stories' ? 'Loose end' : SOURCE_LABELS[e.source]}
          </span>
        </div>
      </div>,
    );
  });

  const countHint = !loaded
    ? 'Loading the record…'
    : refreshing
      ? 'Updating…'
      : `${visible.length} development${visible.length === 1 ? '' : 's'}`
        + (minAlarm > 0 ? ` at alarm ${minAlarm}+` : ' · the complete record');

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
        </div>

        {/* Spine */}
        <div style={{ position: 'relative', padding: '18px 0 34px' }}>
          <span aria-hidden="true" style={{
            position: 'absolute', top: 0, bottom: 0, width: 2, background: theme.line,
            ...(narrow ? { left: 8 } : { left: '50%', transform: 'translateX(-50%)' }),
          }} />
          {rows}
          {loaded && !refreshing && visible.length === 0 && (
            <div style={{ ...mono, position: 'relative', zIndex: 2, fontSize: 10.5, color: theme.dim, textAlign: narrow ? 'left' : 'center', padding: narrow ? '18px 0 18px 28px' : '18px 0', background: theme.bg }}>
              {query
                ? 'Nothing on the record matches that search at this filter.'
                : 'Nothing at this alarm level yet · try "All" for the complete record.'}
            </div>
          )}
        </div>

        {/* Load earlier */}
        <div style={{ textAlign: 'center', padding: '6px 0 0' }}>
          {allExhausted ? (
            entries.length > 0 && (
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
              {loadingMore ? 'Loading earlier…' : 'Keep going · load earlier ↓'}
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
