import type { Context, Config } from "@netlify/edge-functions";

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

export default async (req: Request, context: Context) => {
  const ua = req.headers.get('user-agent') || '';

  if (!isCrawler(ua)) {
    return context.next();
  }

  const url = new URL(req.url);
  const route = parseRoute(url.pathname);
  if (!route) {
    const r = await context.next();
    return new Response(await r.text(), { status: r.status, headers: { ...Object.fromEntries(r.headers), 'x-og-debug': 'no-route' } });
  }

  const routeConfig = ROUTE_CONFIGS[route.type];
  if (!routeConfig) {
    const r = await context.next();
    return new Response(await r.text(), { status: r.status, headers: { ...Object.fromEntries(r.headers), 'x-og-debug': 'no-config' } });
  }

  const supabaseUrl = Netlify.env.get('SUPABASE_URL');
  const anonKey = Netlify.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) {
    const r = await context.next();
    return new Response(await r.text(), { status: r.status, headers: { ...Object.fromEntries(r.headers), 'x-og-debug': `no-env:url=${!!supabaseUrl}:key=${!!anonKey}` } });
  }

  try {
    const record = await fetchRecord(supabaseUrl, anonKey, routeConfig, route.id);
    if (!record) {
      const r = await context.next();
      return new Response(await r.text(), { status: r.status, headers: { ...Object.fromEntries(r.headers), 'x-og-debug': 'no-record' } });
    }

    const origin = url.origin;
    const title = routeConfig.buildTitle(record);
    const description = routeConfig.buildDescription(record);
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
      headers: { ...Object.fromEntries(response.headers), 'x-og-debug': 'injected' },
    });
  } catch (err) {
    const r = await context.next();
    return new Response(await r.text(), { status: r.status, headers: { ...Object.fromEntries(r.headers), 'x-og-debug': `error:${(err as Error).message}` } });
  }
}

export const config: Config = {
  path: ["/detail/*", "/eos/*", "/scotus/*", "/pardons/*"],
};
