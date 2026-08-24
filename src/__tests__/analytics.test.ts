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
function runGate(hostname: string) {
  const appended: Array<{ src?: string; async?: boolean }> = [];
  const created: Array<{ src?: string; async?: boolean }> = [];
  const logs: unknown[][] = [];

  const win: Record<string, unknown> = { location: { hostname } };
  const document = {
    createElement: (tag: string) => {
      if (tag !== 'script') throw new Error(`unexpected createElement(${tag})`);
      const el: { src?: string; async?: boolean } = {};
      created.push(el);
      return el;
    },
    head: {
      appendChild: (el: { src?: string; async?: boolean }) => {
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

describe('public/analytics-gate.js', () => {
  it('injects the GA4 script exactly once on PROD', () => {
    const { win, appended } = runGate(ANALYTICS_HOSTNAME);

    expect(win.TT_ANALYTICS_ENABLED).toBe(true);
    expect(appended).toHaveLength(1);
    expect(appended[0].src).toBe(
      `https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}`,
    );
    expect(appended[0].async).toBe(true);

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

  it('exposes a console-only gtag stub off PROD', () => {
    const { win, logs, appended } = runGate('localhost');

    expect(typeof win.gtag).toBe('function');
    (win.gtag as (...args: unknown[]) => void)('event', 'outbound_click', { a: 1 });

    expect(logs).toHaveLength(1);
    expect(logs[0][0]).toBe('[analytics:off-prod] gtag');
    expect(appended).toHaveLength(0);
  });
});
