import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useSearchParams } from 'wouter';
import type { TabFilterConfig } from '@/lib/filters';
import { track } from '@/lib/analytics';

export interface UseFiltersResult {
  activeFilters: Record<string, string>;
  page: number;
  searchQuery: string;
  committedSearch: string;
  setFilter: (key: string, value: string | null) => void;
  setPage: (n: number) => void;
  setSearch: (q: string) => void;
  clearAll: () => void;
  hasActiveFilters: boolean;
}

export function useFilters(config: TabFilterConfig): UseFiltersResult {
  const [params, setParams] = useSearchParams();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const activeFilters = useMemo(() => {
    const out: Record<string, string> = {};
    for (const dim of config.dimensions) {
      const val = params.get(dim.key);
      if (val) out[dim.key] = val;
    }
    return out;
  }, [params, config.dimensions]);

  const page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);
  const urlSearch = params.get('q') || '';

  const [localSearch, setLocalSearch] = useState(urlSearch);

  const prevUrlSearch = useRef(urlSearch);
  if (prevUrlSearch.current !== urlSearch) {
    prevUrlSearch.current = urlSearch;
    if (localSearch !== urlSearch) setLocalSearch(urlSearch);
  }

  // Analytics fire here, at the commit point, because every tab's filter bar,
  // search box and pager funnels through this hook. Search sends length only
  // (PRD section 4 property hygiene), and only once the debounce settles.
  const tab = config.tabType;

  const setFilter = useCallback((key: string, value: string | null) => {
    track('filter_apply', { tab, filter_key: key, filter_value: value ?? 'clear' });
    setParams(prev => {
      if (value) {
        prev.set(key, value);
      } else {
        prev.delete(key);
      }
      prev.delete('page');
      return prev;
    }, { replace: true });
  }, [setParams, tab]);

  const setPage = useCallback((n: number) => {
    track('pagination', { tab, page: Math.max(1, n) });
    setParams(prev => {
      if (n <= 1) {
        prev.delete('page');
      } else {
        prev.set('page', String(n));
      }
      return prev;
    }, { replace: true });
  }, [setParams, tab]);

  const setSearch = useCallback((q: string) => {
    setLocalSearch(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const trimmed = q.trim();
      if (trimmed) track('search', { tab, query_length: trimmed.length });
      setParams(prev => {
        if (trimmed) {
          prev.set('q', trimmed);
        } else {
          prev.delete('q');
        }
        prev.delete('page');
        return prev;
      }, { replace: true });
    }, 300);
  }, [setParams, tab]);

  const clearAll = useCallback(() => {
    track('filter_apply', { tab, filter_key: 'all', filter_value: 'clear' });
    setParams({}, { replace: true });
    setLocalSearch('');
  }, [setParams, tab]);

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  const hasActiveFilters = Object.keys(activeFilters).length > 0 || urlSearch.length > 0;

  return {
    activeFilters,
    page,
    searchQuery: localSearch,
    committedSearch: urlSearch,
    setFilter,
    setPage,
    setSearch,
    clearAll,
    hasActiveFilters,
  };
}
