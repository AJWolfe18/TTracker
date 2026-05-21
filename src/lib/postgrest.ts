export function sanitizeLike(input: string): string {
  return input
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/\*/g, '\\*');
}

export function buildIlikeOr(columns: string[], query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return '';
  const safe = encodeURIComponent(sanitizeLike(trimmed));
  return `or=(${columns.map(c => `${c}.ilike.*${safe}*`).join(',')})`;
}

export function buildFtsParam(column: string, query: string, config = 'english'): string {
  const trimmed = query.trim();
  if (!trimmed) return '';
  const safe = encodeURIComponent(trimmed);
  return `${column}=wfts(${config}).${safe}`;
}

export interface PostgrestUrlParams {
  select: string;
  filters: string[];
  order: string;
  limit: number;
  page: number;
}

export function buildPostgrestUrl(
  base: string,
  table: string,
  params: PostgrestUrlParams,
): { url: string; headers: Record<string, string> } {
  const offset = (params.page - 1) * params.limit;
  const parts = [
    `select=${params.select}`,
    ...params.filters.filter(Boolean),
    `order=${params.order}`,
    `limit=${params.limit}`,
    `offset=${offset}`,
  ];
  return {
    url: `${base}/rest/v1/${table}?${parts.join('&')}`,
    headers: { 'Prefer': 'count=exact' },
  };
}

export function parseContentRange(header: string | null): number | null {
  if (!header) return null;
  const match = header.match(/\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}
