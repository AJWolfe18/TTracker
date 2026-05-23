# Social Media Share Infrastructure — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make shared TrumpyTracker links show per-story headlines and alarm levels on social media, and replace the Detail page's toggle-based share flow with direct one-click platform buttons.

**Architecture:** A Netlify Edge Function intercepts content routes, detects social crawlers by User-Agent, fetches minimal story data from Supabase via PostgREST REST API (anon key), and returns the same `index.html` with OG meta tags regex-replaced to be record-specific. Regular browsers pass through untouched. The Detail page action row is simplified to direct share buttons for X, Threads, Facebook, Reddit, Copy Link, and Report Correction.

**Tech Stack:** Netlify Edge Functions (Deno), Supabase PostgREST (anon key), React (existing frontend), Web Share API

**ADO:** #515

**Spec:** `docs/superpowers/specs/2026-05-23-social-share-infrastructure-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `netlify/edge-functions/og-tags.ts` | Create | Crawler detection, Supabase fetch, OG tag replacement |
| `netlify.toml` | Modify | Add edge function declarations for content routes |
| `public/og-default.png` | Create | Static 1200×630 branded fallback OG image |
| `src/pages/Detail.tsx` | Modify | Replace share toggle with direct platform buttons + Web Share API |
| `index.html` | Modify | Add missing `twitter:title` and `twitter:description` tags for replacement targets |

---

### Task 1: Add OG tag replacement targets to index.html

The edge function replaces OG tags by regex matching `<meta property="og:title"[^>]*>` etc. Currently `index.html` has `og:title`, `og:description`, `og:image`, `og:type`, and `twitter:card` — but is missing `twitter:title` and `twitter:description`. We need those in the base HTML so the regex has something to replace for Twitter-specific tags.

**Files:**
- Modify: `index.html:10-14`

- [ ] **Step 1: Add twitter:title and twitter:description meta tags**

In `index.html`, after the existing `<meta name="twitter:card" ...>` line (line 14), add:

```html
  <meta name="twitter:title" content="TrumpyTracker" />
  <meta name="twitter:description" content="A daily accountability log. Sourced, cited, updated." />
```

- [ ] **Step 2: Also add og:url so the edge function can replace it**

After `<meta property="og:type" ...>` (line 13), add:

```html
  <meta property="og:url" content="https://trumpytracker.com" />
```

The edge function will replace this with the record-specific URL using the request origin.

- [ ] **Step 3: Verify the full meta block looks correct**

The OG/Twitter meta block in `<head>` should now be:

```html
  <meta property="og:title" content="TrumpyTracker" />
  <meta property="og:description" content="A daily accountability log. Sourced, cited, updated." />
  <meta property="og:image" content="/og-default.png" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://trumpytracker.com" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="TrumpyTracker" />
  <meta name="twitter:description" content="A daily accountability log. Sourced, cited, updated." />
```

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add twitter:title, twitter:description, og:url meta tags for OG replacement targets"
```

---

### Task 2: Create the Netlify Edge Function for OG tag injection

This is the core of the feature. The edge function:
1. Runs on content routes (`/detail/:id`, `/eos/:id`, `/scotus/:id`, `/pardons/:id`)
2. Checks User-Agent for social crawlers
3. If crawler: fetches record from Supabase, replaces OG tags in the HTML response
4. If regular browser: passes through to SPA via `context.next()`

**Files:**
- Create: `netlify/edge-functions/og-tags.ts`

- [ ] **Step 1: Create the netlify/edge-functions directory**

```bash
mkdir -p netlify/edge-functions
```

- [ ] **Step 2: Write the edge function**

Create `netlify/edge-functions/og-tags.ts` with the following content:

```typescript
import type { Context } from "https://edge.netlify.com";

const CRAWLER_PATTERNS = [
  'facebookexternalhit',
  'Facebot',
  'Twitterbot',
  'LinkedInBot',
  'Slackbot',
  'Discordbot',
  'redditbot',
  'WhatsApp',
  'Threads',
];

const ALARM_LABELS: Record<number, string> = {
  5: 'CRISIS',
  4: 'SEVERE',
  3: 'SERIOUS',
  2: 'NOTABLE',
  1: 'WATCH',
  0: 'WIN',
};

interface RouteConfig {
  table: string;
  select: string;
  filters: string[];
  buildTitle: (row: Record<string, unknown>) => string;
  buildDescription: (row: Record<string, unknown>) => string;
}

const ROUTE_CONFIGS: Record<string, RouteConfig> = {
  detail: {
    table: 'stories',
    select: 'primary_headline,summary_spicy,alarm_level,category,source_count,last_updated_at',
    filters: ['status=eq.active', 'summary_neutral=not.is.null'],
    buildTitle: (row) => String(row.primary_headline || 'TrumpyTracker'),
    buildDescription: (row) => {
      const alarm = Number(row.alarm_level ?? 2);
      const label = ALARM_LABELS[alarm] ?? 'NOTABLE';
      const sources = Number(row.source_count ?? 0);
      return `LEVEL ${alarm} · ${label} — ${sources} sources cited`;
    },
  },
  eos: {
    table: 'executive_orders',
    select: 'title,section_what_it_means,alarm_level,category,order_number,updated_at',
    filters: ['is_public=eq.true'],
    buildTitle: (row) => String(row.title || 'Executive Order'),
    buildDescription: (row) => {
      const alarm = Number(row.alarm_level ?? 3);
      const label = ALARM_LABELS[alarm] ?? 'SERIOUS';
      const orderNum = row.order_number ? ` — Executive Order #${row.order_number}` : '';
      return `LEVEL ${alarm} · ${label}${orderNum}`;
    },
  },
  scotus: {
    table: 'scotus_cases',
    select: 'case_name_short,summary_spicy,ruling_impact_level,ruling_label,vote_split,updated_at',
    filters: ['is_public=eq.true'],
    buildTitle: (row) => String(row.case_name_short || 'SCOTUS Case'),
    buildDescription: (row) => {
      const impact = Number(row.ruling_impact_level ?? 3);
      const label = row.ruling_label ? String(row.ruling_label) : ALARM_LABELS[impact] ?? 'SERIOUS';
      const vote = row.vote_split ? ` — ${row.vote_split}` : '';
      return `IMPACT ${impact} · ${label}${vote}`;
    },
  },
  pardons: {
    table: 'pardons',
    select: 'recipient_name,summary_spicy,corruption_level,primary_connection_type,updated_at',
    filters: ['is_public=eq.true'],
    buildTitle: (row) => String(row.recipient_name || 'Pardon'),
    buildDescription: (row) => {
      const corruption = Number(row.corruption_level ?? 2);
      const connection = row.primary_connection_type
        ? String(row.primary_connection_type).replace(/_/g, ' ')
        : '';
      return `CORRUPTION ${corruption}/5${connection ? ` · ${connection}` : ''}`;
    },
  },
};

function isCrawler(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  return CRAWLER_PATTERNS.some((p) => ua.includes(p.toLowerCase()));
}

function parseRoute(pathname: string): { type: string; id: string } | null {
  const match = pathname.match(/^\/(detail|eos|scotus|pardons)\/(.+)$/);
  if (!match) return null;
  return { type: match[1], id: match[2] };
}

function truncate(text: string, max: number): string {
  if (!text || text.length <= max) return text;
  const cut = text.lastIndexOf(' ', max);
  return text.slice(0, cut > 0 ? cut : max) + '…';
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function replaceMetaTag(html: string, property: string, value: string): string {
  const isOg = property.startsWith('og:');
  if (isOg) {
    const regex = new RegExp(`<meta\\s+property="${property}"[^>]*>`, 'i');
    return html.replace(regex, `<meta property="${property}" content="${escapeHtml(value)}" />`);
  }
  const regex = new RegExp(`<meta\\s+name="${property}"[^>]*>`, 'i');
  return html.replace(regex, `<meta name="${property}" content="${escapeHtml(value)}" />`);
}

async function fetchRecord(
  supabaseUrl: string,
  anonKey: string,
  config: RouteConfig,
  id: string,
): Promise<Record<string, unknown> | null> {
  const safeId = encodeURIComponent(id);
  const filterStr = [...config.filters, `id=eq.${safeId}`].join('&');
  const url = `${supabaseUrl}/rest/v1/${config.table}?select=${config.select}&${filterStr}&limit=1`;

  const res = await fetch(url, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
  });

  if (!res.ok) return null;
  const rows: Record<string, unknown>[] = await res.json();
  return rows.length > 0 ? rows[0] : null;
}

export default async function handler(req: Request, context: Context) {
  const ua = req.headers.get('user-agent') || '';
  if (!isCrawler(ua)) {
    return context.next();
  }

  const url = new URL(req.url);
  const route = parseRoute(url.pathname);
  if (!route) {
    return context.next();
  }

  const config = ROUTE_CONFIGS[route.type];
  if (!config) {
    return context.next();
  }

  const supabaseUrl = Netlify.env.get('SUPABASE_URL');
  const anonKey = Netlify.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) {
    return context.next();
  }

  const record = await fetchRecord(supabaseUrl, anonKey, config, route.id);
  if (!record) {
    return context.next();
  }

  const origin = url.origin;
  const title = config.buildTitle(record);
  const description = config.buildDescription(record);
  const summary = truncate(
    String(record.summary_spicy || record.section_what_it_means || description),
    200,
  );
  const canonicalUrl = `${origin}/${route.type}/${route.id}`;
  const imageUrl = `${origin}/og-default.png`;

  const response = await context.next();
  let html = await response.text();

  html = replaceMetaTag(html, 'og:title', title);
  html = replaceMetaTag(html, 'og:description', description);
  html = replaceMetaTag(html, 'og:image', imageUrl);
  html = replaceMetaTag(html, 'og:url', canonicalUrl);
  html = replaceMetaTag(html, 'og:type', 'article');
  html = replaceMetaTag(html, 'twitter:card', 'summary_large_image');
  html = replaceMetaTag(html, 'twitter:title', title);
  html = replaceMetaTag(html, 'twitter:description', summary);

  return new Response(html, {
    status: response.status,
    headers: response.headers,
  });
}

// Path config is in netlify.toml — no in-code config export needed.
```

- [ ] **Step 3: Commit**

```bash
git add netlify/edge-functions/og-tags.ts
git commit -m "feat: add Netlify Edge Function for dynamic OG tag injection on content routes"
```

---

### Task 3: Update netlify.toml with edge function declarations

**Files:**
- Modify: `netlify.toml`

- [ ] **Step 1: Add edge function config to netlify.toml**

Add before the existing `[[redirects]]` block:

```toml
[[edge_functions]]
  function = "og-tags"
  path = "/detail/*"

[[edge_functions]]
  function = "og-tags"
  path = "/eos/*"

[[edge_functions]]
  function = "og-tags"
  path = "/scotus/*"

[[edge_functions]]
  function = "og-tags"
  path = "/pardons/*"
```

The full file should be:

```toml
[build]
  command = "npm run build"
  publish = "dist"

[[edge_functions]]
  function = "og-tags"
  path = "/detail/*"

[[edge_functions]]
  function = "og-tags"
  path = "/eos/*"

[[edge_functions]]
  function = "og-tags"
  path = "/scotus/*"

[[edge_functions]]
  function = "og-tags"
  path = "/pardons/*"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

- [ ] **Step 2: Commit**

```bash
git add netlify.toml
git commit -m "feat: register og-tags edge function for content routes"
```

---

### Task 4: Create the static og-default.png

Create a branded 1200×630 static image for the default OG preview. This is a one-time Node.js script that generates the PNG using `@vercel/og` (Satori under the hood).

**Files:**
- Create: `scripts/generate-og-default.js` (one-time script)
- Create: `public/og-default.png` (generated output)

- [ ] **Step 1: Install satori and resvg-js as dev dependencies**

```bash
npm install --save-dev satori @resvg/resvg-js
```

- [ ] **Step 2: Create the generation script**

Create `scripts/generate-og-default.js`:

```javascript
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'fs';

const WIDTH = 1200;
const HEIGHT = 630;

async function loadFont(url) {
  const res = await fetch(url);
  return await res.arrayBuffer();
}

async function main() {
  const jetBrainsMono = await loadFont(
    'https://cdn.jsdelivr.net/gh/JetBrains/JetBrainsMono@2.304/fonts/ttf/JetBrainsMono-Bold.ttf'
  );
  const archivoBlack = await loadFont(
    'https://cdn.jsdelivr.net/fontsource/fonts/archivo-black@latest/latin-400-normal.ttf'
  );

  const svg = await satori(
    {
      type: 'div',
      props: {
        style: {
          width: WIDTH,
          height: HEIGHT,
          background: '#0a0a0b',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '60px 64px',
          position: 'relative',
          overflow: 'hidden',
        },
        children: [
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                justifyContent: 'flex-start',
                alignItems: 'center',
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      fontFamily: 'Archivo Black',
                      fontSize: 42,
                      color: '#f5f5f4',
                      letterSpacing: '-0.02em',
                    },
                    children: 'TRUMPY',
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      fontFamily: 'Archivo Black',
                      fontSize: 42,
                      color: '#c94a3e',
                      letterSpacing: '-0.02em',
                    },
                    children: '/',
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      fontFamily: 'Archivo Black',
                      fontSize: 42,
                      color: '#f5f5f4',
                      letterSpacing: '-0.02em',
                    },
                    children: 'TRACKER',
                  },
                },
              ],
            },
          },
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      fontFamily: 'Archivo Black',
                      fontSize: 28,
                      color: '#a3a3a3',
                      letterSpacing: '0.02em',
                    },
                    children: 'A daily accountability log.',
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      fontFamily: 'JetBrains Mono',
                      fontSize: 16,
                      color: '#737373',
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                    },
                    children: 'Sourced · Cited · Updated',
                  },
                },
              ],
            },
          },
          {
            type: 'div',
            props: {
              style: {
                fontFamily: 'JetBrains Mono',
                fontSize: 14,
                color: '#525252',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              },
              children: 'trumpytracker.com',
            },
          },
        ],
      },
    },
    {
      width: WIDTH,
      height: HEIGHT,
      fonts: [
        { name: 'JetBrains Mono', data: jetBrainsMono, weight: 700, style: 'normal' },
        { name: 'Archivo Black', data: archivoBlack, weight: 400, style: 'normal' },
      ],
    },
  );

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: WIDTH },
  });
  const png = resvg.render().asPng();
  writeFileSync('public/og-default.png', png);
  console.log(`Generated public/og-default.png (${png.length} bytes)`);
}

main().catch(console.error);
```

- [ ] **Step 3: Run the generation script**

```bash
node scripts/generate-og-default.js
```

Expected: prints `Generated public/og-default.png (XXXXX bytes)` and creates the file.

- [ ] **Step 4: Verify the image exists and is approximately correct size**

```bash
ls -la public/og-default.png
```

Expected: file exists, roughly 10-50KB.

- [ ] **Step 5: Open the image and visually verify**

Open `public/og-default.png` in a viewer. It should show:
- Dark background (#0a0a0b)
- TRUMPY/TRACKER logo with red `/`
- "A daily accountability log." tagline
- "SOURCED · CITED · UPDATED" in mono
- "trumpytracker.com" footer

- [ ] **Step 6: Commit the generated image (not the script — mark it test-only)**

```bash
git add public/og-default.png scripts/generate-og-default.js
git commit -m "feat: add static og-default.png fallback OG image (fixes pre-existing broken og:image reference)"
```

Add `scripts/generate-og-default.js` to `.claude/test-only-paths.md` since it's a one-time generation tool.

---

### Task 5: Refactor Detail page share panel

Replace the "Generate Share Card" toggle with direct platform share buttons.

**Files:**
- Modify: `src/pages/Detail.tsx:1-56, 167-183`

- [ ] **Step 1: Remove ShareCard import and showShare state**

In `src/pages/Detail.tsx`, remove these:

```typescript
// Remove this import (line 6):
import { ShareCardPreview } from '@/components/ShareCard';

// Remove this state (line 23):
const [showShare, setShowShare] = useState(false);
```

- [ ] **Step 2: Add share URL helper functions**

Add these functions inside the `Detail` component, after the `handleCopyLink` function (after line 56):

```typescript
  function shareToX() {
    const text = encodeURIComponent(pickHeadline(item, hmode));
    const url = encodeURIComponent(window.location.href);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank', 'noopener,noreferrer');
  }

  function shareToThreads() {
    const content = encodeURIComponent(pickHeadline(item, hmode) + ' ' + window.location.href);
    window.open(`https://threads.net/intent/post?text=${content}`, '_blank', 'noopener,noreferrer');
  }

  function shareToFacebook() {
    const url = encodeURIComponent(window.location.href);
    const text = encodeURIComponent(pickHeadline(item, hmode));
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}&quote=${text}`, '_blank', 'noopener,noreferrer');
  }

  function shareToReddit() {
    const url = encodeURIComponent(window.location.href);
    const title = encodeURIComponent(pickHeadline(item, hmode));
    window.open(`https://reddit.com/submit?url=${url}&title=${title}`, '_blank', 'noopener,noreferrer');
  }

  function handleNativeShare() {
    if (navigator.share) {
      navigator.share({
        title: pickHeadline(item, hmode),
        url: window.location.href,
      }).catch(() => {});
    }
  }

  const supportsNativeShare = typeof navigator !== 'undefined' && !!navigator.share;
```

- [ ] **Step 3: Replace the action row (lines 167-183)**

Remove the old action row and `{showShare && <ShareCardPreview ... />}` block. Replace with:

```tsx
          {/* Share + Action row */}
          <div style={{ display: 'flex', gap: 10, marginTop: 36, flexWrap: 'wrap', alignItems: 'center' }}>
            {supportsNativeShare && (
              <button onClick={handleNativeShare} style={{ fontFamily: type.mono, fontSize: 11, letterSpacing: '0.14em', padding: '10px 16px', border: `1px solid ${theme.ink}`, background: theme.ink, color: theme.bg, cursor: 'pointer', borderRadius: 2, fontWeight: 700, textTransform: 'uppercase' }}>
                Share
              </button>
            )}
            {[
              { label: 'X', handler: shareToX },
              { label: 'Threads', handler: shareToThreads },
              { label: 'Facebook', handler: shareToFacebook },
              { label: 'Reddit', handler: shareToReddit },
            ].map(({ label, handler }) => (
              <button key={label} onClick={handler} style={{ fontFamily: type.mono, fontSize: 11, letterSpacing: '0.14em', padding: '10px 16px', border: `1px solid ${theme.ink}`, background: theme.ink, color: theme.bg, cursor: 'pointer', borderRadius: 2, fontWeight: 700, textTransform: 'uppercase' }}>
                {label}
              </button>
            ))}
            <button
              onClick={handleCopyLink}
              style={{ fontFamily: type.mono, fontSize: 11, letterSpacing: '0.14em', padding: '10px 16px', border: `1px solid ${theme.line}`, background: 'transparent', color: copied ? '#4ade80' : theme.ink, cursor: 'pointer', borderRadius: 2, textTransform: 'uppercase', transition: 'color 0.2s' }}>
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
            <a
              href={mailtoHref}
              style={{ textDecoration: 'none', fontFamily: type.mono, fontSize: 11, letterSpacing: '0.14em', padding: '10px 16px', border: `1px solid ${theme.line}`, background: 'transparent', color: theme.ink, cursor: 'pointer', borderRadius: 2, textTransform: 'uppercase', display: 'inline-block' }}>
              Report Correction
            </a>
          </div>
```

- [ ] **Step 4: Verify the build compiles**

```bash
npm run build
```

Expected: no errors. The `ShareCard` import is removed, `showShare` state is gone.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Detail.tsx
git commit -m "feat: replace Generate Share Card toggle with direct platform share buttons (X, Threads, Facebook, Reddit)"
```

---

### Task 6: Verify locally and on Netlify deploy

- [ ] **Step 1: Run the local dev server and verify the Detail page**

```bash
npm run server
```

Navigate to a story detail page. Verify:
- Platform buttons (X, Threads, Facebook, Reddit) are visible, filled/primary style
- Copy Link and Report Correction are visible, outlined/secondary style
- No "Generate Share Card" button or toggle
- Each platform button opens the correct URL in a new tab
- Copy Link copies the URL and shows "Copied!" feedback
- On mobile (or Chrome DevTools mobile emulation): a "Share" button appears before the platform buttons

- [ ] **Step 2: Push to test branch and verify Netlify deploy**

```bash
git push origin test
```

Wait for Netlify deploy to complete.

- [ ] **Step 3: Set Netlify environment variables (manual — requires Josh)**

In Netlify dashboard → Site settings → Environment variables, add:
- `SUPABASE_URL` = `https://wnrjrywpcadwutfykflu.supabase.co` (for test site)
- `SUPABASE_ANON_KEY` = the TEST anon key from `src/lib/supabase.ts` line 14

**Note:** This step requires Josh to do it in the Netlify dashboard. Provide him the values.

- [ ] **Step 4: Test OG tags with curl**

After env vars are set and deploy is live, test crawler detection:

```bash
curl -s -A "Twitterbot/1.0" "https://test--trumpytracker.netlify.app/detail/1" | grep -i "og:" | head -10
```

Expected: `og:title` shows the story headline, not "TrumpyTracker". `og:description` shows `LEVEL X · LABEL — N sources cited`.

```bash
curl -s -A "Mozilla/5.0" "https://test--trumpytracker.netlify.app/detail/1" | grep -i "og:" | head -5
```

Expected: generic `og:title` = "TrumpyTracker" (regular browser passes through).

- [ ] **Step 5: Test all content types**

```bash
curl -s -A "facebookexternalhit/1.1" "https://test--trumpytracker.netlify.app/eos/1" | grep -i "og:title"
curl -s -A "facebookexternalhit/1.1" "https://test--trumpytracker.netlify.app/scotus/1" | grep -i "og:title"
curl -s -A "facebookexternalhit/1.1" "https://test--trumpytracker.netlify.app/pardons/1" | grep -i "og:title"
```

Expected: each shows the correct record title, not "TrumpyTracker".

- [ ] **Step 6: Test publish gate enforcement**

Find an unpublished EO or SCOTUS case (one with `is_public = false`), request it with a crawler User-Agent. Expected: generic site OG tags returned, not the record's data.

- [ ] **Step 7: Test with social platform debuggers**

- Facebook: https://developers.facebook.com/tools/debug/ — paste a test URL, verify title/description
- X: https://cards-dev.twitter.com/validator — paste a test URL, verify card preview

---

### Task 7: Add .superpowers to .gitignore

The brainstorming session created mockup files in `.superpowers/`. These shouldn't be committed.

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add .superpowers to .gitignore**

Append to `.gitignore`:

```
# Brainstorming visual companion mockups
.superpowers/
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: add .superpowers/ to gitignore"
```

---

## Checklist Summary

| Task | What | Commit message |
|------|------|---------------|
| 1 | Add OG/Twitter meta tag targets to index.html | `feat: add twitter:title, twitter:description, og:url meta tags...` |
| 2 | Create og-tags edge function | `feat: add Netlify Edge Function for dynamic OG tag injection...` |
| 3 | Update netlify.toml | `feat: register og-tags edge function for content routes` |
| 4 | Generate og-default.png | `feat: add static og-default.png fallback OG image...` |
| 5 | Refactor Detail page share panel | `feat: replace Generate Share Card toggle with direct platform share buttons...` |
| 6 | Verify locally + on Netlify | (no commit — verification) |
| 7 | Add .superpowers to .gitignore | `chore: add .superpowers/ to gitignore` |
