import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useSearchParams } from 'wouter';
import type { TabFilterConfig } from '@/lib/filters';

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

  const setFilter = useCallback((key: string, value: string | null) => {
    setParams(prev => {
      if (value) {
        prev.set(key, value);
      } else {
        prev.delete(key);
      }
      prev.delete('page');
      return prev;
    }, { replace: true });
  }, [setParams]);

  const setPage = useCallback((n: number) => {
    setParams(prev => {
      if (n <= 1) {
        prev.delete('page');
      } else {
        prev.set('page', String(n));
      }
      return prev;
    }, { replace: true });
  }, [setParams]);

  const setSearch = useCallback((q: string) => {
    setLocalSearch(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setParams(prev => {
        const trimmed = q.trim();
        if (trimmed) {
          prev.set('q', trimmed);
        } else {
          prev.delete('q');
        }
        prev.delete('page');
        return prev;
      }, { replace: true });
    }, 300);
  }, [setParams]);

  const clearAll = useCallback(() => {
    setParams({}, { replace: true });
    setLocalSearch('');
  }, [setParams]);

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
