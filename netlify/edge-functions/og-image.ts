// ADO-571: renders the per-record "receipt" share card as a 1200x630 PNG.
// GET /api/og-image/:type/:id.png  (type = detail|eos|scotus|pardons, same names as og-tags routes)
// Any failure or non-public record -> 302 /og-default.png. Publish gates are shared with og-tags via
// _shared/og-card-props.mjs ROUTES (asserted by npm run qa:og-card).
import type { Context, Config } from "@netlify/edge-functions";
import { ImageResponse } from "https://deno.land/x/og_edge@0.0.6/mod.ts";
import { buildCardProps, ROUTES } from "./_shared/og-card-props.mjs";
import { Card } from "./_shared/og-card.mjs";

// TTF, not woff2 (Satori cannot parse woff2). URLs come from
//   curl -A "Mozilla/4.0" "https://fonts.googleapis.com/css2?family=Newsreader:wght@500"
// and the same for wght@600, ital,wght@1,500 and JetBrains+Mono:wght@700.
const FONT_URLS = {
  serif500: 'https://fonts.gstatic.com/s/newsreader/v26/cY9qfjOCX1hbuyalUrK49dLac06G1ZGsZBtoBCzBDXXD9JVF438wSo_ADA.ttf',
  serif600: 'https://fonts.gstatic.com/s/newsreader/v26/cY9qfjOCX1hbuyalUrK49dLac06G1ZGsZBtoBCzBDXXD9JVF438wpojADA.ttf',
  serifItalic: 'https://fonts.gstatic.com/s/newsreader/v26/cY9kfjOCX1hbuyalUrK439vogqC9yFZCYg7oRZaLP4obnf7fTXglsMwaT-ZA.ttf',
  mono700: 'https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8L6tjPQ.ttf',
};

type FontSet = { name: string; data: ArrayBuffer; weight: number; style: 'normal' | 'italic' }[];
let fontCache: FontSet | null = null;

async function loadFonts(): Promise<FontSet> {
  if (fontCache) return fontCache;
  const get = async (u: string) => {
    const r = await fetch(u);
    if (!r.ok) throw new Error(`font ${r.status}`);
    return r.arrayBuffer();
  };
  const [serif500, serif600, serifItalic, mono700] = await Promise.all([
    get(FONT_URLS.serif500), get(FONT_URLS.serif600), get(FONT_URLS.serifItalic), get(FONT_URLS.mono700),
  ]);
  fontCache = [
    { name: 'Newsreader', data: serif500, weight: 500, style: 'normal' },
    { name: 'Newsreader', data: serif600, weight: 600, style: 'normal' },
    { name: 'Newsreader', data: serifItalic, weight: 500, style: 'italic' },
    { name: 'JetBrains Mono', data: mono700, weight: 700, style: 'normal' },
  ];
  return fontCache;
}

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const fallback = () => Response.redirect(`${url.origin}/og-default.png`, 302);
  const m = url.pathname.match(/^\/api\/og-image\/(detail|eos|scotus|pardons)\/([A-Za-z0-9_\-]+)\.png$/);
  if (!m) return fallback();
  const [, type, id] = m;
  const route = ROUTES[type as keyof typeof ROUTES];

  const supabaseUrl = Netlify.env.get('SUPABASE_URL');
  const anonKey = Netlify.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) return fallback();

  try {
    const q = `${supabaseUrl}/rest/v1/${route.table}?select=${route.select}&id=eq.${encodeURIComponent(id)}&${route.filters.join('&')}&limit=1`;
    const r = await fetch(q, { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } });
    if (!r.ok) return fallback();
    const rows: Record<string, unknown>[] = await r.json();
    if (!rows[0]) return fallback();

    const props = buildCardProps(type, rows[0]);
    const fonts = await loadFonts();
    // deno-lint-ignore no-explicit-any
    return new ImageResponse(Card(props) as any, {
      width: 1200,
      height: 630,
      fonts,
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
    });
  } catch {
    return fallback();
  }
};

// cache: "manual" lets the Netlify CDN honor the immutable Cache-Control above (default: never cached).
export const config: Config = { path: "/api/og-image/*", cache: "manual" };
