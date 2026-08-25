# PRD: Product Analytics v1

**Status:** Draft for review
**Owner:** Josh
**Date:** August 23, 2026
**ADO:** Epic 254 → Bug 558 (GA4 gate, ships first) + Stories 559-563 (Phases 1-5)

---

## 0. Open Decisions (Josh — answer before/while the stories run)

- [x] ~~Phase 0~~ — COMPLETE August 23, 2026: PostHog US cloud project 572949; no payment method attached (= billing-cap equivalent); replay 10%, input masking at mask-everything default (do not turn off); repo-watch declined; `phc_` key posted as a comment on ADO-559. **ADO-559 is unblocked.**
- [x] ~~ADO-562 dashboards~~ — decided August 23, 2026: a Claude session drives the PostHog UI via the Chrome extension.
- [x] ~~ADO-258~~ — already Closed (its shared.js instrumentation shipped on legacy pages; the old plan.md status table was stale). ADO-259 (Pre-Commerce + Search Intelligence) stays open, untouched by this project.
- [x] ~~Feedback scope~~ — decided August 23, 2026: simple message-only popup, React app only, no email/category/Turnstile (§5).
- [x] ~~Perf metrics~~ — decided August 23, 2026: out of v1, first fast-follow (§9).
- [x] ~~Rollout order~~ — decided August 24, 2026: PROD rollout pulled forward. Phases 1-2 ship to PROD as **Phase 5a (ADO-563, next)** with the Content Engagement dashboard; feedback (561) and newsletter + remaining dashboards (562) follow as Phase 5b. Why: nothing is observable until PROD, and 1-2 already answer the usage question.

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
| `feedback_open` / `feedback_submit` | Feedback popup opened / submitted | `page_path` |
| `correction_click` | Corrections mailto clicked | `item_type` |

**Property hygiene:** no PII, no free-text user input, no email addresses in any event property. Search sends length only. To be boringly explicit about feedback: `feedback_submit` carries only `page_path` — the feedback **message goes to Supabase only and is never sent to PostHog or GA4**.

## 5. Feedback Button

**Deliberately minimal (Josh, August 23, 2026): "a simple popup where they can say there's an issue with the site." Nothing more in v1.**

- Floating button (bottom corner) on the **React app only**.
- Popup: one text box (required, ≤2000 chars, placeholder "What's wrong / what's missing? Don't include personal info.") + submit. No category picker, no email field.
- Submits to new `feedback-submit` edge function → `feedback` table (message, page_path, created_at). Fires `feedback_submit` so volume shows in PostHog without querying the DB.
- Abuse protection: hidden honeypot field + the existing `rate_limits` pattern. **No Turnstile in v1** — add it only if junk actually shows up in the table.
- Reading feedback: Supabase dashboard for v1. **Notification:** a PostHog alert on the `feedback_submit` event emails Josh daily when there are new submissions (digest-style — a spam burst means one email saying "N new", never N emails). Zero code; configured in Phase 4 alongside the dashboards.
- Spam posture: junk rows are inert (feedback is never displayed publicly and the function sends no email, so there's no abuse surface); honeypot + rate limits cap volume; Turnstile is the pre-agreed escalation if meaningful junk volume appears.
- Explicitly deferred: email/reply loop, categories, Turnstile, legacy-page button, admin viewer.

## 6. Dashboards & KPIs

Three PostHog dashboards, built as part of v1 (not left as an exercise):

1. **Content Engagement** — card open rate (detail views ÷ feed sessions), source click rate (source clicks ÷ detail views), cards per session, engagement by tab and by alarm level. *This dashboard answers the summary-length question.*
2. **Newsletter Funnel** — view → submit → success conversion, error rate by category.
3. **Feedback** — submissions over time and by page.

**North-star check (2 weeks post-launch):** we can state, with real numbers, (a) what % of feed sessions open at least one detail, (b) what % of detail views click a source, (c) newsletter conversion rate.

## 7. Privacy

- Session replay: 10% sample, **all text inputs masked**, no logged-in identity exists on the site.
- IP handling: PostHog default GeoIP then discard; GA4 already anonymizes.
- A short analytics disclosure paragraph added to the About page: usage analytics are anonymous, and feedback is anonymous too — we collect no contact info (the popup tells people not to include personal info in the message).
- No consent banner in v1 (matches current GA4 posture; US-audience site, no accounts, no ads). Revisit only if audience or regulation changes.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Traffic spike exceeds free tier | $0 billing cap — PostHog stops collecting, never bills |
| PostHog script (~60KB) slows page | Load async/deferred; measure before/after via Lighthouse manually (perf metrics are out of scope v1) |
| Ad blockers drop PostHog events | Accepted for v1; numbers are directional. (Reverse proxy via Netlify is a known fix, deferred) |
| Feedback spam | Honeypot + `rate_limits` pattern; junk rows are cheap and harmless (no email sending, no display). Add Turnstile only if volume demands it |
| Instrumentation only verifiable on PROD | Feedback button behind the `feedback` feature flag (URL override `?ff_feedback=true`); events are additive and inert if PostHog key absent |

## 9. Known Gaps (documented, deliberately not in v1)

- Performance: web-vitals, API/edge-function latency, cache hit rates ("where do we need speed improvements") — **first fast-follow**, PostHog web-vitals flag + timing wrapper in `src/lib/api.ts`.
- Error tracking (PostHog has a free error-tracking product; enablement is config, not code).
- Uptime monitoring (UptimeRobot free tier is the obvious candidate).
- Admin feedback viewer tab.

## 10. Success Criteria (acceptance)

- [ ] **Pre-ship gate:** PostHog cannot bill us — confirmed BEFORE the snippet deploys to PROD and re-confirmed post-deploy: either no payment method attached (current state, August 23, 2026) OR a $0 billing limit. If a card is ever added, the $0 limit becomes mandatory. No protection, no ship.
- [ ] PostHog live on PROD, autocapture + replay (10%, masked) verified with real traffic.
- [ ] All named events in §4 verified firing on PROD with correct properties.
- [ ] GA4 continues receiving legacy events + new dual-fired KPI events (allowlist updated). Custom dimension registration for new properties is NOT required — GA4 is traffic reporting + raw-event backup; PostHog is the analysis layer.
- [ ] Feedback popup live on the React app behind the `feedback` flag (flag files store unprefixed keys; `ff_` is the URL-override prefix only); a test submission lands in the `feedback` table and fires the event; honeypot + rate limit verified.
- [ ] Follow-up ADO task created at deploy time, due 2 weeks post-launch, to run the §6 north-star check against the dashboards — the loop closes on a card, not on memory.
- [ ] Newsletter funnel visible end to end in PostHog.
- [ ] Three dashboards built and linked from the ADO card.
- [ ] About page privacy paragraph shipped.
- [ ] **No analytics network calls off-PROD.** TEST/localhost make zero requests to PostHog or GA4 (script tags included) — console-log stub only.
