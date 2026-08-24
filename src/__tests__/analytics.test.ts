import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Loaded as text so the real shipped loader is what gets executed below.
import gateSource from '../../public/analytics-gate.js?raw';

import {
  ANALYTICS_HOSTNAME,
  GA4_MEASUREMENT_ID,
  isAnalyticsEnabled,
  trackPageView,
} from '../lib/analytics';

// Vitest runs node-env (no jsdom), so `window` is stubbed by hand.
type FakeWindow = {
  location: { hostname: string };
  gtag?: (...args: unknown[]) => void;
  TT_ANALYTICS_ENABLED?: boolean;
  dataLayer?: unknown[];
};

function setWindow(hostname: string, extra: Partial<FakeWindow> = {}): FakeWindow {
  const w: FakeWindow = { location: { hostname }, ...extra };
  (globalThis as unknown as { window?: FakeWindow }).window = w;
  return w;
}

const OFF_PROD_HOSTS = [
  'localhost',
  '127.0.0.1',
  'test--taupe-capybara-0ff2ed.netlify.app',
  'deploy-preview-42--taupe-capybara-0ff2ed.netlify.app',
  'taupe-capybara-0ff2ed.netlify.app',
  'trumpytracker.com.evil.example',
  'nottrumpytracker.com',
];

describe('src/lib/analytics gate', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    delete (globalThis as unknown as { window?: FakeWindow }).window;
  });

  it('is disabled when there is no window (SSR / node)', () => {
    delete (globalThis as unknown as { window?: FakeWindow }).window;
    expect(isAnalyticsEnabled()).toBe(false);
  });

  it('is enabled only on the exact production hostname', () => {
    setWindow(ANALYTICS_HOSTNAME);
    expect(isAnalyticsEnabled()).toBe(true);

    for (const host of OFF_PROD_HOSTS) {
      setWindow(host);
      expect(isAnalyticsEnabled(), `expected ${host} to be gated off`).toBe(false);
    }
  });

  it('sends the GA4 page_path config on PROD', () => {
    const gtag = vi.fn();
    setWindow(ANALYTICS_HOSTNAME, { gtag });

    trackPageView('/detail/123');

    expect(gtag).toHaveBeenCalledWith('config', GA4_MEASUREMENT_ID, { page_path: '/detail/123' });
  });

  it('never calls gtag off PROD, even if a stub is present', () => {
    const gtag = vi.fn();
    for (const host of OFF_PROD_HOSTS) {
      setWindow(host, { gtag });
      trackPageView('/news');
    }
    expect(gtag).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });

  it('does not throw when gtag is missing or throws on PROD', () => {
    setWindow(ANALYTICS_HOSTNAME);
    expect(() => trackPageView('/')).not.toThrow();

    setWindow(ANALYTICS_HOSTNAME, {
      gtag: () => {
        throw new Error('blocked by an ad blocker');
      },
    });
    expect(() => trackPageView('/')).not.toThrow();
  });
});

/**
 * public/analytics-gate.js is the loader shared by index.html and the legacy
 * pages. It is a classic browser script, so it is executed here in a vm with a
 * fake DOM -- this is the direct proof of the ADO-558 acceptance criterion
 * "ZERO network requests to googletagmanager.com off PROD (script tag included)".
 */
type FakeScript = { src?: string; async?: boolean; onload?: () => void };

function runGate(hostname: string) {
  const appended: FakeScript[] = [];
  const created: FakeScript[] = [];
  const logs: unknown[][] = [];

  const win: Record<string, unknown> = { location: { hostname } };
  const document = {
    createElement: (tag: string) => {
      if (tag !== 'script') throw new Error(`unexpected createElement(${tag})`);
      const el: FakeScript = {};
      created.push(el);
      return el;
    },
    head: {
      appendChild: (el: FakeScript) => {
        appended.push(el);
        return el;
      },
    },
  };

  // The loader is a classic IIFE that reads `window`/`document`/`console` off
  // the global scope; passing them as parameters shadows the real globals so
  // the test can never touch the network or the host environment.
  const run = new Function('window', 'document', 'console', gateSource) as (
    w: unknown,
    d: unknown,
    c: unknown,
  ) => void;

  run(win, document, { log: (...args: unknown[]) => logs.push(args) });

  return { win, appended, created, logs };
}

const GA_SRC = `https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}`;
const POSTHOG_SRC = 'https://us-assets.i.posthog.com/static/array.js';

describe('public/analytics-gate.js', () => {
  it('injects GA4 and PostHog exactly once each on PROD', () => {
    const { win, appended } = runGate(ANALYTICS_HOSTNAME);

    expect(win.TT_ANALYTICS_ENABLED).toBe(true);
    expect(appended.map((s) => s.src)).toEqual([GA_SRC, POSTHOG_SRC]);
    expect(appended.every((s) => s.async === true)).toBe(true);

    // The GA4 bootstrap commands are queued for the remote script.
    const dataLayer = win.dataLayer as unknown[];
    expect(dataLayer).toHaveLength(2);
    expect(Array.from(dataLayer[0] as ArrayLike<unknown>)[0]).toBe('js');
    expect(Array.from(dataLayer[1] as ArrayLike<unknown>)).toEqual([
      'config',
      GA4_MEASUREMENT_ID,
    ]);
  });

  it('creates NO script element and no dataLayer off PROD', () => {
    for (const host of OFF_PROD_HOSTS) {
      const { win, appended, created } = runGate(host);

      expect(win.TT_ANALYTICS_ENABLED, host).toBe(false);
      expect(created, `${host} must not create a script element`).toHaveLength(0);
      expect(appended, `${host} must not append a script element`).toHaveLength(0);
      expect(win.dataLayer, `${host} must not create a dataLayer`).toBeUndefined();
    }
  });

  it('exposes console-only gtag and TTAnalytics stubs off PROD', () => {
    const { win, logs, appended } = runGate('localhost');

    expect(typeof win.gtag).toBe('function');
    (win.gtag as (...args: unknown[]) => void)('event', 'outbound_click', { a: 1 });

    const tt = win.TTAnalytics as { capture: (n: string, p: unknown) => void };
    expect(typeof tt.capture).toBe('function');
    tt.capture('card_open', { tab: 'news' });

    expect(logs.map((l) => l[0])).toEqual([
      '[analytics:off-prod] gtag',
      '[analytics:off-prod] posthog.capture',
    ]);
    expect(appended).toHaveLength(0);
  });

  /**
   * posthog-js self-assigns window.posthog and its bootstrap is
   * `if (!window.posthog || isArray(window.posthog._i))`. If the gate assigned
   * its own object to that global, PostHog would skip init entirely and fail
   * silently -- so the gate must leave it alone until the library loads.
   */
  it('never touches window.posthog before the SDK loads', () => {
    const { win } = runGate(ANALYTICS_HOSTNAME);
    expect(win.posthog).toBeUndefined();
  });

  it('buffers captures made before the SDK loads, then flushes them in order', () => {
    const { win, appended } = runGate(ANALYTICS_HOSTNAME);
    const tt = win.TTAnalytics as { capture: (n: string, p: unknown) => void };

    // A user clicks before array.js has finished downloading.
    tt.capture('card_open', { tab: 'news', feed_position: 0 });
    tt.capture('source_click', { outlet_domain: 'apnews.com' });

    const captured: Array<[string, unknown]> = [];
    let initArgs: unknown[] = [];
    win.posthog = {
      init: (...args: unknown[]) => {
        initArgs = args;
      },
      capture: (n: string, p: unknown) => captured.push([n, p]),
    };

    const phScript = appended.find((s) => s.src === POSTHOG_SRC);
    phScript?.onload?.();

    expect(initArgs[0]).toMatch(/^phc_/);
    expect(initArgs[1]).toMatchObject({
      api_host: 'https://us.i.posthog.com',
      autocapture: true,
      capture_pageview: 'history_change',
      person_profiles: 'identified_only',
      session_recording: { maskAllInputs: true },
    });

    expect(captured).toEqual([
      ['card_open', { tab: 'news', feed_position: 0 }],
      ['source_click', { outlet_domain: 'apnews.com' }],
    ]);

    // Post-load captures go straight through, not into the buffer.
    tt.capture('share_click', { channel: 'copy' });
    expect(captured).toHaveLength(3);
  });

  it('survives an SDK that fails to load or throws on init', () => {
    const { win, appended } = runGate(ANALYTICS_HOSTNAME);
    const tt = win.TTAnalytics as { capture: (n: string, p: unknown) => void };
    const phScript = appended.find((s) => s.src === POSTHOG_SRC);

    // array.js blocked by an ad blocker: window.posthog never appears.
    expect(() => phScript?.onload?.()).not.toThrow();
    expect(() => tt.capture('card_open', { tab: 'news' })).not.toThrow();

    // ...or it loads but init throws.
    win.posthog = {
      init: () => {
        throw new Error('boom');
      },
      capture: () => {},
    };
    expect(() => phScript?.onload?.()).not.toThrow();
    expect(() => tt.capture('card_open', { tab: 'news' })).not.toThrow();
  });

  it('caps the pre-load buffer so a failed load cannot grow it unbounded', () => {
    const { win, appended } = runGate(ANALYTICS_HOSTNAME);
    const tt = win.TTAnalytics as { capture: (n: string, p: unknown) => void };

    for (let i = 0; i < 200; i++) tt.capture('pagination', { page: i });

    const captured: unknown[] = [];
    win.posthog = { init: () => {}, capture: () => captured.push(1) };
    appended.find((s) => s.src === POSTHOG_SRC)?.onload?.();

    expect(captured).toHaveLength(50);
  });
});
