# Growth kickoff: social automation + monetization

**Written:** August 24, 2026 (end of the ADO-563 analytics rollout session)
**Status:** kickoff only. Each track gets its own deep planning session that produces a PRD + plan in this folder. Nothing here is decided except where marked.
**Owner:** Josh. **Budget ceiling for everything below:** stays inside the $50/month hard cap until revenue exists.

## 0. Open Decisions (Josh)

Answer these before or during the planning sessions; each names the item it blocks.

- [ ] **D1 - Which platform first?** (blocks social Phase B). Recommendation: Bluesky + X free tier, decided by the "Shares by channel" tile on the Content Engagement dashboard after 2 weeks - whichever channel readers already share to wins.
- [ ] **D2 - Human-in-the-loop or full auto?** (blocks social Phase B). Recommendation: draft-then-approve for the first month (the Discord webhook already exists for alerts; approval = a reaction), full auto only for alarm-5 items once the voice is trusted.
- [ ] **D3 - Image style.** (blocks visuals). Recommendation: deterministic branded cards rendered from our own data (headline, alarm level, front tag, source count) - $0, no AI-image weirdness, always on-brand. AI-generated imagery only for the weekly "by the numbers" post, if ever.
- [ ] **D4 - First money move.** (blocks monetization Phase A). Recommendation: a "Support the receipts" button (Ko-fi or Stripe Payment Link, $0 setup, 0-5% fees) BEFORE any ads. Ads on political content pay badly and AdSense may reject or demonetize the category.
- [ ] **D5 - Where does the first dollar go?** Recommendation: Supabase Pro ($25/mo) - PROD DB has been over the 500MB free cap since May (see active-work memory). Revenue target #1 is simply "the site pays its own hosting".
- [ ] **D6 - Retire the overlapping cards?** ADO-131, 149, 236, 249 all describe pieces of 515 / 299. Recommendation: close them as duplicates when the social PRD lands.

## 1. What already exists (do not re-plan)

| Item | State | What it is |
|---|---|---|
| Epic **ADO-299** Social Media & Marketing Automation | New (January 2026) | Full tools landscape (Buffer / Postiz / direct APIs), 5-phase plan, cost table. Still the reference for platform costs: X free tier = 500 posts/month (enough), X Basic $200/mo only for engagement features (NOT in budget). |
| Story **ADO-515** Social share infrastructure Phase 1 | New, blocked | Dynamic OG tags per story/EO/SCOTUS/pardon via Netlify Edge Function + refactored share panel. Spec: `docs/superpowers/specs/2026-05-23-social-share-infrastructure-design.md`. **Blocker:** Netlify PROD env vars (SUPABASE_URL + ANON_KEY) still point at TEST values (memory, May 30). |
| Share panel on detail pages | Live | X / Reddit / Copy Link buttons, instrumented (`share_click` by channel) since ADO-560. |
| `og-default.png` | Broken reference | Fixed as part of 515. |
| Claude cloud agents (Stories / EO / SCOTUS / Pardons) | Live | Every item already has editorial copy in the T2 voice + an alarm level. Social copy is a derivative of this, not new AI spend. |
| The Tracker + 8 fronts | Live on PROD since August 24, 2026 | Fronts are natural social series ("Iran, day 137") - a front page (ADO-548) is the ideal share target. |
| Canva MCP | Connected in Claude Code | Can create/edit/export designs programmatically - candidate for card templates without paying for Canva AI. |
| PostHog Content Engagement dashboard | Live | `share_click` by channel, `source_click` by outlet, opens by type / alarm. This is the data that decides D1 and what to post. |

## 2. What changed since Epic 299 was written (January)

1. **Editorial copy is free now.** 299 assumed GPT writes "smart-ass commentary" per post. The Claude agents already produce it per item at $0 marginal (subscription). Social copy = a short-form template over existing fields (headline, spicy summary first sentence, alarm label, front) - no new model calls for v1.
2. **We have alarm levels and fronts.** Posting rules can be mechanical: alarm 5 = post immediately; front opening / new front peak = post; everything else = daily digest. This is the same rule the Tracker main line uses (migration 112) - reuse `v_tracker_stories.main_line` as the "worth posting" predicate.
3. **We can measure it.** `share_click` by channel tells us where readers already go; UTM-tagged links on our own posts show up in GA4 acquisition as a distinct source. Add `utm_source=<platform>&utm_medium=social&utm_campaign=auto` to every automated link so social-driven sessions are separable in both dashboards.
4. **Visuals do not need image AI.** A branded card rendered from data (Satori / `@vercel/og` on a Netlify Edge Function, or a Canva template filled via MCP) is deterministic, $0, and never misspells a name. This also IS the 515 Phase 2 "dynamic OG image" - one renderer serves both link previews and social posts.

## 3. Social automation - proposed shape (for the planning session)

**Goal:** every alarm-5 development and every front opening gets posted with a branded card and a UTM link within ~15 minutes, with zero manual work after approval rules are set.

- **Phase A - cards + previews ($0):** unblock 515 (Josh sets the two Netlify env vars), ship OG tags, then the card renderer (headline, alarm badge, front tag, "N sources", date, T2 wordmark). Platform-sized variants: 1200x630 (link preview / X), 1080x1080 (IG / Threads), 1080x1920 (stories) - same renderer, three sizes.
- **Phase B - poster ($0):** a scheduled GitHub Action (same pattern as `rss-tracker-prod.yml`) or a Claude cloud agent that reads new `main_line = true` rows since last run, builds copy from existing fields, attaches the card, posts via Bluesky AT Protocol (free) + X free tier (500/mo). Record every post in a `social_posts` table (platform, entity, post id, url, posted_at) so it is idempotent and measurable. Human gate per D2.
- **Phase C - digest + series ($0):** daily "today on the main line" thread; weekly "by the numbers" card (developments logged, alarm-5 count - the Tracker tally numbers already exist in `fetchTrackerTally`); front series posts when a front hits a new peak.
- **Phase D - engagement:** requires X Basic ($200/mo). Out of budget; revisit only once monetization covers it.

**Cost:** Phases A-C $0/month on current infrastructure. Optional: Buffer $5/channel/mo if we want IG/Facebook without Meta app review.

**Success metrics (from the dashboards):** GA4 sessions with `utm_medium=social` per week; `share_click` growth; retention of social-acquired visitors vs direct.

## 4. Monetization - proposed shape (for the planning session)

**Goal #1:** the site pays its own hosting (~$25-45/month: Supabase Pro + domain; PostHog stays $0). **Goal #2:** fund the X Basic tier if engagement automation proves worth it.

| Option | Setup cost | Fit | Notes |
|---|---|---|---|
| **Donation / "Support the receipts"** (Ko-fi, Buy Me a Coffee, Stripe Payment Link) | $0, 0-5% fees | Best first move | One button in the header + a line under every detail page. Zero design risk, no content-policy exposure. Instrument as `support_click`. |
| **Newsletter sponsorship** | $0 | Good, later | Needs the newsletter to exist with real subscribers (Phase 5b ships the funnel). Sponsor slot in the weekly digest. Rate follows list size. |
| **Membership** (Patreon / Ko-fi memberships) | $0, 5-8% fees | Medium | Perk ideas: early access to front pages, monthly "receipts" PDF, name in a supporters list. Only after there is a habit (retention tile > 10%). |
| **Display ads** (AdSense, Ezoic, Mediavine) | $0 but traffic minimums (Mediavine 50k sessions/mo) | Poor fit now | Political content is often limited-ads or rejected; RPM on politics is low; ads fight the design. Park it. |
| **Affiliate / merch** | $0-low | Weak | Off-brand unless it is books/receipts-themed. Park it. |

**Instrumentation first:** add `support_click` (and later `member_click`) to the analytics allowlist so the Content Engagement dashboard shows conversion by page and by alarm level of the item being read. Decision rule: if support clicks per 1,000 pageviews < 2 after a month, the ask is invisible - move it, do not add another.

**Cost:** $0 to start. Fees only on money that arrives.

## 5. Sequencing (recommendation)

1. **Now (no session needed):** Josh sets Netlify PROD env vars (unblocks 515) and answers D1-D5 above.
2. **Session 1 - Social PRD + plan** (deep): resolves 299 vs 515 overlap, specifies the card renderer, poster, `social_posts` table, UTM scheme, approval flow. Output: `docs/features/growth/prd-social-automation.md` + plan. Close duplicate cards (D6).
3. **Session 2 - Monetization PRD + plan** (medium): support button + instrumentation + copy; newsletter sponsorship placeholder. Output: `docs/features/growth/prd-monetization.md`.
4. **Build order:** 515 -> card renderer -> support button (one afternoon, ships with the renderer PR) -> poster Phase B -> digest.
5. **Read the dashboard at each step** (ADO-564 rules): shares-by-channel picks the platform; source-click rate decides whether posts link to us or to the outlet; retention decides when membership is worth offering.

## 6. Related cards

- Epic ADO-299 (social automation) - keep as the parent; this doc supersedes its phase list.
- Epic ADO-565 (monetization) - created August 24, 2026.
- ADO-515 (OG tags + share UI) - first build.
- ADO-548 (front pages) - best share target; sequence before Phase C.
- ADO-564 (north-star numbers) - the data gate for every decision above.
- ADO-131 / 149 / 236 / 249 - overlapping legacy cards, close on D6.
