import { url, anonKey } from './supabase';
import { storyToItem, eoToItem, scotusToItem, pardonToItem, detailToItem, eoDetailToItem, scotusDetailToItem, pardonDetailToItem } from './adapter';
import { buildPostgrestUrl, buildIlikeOr, buildFtsParam, parseContentRange } from './postgrest';
import { getFilterConfig } from './filters';
import type { DisplayItem } from '@/types';
import type { TabFilterConfig } from './filters';

export interface FetchOptions {
  page?: number;
  filters?: Record<string, string>;
  signal?: AbortSignal;
}

export interface FetchResult {
  items: DisplayItem[];
  total: number;
  page: number;
  totalPages: number;
}

const baseHeaders = {
  'apikey': anonKey,
  'Authorization': `Bearer ${anonKey}`,
  'Content-Type': 'application/json',
};

function buildFilters(config: TabFilterConfig, filters?: Record<string, string>): string[] {
  const out = [...config.baseFilters];
  if (!filters) return out;

  for (const dim of config.dimensions) {
    const val = filters[dim.key];
    if (val) {
      const allowed = new Set(dim.options.map(o => o.apiValue).filter(Boolean));
      if (allowed.has(val)) {
        out.push(`${dim.postgrestColumn}=${dim.postgrestOp}.${val}`);
      }
    }
  }

  const q = filters.q;
  if (q && q.trim()) {
    if (config.searchVectorColumn) {
      out.push(buildFtsParam(config.searchVectorColumn, q));
    } else if (config.searchColumns.length > 0) {
      out.push(buildIlikeOr(config.searchColumns, q));
    }
  }

  return out;
}

type Adapter = (raw: Record<string, unknown>) => DisplayItem;

const ADAPTERS: Record<string, Adapter> = {
  stories: (raw => storyToItem(raw as unknown as Parameters<typeof storyToItem>[0])) as Adapter,
  eos: eoToItem,
  scotus: scotusToItem,
  pardons: pardonToItem,
};

export async function fetchList(
  tabType: string,
  options?: FetchOptions,
): Promise<FetchResult> {
  const config = getFilterConfig(tabType);
  const adapter = ADAPTERS[tabType] || ADAPTERS.stories;
  const pg = options?.page ?? 1;

  const filters = buildFilters(config, options?.filters);
  const { url: reqUrl, headers: preferHeaders } = buildPostgrestUrl(
    url, config.table, {
      select: config.selectFields,
      filters,
      order: config.orderBy,
      limit: config.pageSize,
      page: pg,
    },
  );

  const res = await fetch(reqUrl, {
    headers: { ...baseHeaders, ...preferHeaders },
    signal: options?.signal,
  });

  // 416 = offset beyond total (empty page, but Content-Range still valid)
  if (!res.ok && res.status !== 416) {
    throw new Error(`${config.table}: ${res.status}`);
  }

  const total = parseContentRange(res.headers.get('content-range')) ?? 0;
  const data: Record<string, unknown>[] = res.status === 416 ? [] : await res.json();
  const items = data.map(adapter);
  const totalPages = total === 0 ? 0 : Math.ceil(total / config.pageSize);

  return { items, total, page: pg, totalPages };
}

// ── Detail fetchers (unchanged — single item by ID) ──

function validateId(id: string | number): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function fetchStoryDetail(
  id: string | number,
  signal?: AbortSignal,
): Promise<DisplayItem | null> {
  const endpoint = `${url}/functions/v1/stories-detail/${id}`;
  const res = await fetch(endpoint, { headers: baseHeaders, signal });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`stories-detail: ${res.status}`);
  }
  const data = await res.json();
  if (!data?.story) return null;
  return detailToItem(data);
}

export async function fetchEoDetail(id: string | number, signal?: AbortSignal): Promise<DisplayItem | null> {
  const safeId = encodeURIComponent(String(id));
  const query = `executive_orders?select=id,order_number,title,date,category,alarm_level,action_tier,section_what_it_means,section_what_they_say,section_reality_check,section_why_it_matters,source_url&id=eq.${safeId}&is_public=eq.true`;
  const res = await fetch(`${url}/rest/v1/${query}`, { headers: baseHeaders, signal });
  if (!res.ok) return null;
  const data: Record<string, unknown>[] = await res.json();
  if (!data.length) return null;
  return eoDetailToItem(data[0]);
}

export async function fetchScotusDetail(id: string | number, signal?: AbortSignal): Promise<DisplayItem | null> {
  const numId = validateId(id);
  if (!numId) return null;
  const query = `scotus_cases?select=id,case_name,case_name_short,docket_number,citation,term,decided_at,argued_at,vote_split,majority_author,dissent_authors,case_type,ruling_impact_level,ruling_label,disposition,summary_spicy,who_wins,who_loses,why_it_matters,dissent_highlights,source_url,pdf_url&id=eq.${numId}&is_public=eq.true`;
  const res = await fetch(`${url}/rest/v1/${query}`, { headers: baseHeaders, signal });
  if (!res.ok) return null;
  const data: Record<string, unknown>[] = await res.json();
  if (!data.length) return null;
  return scotusDetailToItem(data[0]);
}

export async function fetchPardonDetail(id: string | number, signal?: AbortSignal): Promise<DisplayItem | null> {
  const endpoint = `${url}/functions/v1/pardons-detail?id=${id}`;
  const res = await fetch(endpoint, { headers: baseHeaders, signal });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.pardon) return null;
  return pardonDetailToItem(data.pardon);
}
