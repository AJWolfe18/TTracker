/**
 * Analytics environment gate (ADO-558) + PostHog bootstrap (ADO-559).
 *
 * One gating pattern for every HTML surface and every vendor: analytics are
 * only ever loaded on the production hostname. Off PROD (localhost, the Netlify
 * TEST site, branch/deploy previews) nothing is injected and ZERO network
 * requests are made to any analytics vendor -- callers get console logging
 * instead, so instrumentation is still observable while developing.
 *
 * Loaded as a plain classic script from <head> by index.html (React app) and by
 * every legacy page in public/ that carries analytics. It is deliberately NOT a
 * module and NOT bundled by Vite, so it cannot import from src/ -- the React
 * app mirrors the constants in src/lib/analytics.ts. Keep them in sync.
 *
 * Exposes:
 *   window.TT_ANALYTICS_ENABLED  boolean
 *   window.gtag(...)             GA4 (real on PROD, console stub off PROD)
 *   window.TTAnalytics.capture(name, props)
 *                                PostHog mirror, safe to call at any time
 */
(function () {
  'use strict';

  // If this file is ever included twice on one page, only the first run counts.
  // A second GA4 injection would double-count pageviews -- the exact metric
  // this gate exists to protect.
  if (window.TT_ANALYTICS_GATE_LOADED) return;
  window.TT_ANALYTICS_GATE_LOADED = true;

  // Exact-match allowlist, never a suffix test (a suffix test would let
  // trumpytracker.com.example.org through). www currently 301s to the apex, so
  // only the apex is reachable today; the alias is here so that flipping
  // Netlify's primary domain can't silently switch analytics off.
  var ANALYTICS_HOSTNAMES = ['trumpytracker.com', 'www.trumpytracker.com'];
  var GA4_MEASUREMENT_ID = 'G-5MDT4HFMNB';

  // Publishable client-side project key -- identifies the PostHog project and
  // grants no read access, same trust class as the Supabase anon key already in
  // this frontend. Committed on purpose (plan Phase 0 "reviewer exception").
  // Secret-class PostHog keys (personal API keys) must never appear in the repo.
  var POSTHOG_PUBLISHABLE_KEY = 'phc_DfxYmHLbTycAnoLHV6ed3s2JeUpABfnxzwrerBJU8Dy3';
  var POSTHOG_API_HOST = 'https://us.i.posthog.com';
  var POSTHOG_ASSET_HOST = 'https://us-assets.i.posthog.com';

  var host = (window.location.hostname || '').toLowerCase();
  var enabled = ANALYTICS_HOSTNAMES.indexOf(host) !== -1;

  // Exposed so page scripts can branch without re-implementing the hostname
  // rule (public/shared.js keeps its own defensive check as well).
  window.TT_ANALYTICS_ENABLED = enabled;

  // ---------------------------------------------------------------------
  // Off PROD: console only. No script tags, no dataLayer, no requests.
  // ---------------------------------------------------------------------
  if (!enabled) {
    window.gtag = function () {
      console.log('[analytics:off-prod] gtag', Array.prototype.slice.call(arguments));
    };
    window.TTAnalytics = {
      capture: function (name, props) {
        console.log('[analytics:off-prod] posthog.capture', name, props);
      },
    };
    return;
  }

  // ---------------------------------------------------------------------
  // GA4
  // ---------------------------------------------------------------------
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', GA4_MEASUREMENT_ID);

  var gaScript = document.createElement('script');
  gaScript.async = true;
  gaScript.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_MEASUREMENT_ID;
  document.head.appendChild(gaScript);

  // ---------------------------------------------------------------------
  // PostHog
  //
  // We load posthog-js (array.js) directly and init it on load, rather than
  // pasting PostHog's minified queueing stub. Two reasons:
  //   1. The stub's only job is buffering calls made before the library
  //      arrives, which the small queue below does readably.
  //   2. array.js self-assigns window.posthog, and its bootstrap is
  //      `if (!window.posthog || isArray(window.posthog._i))`. Assigning our
  //      own object to window.posthog would make PostHog skip initialization
  //      ENTIRELY and fail silently, so we must not touch that global before
  //      the library loads. (Verified against posthog-js 1.418.10.)
  // ---------------------------------------------------------------------
  var pendingEvents = [];
  var posthogReady = false;

  window.TTAnalytics = {
    capture: function (name, props) {
      if (!posthogReady) {
        // Cap the buffer so a load failure can't grow it without bound.
        if (pendingEvents.length < 50) pendingEvents.push([name, props]);
        return;
      }
      try {
        window.posthog.capture(name, props);
      } catch (err) {
        /* analytics must never break the page */
      }
    },
  };

  var phScript = document.createElement('script');
  phScript.async = true;
  phScript.src = POSTHOG_ASSET_HOST + '/static/array.js';
  phScript.onload = function () {
    if (!window.posthog || typeof window.posthog.init !== 'function') return;
    try {
      window.posthog.init(POSTHOG_PUBLISHABLE_KEY, {
        api_host: POSTHOG_API_HOST,
        // Autocapture covers generic clicks/taps for free (PRD section 2).
        autocapture: true,
        // SPA route changes. Pinned against posthog-js 1.418.10, which serves
        // this option; older SDKs needed a manual $pageview on route change.
        capture_pageview: 'history_change',
        capture_pageleave: true,
        // No accounts on this site, so nobody is ever identified. This keeps
        // PostHog from creating person profiles for anonymous traffic, which
        // is what keeps us inside the free tier (PRD section 3).
        person_profiles: 'identified_only',
        // Belt and suspenders with the project-level setting: replay sampling
        // and masking are configured in the PostHog project, and we assert
        // masking here too so a settings change can't silently unmask inputs.
        session_recording: { maskAllInputs: true },
      });
      posthogReady = true;
      for (var i = 0; i < pendingEvents.length; i++) {
        window.posthog.capture(pendingEvents[i][0], pendingEvents[i][1]);
      }
      pendingEvents.length = 0;
    } catch (err) {
      /* analytics must never break the page */
    }
  };
  document.head.appendChild(phScript);
})();
