import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Loaded as text so the real shipped legacy helper is what gets exercised.
import sharedSource from '../../public/shared.js?raw';

/**
 * `public/shared.js` is the legacy vanilla-page helper. It is a classic
 * browser IIFE (`(function (global) { ... })(window)`), not a module, so it is
 * executed here against a hand-built fake browser environment.
 *
 * These tests pin two rules that are easy to break silently on a later edit:
 *   1. PostHog never receives `term_hash` (PRD section 4: search sends length
 *      only, nothing derived from free-text input).
 *   2. GA4 and PostHog dispatch INDEPENDENTLY -- a missing or throwing gtag
 *      must not suppress the PostHog mirror or break the page.
 */
type TrackEvent = (name: string, params?: Record<string, unknown>, opts?: Record<string, unknown>) => void;

interface Loaded {
  trackEvent: TrackEvent;
  trackSearchAction: (term: string, resultCount: number) => void;
  gaCalls: unknown[][];
  phCalls: Array<[string, Record<string, unknown>]>;
}

function loadShared(options: {
  /** `null` means "gtag is not defined at all". */
  gtag?: ((...args: unknown[]) => void) | null;
  withPostHog?: boolean;
  hostname?: string;
} = {}): Loaded {
  const gaCalls: unknown[][] = [];
  const phCalls: Array<[string, Record<string, unknown>]> = [];

  const store = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  };

  const gtag =
    options.gtag === null
      ? undefined
      : options.gtag ?? ((...args: unknown[]) => void gaCalls.push(args));

  const win: Record<string, unknown> = {
    SUPABASE_CONFIG: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon' },
    location: { hostname: options.hostname ?? 'trumpytracker.com', search: '', pathname: '/' },
    history: { replaceState: () => {}, pushState: () => {}, state: null },
    localStorage: store(),
    sessionStorage: store(),
    scrollY: 0,
    scrollTo: () => {},
    matchMedia: () => ({ matches: false }),
    addEventListener: () => {},
    gtag,
    // TT_ANALYTICS_ENABLED is normally set by public/analytics-gate.js.
    TT_ANALYTICS_ENABLED: (options.hostname ?? 'trumpytracker.com') === 'trumpytracker.com',
  };

  if (options.withPostHog !== false) {
    win.TTAnalytics = {
      capture: (name: string, props: Record<string, unknown>) => {
        phCalls.push([name, props]);
      },
    };
  }

  const document = {
    body: { innerHTML: '', style: {} },
    documentElement: { setAttribute: () => {} },
    addEventListener: () => {},
    createElement: () => ({ style: {} }),
  };

  const run = new Function(
    'window',
    'document',
    'localStorage',
    'sessionStorage',
    'gtag',
    'console',
    `${sharedSource}\nreturn window.TTShared;`,
  ) as (...args: unknown[]) => { trackEvent: TrackEvent; trackSearchAction: (t: string, n: number) => void };

  const shared = run(
    win,
    document,
    win.localStorage,
    win.sessionStorage,
    gtag,
    { log: () => {}, warn: () => {}, error: () => {} },
  );

  return { trackEvent: shared.trackEvent, trackSearchAction: shared.trackSearchAction, gaCalls, phCalls };
}

describe('public/shared.js trackEvent -> PostHog mirror', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  it('sends term_hash to GA4 but NEVER to PostHog', () => {
    const { trackSearchAction, gaCalls, phCalls } = loadShared();

    trackSearchAction('epstein documents', 7);

    // GA4 keeps legacy continuity for existing Looker Studio reports.
    const gaParams = gaCalls[0][2] as Record<string, unknown>;
    expect(gaParams.term_hash).toBeTypeOf('string');
    expect(gaParams.term_len).toBe('epstein documents'.length);

    // PostHog starts clean: nothing derived from the query text.
    const [phName, phParams] = phCalls[0];
    expect(phName).toBe('search_action');
    expect(phParams).not.toHaveProperty('term_hash');
    expect(phParams.term_len).toBe('epstein documents'.length);
    expect(JSON.stringify(phParams)).not.toContain(gaParams.term_hash as string);
  });

  it('still mirrors to PostHog when gtag is missing entirely', () => {
    const { trackEvent, phCalls } = loadShared({ gtag: null });

    trackEvent('outbound_click', { source_domain: 'apnews.com' });

    expect(phCalls).toHaveLength(1);
    expect(phCalls[0][0]).toBe('outbound_click');
    expect(phCalls[0][1]).toMatchObject({ source_domain: 'apnews.com' });
  });

  it('still mirrors to PostHog when gtag throws, and does not rethrow', () => {
    const { trackEvent, phCalls } = loadShared({
      gtag: () => {
        throw new Error('ad blocker ate gtag');
      },
    });

    expect(() => trackEvent('detail_toggle', { action: 'open' })).not.toThrow();
    expect(phCalls).toHaveLength(1);
    expect(phCalls[0][0]).toBe('detail_toggle');
  });

  it('does not throw when PostHog is absent', () => {
    const { trackEvent, gaCalls } = loadShared({ withPostHog: false });

    expect(() => trackEvent('outbound_click', { source_domain: 'apnews.com' })).not.toThrow();
    expect(gaCalls).toHaveLength(1);
  });

  it('sends to neither vendor off PROD', () => {
    const { trackEvent, gaCalls, phCalls } = loadShared({ hostname: 'localhost' });

    trackEvent('outbound_click', { source_domain: 'apnews.com' });

    expect(gaCalls).toHaveLength(0);
    expect(phCalls).toHaveLength(0);
  });
});
