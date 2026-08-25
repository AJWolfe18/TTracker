/**
 * Analytics for the React app (ADO-558 gate, ADO-559 typed wrapper).
 *
 * Same single environment rule as `public/analytics-gate.js`: analytics only
 * run on the production hostname. Everywhere else (localhost, the Netlify TEST
 * site, branch/deploy previews) we log to the console and make zero network
 * calls.
 *
 * `public/analytics-gate.js` is a plain classic script shared with the legacy
 * HTML pages, so it cannot import from `src/`. The constants below are mirrored
 * there on purpose -- change one, change both.
 *
 * Scope: React app ONLY. `public/shared.js` is not bundled by Vite and keeps
 * its own `trackEvent` + `ALLOWED_PARAMS` path for GA4, mirroring to PostHog
 * through the same `window.TTAnalytics.capture` façade this module uses.
 *
 * Note for tests: nothing here touches `window` at module scope. Vitest runs in
 * a node environment with no jsdom, so import-time DOM access would crash the
 * whole test file (see the `src/lib/supabase.ts` gotcha).
 */

/** Canonical production hostname. */
export const ANALYTICS_HOSTNAME = 'trumpytracker.com';

/**
 * Hosts that count as production. Exact matches only, never a suffix test --
 * a suffix test would let `trumpytracker.com.example.org` through.
 *
 * `www` currently 301s to the apex, so only the apex is reachable today. The
 * alias is here so that flipping Netlify's primary domain can't silently
 * switch analytics off.
 */
export const ANALYTICS_HOSTNAMES: readonly string[] = [
  ANALYTICS_HOSTNAME,
  `www.${ANALYTICS_HOSTNAME}`,
];

export const GA4_MEASUREMENT_ID = 'G-5MDT4HFMNB';

/**
 * Bump whenever the shape of any event's properties changes, so GA4 raw events
 * stay interpretable. Mirrors `schema_v` in `public/shared.js`.
 */
export const SCHEMA_VERSION = 2;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    TT_ANALYTICS_ENABLED?: boolean;
    TTAnalytics?: { capture: (name: string, props: Record<string, unknown>) => void };
  }
}

/* ------------------------------------------------------------------ *
 * Event taxonomy (PRD section 4)
 * ------------------------------------------------------------------ */

/**
 * Analytics-local item type. `DisplayItem.type` is a plain `string` in
 * `src/types.ts`; we deliberately do not widen the shared types for analytics.
 */
export type AnalyticsItemType = 'story' | 'eo' | 'scotus' | 'pardon';

/**
 * Where a card sat when it was opened: a 0-based index in a grid/spine, or one
 * of the named slots that bypass the grid (Home hero + featured, Detail's
 * "Keep Reading" strip).
 */
export type FeedPosition = number | 'hero' | 'featured' | 'related';

/**
 * The property contract for every named event.
 *
 * Property keys and their types are compile-time enforced: a caller physically
 * cannot pass free text to `search`, because the only key it accepts is
 * `query_length: number`. No PII, no free-text user input, no email addresses
 * anywhere in here (PRD section 4 "Property hygiene").
 */
export interface EventProps {
  card_open: {
    item_type: AnalyticsItemType;
    alarm_level: number;
    feed_position: FeedPosition;
    tab: string;
  };
  source_click: {
    item_type: AnalyticsItemType;
    outlet_domain: string;
    source_position: number;
  };
  share_click: { channel: string; item_type: AnalyticsItemType };
  correction_click: { item_type: AnalyticsItemType };
  filter_apply: { tab: string; filter_key: string; filter_value: string };
  /** Never the query text -- length only. */
  search: { tab: string; query_length: number };
  pagination: { tab: string; page: number };
  newsletter_view: { surface: string };
  newsletter_submit: { surface: string };
  newsletter_success: { surface: string };
  newsletter_error: { surface: string; error_category: string };
  feedback_open: { page_path: string };
  /** The feedback MESSAGE goes to Supabase only, never to an analytics vendor. */
  feedback_submit: { page_path: string };
}

export type EventName = keyof EventProps;

/**
 * Runtime allowlist of property keys per event.
 *
 * This is the React-side equivalent of `ALLOWED_PARAMS` in `public/shared.js`,
 * and it exists because the type system disappears at runtime: an `as any` cast
 * or an untyped JS caller could otherwise smuggle a raw search string into a
 * vendor payload. Undeclared keys are dropped, not sent.
 *
 * `_schemaMatchesTypes` below makes this list drift-proof -- if it disagrees
 * with `EventProps` in either direction, the build fails.
 */
const EVENT_PROP_KEYS = {
  card_open: ['item_type', 'alarm_level', 'feed_position', 'tab'],
  source_click: ['item_type', 'outlet_domain', 'source_position'],
  share_click: ['channel', 'item_type'],
  correction_click: ['item_type'],
  filter_apply: ['tab', 'filter_key', 'filter_value'],
  search: ['tab', 'query_length'],
  pagination: ['tab', 'page'],
  newsletter_view: ['surface'],
  newsletter_submit: ['surface'],
  newsletter_success: ['surface'],
  newsletter_error: ['surface', 'error_category'],
  feedback_open: ['page_path'],
  feedback_submit: ['page_path'],
} as const satisfies Record<EventName, readonly string[]>;

/* --- compile-time guard: EVENT_PROP_KEYS must match EventProps exactly --- */

type KeyDrift<Declared extends string, Listed extends string> =
  [Exclude<Declared, Listed> | Exclude<Listed, Declared>] extends [never]
    ? true
    : ['ANALYTICS SCHEMA DRIFT', Exclude<Declared, Listed> | Exclude<Listed, Declared>];

type SchemaCheck = {
  [E in EventName]: KeyDrift<
    keyof EventProps[E] & string,
    (typeof EVENT_PROP_KEYS)[E][number]
  >;
};

// If a property is added to EventProps but not to EVENT_PROP_KEYS (or vice
// versa), this assignment fails to compile and names the offending event.
const _schemaMatchesTypes: Record<EventName, true> = {} as SchemaCheck;
void _schemaMatchesTypes;

/* ------------------------------------------------------------------ *
 * Environment gate
 * ------------------------------------------------------------------ */

/** True only on the production hostname. */
export function isAnalyticsEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return ANALYTICS_HOSTNAMES.includes((window.location.hostname || '').toLowerCase());
}

/**
 * Map a `DisplayItem.type` (a plain string) onto the analytics vocabulary.
 * Returns null for anything unrecognised so callers drop the event rather than
 * inventing a category.
 */
export function toAnalyticsItemType(type: string | null | undefined): AnalyticsItemType | null {
  switch (type) {
    case 'story':
    case 'stories':
      return 'story';
    case 'eo':
    case 'eos':
    case 'executive_order':
      return 'eo';
    case 'scotus':
      return 'scotus';
    case 'pardon':
    case 'pardons':
      return 'pardon';
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * Dispatch
 * ------------------------------------------------------------------ */

/** Drop any key not declared for this event, and any null/undefined value. */
function pickAllowed<E extends EventName>(event: E, props: EventProps[E]): Record<string, unknown> {
  const allowed: readonly string[] = EVENT_PROP_KEYS[event];
  const safe: Record<string, unknown> = {};
  if (!props || typeof props !== 'object') return safe;

  for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    if (!allowed.includes(key)) {
      console.warn(`[analytics] Blocked param: ${event}.${key}`);
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

/**
 * Fire a named KPI event to PostHog and GA4.
 *
 * Fire-and-forget: never throws, never blocks navigation. An analytics failure
 * (ad blocker, offline, SDK missing) must not break the UI.
 */
export function track<E extends EventName>(event: E, props: EventProps[E]): void {
  let safe: Record<string, unknown>;
  try {
    safe = pickAllowed(event, props);
  } catch {
    return;
  }

  if (!isAnalyticsEnabled()) {
    console.log('[analytics:off-prod]', event, safe);
    return;
  }

  // PostHog is the analysis layer.
  try {
    window.TTAnalytics?.capture(event, safe);
  } catch {
    /* ignored */
  }

  // GA4 stays a traffic report plus a raw-event backup. Custom dimensions are
  // deliberately NOT pre-registered (PRD section 10) -- the props still land in
  // raw events, they just aren't sliceable in GA4 reports until someone needs it.
  try {
    window.gtag?.('event', event, { ...safe, schema_v: SCHEMA_VERSION });
  } catch {
    /* ignored */
  }
}

/**
 * Report an SPA route change to GA4. No-op (console only) off PROD.
 *
 * PostHog captures SPA pageviews itself via `capture_pageview: 'history_change'`
 * (see `public/analytics-gate.js`), so this is GA4-only on purpose.
 */
export function trackPageView(path: string): void {
  if (!isAnalyticsEnabled()) {
    console.log('[analytics:off-prod] page_view', path);
    return;
  }
  try {
    window.gtag?.('config', GA4_MEASUREMENT_ID, { page_path: path });
  } catch {
    /* analytics must never break the UI */
  }
}
