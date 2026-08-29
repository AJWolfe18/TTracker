# PRD: Social Automation v1 (Facebook Page first)

**Epic:** ADO-299 (parent) · **Planning card:** ADO-566 · **Plan:** `plan-social-automation.md` (same folder)
**Status lives in ADO.** This doc holds the what/why; the plan holds the how.
**Cost:** $0/month on current infrastructure (Netlify Edge, GitHub Actions, Supabase, Meta Graph API free tier).

---

## 0. Open Decisions (Josh)

All six kickoff decisions were answered August 29, 2026. Nothing blocks the build.

| # | Decision | Answer (August 29, 2026) | Why |
|---|---|---|---|
| D1 | Platform first | **Facebook Page.** Bluesky/X later, data-driven. | Josh's pick. FB posting is free via the Graph API; only the one-time Page + developer-app setup is on Josh (section 6). |
| D2 | Approval | **Draft-then-approve for month 1.** Drafts queue in the admin dashboard; Discord pings Josh. Alarm-5 goes full auto only after the voice is trusted. | Bad headline under the brand with no check is the failure mode. |
| D3 | Pictures | **Branded per-story card rendered from our data.** Design chosen August 29, 2026: the **receipt** (paper slip on black: receipt number + date, headline, Filed under = Story / Executive Order / SCOTUS / Pardon, one alarm badge showing level number + spicy label, e.g. 5 · Constitutional Dumpster Fire; no source count, no generic CRISIS). Canvas: https://claude.ai/code/artifact/a77a84dd-3904-412c-ab32-aa76363abe8c. Headline font steps down by length (44/36/32px, 4-line cap). No outlet photos (copyright; feed compliance is excerpts-only; RSS rarely carries an image anyway). No AI images. | $0, never misspells a name, and the same image becomes the og:image for every link preview (closes the last 515 gap). |
| D4 | Money ask | **Not yet.** Revisit after ADO-564 north-star numbers (September 7, 2026). | Josh's call. |
| D5 | First dollar | Moot until D4 changes. Recorded recommendation: Supabase Pro ($25/mo) because PROD DB is over the free cap. | - |
| D6 | Legacy cards | **Done August 29, 2026:** ADO-131, 149, 236, 249 set to Removed as duplicates. | All four describe pieces of 515/299 that are now built or planned here. |
| D7 (new) | Cadence | **Every alarm-5 story, EO, and pardon posts (after approval).** An **hourly "top pick"** slot is designed in behind a setting, OFF at launch; decide with month-1 data. | Josh wants alarm-5 for sure and is open to hourly; hourly risks filler on slow days, so it's a dial, not a default. |

Still open, non-blocking:
- [ ] **D8 - Full-auto date.** After ~30 days of approving drafts, Josh decides whether alarm-5 items skip the queue. Blocks nothing; flips one setting.

---

## 1. Problem

TrumpyTracker publishes editorial copy with alarm levels for every story, EO, SCOTUS case, and pardon, but nothing leaves the site unless a reader shares it by hand. Link previews show one generic black image. There is no channel where the site shows up in front of people who haven't already visited.

## 2. Goal

Every alarm-5 development gets posted to the TrumpyTracker Facebook Page with a branded card and a UTM-tagged link, with zero manual work beyond a one-click approve, within about 15 minutes of Josh approving it. Measurable in GA4/PostHog as its own traffic source.

**Success metrics** (Content Engagement dashboard 2029138 + GA4 acquisition):
- Weekly sessions with `utm_medium=social` > 0 in week 1, trending up by week 4
- Approve rate of drafts > 80% by week 4 (the voice is right; otherwise fix the template, not the queue)
- Zero posts on unpublished/hidden items (publish gates respected)

## 3. Scope

### In (v1, four build stories - one session each)

**S1 - Card renderer (ADO-571)** - Netlify Edge Function `/api/og-image/:type/:id` returns a 1200x630 PNG built from the record's own fields. `og-tags` switches `og:image` from `og-default.png` to this URL. Fallback to `og-default.png` on any error. Also refreshes `og-default.png` with the current tagline.

**S2 - Draft queue (ADO-572)** - `social_posts` table + `scripts/social/draft-posts.js` that finds new post-worthy items (rule in section 4), writes one `draft` row per item with the generated copy, and pings Discord "N drafts waiting" with an admin link. Admin dashboard gets a **Social** tab: preview card + copy, Approve / Reject / edit copy.

**S3 - Facebook poster (ADO-573)** - `scripts/social/post-facebook.js` posts every `approved` row to the Page via Graph API (`/{page_id}/feed` with `message` + `link`; FB pulls the card from og:image), stores post id/url, marks `posted`. Runs on a GitHub Actions schedule every 30 minutes, plus draft generation in the same run. Idempotent: one row per (platform, entity) ever.

**S4 - Cadence + digest (ADO-574)** - hourly "top pick" mode (setting-driven, OFF at launch), daily "today on the main line" digest post, front-peak posts. Starts only after S3 has run for two weeks.

### Out (explicitly)
- Bluesky, X, Threads, Instagram: add as `platform` values later; the table and poster are platform-keyed from day one.
- Replies / engagement (needs X Basic $200/mo - never in budget until Epic 565 covers it).
- AI-written commentary per post. Copy is a template over fields the Claude agents already produced. $0 marginal.
- Outlet photos or AI images (D3).
- Any money ask (D4).

## 4. Posting rule (what gets drafted)

An item becomes a draft when ALL are true:
1. **Public:** stories `status='active' AND summary_neutral IS NOT NULL`; EOs/pardons/SCOTUS `is_public = true`. Same gates as `og-tags`.
2. **Worth it:** `alarm_level = 5` (stories via `v_tracker_stories` where `main_line = true`; EOs `alarm_level = 5`; pardons `corruption_level = 5`).
3. **New since last run:** `enriched_at` / `last_updated_at` newer than the last draft run watermark.
4. **Never drafted before:** no `social_posts` row for (platform, entity_type, entity_id).

Everything else is ignored in v1 (S4 adds the digest so lower-alarm items still get a daily mention).

## 5. Copy template (no em dashes, no AI call)

```
{headline}

{first sentence of summary_spicy}

LEVEL {alarm} · {LABEL}  |  {source_count} sources
{url}?utm_source=facebook&utm_medium=social&utm_campaign=auto
```

Labels reuse `og-tags` (`5: CRISIS, 4: SEVERE, 3: SERIOUS, 2: NOTABLE, 1: WATCH, 0: WIN`). Pardons use `corruption_level` with the same label map. Josh can edit the copy in the queue before approving; edits are stored on the row.

## 6. Josh's one-time setup (before S3 can post)

~30 minutes, all free. Written as a checklist on the poster story. The TrumpyTracker Facebook Page already exists (Josh, August 29, 2026).
1. Log in as the Page admin.
2. developers.facebook.com → **Create App** → type "Business" → add the **Facebook Login** product (needed only to mint a token).
3. Graph API Explorer → select the app → permissions `pages_manage_posts`, `pages_read_engagement`, `pages_show_list` → Generate User Token → then **Get Page Access Token** for the TT Page.
4. Exchange for a **long-lived** token (Graph API Explorer has a button; Page tokens derived from long-lived user tokens do not expire).
5. Add GitHub secrets `FB_PAGE_ID` and `FB_PAGE_ACCESS_TOKEN` (repo → Settings → Secrets).
6. App stays in **Development mode** - that is enough to post to a Page you admin. No App Review needed. (App Review is only for posting on behalf of *other* users.)

## 7. Approval flow (D2)

```
enrichment writes alarm-5 item
  → draft-posts.js (every 30 min) writes social_posts row status='draft'
  → Discord embed: "2 social drafts waiting" + link to admin.html#social
  → Josh opens admin Social tab: sees card + copy, clicks Approve (or edits, or Rejects)
  → post-facebook.js (next 30-min run) posts approved rows, stores post_url, status='posted'
  → failures: status='failed', error stored, Discord alert, retried next run up to 3 times
```

Latency = Josh's approval time + up to 30 min. Once D8 flips, alarm-5 rows are created as `approved` and go out on the next run.

## 8. Measurement

- Every link carries `utm_source=facebook&utm_medium=social&utm_campaign=auto` → GA4 acquisition shows "facebook / social"; PostHog session properties carry the same.
- `social_posts` is the ledger: count posted by day, approve/reject ratio, failures. Admin Social tab shows the last 30 days.
- Existing `share_click` tile keeps measuring reader-initiated shares separately.

## 9. Cost and limits

| Piece | Cost | Limit that matters |
|---|---|---|
| Card renderer (Netlify Edge) | $0 | 1M edge invocations/mo free; crawlers only fetch on share, and FB caches per URL |
| GitHub Actions, 30-min schedule | $0 | ~10s/run × 1,440 runs/mo ≈ 240 min/mo of the 2,000 free (private repo). Drop to hourly if minutes get tight. |
| Meta Graph API | $0 | Page posting has no meaningful quota at our volume (single-digit posts/day) |
| Supabase | $0 | `social_posts` is a few KB/row; egress negligible |
| Discord webhook | $0 | already in use for pipeline alerts |
| **Total** | **$0/month** | |

## 10. Risks

- **Meta token expiry / app disabled.** Mitigation: poster alerts Discord on any 4xx; runbook = repeat section 6 steps 3-5.
- **Posting on a hidden item.** Mitigation: the draft query reuses the exact publish predicates from `og-tags`; a unit test asserts each entity type's filter string.
- **Card font/render failure at the edge.** Mitigation: renderer returns `og-default.png` bytes on any throw; never a broken image.
- **GH Actions minutes.** Mitigation: schedule is one line to change; the poster also runs at the end of the RSS/EO/pardons workflows so hourly would still catch alarm-5 within the pipeline cadence.
- **Voice sounds like a bot.** Mitigation: month-1 approval queue is the feedback loop; template tweaks are one-line changes.

## 11. Related

- Kickoff + decision history: `kickoff-social-and-monetization.md`
- Share infrastructure spec (OG tags, Phase 2 card design): `docs/superpowers/specs/2026-05-23-social-share-infrastructure-design.md`
- Tracker main-line rule: migration 112, `v_tracker_stories.main_line`
- Analytics decision rules: comment on ADO-564
