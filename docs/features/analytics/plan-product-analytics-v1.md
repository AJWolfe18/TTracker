# Implementation Plan: Product Analytics v1

**PRD:** `docs/features/analytics/prd.md` (read it first — this plan implements that scope, nothing more)
**ADO:** Epic 254 → Bug 558 (GA4 gate, ships first) + Stories 559 (P1), 560 (P2), 561 (P3), 562 (P4), 563 (P5) — each phase ≈ one session
**Before starting: check PRD §0 "Open Decisions" — unanswered items there block the stories they name (Phase 0 blocks ADO-559).**
**Branch:** develop on `test` (direct commit/push in interactive sessions; autonomous/overnight sessions deliver via PR to `test` per the 2026-08-19 convention). PROD ships via cherry-picked deployment branch + PR to `main`.

---

## Phase 0: PostHog account setup (Josh, ~15 min, no code)

**Status August 23, 2026: DONE except the key handoff** — US cloud project 572949 created; no payment method attached (= billing-cap equivalent; if a card is ever added, set a $0 limit that day); replay sampling 10%; input masking left at PostHog's mask-everything default (do NOT turn off — newsletter email + feedback box would show in recordings); repo-watch/GitHub integration declined. **Remaining: paste the `phc_` key into ADO-559.** Original steps kept below for re-setup reference:

1. Create PostHog Cloud US account + one project ("TrumpyTracker PROD").
2. **Set the project billing limit to $0** (Settings → Billing) — hard requirement before any script ships.
3. Enable session replay: sample rate 10%, "mask all text inputs" ON.
4. Copy the project API key (`phc_...`). **Reviewer exception, stated here so nobody blocks it later:** this is a *publishable* client key, same trust class as the Supabase anon key already committed in this frontend — it identifies the project, it grants no read access. It lives in a clearly named constant (`POSTHOG_PUBLISHABLE_KEY`) in the snippet/config, committed on purpose. Secret-class PostHog keys (personal API keys) must never appear in the repo.

## Phase 1: PostHog bootstrap + environment gating (1 session)

**Files:** `index.html`, `public/*.html` (the live legacy pages that already carry the gtag snippet), new `src/lib/analytics.ts`

1. **Load path decision: HTML snippet only, no npm dependency.** One load mechanism for both the React app and legacy pages — the official PostHog snippet (async, deferred) added next to the existing gtag snippet in `index.html` and each legacy page that has gtag today (`rg -l googletagmanager public/*.html` for the authoritative list). `src/lib/analytics.ts` types the global (`declare global { interface Window { posthog?: ... } }`) — do NOT add `posthog-js` to package.json; two load paths would drift.
   - **Scope check before touching legacy pages:** confirm which `public/*.html` pages are still production surfaces actually served on trumpytracker.com (vs dead/parked files). Only instrument live ones; list them in the ADO card.
2. **Gate on hostname:** initialize PostHog only when `location.hostname === 'trumpytracker.com'`. On TEST/localhost, expose a console-logging stub.
   - **Fix the existing GA4 leak while here:** today the gtag snippet fires `gtag('config', ...)` unconditionally in `index.html` and every legacy page, so TEST/localhost **pageviews already pollute PROD GA4** — only `shared.js` custom events are gated. Gating the config call is not enough: the external `googletagmanager.com/gtag/js` script tag itself must not load off-PROD (the QA criterion is ZERO analytics network calls). Replace the static `<script async src>` with conditional injection — inside the hostname gate, `document.createElement('script')` for both gtag and PostHog. Same pattern in `index.html` and every live legacy page; also gate the `App.tsx` route-change `gtag('config', ...)` call. One gating convention, both vendors, script level.
   - **This GA4 gate can (and should) ship first as its own small commit/PR** ahead of the PostHog work — it immediately stops dev/TEST traffic corrupting PROD traffic numbers and carries near-zero risk.
3. Autocapture ON (default). SPA pageviews: pin the exact option against the current posthog-js docs at implementation time (recent SDKs: `capture_pageview: 'history_change'`; older ones need a manual `$pageview` capture on route change). Do not guess — verify against the SDK version the snippet serves, and record the chosen config in this doc.
4. `src/lib/analytics.ts`: thin typed wrapper with **per-event property maps**, not a loose Record —
   ```ts
   interface EventProps {
     card_open: { item_type: ItemType; alarm_level: number; feed_position: number | 'hero' | 'featured'; tab: string };
     source_click: { item_type: ItemType; outlet_domain: string; source_position: number };
     search: { tab: string; query_length: number };
     // ...one entry per PRD §4 event
   }
   function track<E extends keyof EventProps>(event: E, props: EventProps[E]): void
   ```
   - Event names AND property keys/types are compile-time enforced (same philosophy as `skip-reasons.js`) — a future caller physically cannot pass free text or a raw query string to `search`, because the type only accepts `query_length: number`. This is the React-side equivalent of `shared.js`'s `ALLOWED_PARAMS` runtime allowlist, which the wrapper's direct `window.gtag` dual-fire would otherwise bypass. Belt-and-suspenders: the wrapper also drops undeclared prop keys at runtime (guards against `as any` casts).
   - `ItemType` is an analytics-local type — `type AnalyticsItemType = 'story' | 'eo' | 'scotus' | 'pardon'` defined in `analytics.ts` with a small normalizer from `DisplayItem.type` (which is a plain `string` in `src/types.ts`); don't widen the shared types for this.
   - **Wrapper scope: React app ONLY.** `analytics.ts` is bundled by Vite and is NOT available to `public/shared.js`/legacy pages. Legacy pages keep their existing `trackEvent` + `ALLOWED_PARAMS` path for GA4, and mirror their named events to PostHog with a small guarded addition inside `shared.js` itself (`if (window.posthog) posthog.capture(name, params)` after the allowlist filter, so the same allowlist protects both vendors). No shared shim — two surfaces, two deliberately separate implementations, one allowlist each.
   - Dual-fires to `window.gtag` when present (event name + props passed through).
   - Never throws; all calls wrapped so an analytics failure can't break the UI.
5. GA4 allowlist: add any new param names to `ALLOWED_PARAMS` in `public/shared.js` and bump `schema_v` (see memory/gotcha: unlisted params are SILENTLY dropped).
6. **GA4's role, stated so nobody over-builds it:** GA4 is traffic/acquisition reporting plus a raw-event backup. PostHog is the behavioral analysis layer. Do NOT pre-register GA4 custom dimensions for the new event properties — without registration the props still land in raw events (BigQuery-exportable), they just aren't sliceable in GA4 reports, and that's fine. Register a custom dimension manually only if/when a specific Looker Studio report needs that specific property, as a documented one-off.

**QA:** `npm run qa:smoke`; verify locally that NO network calls go to PostHog/GA4 (console stub only); verify the snippet is inert without the PROD hostname.

## Phase 2: Named events in the React app (1 session)

**Files:** `src/components/Card.tsx`, `src/pages/Detail.tsx`, `src/pages/Home.tsx` (or wherever filter pills/search/pagination handlers live — confirm via `src/hooks/useFilters.ts` call sites), `src/App.tsx`

Wire the PRD §4 events:

| Event | Where |
|---|---|
| `card_open` | **In `Home.tsx`, not `Card.tsx`.** `Card` receives only `item`/`headlineMode`/`onOpen` and doesn't know its position or tab, and two open surfaces bypass `Card` entirely (the hero `<h1 onClick>` and the featured card). Fix: `Home` builds a per-item wrapper — `const openWithTracking = (item, position) => { track('card_open', { item_type, alarm_level, feed_position: position, tab }); onOpenItem(item.id); }` — and passes the closure at all three call sites: hero (`feed_position: 'hero'`), featured (`'featured'`), and grid cards (numeric index). `Home` already has the item, the index at map time, and the tab via its filter config; `Card`'s interface doesn't change. |
| `source_click` | `Detail.tsx` — the sources list anchors AND the event-timeline source anchors (two distinct render sites; instrument both) |
| `share_click` | `Detail.tsx` — the copy-link and social share handlers |
| `correction_click` | `Detail.tsx` — the corrections mailto anchor |
| `filter_apply`, `search`, `pagination` | `useFilters` consumers — fire at the commit point, not per keystroke |

Rules:
- Props only from PRD §4 — no free text, no query strings (length only).
- Don't block navigation on event dispatch (fire-and-forget; PostHog handles beacon/unload).

**QA:** vitest for the wrapper (event-name typing, gtag dual-fire, no-throw on missing SDK); `npm run qa:smoke`; manual click-through on local with console stub verifying every event + props.

## Phase 3: Feedback popup (1 session)

**Scope decision (Josh, August 23, 2026): deliberately minimal — "a simple popup where they can say there's an issue with the site." Message-only, React app only, no email, no category, no Turnstile, no legacy include. Deferred extras listed in PRD §5 — do NOT build them.**

**Files:** new `src/components/FeedbackButton.tsx`, new `supabase/functions/feedback-submit/index.ts`, new migration, `public/shared/flags-prod.json` + `flags-test.json`

1. **Migration `113_feedback.sql`** (112 exists — `112_tracker_main_line.sql`; re-verify max number at build time): `CREATE TABLE IF NOT EXISTS feedback` — `id` identity, `message` text NOT NULL (≤2000 enforced in function), `page_path` text, `created_at` timestamptz DEFAULT now(). **Every statement idempotent** (`IF NOT EXISTS` / guarded `DO` blocks) per AGENTS.md. RLS on, **no anon grants** (post-046 lockdown means it's invisible to anon by default — that's correct; only service_role reads/writes). No PII columns, so no retention machinery needed; prune ad hoc if it ever grows.
2. **Edge function `feedback-submit`:** clone the `newsletter-signup` skeleton MINUS Turnstile — CORS headers, `rate_limits` reuse, honeypot check (reject when the hidden field is filled), input validation (non-empty, ≤2000 chars), insert with service role. No new secrets. Deploy to TEST ref `wnrjrywpcadwutfykflu` first.
3. **React component:** floating button → popup (one text box with placeholder "What's wrong / what's missing? Don't include personal info." + hidden honeypot + submit) → POST to function. Behind feature flag **`feedback`** — flag files store unprefixed keys (see `rap_sheet` in `flags-prod.json`); `ff_` is only the URL-override prefix (`?ff_feedback=true`), stripped by `useFeatureFlag.ts`. OFF in `flags-prod.json` at ship, ON in `flags-test.json`.
4. Fire `feedback_open` / `feedback_submit` (props: `page_path` only) via the wrapper.

**QA:** function unit-tested against TEST (happy path, rate-limit, honeypot filled, empty message, 2001-char message); `npm run qa:smoke`; verify a TEST submission lands in the table.

## Phase 4: Newsletter funnel + dashboards + privacy note (1 session)

**Files:** `src/components/Footer.tsx` + `src/lib/newsletter.ts` (the React app's live newsletter path — the one the PRD's problem statement is actually about), `public/shared.js` (legacy pages' helpers), About page component, PostHog UI

1. **React funnel first:** instrument `Footer.tsx`/`newsletter.ts` with `newsletter_view` (form rendered), `newsletter_submit`, `newsletter_success`, `newsletter_error` through the `analytics.ts` wrapper. Then mirror the same four steps in the legacy `shared.js` helpers (which already have submit/success/error — add `newsletter_view`, staying on `shared.js`'s own `trackEvent`/allowlist path with the PostHog mirror from Phase 1; legacy pages never import the Vite-bundled wrapper).
2. Build the three dashboards in PostHog (PRD §6) and paste their URLs into the ADO card.
   - Also configure the **feedback notification**: a PostHog alert on the `feedback_submit` event that emails Josh daily when count > 0 (digest-style, not per-event). Verify the alert email arrives (trigger a TEST-flag submission on PROD post-deploy, or use PostHog's test-send).
3. About page: analytics disclosure paragraph (PRD §7).

## Phase 5: PROD rollout + verification (part of a deploy session)

1. Cherry-pick to a deployment branch → PR to `main` per `docs/guides/prod-deployment-checklist.md`. Deploy `feedback-submit` to PROD ref `osjbulmltfpcoldydexg`; apply migration 113 on PROD. No new secrets (feedback v1 has no Turnstile).
2. Post-deploy verify on trumpytracker.com (analytics only work here): autocapture events arriving, each named event via real clicks, replay recording sampled + masked, GA4 still receiving.
3. Flip the `feedback` key to `true` in `flags-prod.json` after a live test submission (the JSON key is `feedback`, NOT `ff_feedback` — see Phase 3 step 3).
4. Confirm PostHog still can't bill (no payment method, or $0 limit if a card was added) one more time in settings.
5. Update `docs/ARCHITECTURE.md` current-state tables (new vendor, new edge function, new flag, new secret consumers) — same-session rule.

---

## Explicitly out of scope (PRD §2)

Web-vitals/perf, error tracking, uptime, admin feedback viewer. First fast-follow = PostHog web-vitals flag + `src/lib/api.ts` timing wrapper.

## Cost

$0/month: PostHog free tier with $0 hard cap, GA4 free, one more edge function (free tier), feedback table negligible. No OpenAI/Claude usage anywhere in this feature.
