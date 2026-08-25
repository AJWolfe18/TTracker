import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ANALYTICS_HOSTNAME,
  SCHEMA_VERSION,
  track,
  toAnalyticsItemType,
  type EventName,
} from '../lib/analytics';

// Vitest runs node-env (no jsdom), so `window` is stubbed by hand.
type FakeWindow = {
  location: { hostname: string };
  gtag?: (...args: unknown[]) => void;
  TTAnalytics?: { capture: (name: string, props: Record<string, unknown>) => void };
};

function setWindow(hostname: string, extra: Partial<FakeWindow> = {}) {
  (globalThis as unknown as { window?: FakeWindow }).window = {
    location: { hostname },
    ...extra,
  };
}

const OFF_PROD_HOSTS = [
  'localhost',
  '127.0.0.1',
  'test--taupe-capybara-0ff2ed.netlify.app',
  'deploy-preview-42--taupe-capybara-0ff2ed.netlify.app',
];

describe('track() wrapper', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    delete (globalThis as unknown as { window?: FakeWindow }).window;
  });

  function prodWindow() {
    const capture = vi.fn();
    const gtag = vi.fn();
    setWindow(ANALYTICS_HOSTNAME, { gtag, TTAnalytics: { capture } });
    return { capture, gtag };
  }

  it('dual-fires to PostHog and GA4, stamping schema_v on GA4 only', () => {
    const { capture, gtag } = prodWindow();

    track('card_open', { item_type: 'story', alarm_level: 5, feed_position: 3, tab: 'news' });

    expect(capture).toHaveBeenCalledWith('card_open', {
      item_type: 'story',
      alarm_level: 5,
      feed_position: 3,
      tab: 'news',
    });
    expect(gtag).toHaveBeenCalledWith('event', 'card_open', {
      item_type: 'story',
      alarm_level: 5,
      feed_position: 3,
      tab: 'news',
      schema_v: SCHEMA_VERSION,
    });
  });

  it('drops undeclared keys at runtime, so an `as any` cast cannot leak PII', () => {
    const { capture, gtag } = prodWindow();

    // Exactly what the type system forbids, forced through anyway.
    track('search', {
      tab: 'news',
      query_length: 12,
      query: 'my private search text',
      email: 'someone@example.com',
    } as unknown as { tab: string; query_length: number });

    expect(capture).toHaveBeenCalledWith('search', { tab: 'news', query_length: 12 });

    const gaProps = gtag.mock.calls[0][2] as Record<string, unknown>;
    expect(gaProps).toEqual({ tab: 'news', query_length: 12, schema_v: SCHEMA_VERSION });
    expect(JSON.stringify(gaProps)).not.toContain('private');
    expect(JSON.stringify(gaProps)).not.toContain('example.com');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('omits null and undefined values rather than sending them', () => {
    const { capture } = prodWindow();

    track('share_click', {
      channel: 'copy_link',
      item_type: undefined as unknown as 'story',
    });

    expect(capture).toHaveBeenCalledWith('share_click', { channel: 'copy_link' });
  });

  it('sends nothing off PROD', () => {
    const capture = vi.fn();
    const gtag = vi.fn();
    for (const host of OFF_PROD_HOSTS) {
      setWindow(host, { gtag, TTAnalytics: { capture } });
      track('pagination', { tab: 'eos', page: 2 });
    }
    expect(capture).not.toHaveBeenCalled();
    expect(gtag).not.toHaveBeenCalled();
    expect(logSpy, 'off-PROD path is silent (no console.log in shipped code)').not.toHaveBeenCalled();
  });

  it('never throws when a vendor is missing or throws', () => {
    setWindow(ANALYTICS_HOSTNAME);
    expect(() => track('feedback_open', { page_path: '/news' })).not.toThrow();

    setWindow(ANALYTICS_HOSTNAME, {
      gtag: () => {
        throw new Error('ad blocker');
      },
      TTAnalytics: {
        capture: () => {
          throw new Error('ad blocker');
        },
      },
    });
    expect(() => track('feedback_open', { page_path: '/news' })).not.toThrow();
  });

  it('still reaches GA4 when PostHog is blocked', () => {
    const gtag = vi.fn();
    setWindow(ANALYTICS_HOSTNAME, {
      gtag,
      TTAnalytics: {
        capture: () => {
          throw new Error('blocked');
        },
      },
    });

    track('correction_click', { item_type: 'eo' });

    expect(gtag).toHaveBeenCalledWith('event', 'correction_click', {
      item_type: 'eo',
      schema_v: SCHEMA_VERSION,
    });
  });
});

describe('toAnalyticsItemType', () => {
  it('normalises the tab/route spellings used across the app', () => {
    expect(toAnalyticsItemType('story')).toBe('story');
    expect(toAnalyticsItemType('stories')).toBe('story');
    expect(toAnalyticsItemType('eo')).toBe('eo');
    expect(toAnalyticsItemType('eos')).toBe('eo');
    expect(toAnalyticsItemType('executive_order')).toBe('eo');
    expect(toAnalyticsItemType('scotus')).toBe('scotus');
    expect(toAnalyticsItemType('pardon')).toBe('pardon');
    expect(toAnalyticsItemType('pardons')).toBe('pardon');
  });

  it('returns null for anything unrecognised instead of inventing a category', () => {
    expect(toAnalyticsItemType('nonsense')).toBeNull();
    expect(toAnalyticsItemType(undefined)).toBeNull();
    expect(toAnalyticsItemType(null)).toBeNull();
  });
});

describe('event taxonomy', () => {
  afterEach(() => {
    delete (globalThis as unknown as { window?: FakeWindow }).window;
  });

  it('carries every named event in PRD section 4', () => {
    const expected: EventName[] = [
      'card_open', 'source_click', 'share_click', 'correction_click',
      'filter_apply', 'search', 'pagination',
      'newsletter_view', 'newsletter_submit', 'newsletter_success', 'newsletter_error',
      'feedback_open', 'feedback_submit',
    ];

    const capture = vi.fn();
    setWindow(ANALYTICS_HOSTNAME, { gtag: vi.fn(), TTAnalytics: { capture } });

    for (const name of expected) {
      // Props are per-event typed; this loop only checks the names round-trip.
      track(name as 'feedback_open', { page_path: '/x' });
    }

    expect(capture.mock.calls.map((c) => c[0]).sort()).toEqual([...expected].sort());
  });
});
