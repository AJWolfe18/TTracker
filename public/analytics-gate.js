/**
 * Analytics environment gate (ADO-558).
 *
 * One gating pattern for every HTML surface: analytics vendors are only ever
 * loaded on the production hostname. Off PROD (localhost, the Netlify TEST
 * site, branch/deploy previews) nothing is injected and ZERO network requests
 * are made to any analytics vendor -- callers get a console-logging stub so
 * existing instrumentation keeps working without touching the wire.
 *
 * Loaded as a plain classic script from <head> by index.html (React app) and
 * by every live legacy page in public/. It is deliberately NOT a module and
 * NOT bundled by Vite, so it cannot import from src/ -- the React app mirrors
 * these two constants in src/lib/analytics.ts. Keep them in sync.
 *
 * PostHog is added to this same gate in ADO-559 (Phase 1) -- one convention,
 * both vendors, script level.
 */
(function () {
  'use strict';

  var ANALYTICS_HOSTNAME = 'trumpytracker.com';
  var GA4_MEASUREMENT_ID = 'G-5MDT4HFMNB';

  var enabled = window.location.hostname === ANALYTICS_HOSTNAME;

  // Exposed so page scripts can branch without re-implementing the hostname
  // rule (public/shared.js keeps its own defensive check as well).
  window.TT_ANALYTICS_ENABLED = enabled;

  if (!enabled) {
    // Console stub only. No dataLayer, no script tag, no requests.
    window.gtag = function () {
      console.log('[analytics:off-prod] gtag', Array.prototype.slice.call(arguments));
    };
    return;
  }

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
})();
