# PRD: Product Analytics v1

**Status:** Draft for review
**Owner:** Josh
**Date:** August 23, 2026
**ADO:** TBD (card on approval)

---

## 1. Problem

TrumpyTracker has almost no visibility into how people actually use the product.

- The **React app** (Tracker spine + News/EO/SCOTUS/Pardons tabs — the main site) reports only GA4 page views (`src/App.tsx`). No source-link clicks, no share clicks, no filter/search usage, no per-card engagement.
- The **legacy vanilla pages** have decent hand-wired GA4 events in `public/shared.js` (`outbound_click`, `detail_toggle`, `newsletter_signup`, `search_action`), but that instrumentation never made it to the React app that replaced them.
- Product questions we cannot currently answer:
  - Do readers open detail pages, or bounce off cards?
  - Do readers click through to source articles? (This directly gates the "are 2-3 sentence summaries enough?" content decision.)
  - Which tabs/filters/alarm levels get attention?
  - Does anyone use search? Share? The corrections link?
  - Is the newsletter funnel leaking at the form, the submit, or the confirm?
  - Is anyone trying to tell us something and giving up (no feedback channel exists)?

Without this, content and UX decisions (summary length, tab ordering, card density) are guesses.

## 2. Goals

1. **Behavioral visibility:** autocapture generic clicks/taps/route changes on the main site for free; the ~10 named KPI events that carry semantics (item type, alarm level, position) each need explicit wiring — see §4.
2. **Decision support:** within 2 weeks of shipping, answer "do readers who open details click through to sources?" with real numbers.
3. **Feedback channel:** a lightweight feedback button on every page, with measurable volume.
4. **Newsletter funnel:** measure view → submit → success/error end to end.
5. **$0/month:** stay inside free tiers with a hard spend cap.

### Non-goals (v1)

- **Performance metrics** (Core Web Vitals, API latency, cache effectiveness). Explicitly deferred per scope decision; PostHog can enable web-vitals autocapture later with a config flag. Documented as fast-follow.
- Error tracking, uptime monitoring (documented as known gaps, not built).
- A/B testing / experimentation.
- Admin UI for reading feedback (Supabase dashboard read is enough for v1).

## 3. Solution Overview

**Stack: PostHog Cloud (US region, free tier) added alongside GA4.**

| Concern | Tool | Why |
|---|---|---|
| Behavioral events, funnels, retention | PostHog autocapture + named events | Autocapture records all clicks without hand-wiring; free to 1M events/mo |
| Session replay | PostHog, 10% sample, all inputs masked | Fastest way to see confusion/dead-ends; free to 5K recordings/mo |
| Traffic/acquisition reporting | GA4 (unchanged, G-5MDT4HFMNB) | Keeps Looker Studio continuity and search/ads integration |
| Feedback storage | Supabase table + edge function | Mirrors proven newsletter-signup pattern |

**Cost control (hard requirement):** PostHog project billing limit set to **$0** so it stops collecting rather than bills if traffic ever exceeds free tier. GA4 is free. Net budget impact: **$0/month**.

**Environment rule:** analytics fire only on `trumpytracker.com`; TEST/localhost log to console only. Note this is *stricter than today*: `shared.js` currently gates only custom events, while the GA4 pageview snippet fires unconditionally — meaning TEST/localhost pageviews pollute PROD GA4 right now. This project fixes that leak by gating both vendors at script level (plan Phase 1). Consequence: instrumentation is only fully verifiable after a PROD deploy.

## 4. Event Taxonomy

Autocapture covers generic clicks. These named events add the semantics autocapture can't infer. All dual-fire to GA4 so existing Looker Studio reports keep working (allowlists updated in the relevant path: the typed property maps in the React wrapper, `ALLOWED_PARAMS` in legacy `shared.js`).

| Event | Fired when | Key properties |
|---|---|---|
| `card_open` | Feed card clicked → detail route | `item_type` (story/eo/scotus/pardon), `alarm_level`, `feed_position`, `tab` |
| `source_click` | Outbound source link clicked on a detail page | `item_type`, `outlet_domain`, `source_position` |
| `share_click` | Any share action (copy link, social) | `channel`, `item_type` |
| `filter_apply` | Filter pill toggled | `tab`, `filter_key`, `filter_value` |
| `search` | Search committed | `tab`, `query_length` (never the query text) |
| `pagination` | Page changed | `tab`, `page` |
| `newsletter_view` / `newsletter_submit` / `newsletter_success` / `newsletter_error` | Funnel steps | `surface`, `error_category` (error only) |
| `feedback_open` / `feedback_submit` | Feedback modal opened / submitted | `category`, `page_path` |
| `correction_click` | Corrections mailto clicked | `item_type` |

**Property hygiene:** no PII, no free-text user input, no email addresses in any event property. Search sends length only. To be boringly explicit about feedback: `feedback_submit` carries only `category` and `page_path` — the feedback **message and email go to Supabase only and are never sent to PostHog or GA4**.

## 5. Feedback Button

- Floating button (bottom corner) on the React app and on legacy pages **that remain linked/served in production** (the live-surface list confirmed in plan Phase 1 — parked/dead files are out of scope).
- Modal: category select (`bug`, `content`, `idea`, `other`), message (required, ≤2000 chars), optional email. The email field is labeled "optional — only if you want a reply"; submitting one makes that submission non-anonymous by design (see §7).
- Submits to new `feedback-submit` edge function → `feedback` table.
- Abuse protection: reuse the existing `rate_limits` pattern and Turnstile integration from `newsletter-signup` (already proven on this site).
- Each submit also fires `feedback_submit` so volume is visible in PostHog without querying the DB.
- Reading feedback: Supabase dashboard for v1.

## 6. Dashboards & KPIs

Three PostHog dashboards, built as part of v1 (not left as an exercise):

1. **Content Engagement** — card open rate (detail views ÷ feed sessions), source click rate (source clicks ÷ detail views), cards per session, engagement by tab and by alarm level. *This dashboard answers the summary-length question.*
2. **Newsletter Funnel** — view → submit → success conversion, error rate by category.
3. **Feedback** — submissions over time, by category, by page.

**North-star check (2 weeks post-launch):** we can state, with real numbers, (a) what % of feed sessions open at least one detail, (b) what % of detail views click a source, (c) newsletter conversion rate.

## 7. Privacy

- Session replay: 10% sample, **all text inputs masked**, no logged-in identity exists on the site.
- IP handling: PostHog default GeoIP then discard; GA4 already anonymizes.
- A short analytics disclosure paragraph added to the About page: usage analytics are anonymous; feedback is anonymous **unless you include an email**, in which case it's stored only to reply to you, never shared, and deleted with the feedback row (retention: feedback rows kept ≤12 months).
- No consent banner in v1 (matches current GA4 posture; US-audience site, no accounts, no ads). Revisit only if audience or regulation changes.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Traffic spike exceeds free tier | $0 billing cap — PostHog stops collecting, never bills |
| PostHog script (~60KB) slows page | Load async/deferred; measure before/after via Lighthouse manually (perf metrics are out of scope v1) |
| Ad blockers drop PostHog events | Accepted for v1; numbers are directional. (Reverse proxy via Netlify is a known fix, deferred) |
| Feedback spam | Turnstile + rate limits, same as newsletter |
| Instrumentation only verifiable on PROD | Feedback button behind the `feedback` feature flag (URL override `?ff_feedback=true`); events are additive and inert if PostHog key absent |

## 9. Known Gaps (documented, deliberately not in v1)

- Performance: web-vitals, API/edge-function latency, cache hit rates ("where do we need speed improvements") — **first fast-follow**, PostHog web-vitals flag + timing wrapper in `src/lib/api.ts`.
- Error tracking (PostHog has a free error-tracking product; enablement is config, not code).
- Uptime monitoring (UptimeRobot free tier is the obvious candidate).
- Admin feedback viewer tab.

## 10. Success Criteria (acceptance)

- [ ] **Pre-ship gate:** $0 PostHog billing cap confirmed in settings BEFORE the snippet deploys to PROD, and re-confirmed post-deploy. No cap, no ship.
- [ ] PostHog live on PROD, autocapture + replay (10%, masked) verified with real traffic.
- [ ] All named events in §4 verified firing on PROD with correct properties.
- [ ] GA4 continues receiving legacy events + new dual-fired KPI events (allowlist updated). Custom dimension registration for new properties is NOT required — GA4 is traffic reporting + raw-event backup; PostHog is the analysis layer.
- [ ] Feedback button live on the React app + live-surface legacy pages behind the `feedback` flag (flag files store unprefixed keys; `ff_` is the URL-override prefix only); a test submission lands in the `feedback` table and fires the event.
- [ ] Follow-up ADO task created at deploy time, due 2 weeks post-launch, to run the §6 north-star check against the dashboards — the loop closes on a card, not on memory.
- [ ] Newsletter funnel visible end to end in PostHog.
- [ ] Three dashboards built and linked from the ADO card.
- [ ] About page privacy paragraph shipped.
- [ ] **No analytics network calls off-PROD.** TEST/localhost make zero requests to PostHog or GA4 (script tags included) — console-log stub only.
