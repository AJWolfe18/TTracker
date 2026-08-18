import { useEffect, useRef, useState, useCallback } from 'react';
import { useLocation } from 'wouter';
import { useTheme } from '@/hooks/useTheme';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { alarmPalette } from '@/tokens';
import { fmtDate } from '@/lib/date-utils';
import {
  fetchTimelineEntries,
  SOURCE_LABELS,
  SOURCE_ROUTES,
  type TimelineEntry,
  type TimelineSource,
} from '@/lib/timeline';

// The rap sheet (ADO-544): one horizontal, evenly spaced strip of every recent
// development across stories, SCOTUS, EOs and pardons. Every entry labeled.
// Loads parked at today; scroll left into history. Below 720px it becomes a
// single-column vertical list, newest first, so today stays at the top.

const SOURCES: TimelineSource[] = ['stories', 'scotus', 'eos', 'pardons'];

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

const monthShort = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short' }).toUpperCase();

export function RapSheetTimeline() {
  const enabled = useFeatureFlag('rap_sheet');
  const { theme, headType, mode } = useTheme();
  const [, navigate] = useLocation();
  const narrow = useIsNarrow(720);

  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [off, setOff] = useState<Set<TimelineSource>>(new Set());

  const railRef = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    fetchTimelineEntries(ac.signal)
      .then(list => { if (!ac.signal.aborted) { setEntries(list); setLoaded(true); } })
      .catch(() => { /* rap sheet is additive — never break the homepage */ });
    return () => ac.abort();
  }, [enabled]);

  const syncNav = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    setCanPrev(rail.scrollLeft > 8);
    setCanNext(rail.scrollLeft < rail.scrollWidth - rail.clientWidth - 8);
  }, []);

  const visible = entries.filter(e => !off.has(e.source));

  // Park at today (right end) whenever the strip re-renders
  useEffect(() => {
    if (narrow) return;
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollLeft = rail.scrollWidth;
    requestAnimationFrame(() => {
      rail.scrollLeft = rail.scrollWidth;
      syncNav();
    });
  }, [loaded, narrow, visible.length, syncNav]);

  if (!enabled || (loaded && entries.length === 0)) return null;

  const toggle = (s: TimelineSource) => {
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

  const scrollByPage = (dir: 1 | -1) => {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollBy({ left: dir * Math.max(240, rail.clientWidth * 0.8), behavior: 'smooth' });
  };

  const mono: React.CSSProperties = {
    fontFamily: headType.mono,
    textTransform: 'uppercase',
    letterSpacing: '0.09em',
  };

  const dotColors = (alarm: number) => alarmPalette(alarm, 'restrained', mode, 'midnight');
  const lastVisibleIdx = visible.length - 1;

  const chips = (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '12px 0 14px' }}>
      {SOURCES.map(s => {
        const on = !off.has(s);
        return (
          <button
            key={s}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(s)}
            className="tt-rs-chip"
            style={{
              ...mono,
              fontSize: 10.5,
              padding: '6px 11px',
              background: 'none',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              color: on ? theme.ink : theme.dim,
              border: `1px solid ${on ? theme.dim : theme.line}`,
            }}
          >
            <i aria-hidden="true" style={{
              width: 7, height: 7, borderRadius: '50%', flex: 'none',
              background: on ? 'currentColor' : theme.line,
              // hollow marker preview for non-story sources
              ...(s !== 'stories' && on ? { background: 'transparent', boxShadow: 'inset 0 0 0 2px currentColor' } : {}),
            }} />
            {SOURCE_LABELS[s]}
          </button>
        );
      })}
    </div>
  );

  const heading = (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
        <h2 style={{
          fontFamily: headType.display, fontWeight: 600, fontSize: 22,
          letterSpacing: '-0.01em', margin: 0, color: theme.ink,
        }}>
          The whole term
        </h2>
        <span style={{ ...mono, fontSize: 10.5, color: theme.dim }}>
          {loaded ? `${visible.length} recent developments shown` : 'Loading the record…'}
        </span>
      </div>
      <p style={{ ...mono, fontSize: 10.5, color: theme.dim, margin: '6px 0 0' }}>
        Recent developments across every tracker, in order · dot color = alarm level · switch any source on or off
      </p>
    </>
  );

  // ── Mobile: vertical single-column list, newest first, line on the left ──
  if (narrow) {
    const desc = [...visible].reverse();
    return (
      <section aria-label="Rap sheet timeline" style={{ padding: '28px 0 24px', borderBottom: `1px solid ${theme.line}` }}>
        {heading}
        {chips}
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, borderLeft: `2px solid ${theme.line}` }}>
          {desc.map((e, i) => {
            const c = dotColors(e.alarm);
            return (
              <li key={`${e.source}-${e.id}`} style={{ position: 'relative', padding: '0 0 18px 20px' }}>
                <span aria-hidden="true" style={{
                  position: 'absolute', left: -7, top: 4,
                  width: 12, height: 12, borderRadius: '50%',
                  background: e.source === 'stories' ? c.accent : theme.bg,
                  boxShadow: e.source === 'stories' ? 'none' : `inset 0 0 0 3px ${c.accent}`,
                  border: `2px solid ${theme.bg}`,
                  ...(i === 0 ? { outline: `3px solid ${c.accent}44` } : {}),
                }} />
                <a
                  href={`/${SOURCE_ROUTES[e.source]}/${encodeURIComponent(String(e.id))}`}
                  onClick={ev => { ev.preventDefault(); open(e); }}
                  className="tt-rs-card"
                  style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}
                >
                  <time style={{ ...mono, fontSize: 10, color: c.accent }}>
                    {fmtDate(e.date)} · Alarm {e.alarm}
                  </time>
                  <div style={{
                    fontFamily: headType.display, fontSize: 15, lineHeight: 1.3,
                    marginTop: 4, color: theme.ink,
                  }}>
                    {e.headline}
                  </div>
                  <div style={{ ...mono, fontSize: 9.5, color: theme.dim, marginTop: 5 }}>
                    {SOURCE_LABELS[e.source]}
                  </div>
                </a>
              </li>
            );
          })}
        </ol>
        <style>{`.tt-rs-card:hover div { color: ${theme.accent} !important; }`}</style>
      </section>
    );
  }

  // ── Desktop: horizontal evenly spaced strip, parked at today ──
  const strip: React.ReactNode[] = [];
  let lastMonth: string | null = null;
  visible.forEach((e, i) => {
    const ym = e.date.slice(0, 7);
    if (ym !== lastMonth) {
      const isYear = ym.endsWith('-01') || lastMonth === null;
      strip.push(
        <div key={`m-${ym}`} style={{ position: 'relative', flex: 'none', width: 76 }} aria-hidden="true">
          <i style={{ position: 'absolute', left: '50%', top: 26, bottom: 26, width: 1, background: theme.line }} />
          <span style={{
            ...mono, position: 'absolute', left: '50%', top: '50%',
            transform: 'translate(-50%,-50%)', background: theme.bg, padding: '3px 8px',
            fontSize: 10, whiteSpace: 'nowrap',
            color: isYear ? theme.ink : theme.dim,
            border: isYear ? `1px solid ${theme.line}` : 'none',
          }}>
            {isYear ? `${monthShort(e.date)} '${ym.slice(2, 4)}` : monthShort(e.date)}
          </span>
        </div>,
      );
      lastMonth = ym;
    }

    const c = dotColors(e.alarm);
    const up = i % 2 === 0;
    const dotSize = e.alarm >= 5 ? 16 : e.alarm === 4 ? 13 : 12;
    strip.push(
      <div key={`${e.source}-${e.id}`} style={{ position: 'relative', flex: 'none', width: 226 }}>
        <span aria-hidden="true" style={{
          position: 'absolute', left: 0, top: '50%', transform: 'translate(-50%,-50%)',
          width: dotSize, height: dotSize, borderRadius: '50%', zIndex: 3,
          background: e.source === 'stories' ? c.accent : theme.bg,
          boxShadow: e.source === 'stories' ? 'none' : `inset 0 0 0 3px ${c.accent}`,
          border: `2px solid ${theme.bg}`,
          ...(i === lastVisibleIdx ? { outline: `4px solid ${c.accent}40` } : {}),
        }} />
        <a
          href={`/${SOURCE_ROUTES[e.source]}/${encodeURIComponent(String(e.id))}`}
          onClick={ev => { ev.preventDefault(); open(e); }}
          className="tt-rs-card"
          title={e.headline}
          style={{
            position: 'absolute', left: 0, width: 198, paddingLeft: 14,
            color: 'inherit', textDecoration: 'none', display: 'block',
            ...(up ? { bottom: 'calc(50% + 18px)' } : { top: 'calc(50% + 18px)' }),
          }}
        >
          <span aria-hidden="true" style={{
            position: 'absolute', left: 0, width: 1, background: theme.line,
            ...(up ? { top: '100%', height: 18 } : { bottom: '100%', height: 18 }),
          }} />
          <time style={{ ...mono, display: 'block', fontSize: 10, color: c.accent }}>
            {fmtDate(e.date)}
          </time>
          <span className="tt-rs-hl" style={{
            display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            fontFamily: headType.display, fontSize: 15, lineHeight: 1.3,
            marginTop: 5, color: theme.ink,
          }}>
            {e.headline}
          </span>
          <span style={{ ...mono, display: 'block', fontSize: 9.5, color: theme.dim, marginTop: 7 }}>
            {SOURCE_LABELS[e.source]} · <b style={{ color: c.accent, fontWeight: 500 }}>Alarm {e.alarm}</b>
          </span>
        </a>
      </div>,
    );
  });

  const navBtn = (dir: 1 | -1, disabled: boolean) => (
    <button
      type="button"
      aria-label={dir === -1 ? 'Earlier' : 'Later'}
      disabled={disabled}
      onClick={() => scrollByPage(dir)}
      className="tt-rs-nav"
      style={{
        position: 'absolute', top: '50%', transform: 'translateY(-50%)', zIndex: 5,
        width: 40, height: 40, borderRadius: '50%',
        background: theme.bg2, border: `1px solid ${theme.line}`, color: theme.ink,
        fontSize: 19, lineHeight: 1, cursor: disabled ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: disabled ? 0.25 : 1,
        ...(dir === -1 ? { left: -14 } : { right: -14 }),
      }}
    >
      {dir === -1 ? '‹' : '›'}
    </button>
  );

  return (
    <section aria-label="Rap sheet timeline" style={{ padding: '28px 0 22px', borderBottom: `1px solid ${theme.line}` }}>
      {heading}
      {chips}
      <div style={{ position: 'relative' }}>
        {navBtn(-1, !canPrev)}
        <div
          ref={railRef}
          onScroll={syncNav}
          className="tt-rs-rail"
          style={{ overflowX: 'auto', scrollBehavior: 'smooth' }}
        >
          <div style={{
            display: 'flex', alignItems: 'stretch', position: 'relative',
            height: 300, padding: '0 34px', width: 'max-content',
          }}>
            <div aria-hidden="true" style={{
              position: 'absolute', left: 0, right: 0, top: '50%', height: 1,
              background: `repeating-linear-gradient(90deg, ${theme.line} 0 5px, transparent 5px 11px)`,
            }} />
            {strip}
          </div>
        </div>
        {navBtn(1, !canNext)}
      </div>
      <div style={{ ...mono, fontSize: 10, color: theme.dim, marginTop: 10 }}>
        Scroll sideways, or use the arrows · <b style={{ color: theme.ink, fontWeight: 500 }}>◀ earlier</b> · you are at today
      </div>
      <style>{`
        .tt-rs-rail { scrollbar-width: thin; scrollbar-color: ${theme.line} transparent; }
        .tt-rs-rail::-webkit-scrollbar { height: 7px; }
        .tt-rs-rail::-webkit-scrollbar-thumb { background: ${theme.line}; border-radius: 4px; }
        .tt-rs-card:hover .tt-rs-hl { color: ${theme.accent} !important; }
        .tt-rs-chip:hover { border-color: ${theme.dim} !important; }
        .tt-rs-nav:hover:not(:disabled) { border-color: ${theme.accent} !important; color: ${theme.accent} !important; }
        .tt-rs-card:focus-visible, .tt-rs-chip:focus-visible, .tt-rs-nav:focus-visible {
          outline: 2px solid ${theme.accent}; outline-offset: 3px;
        }
      `}</style>
    </section>
  );
}
