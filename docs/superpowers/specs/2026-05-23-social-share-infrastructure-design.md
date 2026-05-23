# Social Media Share Infrastructure — Design Spec

**Date:** 2026-05-23
**Status:** Draft
**Owner:** Josh
**Cost impact:** Expected ~$0/month (verify Netlify plan limits before deploy)

## Problem

When someone shares a TrumpyTracker link on social media, every platform shows the same generic preview: "TrumpyTracker — accountability log." No story headline, no alarm level, no visual identity. The current share flow on the Detail page requires clicking "Generate Share Card," waiting for a client-side image render, then picking a platform — three steps for something that should be one click.

## Solution

Two-phase approach to social media sharing:

1. **Phase 1:** Dynamic OG meta tags per story + simplified share UI (direct platform buttons)
2. **Phase 2:** Dynamic per-story OG image generation (branded share card rendered server-side)

Phase 1 is standalone and delivers 80% of the value. Phase 2 adds visual punch once sharing traction is confirmed.

---

## Phase 1: Dynamic OG Tags + Share UI

### 1.1 Netlify Edge Function — Crawler Detection + OG Tag Injection

A single Edge Function intercepts all content routes and injects per-story OG meta tags when social platform crawlers request the page. Regular browser users pass through to the SPA normally.

**Routes handled:**
- `/detail/:id` (stories)
- `/eos/:id` (executive orders)
- `/scotus/:id` (SCOTUS cases)
- `/pardons/:id` (pardons)

**Crawler detection:** User-Agent matching for `facebookexternalhit`, `Twitterbot`, `LinkedInBot`, `Slackbot`, `Discordbot`, `redditbot`, `Threads`.

**Behavior:**
- Crawler detected → fetch story data from Supabase (anon key, minimal fields), return HTML with record-specific OG tags that **replace** the generic ones. The edge function fetches the upstream `index.html` response via `context.next()`, reads the HTML body as text, and uses regex patterns to match and replace OG/Twitter meta tags by attribute identity — not by exact string or line position. Patterns: `/<meta property="og:title"[^>]*>/` replaces with the record-specific `og:title`, and similarly for `og:description`, `og:image`, `og:url`, `og:type`, `twitter:card`, `twitter:title`, `twitter:description`. This approach is resilient to formatting changes in `index.html` (whitespace, attribute order, line number shifts). Result: crawlers see exactly one value per OG property — never duplicate tags.
- Regular browser → `context.next()` passes through to Netlify's SPA redirect (`/* → /index.html`)

**Origin handling:** All URLs (`og:image`, `og:url`) are derived from the incoming request's origin (`new URL(request.url).origin`), never hardcoded. This ensures branch deploys, preview sites, and production all generate correct self-referencing URLs. Crawlers that hit the test deploy get test OG tags pointing at the test site.

**OG tags injected:**
```html
<meta property="og:title" content="{spicy headline}" />
<meta property="og:description" content="{per-type description, see table below}" />
<meta property="og:image" content="{origin}/og-default.png" />
<meta property="og:url" content="{origin}/{route}/{id}" />
<meta property="og:type" content="article" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="{spicy headline}" />
<meta name="twitter:description" content="{summary_spicy, truncated to 200 chars}" />
```

**Data fetched per content type (minimal fields, ~200 bytes per query):**

| Type | Fields | Publish gate |
|------|--------|-------------|
| Stories | `primary_headline, summary_spicy, alarm_level, category, source_count, last_updated_at` | `status=eq.active` AND `summary_neutral` not null (matches `filters.ts` line 47) |
| EOs | `title, section_what_it_means, alarm_level, category, order_number, updated_at` | `is_public=eq.true` (matches `api.ts` line 123) |
| SCOTUS | `case_name_short, summary_spicy, ruling_impact_level, ruling_label, vote_split, updated_at` | `is_public=eq.true` (matches `api.ts` line 134) |
| Pardons | `recipient_name, summary_spicy, corruption_level, primary_connection_type, updated_at` | Query via `pardons-detail` edge function (same gate as frontend) |

Note: `*_updated_at` fields are used in Phase 2 for OG image cache busting (`?v={unix_timestamp}`). In Phase 1 they are fetched but unused — minimal cost to include now and avoids a Phase 2 query change.

**Critical:** The edge function MUST apply the same publish gates the frontend uses. If a record fails the gate (unpublished EO, draft SCOTUS case, unenriched story), return generic site-level OG tags instead of record-specific ones. Never expose unpublished content metadata in OG tags.

**Per-type OG description templates:**

| Type | `og:description` template |
|------|--------------------------|
| Stories | `LEVEL {alarm} · {alarm_label} — {source_count} sources cited` |
| EOs | `LEVEL {alarm} · {alarm_label} — Executive Order #{order_number}` |
| SCOTUS | `IMPACT {ruling_impact_level} · {ruling_label} — {vote_split}` |
| Pardons | `CORRUPTION {corruption_level}/5 · {primary_connection_type}` |

Each content type has its own description template using only fields present in that type's query set. No shared template across types.

**Route-to-table mapping:**

| Route | Supabase table | ID field |
|-------|---------------|----------|
| `/detail/:id` | `stories` | `id` |
| `/eos/:id` | `executive_orders` | `id` |
| `/scotus/:id` | `scotus_cases` | `id` |
| `/pardons/:id` | `pardons` | `id` |

**Supabase access:** Uses anon key (already public in the frontend bundle). Env vars `SUPABASE_URL` and `SUPABASE_ANON_KEY` set in Netlify dashboard, scoped per deploy context (test site vs prod site).

**Files:**
- `netlify/edge-functions/og-tags.ts` — the edge function
- `netlify.toml` — add `[[edge_functions]]` declarations

### 1.2 Static OG Default Image

Create a branded static image at `public/og-default.png` (1200x630) used as the `og:image` for all stories in Phase 1. This also fixes a pre-existing bug where `index.html` references `/og-default.png` but the file doesn't exist.

Design: Dark background (#0a0a0b), TRUMPY/TRACKER logo, tagline "accountability log," TrumpyTracker URL. Matches the existing share card aesthetic. Generated programmatically using the same Satori tooling from Phase 2 (or created as a one-off static asset during Phase 1).

### 1.3 Share Panel Refactor

Replace the current "Generate Share Card" toggle flow with direct platform buttons.

**Current action row (remove):**
```
[Generate Share Card]  [Copy Link]  [Report Correction]
```

**New action row:**
```
[X]  [THREADS]  [FACEBOOK]  [REDDIT]  |  [COPY LINK]  [REPORT CORRECTION]
```

**Button behavior:**
- **X:** Opens `twitter.com/intent/tweet?text={headline}&url={story_url}`
- **Threads (best-effort):** Opens `threads.net/intent/post?text={headline + story_url}`. Note: this endpoint is not formally documented by Meta and may change or be unsupported on some browsers. Implementation should detect failure (e.g., the opened page returns an error) and fall back to copying the share text to clipboard with a toast message. If the endpoint stops working entirely, the button can be removed without affecting other platforms.
- **Facebook:** Opens `facebook.com/sharer/sharer.php?u={story_url}&quote={headline}`
- **Reddit:** Opens `reddit.com/submit?url={story_url}&title={headline}`
- **Copy Link:** Copies story URL to clipboard (existing functionality, retained)
- **Report Correction:** Existing mailto flow, unchanged

**Why Copy Link stays:** It's the universal share path for platforms without intent URLs — Slack, Discord, email, iMessage, BlueSky, group chats. Removing it would be a regression from the current Detail page. It's styled as a secondary/utility button (outlined) to keep visual hierarchy clear.

**Styling:** Platform buttons are filled/primary (white bg, dark text, bold). Report Correction stays outlined/secondary. All use existing mono font, uppercase, letter-spacing pattern from the current design system.

**Mobile:** Add Web Share API detection. On mobile browsers that support it, show a "SHARE" button before the platform buttons that triggers the native share sheet (passes headline + URL). The individual platform buttons remain visible below as a fallback — Web Share is an addition, not a replacement.

**Removals (Phase 1):**
- `showShare` toggle state and "Generate Share Card" button in `Detail.tsx`
- ShareCard import and conditional render removed from `Detail.tsx`

**Deferred to Phase 2 completion:**
- `ShareCard.tsx` component — kept as visual reference for Phase 2 OG image verification (side-by-side comparison of client-rendered vs server-rendered card)
- `html-to-image` npm dependency — removed after Phase 2 ships and visual verification passes

**Files:**
- `src/pages/Detail.tsx` — refactor action row, remove ShareCard import/render
- `src/components/ShareCard.tsx` — kept (unused but retained as Phase 2 reference)
- `package.json` — no changes in Phase 1

### 1.4 Verification

Test OG tags using:
- Facebook Sharing Debugger (`developers.facebook.com/tools/debug/`)
- X Card Validator (`cards-dev.twitter.com/validator`)
- LinkedIn Post Inspector
- Manual paste-test on Reddit, Threads, Discord

---

## Phase 2: Dynamic OG Image Generation

### 2.1 OG Image Edge Function

A Netlify Edge Function at `/api/og-image/:type/:id` that generates a branded 1200x630 PNG share card on-the-fly using `og_edge` (Deno-native Satori wrapper).

**Route:** `/api/og-image/:type/:id` where type = `detail|eos|scotus|pardons`

**Behavior:**
1. Parse type and ID from URL
2. Fetch story data from Supabase (same minimal fields as Phase 1)
3. Render share card design via Satori → SVG → PNG
4. Return PNG with cache headers: `Cache-Control: public, max-age=86400, s-maxage=86400`

**Design (recreates existing ShareCard aesthetic):**
- Dark background (#0a0a0b)
- Alarm-level accent color border and badge
- `LEVEL {N} · {alarm_label}` badge (top right)
- `TRUMPY/TRACKER` logo (top left, accent color on the `/`)
- Content type + spicy label (above headline, mono, accent color)
- Headline (display font, white, large)
- Per-type footer bar (bottom, mono, gray):

  | Type | Footer left | Footer right |
  |------|------------|-------------|
  | Stories | `trumpytracker.com` | `{source_count} sources cited` |
  | EOs | `trumpytracker.com` | `Executive Order #{order_number}` |
  | SCOTUS | `trumpytracker.com` | `{vote_split}` |
  | Pardons | `trumpytracker.com` | `{primary_connection_type}` |

- Decorative accent circles (top right corner)

**Satori constraints (differences from client-side ShareCard):**
- No `clamp()` — use fixed `32px` font size for headline
- Fonts loaded as ArrayBuffer at cold start, not from Google Fonts CDN
- No `textWrap: 'balance'` — Satori doesn't support it
- All positioning via flexbox (Satori's `position: absolute` support is sufficient for the circles)

### 2.2 Font Bundling

Bundle static (non-variable) font files for Satori:
- JetBrains Mono Regular + Bold (mono text: labels, badges, footer)
- Archivo Bold or Archivo Black (display text: headline, logo)

**Loading strategy:** Netlify Edge Functions run on Deno but do NOT expose `Deno.readFile()` or general filesystem APIs. Same-site `fetch()` is also discouraged (triggers a new request chain). The supported approach is:

1. **Host font files on a CDN or public URL** (e.g., Google Fonts TTF URLs, jsDelivr, or committed to `public/fonts/` and fetched via absolute external URL)
2. **Fetch once per cold start** using `fetch()` to the external URL, cache the `ArrayBuffer` in a module-level variable
3. Subsequent warm invocations reuse the cached buffer (Edge Function instances persist across requests)

Alternative: **Base64-encode small font subsets** directly in the edge function source. This avoids fetch latency entirely but increases deploy size. Viable if we subset fonts to only the characters needed (A-Z, 0-9, punctuation — share cards don't need full Unicode).

Total font size: ~200-400KB (full files) or ~40-80KB (subsetted).

Note: Newsreader (currently used for display) is a variable font. Satori doesn't support variable fonts. Use Archivo Black (already loaded in `index.html`) as the display font for OG images instead.

### 2.3 Wire OG Tags to Dynamic Image

Update the Phase 1 edge function (`og-tags.ts`) to change:
```
og:image = /og-default.png
```
to:
```
og:image = {origin}/api/og-image/{type}/{id}?v={updated_at_unix}
```

The `?v={updated_at_unix}` query parameter busts CDN and social platform caches when content changes. `updated_at_unix` is the record's `last_updated_at` (or equivalent) as a Unix timestamp. This is critical because:
- Our CDN caches images for 24 hours
- X/Twitter caches card metadata for ~7 days
- Facebook caches until manually cleared via Sharing Debugger
- Without cache busting, headline/alarm changes would show stale cards for days

The OG image endpoint ignores the `?v=` parameter (it just serves the current image), but the unique URL forces caches to treat each version as a new resource.

The static `og-default.png` becomes the fallback for non-content pages (home, about).

### 2.4 Content Type Variations

All four content types use the same card layout but with type-specific data:

| Type | Badge text | Headline source | Accent color source |
|------|-----------|----------------|-------------------|
| Stories | `LEVEL {alarm_level} · {alarm_label}` | `primary_headline` | `alarm_level` |
| EOs | `LEVEL {alarm_level} · {alarm_label}` | `title` | `alarm_level` |
| SCOTUS | `IMPACT {ruling_impact_level} · {label}` | `case_name_short` | `ruling_impact_level` |
| Pardons | `CORRUPTION {corruption_level} · {label}` | `recipient_name` | `corruption_level` |

### 2.5 Verification & Cleanup

- Same platform debuggers as Phase 1
- Visual comparison: server-rendered card vs client-side ShareCard.tsx (should be near-identical)
- Test all 4 content types
- Verify CDN caching works (second request should be fast/cached)
- Verify cache busting works (update a story's headline, confirm new image URL is generated)

**Post-verification cleanup (after Phase 2 visual comparison passes):**
- Delete `src/components/ShareCard.tsx`
- Remove `html-to-image` from `package.json`

**Files:**
- `netlify/edge-functions/og-image.ts` — image generation function
- `netlify/edge-functions/fonts/` — bundled font files
- `netlify/edge-functions/og-tags.ts` — update og:image URL
- `netlify.toml` — add og-image edge function declaration
- `src/components/ShareCard.tsx` — delete after visual verification
- `package.json` — remove `html-to-image` after visual verification

---

## Architecture Diagram

```
Shared link on social media
        │
        ▼
Social crawler requests trumpytracker.com/detail/123
        │
        ▼
┌─────────────────────────────────────┐
│  Netlify Edge Function: og-tags.ts  │
│                                     │
│  Is this a crawler?                 │
│  ├─ YES → Fetch story from Supabase │
│  │        Inject OG meta tags       │
│  │        og:image → /api/og-image/ │  ← Phase 2
│  │        Return HTML               │
│  └─ NO  → context.next()           │
│           (SPA loads normally)       │
└─────────────────────────────────────┘
        │ (crawler follows og:image URL)
        ▼
┌─────────────────────────────────────┐
│  Netlify Edge Function: og-image.ts │  ← Phase 2
│                                     │
│  Fetch story from Supabase          │
│  Render card via Satori → PNG       │
│  Return with 24hr cache headers     │
└─────────────────────────────────────┘
```

## What's NOT In Scope

- Automated posting (separate feature — posting queue/scheduler)
- Share buttons on card list view (Detail page only)
- Instagram-specific handling (no link sharing support on Instagram)
- BlueSky support (can be added later as a platform button)
- Analytics on share clicks (can be added later via GA events)
- Share card for non-content pages (home, about use static og-default.png)

## Cost

| Component | Expected cost | Notes |
|-----------|--------------|-------|
| Netlify Edge Functions (OG tags + image gen) | ~$0 | Netlify pricing is plan/credits-based; verify against your current Netlify plan's Edge Function allowance before deploying |
| Supabase queries from edge functions | $0 | Negligible egress (~200 bytes/query, well within 5GB free tier) |
| Font file storage | $0 | Bundled in repo or fetched from public CDN |
| CDN caching | $0 | Included in Netlify |
| **Total** | **Expected ~$0/month** | **Verify Netlify plan limits before Phase 1 deploy** |

**Budget note:** Social crawler traffic is low volume (crawlers cache results, so each unique share generates ~1-3 requests). Even if Netlify charges per-invocation beyond a free tier, the volume should be negligible. However, given the project's $50/month hard budget, confirm the Netlify plan's Edge Function limits in the dashboard before deploying.

## Estimated Effort

| Phase | Sessions | Deliverable |
|-------|----------|-------------|
| Phase 1 | 1-2 | Dynamic OG tags + share UI refactor |
| Phase 2 | 1-2 | Dynamic OG image generation |
| **Total** | **2-4** | **Full share infrastructure** |

## Pre-existing Bug Fix (Included)

`index.html` line 12 references `/og-default.png` which doesn't exist. Phase 1 creates this file, fixing the broken OG image for all current shares.

## Netlify Configuration Required (Manual)

Before deploying Phase 1, set these in Netlify dashboard (Site settings → Environment variables):

**Production site (trumpytracker.com):**
- `SUPABASE_URL` = PROD Supabase URL
- `SUPABASE_ANON_KEY` = PROD anon key

**Test site (branch deploy):**
- `SUPABASE_URL` = TEST Supabase URL
- `SUPABASE_ANON_KEY` = TEST anon key

These are public anon keys (already exposed in the frontend bundle). No service keys needed.
