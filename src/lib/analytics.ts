/**
 * Analytics gate for the React app (ADO-558).
 *
 * Same single rule as `public/analytics-gate.js`: analytics only run on the
 * production hostname. Everywhere else (localhost, the Netlify TEST site,
 * branch/deploy previews) we log to the console and make zero network calls.
 *
 * `public/analytics-gate.js` is a plain classic script shared with the legacy
 * HTML pages, so it cannot import from `src/`. The two constants below are
 * mirrored there on purpose -- change one, change both.
 *
 * Note for tests: nothing here touches `window` at module scope. Vitest runs in
 * a node environment with no jsdom, so import-time DOM access would crash the
 * whole test file (see `src/lib/supabase.ts` gotcha).
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

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    TT_ANALYTICS_ENABLED?: boolean;
  }
}

/** True only on the production hostname. */
export function isAnalyticsEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return ANALYTICS_HOSTNAMES.includes((window.location.hostname || '').toLowerCase());
}

/**
 * Report an SPA route change to GA4. No-op (console only) off PROD.
 * Never throws -- an analytics failure must not break navigation.
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
