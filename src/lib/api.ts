import { url, anonKey } from './supabase';
import { adaptActiveResponse, adaptSearchResponse, detailToItem, eoToItem, scotusToItem, pardonToItem } from './adapter';
import type { DisplayItem } from '@/types';

export interface FetchOptions {
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface FetchResult {
  items: DisplayItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

const headers = {
  'apikey': anonKey,
  'Authorization': `Bearer ${anonKey}`,
  'Content-Type': 'application/json',
};

export async function fetchActiveStories(options?: FetchOptions): Promise<FetchResult> {
  const params = new URLSearchParams();
  if (options?.cursor) params.set('cursor', options.cursor);
  if (options?.limit) params.set('limit', String(options.limit));

  const qs = params.toString();
  const endpoint = `${url}/functions/v1/stories-active${qs ? '?' + qs : ''}`;

  const res = await fetch(endpoint, { headers, signal: options?.signal });
  if (!res.ok) throw new Error(`stories-active: ${res.status}`);

  const data = await res.json();
  return adaptActiveResponse(data);
}

export async function fetchStoryDetail(
  id: string | number,
  signal?: AbortSignal,
): Promise<DisplayItem | null> {
  const endpoint = `${url}/functions/v1/stories-detail/${id}`;

  const res = await fetch(endpoint, { headers, signal });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`stories-detail: ${res.status}`);
  }

  const data = await res.json();
  if (!data?.story) return null;
  return detailToItem(data);
}

export async function searchStories(
  query: string,
  options?: FetchOptions,
): Promise<FetchResult> {
  const params = new URLSearchParams();
  params.set('q', query);
  if (options?.cursor) params.set('cursor', options.cursor);
  if (options?.limit) params.set('limit', String(options.limit));

  const endpoint = `${url}/functions/v1/stories-search?${params.toString()}`;

  const res = await fetch(endpoint, { headers, signal: options?.signal });
  if (!res.ok) throw new Error(`stories-search: ${res.status}`);

  const data = await res.json();
  return adaptSearchResponse(data);
}

export async function fetchExecutiveOrders(options?: FetchOptions): Promise<FetchResult> {
  const query = 'executive_orders?select=id,order_number,title,date,category,alarm_level,section_what_it_means,section_why_it_matters,source_url&is_public=eq.true&order=date.desc,id.desc&limit=100';
  const res = await fetch(`${url}/rest/v1/${query}`, { headers, signal: options?.signal });
  if (!res.ok) throw new Error(`executive_orders: ${res.status}`);

  const data: Record<string, unknown>[] = await res.json();
  return { items: data.map(eoToItem), nextCursor: null, hasMore: false };
}

export async function fetchScotusCases(options?: FetchOptions): Promise<FetchResult> {
  const query = 'scotus_cases?select=id,case_name,case_name_short,docket_number,term,decided_at,vote_split,majority_author,case_type,ruling_impact_level,ruling_label,summary_spicy,who_wins,who_loses,why_it_matters,source_url,pdf_url&is_public=eq.true&order=decided_at.desc&limit=100';
  const res = await fetch(`${url}/rest/v1/${query}`, { headers, signal: options?.signal });
  if (!res.ok) throw new Error(`scotus_cases: ${res.status}`);

  const data: Record<string, unknown>[] = await res.json();
  return { items: data.map(scotusToItem), nextCursor: null, hasMore: false };
}

export async function fetchPardons(options?: FetchOptions): Promise<FetchResult> {
  const endpoint = `${url}/functions/v1/pardons-active`;
  const res = await fetch(endpoint, { headers, signal: options?.signal });
  if (!res.ok) throw new Error(`pardons-active: ${res.status}`);

  const data = await res.json();
  return { items: (data.items || []).map(pardonToItem), nextCursor: data.next_cursor || null, hasMore: data.has_more || false };
}

function validateId(id: string | number): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function fetchEoDetail(id: string | number, signal?: AbortSignal): Promise<DisplayItem | null> {
  const numId = validateId(id);
  if (!numId) return null;
  const query = `executive_orders?select=id,order_number,title,date,category,alarm_level,section_what_it_means,section_what_they_say,section_reality_check,section_why_it_matters,source_url&id=eq.${numId}&is_public=eq.true`;
  const res = await fetch(`${url}/rest/v1/${query}`, { headers, signal });
  if (!res.ok) return null;
  const data: Record<string, unknown>[] = await res.json();
  if (!data.length) return null;
  const item = eoToItem(data[0]);
  item.body = (data[0].section_why_it_matters as string) || (data[0].section_what_it_means as string) || '';
  return item;
}

export async function fetchScotusDetail(id: string | number, signal?: AbortSignal): Promise<DisplayItem | null> {
  const numId = validateId(id);
  if (!numId) return null;
  const query = `scotus_cases?select=id,case_name,case_name_short,docket_number,term,decided_at,vote_split,majority_author,case_type,ruling_impact_level,ruling_label,summary_spicy,who_wins,who_loses,why_it_matters,dissent_highlights,source_url,pdf_url&id=eq.${numId}&is_public=eq.true`;
  const res = await fetch(`${url}/rest/v1/${query}`, { headers, signal });
  if (!res.ok) return null;
  const data: Record<string, unknown>[] = await res.json();
  if (!data.length) return null;
  const item = scotusToItem(data[0]);
  item.body = (data[0].why_it_matters as string) || (data[0].summary_spicy as string) || '';
  return item;
}

export async function fetchPardonDetail(id: string | number, signal?: AbortSignal): Promise<DisplayItem | null> {
  const endpoint = `${url}/functions/v1/pardons-detail?id=${id}`;
  const res = await fetch(endpoint, { headers, signal });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.pardon) return null;
  const item = pardonToItem(data.pardon);
  item.body = (data.pardon.crime_description as string) || (data.pardon.summary_spicy as string) || '';
  return item;
}
