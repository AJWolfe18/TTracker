# Handoff: ADO-558 + ADO-559 — Product Analytics v1, Bug fix + Phase 1

**Date:** August 23, 2026
**ADO:** Epic 254 → Bug 558 (Active), User Story 559 (Active)
**PRs:** [#129](https://github.com/AJWolfe18/TTracker/pull/129) (558) and [#130](https://github.com/AJWolfe18/TTracker/pull/130) (559), both open to `test`, both `@codex review` requested
**Branches:** `feature/ado-558-ga4-hostname-gate`, `feature/ado-559-posthog-bootstrap` (stacked on 558)
**Worktree:** `.claude/worktrees/analytics-v1` — used because another session owned the main tree

---

## What Josh needs to do

1. **Merge PR #129 first**, then PR #130. (#130 is cut from #129, so its diff includes those files until #129 lands. If #130 goes first nothing breaks — #129 then shows as already-merged and can be closed.)
2. Nothing else. Both cards stay **Active** until their PRs merge.

---

## What shipped

### ADO-558 — GA4 was polluting PROD analytics

Every dev and TEST visit was counted in PROD GA4 (`G-5MDT4HFMNB`). The gtag script tag and `gtag('config', …)` fired unconditionally in `index.html`, on `src/App.tsx` route changes, and on every legacy page. Only `shared.js` *custom events* were gated — pageviews were not.

**Fix:** one gating pattern in one file.

| File | Change |
|---|---|
| `public/analytics-gate.js` | **New.** The only place any analytics vendor loads. On PROD it injects the GA4 script via `document.createElement`; off PROD it installs a console-logging `gtag` stub and creates no script element and no `dataLayer`. Exposes `window.TT_ANALYTICS_ENABLED`. |
| `index.html` + 3 legacy pages | Load that one file instead of each holding an inline copy. |
| `src/lib/analytics.ts` | **New.** React-side half of the same rule. |
| `src/App.tsx` | Per-route `gtag('config')` now goes through `trackPageView`. |

### ADO-559 — PostHog bootstrap + typed wrapper (Phase 1)

PostHog joins GA4 behind the same gate. Snippet-only load, **no npm dependency**, so there is one load path and the two can't drift.

| File | Change |
|---|---|
| `public/analytics-gate.js` | Injects posthog-js alongside GA4 on PROD; off PROD both vendors are console stubs. |
| `src/lib/analytics.ts` | `track<E>(event, props)` with per-event property maps, runtime allowlist, GA4 dual-fire, never throws. |
| `public/shared.js` | `ALLOWED_PARAMS` gains the PRD §4 params; `schema_v` 1 → 2; PostHog mirror after the allowlist filter; environment gate unified onto the allowlist rule. |
| `docs/features/analytics/plan-product-analytics-v1.md` | Phase 1 step 3 config recorded, as the plan required. |

---

## Three findings worth carrying forward

### 1. Never assign `window.posthog` before posthog-js loads

The plan said "use the official PostHog snippet". We don't. Reading the bundle actually served revealed why that matters:

```js
var i = v.posthog;
if (!i || X(i._i)) { /* create instance, assign v.posthog */ }
```

`array.js` **self-assigns `window.posthog`**, and only initializes if that global is absent or is a stub carrying an `_i` array. Assigning any other object to `window.posthog` makes PostHog **skip initialization entirely and fail silently** — no error, no events, nothing to notice.

So the gate loads `array.js` and calls `init` in `onload`, with a small capped queue for captures made before it lands, and both surfaces mirror through a `window.TTAnalytics.capture` façade instead of touching `window.posthog`. Pinned by a regression test.

### 2. The SPA pageview option is pinned to a verified SDK version

The bundle at `https://us-assets.i.posthog.com/static/array.js` reports `LIB_VERSION="1.418.10"` and contains the `"history_change"` branch, so `capture_pageview: 'history_change'` is supported. **Consequence:** `trackPageView()` is **GA4-only** on purpose — PostHog captures route changes itself, so dual-firing would double-count.

### 3. `shared.js`'s environment gate was a denylist, and it leaked

It checked `'test--'`, `localhost`, `127.0.0.1` — which misses Netlify **deploy previews** (`deploy-preview-42--…`) and any other branch deploy. Now unified onto the allowlist rule via `TT_ANALYTICS_ENABLED`, with a fallback that fails closed.

---

## How to verify

```bash
npx vitest run     # 169/169 (22 analytics)
npm run lint       # tsc --noEmit, clean
npm run qa:smoke   # exit 0
npm run build && grep -rl "googletagmanager\|posthog" dist/ | grep -v '\.map$'
#   -> dist/analytics-gate.js only
```

The strongest evidence is `src/__tests__/analytics.test.ts`: it imports the **real shipped loader** with `?raw` and executes it against a fake DOM on 7 off-PROD hostnames — `localhost`, `127.0.0.1`, `test--…netlify.app`, `deploy-preview-42--…`, the bare netlify subdomain, plus `trumpytracker.com.evil.example` and `nottrumpytracker.com` — asserting **0 script elements created, 0 appended, no `dataLayer`**. That is the ADO-558 AC proven directly rather than inferred.

The compile-time schema guard was verified by deliberately breaking it:

```
error TS2322: Type 'SchemaCheck' is not assignable to type 'Record<keyof EventProps, true>'.
  Types of property 'search' are incompatible.
    Type '["ANALYTICS SCHEMA DRIFT", "query_length"]' is not assignable to type 'true'.
```

It names the event *and* the drifting key. Reverted after the check.

---

## Review response (PR #129 automated review, no blockers)

**Taken:** double-include guard (a second injection would double-count pageviews — the very metric being fixed); case-insensitive hostname + `www` alias (still exact-match, never a suffix test).

**Rejected — one would have caused a real bug:** the suggestion to use a relative `src` instead of `/analytics-gate.js` **would break the React app.** It is an SPA served at routes like `/detail/123`, where a relative path resolves to `/detail/analytics-gate.js` and 404s. Also rejected: `<link rel="preload">` (the tag is already first in `<head>`) and `id="analytics-gate"` (no runtime or test value).

---

## Gotchas hit along the way

- **A subset of `node_modules` is tracked in this repo.** `npm ci` in a fresh worktree rewrites their line endings and they show as modified. Stage files explicitly — **never `git add -A`** here.
- **`@types/node` is not a dependency.** A test that imported `node:fs`/`node:vm` failed `tsc`. Vite's `?raw` import plus `new Function` does the same job with no node builtins.
- The legacy pages are **orphaned but still served**: `dashboard-legacy.html`, `executive-orders.html`, `pardons.html` ship in `dist/` and are reachable by direct URL, but nothing in the current site links to them. Gated anyway — same pollution, two-line change.

---

## Next

- **ADO-560** (Phase 2): wire the PRD §4 named events in the React app. `card_open` belongs in `Home.tsx`, not `Card.tsx` — see the plan's table for why (three open surfaces, two of which bypass `Card`).
- Phases 3–5 unchanged: feedback popup, newsletter funnel + dashboards, PROD rollout.
- **Verification debt by design:** real events arriving in PostHog, replay sampling/masking, and GA4 continuity can only be confirmed after the PROD deploy (PRD §3). That is Phase 5 / ADO-563.

**Cost: $0.** PostHog free tier, no payment method attached, `person_profiles: 'identified_only'` so anonymous traffic creates no person profiles.
