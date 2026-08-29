# Social Automation v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (inline - Josh has banned subagent spawning in this repo). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every alarm-5 story/EO/pardon gets a branded card and a draft Facebook post that Josh approves in the admin dashboard and a scheduled job publishes to the TrumpyTracker Page.

**Architecture:** Three independent pieces wired by one table. (1) A Netlify Edge Function renders the card PNG from record data, and `og-tags` points `og:image` at it. (2) A Node script (GitHub Actions, every 30 min) turns new alarm-5 items into `social_posts` drafts and pings Discord; the admin dashboard approves them. (3) The same run posts approved rows to Facebook via the Graph API `/{page}/feed` with `message` + `link`; Facebook pulls the card from og:image, so no image upload is needed.

**Tech Stack:** Netlify Edge Functions (Deno) + `og_edge` (Satori) for the card; Supabase migration + PostgREST; Node 20 scripts under `scripts/social/`; GitHub Actions cron; Meta Graph API v21; admin.html vanilla JS tab.

**Spec:** `docs/features/growth/prd-social-automation.md` (decisions D1-D8 in section 0; posting rule section 4; copy template section 5; Josh's token setup section 6).

## Global Constraints

- $0/month. No new paid services, no new AI calls (copy is a template over existing fields).
- Every automated link carries `?utm_source=facebook&utm_medium=social&utm_campaign=auto`.
- No em dashes in any generated copy. Use `·`, `|`, periods, hyphens.
- Publish gates are the SAME predicates `og-tags.ts` uses: stories `status=eq.active` + `summary_neutral=not.is.null`; EOs/pardons/SCOTUS `is_public=eq.true`. A unit test asserts them.
- All timestamps `timestamptz`. Migrations idempotent (`IF NOT EXISTS`). Cursor pagination only.
- Every skip in the draft/post loops writes a `pipeline_skips` row via `recordSkip()` (ADO-466).
- Supabase egress: select named columns only, never `content`/`embedding`.
- Work on `test`. PROD ships by cherry-pick PR; the poster workflow runs only on `main` with `ENABLE_PROD_SCHEDULES`.
- Card feature ships behind flag `share_cards` (OFF in `flags-prod.json` until Josh verifies via `?ff_share_cards=true`).

Story map (one session each): **S1 card renderer → S2 draft queue → S3 Facebook poster → S4 cadence + digest.** ADO-571 / 572 / 573 / 574 (created August 29, 2026 under Epic 299).

---

## S1 - Card renderer

### Task 1: `og-image` edge function renders a 1200x630 PNG for a story

**Files:**
- Create: `netlify/edge-functions/og-image.ts`
- Create: `netlify/edge-functions/_shared/og-card.tsx` (the receipt card - chosen August 29, 2026; reference markup in the design canvas Main artboard: black 1200x630, left column wordmark + tagline + domain, right 640px paper slip #f3efe6 rotated -1.2deg with receipt number + date, headline, a Filed under row (TYPE_LABEL: Story / Executive Order / SCOTUS / Pardon), and one badge `{alarm} · {spicy label}`; no source count)
- Modify: `netlify.toml` (add `[[edge_functions]] function = "og-image" path = "/api/og-image/*"`)
- Test: `scripts/tests/og-image-card.test.mjs` (pure-function tests of the data → card-props mapper; the PNG render itself is verified by curl on the TEST deploy)

**Interfaces:**
- Produces: `GET /api/og-image/:type/:id?v=<updated_at unix>` → `image/png`, `Cache-Control: public, max-age=31536000, immutable`. `type` ∈ `detail|eos|scotus|pardons` (same names as `og-tags` routes). On any error → 302 to `/og-default.png`.
- Produces (pure, tested): `buildCardProps(type, row) → { headline, headlineSize, alarm, label, badge, typeLabel, receiptNo, dateText }` in `_shared/og-card-props.mjs`. `headlineSize` = 44 (headline ≤ 90 chars) / 36 (≤ 130) / 32; the card clamps the headline to 4 lines with an ellipsis.

- [ ] **Step 1: Write the failing test for the props mapper**

```js
// scripts/tests/og-image-card.test.mjs
import assert from 'node:assert/strict';
import { buildCardProps } from '../../netlify/edge-functions/_shared/og-card-props.mjs';

const story = { id: 16879, primary_headline: 'Judges Fired After Blocking Deportations', alarm_level: 5, category: 'corruption_scandals', last_updated_at: '2026-04-12T15:28:04+00:00' };
const p = buildCardProps('detail', story);
assert.equal(p.headline, story.primary_headline);
assert.equal(p.alarm, 5);
assert.equal(p.label, 'CRISIS');
assert.equal(p.badge, '5 · Constitutional Dumpster Fire');
assert.equal(p.headlineSize, 44);
assert.equal(p.receiptNo, '16879');
assert.equal(p.typeLabel, 'Story');
assert.equal(p.dateText, 'April 12, 2026');

const pardon = { recipient_name: 'Someone', corruption_level: 4, primary_connection_type: 'direct', updated_at: '2026-01-05T00:00:00Z' };
const q = buildCardProps('pardons', pardon);
assert.equal(q.alarm, 4);
assert.equal(q.badge, '4 · Cronies-in-Chief');
assert.equal(buildCardProps('detail', { primary_headline: 'x'.repeat(100), alarm_level: 5 }).headlineSize, 36);
assert.equal(buildCardProps('detail', { primary_headline: 'x'.repeat(140), alarm_level: 5 }).headlineSize, 32);

assert.equal(buildCardProps('detail', { alarm_level: 99 }).label, 'NOTABLE'); // unknown level falls back
console.log('og-image-card: ok');
```

Keep the mapper in a plain `.mjs` (no JSX, no Deno imports) so Node can test it and the Deno edge function can `import` it too.

- [ ] **Step 2: Run it, expect failure** - `node scripts/tests/og-image-card.test.mjs` → `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Write the mapper** `netlify/edge-functions/_shared/og-card-props.mjs`

```js
export const ALARM_LABELS = { 5: 'CRISIS', 4: 'SEVERE', 3: 'SERIOUS', 2: 'NOTABLE', 1: 'WATCH', 0: 'WIN' };
// Copy the spicy labels from public/shared/tone-system.json → labels.{stories,pardons,executive_orders,scotus}[level].spicy
const SPICY = { detail: { 5: 'Constitutional Dumpster Fire', 4: 'Criminal Bullshit', 3: 'The Deep Swamp', 2: 'The Great Gaslight', 1: 'Petty Nonsense', 0: 'Actual Win' },
                pardons: { 5: 'Pay 2 Win', 4: 'Cronies-in-Chief', 3: 'The Party Favor', 2: 'The PR Stunt', 1: 'The Rounding Error', 0: 'Actual Mercy' },
                eos: {/* from tone-system.json executive_orders */}, scotus: {/* from tone-system.json scotus */} };
const TYPE_LABEL = { detail: 'Story', eos: 'Executive Order', scotus: 'SCOTUS', pardons: 'Pardon' };
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';

export function buildCardProps(type, row) {
  const rawAlarm = type === 'pardons' ? row.corruption_level : row.alarm_level;
  const alarm = Number.isInteger(rawAlarm) && rawAlarm >= 0 && rawAlarm <= 5 ? rawAlarm : 2;
  const headline = type === 'detail' ? row.primary_headline : type === 'eos' ? row.title : type === 'scotus' ? row.case_name_short : row.recipient_name;
  const dateIso = row.last_updated_at || row.updated_at || row.decided_at || null;
  return {
    headline: String(headline || 'TrumpyTracker'),
    alarm, label: ALARM_LABELS[alarm] ?? 'NOTABLE',
    badge: `${alarm} · ${SPICY[type]?.[alarm] ?? ALARM_LABELS[alarm]}`,
    headlineSize: String(headline || '').length <= 90 ? 44 : String(headline).length <= 130 ? 36 : 32,
    typeLabel: TYPE_LABEL[type],
    receiptNo: String(row.id ?? ''),
    dateText: fmtDate(dateIso),
  };
}
```

Fill the `eos`/`scotus` spicy maps from `public/shared/tone-system.json` (do not invent labels). Unknown-level fallback of 2/NOTABLE matches `og-tags`.

- [ ] **Step 4: Run test, expect `og-image-card: ok`.** Add `"qa:og-card": "node scripts/tests/og-image-card.test.mjs"` to `package.json` and append it to `qa:smoke`.

- [ ] **Step 5: Write the edge function**

```ts
// netlify/edge-functions/og-image.ts
import type { Context, Config } from "@netlify/edge-functions";
import { ImageResponse } from "https://deno.land/x/og_edge@0.0.6/mod.ts";
import { buildCardProps } from "./_shared/og-card-props.mjs";
import { Card } from "./_shared/og-card.tsx";

// Same route table shape as og-tags.ts - keep the two in sync (select + filters are copied verbatim).
const ROUTES: Record<string, { table: string; select: string; filters: string[] }> = {
  detail:  { table: 'stories',          select: 'id,primary_headline,alarm_level,category,last_updated_at', filters: ['status=eq.active', 'summary_neutral=not.is.null'] },
  eos:     { table: 'executive_orders', select: 'id,title,alarm_level,order_number,updated_at', filters: ['is_public=eq.true'] },
  scotus:  { table: 'scotus_cases',     select: 'id,case_name_short,alarm_level,decided_at,updated_at', filters: ['is_public=eq.true'] },
  pardons: { table: 'pardons',          select: 'id,recipient_name,corruption_level,primary_connection_type,updated_at', filters: ['is_public=eq.true'] },
};

let fontCache: { serif: ArrayBuffer; mono: ArrayBuffer } | null = null;
async function fonts() {
  if (fontCache) return fontCache;
  const get = (u: string) => fetch(u).then(r => r.arrayBuffer());
  fontCache = {
    serif: await get('https://fonts.gstatic.com/s/newsreader/v20/cY9qfjOCX1hbuyalUrK49dLac06G1ZGsZBtoBCzBDXXD9JVF438w-I_ADOxEPjCggA.ttf'),
    mono:  await get('https://fonts.gstatic.com/s/jetbrainsmono/v18/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKxjPVmUsaaDhw.ttf'),
  };
  return fontCache;
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const m = url.pathname.match(/^\/api\/og-image\/(detail|eos|scotus|pardons)\/([A-Za-z0-9_\-]+)\.png$/);
  const fallback = () => Response.redirect(`${url.origin}/og-default.png`, 302);
  if (!m) return fallback();
  const [, type, id] = m;
  const route = ROUTES[type];
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL'); const anon = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !anon) return fallback();
    const q = `${supabaseUrl}/rest/v1/${route.table}?select=${route.select}&id=eq.${encodeURIComponent(id)}&${route.filters.join('&')}&limit=1`;
    const r = await fetch(q, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } });
    if (!r.ok) return fallback();
    const rows = await r.json(); if (!rows[0]) return fallback();
    const props = buildCardProps(type, rows[0]);
    const f = await fonts();
    return new ImageResponse(Card(props), {
      width: 1200, height: 630,
      fonts: [{ name: 'Newsreader', data: f.serif, weight: 500 }, { name: 'JetBrains Mono', data: f.mono, weight: 700 }],
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
    });
  } catch { return fallback(); }
};
export const config: Config = { path: "/api/og-image/*" };
```

Verify the two gstatic font URLs at build time by fetching the CSS at `https://fonts.googleapis.com/css2?family=Newsreader:wght@500` with a Chrome UA and copying the `url(...)` values; do not trust the ones above verbatim.

- [ ] **Step 6: Write `Card(props)`** in `_shared/og-card.tsx` as Satori-compatible JSX (flex only, no grid, no `text-wrap`, absolute positioning allowed) matching the design Josh picked on the canvas (`Main.dc.html` = A, `TabloidBlock` = B, `Receipt` = C). Satori limits: `display:flex` on every parent with >1 child; no `border-radius: 50%` on rotated elements; box-shadow supported; `transform: rotate` supported.

- [ ] **Step 7: Deploy to TEST** (push `test`), then:

```bash
curl -sI "https://test--<site>.netlify.app/api/og-image/detail/16879.png" | grep -iE "content-type|cache-control"   # image/png
curl -sI ".../api/og-image/detail/999999999.png" | grep -iE "location"                                        # 302 → /og-default.png
curl -sI ".../api/og-image/pardons/<a non-public id>.png" | grep -i location                                   # 302 (gate respected)
```

Open the PNG and compare to the canvas by eye.

- [ ] **Step 8: Commit** `feat(og): per-record share card renderer at /api/og-image (ADO-571)`

### Task 2: `og-tags` points og:image at the card

**Files:**
- Modify: `netlify/edge-functions/og-tags.ts` (the `imageUrl` line ~170)
- Modify: `public/shared/flags-test.json` / `flags-prod.json` (add `"share_cards": true` / `false`)

- [ ] **Step 1:** Replace `const imageUrl = \`${origin}/og-default.png\`` with:

```ts
const version = Math.floor(new Date(String(row.last_updated_at || row.updated_at || 0)).getTime() / 1000) || 0;
const flags = await fetch(`${origin}/shared/flags-${isProd ? 'prod' : 'test'}.json`).then(r => r.json()).catch(() => ({}));
const useCard = flags.share_cards === true || url.searchParams.get('ff_share_cards') === 'true';
const imageUrl = useCard ? `${origin}/api/og-image/${route.type}/${route.id}.png?v=${version}` : `${origin}/og-default.png`;
```

(`isProd` = `url.hostname === 'trumpytracker.com'`; keep `og:image:width/height` 1200/630 - the card is the same size.)

- [ ] **Step 2:** Verify on TEST with the crawler UA: `curl -s -A facebookexternalhit/1.1 https://test--<site>.netlify.app/detail/16879 | grep -o '<meta property="og:image"[^>]*>'` → the `/api/og-image/...` URL.
- [ ] **Step 3:** Run Facebook Sharing Debugger on the TEST URL → card shows. Run `npm run qa:smoke`.
- [ ] **Step 4: Commit** `feat(og): og:image uses the per-record card behind share_cards flag (ADO-571)`

### Task 3: refresh `og-default.png` tagline

- [ ] Regenerate `public/og-default.png` (1200x630, black, wordmark, "Keeping receipts on every scandal, pardon, and power grab.") by hitting the renderer with a synthetic props object once via a small script `scripts/social/render-og-default.mjs`, or export artboard C's left column from the design canvas. Commit `chore(og): og-default.png carries the current tagline`.

---

## S2 - Draft queue

### Task 4: migration `114_social_posts.sql`

**Files:**
- Create: `migrations/114_social_posts.sql`
- Modify: `docs/database/database-schema.md` (new table section)

**Produces:** table `social_posts`.

- [ ] **Step 1: Write the migration**

```sql
-- Migration 114: social_posts ledger (ADO-572). One row per (platform, entity) ever; idempotent poster.
CREATE TABLE IF NOT EXISTS public.social_posts (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform     TEXT NOT NULL CHECK (platform IN ('facebook','bluesky','x','threads')),
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('story','eo','scotus','pardon','digest')),
  entity_id    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','posted','failed')),
  copy         TEXT NOT NULL,
  link_url     TEXT NOT NULL,
  image_url    TEXT,
  post_id      TEXT,
  post_url     TEXT,
  error        TEXT,
  attempts     SMALLINT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at  TIMESTAMPTZ,
  posted_at    TIMESTAMPTZ,
  UNIQUE (platform, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS social_posts_status_idx ON public.social_posts (status, created_at);
ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;
-- service role only; no anon grants (the admin dashboard uses the service key path like other admin tables)
CREATE TABLE IF NOT EXISTS public.social_state (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.social_state (key, value) VALUES ('draft_watermark', '1970-01-01T00:00:00Z') ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2:** `node scripts/apply-migrations.js` against TEST; verify with `GET /social_posts?select=id&limit=1` (200, empty).
- [ ] **Step 3:** Add both tables to `docs/database/database-schema.md`. Commit `feat(db): social_posts ledger + social_state watermark (migration 114, ADO-572)`.

### Task 5: `scripts/social/draft-posts.js` + copy builder

**Files:**
- Create: `scripts/social/lib/copy.mjs` (pure), `scripts/social/lib/select-candidates.mjs` (query builders, pure), `scripts/social/draft-posts.js` (runner)
- Modify: `scripts/lib/skip-reasons.js` (add `PIPELINES.SOCIAL`, `REASONS.ALREADY_DRAFTED`, `REASONS.NOT_PUBLIC`)
- Test: `scripts/tests/social-copy.test.mjs`, `scripts/tests/social-candidates.test.mjs`

**Interfaces:**
- `buildCopy({ type, headline, spicy, alarm, sources, url }) → string` (section 5 template; first sentence of `spicy`; strips em dashes; appends UTM link)
- `candidateQuery(type, sinceIso) → string` (PostgREST path; asserts the publish gates)
- `postUrl(origin, type, id) → string` with UTM params

- [ ] **Step 1: Failing tests**

```js
// scripts/tests/social-copy.test.mjs
import assert from 'node:assert/strict';
import { buildCopy, firstSentence, postUrl } from '../social/lib/copy.mjs';
assert.equal(firstSentence('They did it. Again — and worse.'), 'They did it.');
const c = buildCopy({ type: 'story', headline: 'H', spicy: 'One. Two.', alarm: 5, sources: 7, url: 'https://trumpytracker.com/detail/1' });
assert.ok(c.startsWith('H\n\nOne.\n\nLEVEL 5 · CRISIS  |  7 sources\n'));
assert.ok(c.includes('utm_source=facebook&utm_medium=social&utm_campaign=auto'));
assert.ok(!c.includes('—'), 'no em dashes');
assert.equal(postUrl('https://trumpytracker.com', 'pardon', 12), 'https://trumpytracker.com/pardons/12?utm_source=facebook&utm_medium=social&utm_campaign=auto');
console.log('social-copy: ok');
```

```js
// scripts/tests/social-candidates.test.mjs
import assert from 'node:assert/strict';
import { candidateQuery } from '../social/lib/select-candidates.mjs';
const s = candidateQuery('story', '2026-08-01T00:00:00Z');
assert.ok(s.startsWith('/v_tracker_stories?'));
for (const must of ['main_line=eq.true', 'alarm_level=eq.5', 'status=eq.active', 'summary_neutral=not.is.null', 'last_updated_at=gt.2026-08-01T00:00:00Z', 'order=last_updated_at.asc', 'limit=50']) assert.ok(s.includes(must), must);
assert.ok(candidateQuery('eo', 'x').includes('is_public=eq.true'));
assert.ok(candidateQuery('pardon', 'x').includes('corruption_level=eq.5'));
assert.ok(!s.includes('select=*'));
console.log('social-candidates: ok');
```

- [ ] **Step 2:** Run both → module not found.
- [ ] **Step 3: Implement**

```js
// scripts/social/lib/copy.mjs
const LABELS = { 5: 'CRISIS', 4: 'SEVERE', 3: 'SERIOUS', 2: 'NOTABLE', 1: 'WATCH', 0: 'WIN' };
const ROUTE = { story: 'detail', eo: 'eos', scotus: 'scotus', pardon: 'pardons' };
export const UTM = 'utm_source=facebook&utm_medium=social&utm_campaign=auto';
export const firstSentence = (t = '') => (String(t).match(/^.*?[.!?](?=\s|$)/)?.[0] ?? String(t).slice(0, 200)).replace(/\s*[—–]\s*/g, ', ').trim();
export const postUrl = (origin, type, id) => `${origin}/${ROUTE[type]}/${id}?${UTM}`;
export function buildCopy({ headline, spicy, alarm, sources, url }) {
  const meta = [`LEVEL ${alarm} · ${LABELS[alarm] ?? 'NOTABLE'}`, sources != null ? `${sources} sources` : null].filter(Boolean).join('  |  ');
  return [headline, firstSentence(spicy), meta, url].filter(Boolean).join('\n\n').replace(/\n\n(?=[^\n]*$)/, '\n').replace(/[—–]/g, '-');
}
```

```js
// scripts/social/lib/select-candidates.mjs
export function candidateQuery(type, sinceIso) {
  switch (type) {
    case 'story':  return `/v_tracker_stories?select=id,primary_headline,summary_spicy,alarm_level,source_count,last_updated_at&main_line=eq.true&alarm_level=eq.5&status=eq.active&summary_neutral=not.is.null&last_updated_at=gt.${sinceIso}&order=last_updated_at.asc&limit=50`;
    case 'eo':     return `/executive_orders?select=id,title,spicy_summary,alarm_level,updated_at&is_public=eq.true&alarm_level=eq.5&updated_at=gt.${sinceIso}&order=updated_at.asc&limit=50`;
    case 'pardon': return `/pardons?select=id,recipient_name,summary_spicy,corruption_level,updated_at&is_public=eq.true&corruption_level=eq.5&updated_at=gt.${sinceIso}&order=updated_at.asc&limit=50`;
    default: throw new Error(`unknown type ${type}`);
  }
}
```

(Confirm `v_tracker_stories` exposes `status`/`summary_neutral`/`summary_spicy`; if the view bakes the gate in and omits the columns, drop those two filters for `story` and update the test - the view already enforces them per migration 112.)

```js
// scripts/social/draft-posts.js  (node scripts/social/draft-posts.js [--dry-run])
import { createClient } from '@supabase/supabase-js';
import { candidateQuery } from './lib/select-candidates.mjs';
import { buildCopy, postUrl } from './lib/copy.mjs';
import { recordSkip, PIPELINES, REASONS } from '../lib/skip-reasons.js';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const ORIGIN = process.env.SITE_ORIGIN ?? 'https://trumpytracker.com';
const AUTO = process.env.SOCIAL_AUTO_APPROVE_ALARM5 === 'true';   // D8 switch, default off
const dry = process.argv.includes('--dry-run');
const { data: wm } = await sb.from('social_state').select('value').eq('key', 'draft_watermark').single();
const since = wm?.value ?? '1970-01-01T00:00:00Z';
let newest = since, created = 0;
for (const type of ['story', 'eo', 'pardon']) {
  const { data: rows, error } = await sb.rpc('postgrest_get', { path: candidateQuery(type, since) }).catch(() => ({ data: null, error: 'no rpc' }));
  // If no such RPC exists, use fetch against `${SUPABASE_URL}/rest/v1${candidateQuery(...)}` with the service key headers.
  if (error) throw new Error(`${type}: ${error.message ?? error}`);
  for (const r of rows ?? []) {
    const ts = r.last_updated_at ?? r.updated_at; if (ts > newest) newest = ts;
    const headline = r.primary_headline ?? r.title ?? r.recipient_name;
    const alarm = r.alarm_level ?? r.corruption_level;
    const row = { platform: 'facebook', entity_type: type, entity_id: String(r.id), status: AUTO ? 'approved' : 'draft',
      copy: buildCopy({ type, headline, spicy: r.summary_spicy ?? r.spicy_summary ?? '', alarm, sources: r.source_count ?? null, url: postUrl(ORIGIN, type, r.id) }),
      link_url: postUrl(ORIGIN, type, r.id), image_url: `${ORIGIN}/api/og-image/${type === 'story' ? 'detail' : type === 'eo' ? 'eos' : 'pardons'}/${r.id}.png`,
      approved_at: AUTO ? new Date().toISOString() : null };
    if (dry) { console.log(row.copy, '\n---'); continue; }
    const { error: e } = await sb.from('social_posts').insert(row);
    if (e?.code === '23505') { await recordSkip(sb, { pipeline: PIPELINES.SOCIAL, reason: REASONS.ALREADY_DRAFTED, entity_type: type, entity_id: String(r.id) }); continue; }
    if (e) throw e; created++;
  }
}
if (!dry) await sb.from('social_state').upsert({ key: 'draft_watermark', value: newest, updated_at: new Date().toISOString() });
console.log(`social drafts created: ${created}`);
if (created > 0 && process.env.DISCORD_WEBHOOK_URL && !dry) {
  await fetch(process.env.DISCORD_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [{ title: `${created} social draft${created === 1 ? '' : 's'} waiting`, color: 13191742, description: `[Open the Social queue](${ORIGIN}/admin.html#social)` }] }) }).catch(() => {});
}
```

Use plain `fetch` to PostgREST (headers `apikey` + `Authorization: Bearer <service key>`) rather than an RPC - the snippet notes both; pick fetch. Idempotency comes from the UNIQUE constraint (23505 → skip), so re-running after a crash is safe.

- [ ] **Step 4:** Tests pass; `node scripts/social/draft-posts.js --dry-run` against TEST prints copy for the current alarm-5 set. Add `qa:social` script running both tests; append to `qa:smoke`.
- [ ] **Step 5: Commit** `feat(social): draft-posts creates social_posts drafts for alarm-5 items + Discord ping (ADO-572)`

### Task 6: admin dashboard Social tab

**Files:**
- Modify: `public/admin.html` (new tab "Social" next to Skips), `public/admin/*.js` per existing tab pattern (read the Skips tab implementation first and copy its fetch/render shape)

- [ ] **Step 1:** Table of `social_posts` where `status in (draft,failed)` newest first (cursor pagination on `id`): card thumbnail (`image_url`), editable `<textarea>` with `copy`, link, buttons **Approve** (`PATCH status=approved, approved_at=now(), copy=<textarea>`), **Reject** (`status=rejected`). Below it, a collapsed "Last 30 days" list of `posted` rows with `post_url`.
- [ ] **Step 2:** Manual QA on TEST admin: approve one, reject one, edit copy then approve - rows update; reload shows state.
- [ ] **Step 3: Commit** `feat(admin): Social tab - approve/reject/edit social drafts (ADO-572)`

---

## S3 - Facebook poster

### Task 7: `scripts/social/post-facebook.js`

**Files:**
- Create: `scripts/social/lib/facebook.mjs` (pure request builder), `scripts/social/post-facebook.js` (runner)
- Test: `scripts/tests/social-facebook.test.mjs`

**Interfaces:**
- `buildFeedRequest({ pageId, token, message, link }) → { url, body }` where `url = https://graph.facebook.com/v21.0/${pageId}/feed`, body `URLSearchParams` with `message`, `link`, `access_token`.
- `postUrlFor(pageId, postId) → https://www.facebook.com/${postId}` (Graph returns `id` = `<pageid>_<postid>`; the URL form `https://www.facebook.com/<pageid>_<postid>` resolves).

- [ ] **Step 1: Failing test**

```js
import assert from 'node:assert/strict';
import { buildFeedRequest, postUrlFor } from '../social/lib/facebook.mjs';
const r = buildFeedRequest({ pageId: '123', token: 'T', message: 'hi', link: 'https://x/y?utm_source=facebook' });
assert.equal(r.url, 'https://graph.facebook.com/v21.0/123/feed');
assert.equal(r.body.get('message'), 'hi'); assert.equal(r.body.get('link'), 'https://x/y?utm_source=facebook'); assert.equal(r.body.get('access_token'), 'T');
assert.equal(postUrlFor('123', '123_456'), 'https://www.facebook.com/123_456');
console.log('social-facebook: ok');
```

- [ ] **Step 2:** fail → **Step 3: implement** (`facebook.mjs` is 10 lines; `post-facebook.js`):

```js
// scripts/social/post-facebook.js
import { createClient } from '@supabase/supabase-js';
import { buildFeedRequest, postUrlFor } from './lib/facebook.mjs';
import { recordSkip, PIPELINES, REASONS } from '../lib/skip-reasons.js';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { FB_PAGE_ID, FB_PAGE_ACCESS_TOKEN, DISCORD_WEBHOOK_URL } = process.env;
if (!FB_PAGE_ID || !FB_PAGE_ACCESS_TOKEN) { console.log('FB secrets missing; nothing posted'); process.exit(0); }
const { data: rows } = await sb.from('social_posts').select('id,copy,link_url,attempts,entity_type,entity_id')
  .eq('platform', 'facebook').in('status', ['approved', 'failed']).lt('attempts', 3).order('id', { ascending: true }).limit(10);
let ok = 0, failed = 0;
for (const p of rows ?? []) {
  const { url, body } = buildFeedRequest({ pageId: FB_PAGE_ID, token: FB_PAGE_ACCESS_TOKEN, message: p.copy, link: p.link_url });
  const res = await fetch(url, { method: 'POST', body });
  const json = await res.json().catch(() => ({}));
  if (res.ok && json.id) {
    await sb.from('social_posts').update({ status: 'posted', post_id: json.id, post_url: postUrlFor(FB_PAGE_ID, json.id), posted_at: new Date().toISOString(), error: null }).eq('id', p.id); ok++;
  } else {
    const msg = json?.error?.message ?? `HTTP ${res.status}`;
    await sb.from('social_posts').update({ status: 'failed', error: msg, attempts: p.attempts + 1 }).eq('id', p.id);
    await recordSkip(sb, { pipeline: PIPELINES.SOCIAL, reason: REASONS.POST_FAILED, entity_type: p.entity_type, entity_id: p.entity_id, metadata: { msg } }); failed++;
  }
  await new Promise(r => setTimeout(r, 1500)); // be polite to Graph
}
console.log(`facebook posted=${ok} failed=${failed}`);
if (failed && DISCORD_WEBHOOK_URL) await fetch(DISCORD_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [{ title: `Facebook post failed (${failed})`, color: 15158332, description: 'See admin → Social. If the error mentions the token, redo PRD section 6 steps 3-5.' }] }) }).catch(() => {});
```

Add `REASONS.POST_FAILED` to `skip-reasons.js`. Never log the token.

- [ ] **Step 4:** Test passes. Dry-run against the real Page ONCE with one approved TEST row and `SITE_ORIGIN` = the TEST site (so the link previews the TEST card); delete the FB post afterwards by hand.
- [ ] **Step 5: Commit** `feat(social): post approved drafts to the Facebook Page via Graph API (ADO-573)`

### Task 8: workflow `social-poster.yml`

**Files:**
- Create: `.github/workflows/social-poster.yml`
- Modify: `docs/guides/prod-deployment-checklist.md` (new secrets `FB_PAGE_ID`, `FB_PAGE_ACCESS_TOKEN`; new var `SOCIAL_AUTO_APPROVE_ALARM5`)

- [ ] **Step 1:**

```yaml
name: Social Poster
on:
  schedule: [{ cron: '*/30 * * * *' }]
  workflow_dispatch:
jobs:
  social:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' && (github.event_name != 'schedule' || vars.ENABLE_PROD_SCHEDULES == 'true')
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - name: Draft new posts
        env: { SUPABASE_URL: ${{ secrets.SUPABASE_URL }}, SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}, DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}, SOCIAL_AUTO_APPROVE_ALARM5: ${{ vars.SOCIAL_AUTO_APPROVE_ALARM5 }} }
        run: node scripts/social/draft-posts.js
      - name: Post approved
        env: { SUPABASE_URL: ${{ secrets.SUPABASE_URL }}, SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}, FB_PAGE_ID: ${{ secrets.FB_PAGE_ID }}, FB_PAGE_ACCESS_TOKEN: ${{ secrets.FB_PAGE_ACCESS_TOKEN }}, DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }} }
        run: node scripts/social/post-facebook.js
      - name: Alert on failure
        if: failure()
        env: { DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }} }
        run: |  # copy the exact block from rss-tracker-prod.yml
```

Add a TEST twin `social-poster-test.yml` (workflow_dispatch only, `test` branch, `SITE_ORIGIN` = TEST site) mirroring `rss-tracker-test.yml`.

- [ ] **Step 2:** `gh workflow run "Social Poster - TEST" --ref test` → drafts appear in admin; approve one; run again → posted, `post_url` set.
- [ ] **Step 3: Commit** `ci(social): 30-minute social poster workflow, PROD kill-switch honored (ADO-573)`

---

## S4 - Cadence + digest (starts after two weeks of S3 data)

### Task 9: hourly top-pick mode (D7, OFF by default)
- `vars.SOCIAL_HOURLY_PICK=true` makes `draft-posts.js` also draft, at most once per hour, the highest-alarm `main_line` story since the last pick (alarm ≥ 4) when no alarm-5 draft was created that hour. State key `hourly_pick_at` in `social_state`. Test: pick skipped when an alarm-5 draft exists; pick skipped within 60 min of the last one.

### Task 10: daily digest
- `entity_type='digest'`, `entity_id=YYYY-MM-DD`, copy = "Today on the main line:" + up to 5 headlines with alarm labels + link to `/?utm_...`. Runs at 22:00 UTC. Uses the same approve flow. Front-peak posts: draft when `v_tracker_stories` shows a new peak (`main_line` reason = escalation) - reuse the story path with the front name in the kicker.

---

## Cards to create in ADO (after Josh picks the card design)

| Story | Title | Parent |
|---|---|---|
| S1 | Share card renderer at /api/og-image + og:image swap behind share_cards flag | Epic 299 |
| S2 | social_posts ledger + draft-posts script + admin Social tab (draft-then-approve) | Epic 299 |
| S3 | Facebook Page poster via Graph API + 30-min Social Poster workflow (Josh: token setup checklist) | Epic 299 |
| S4 | Social cadence: hourly top-pick switch + daily main-line digest + front-peak posts | Epic 299 |

Close as duplicates when S1 is created: ADO-131, 149, 236, 249 (D6).
