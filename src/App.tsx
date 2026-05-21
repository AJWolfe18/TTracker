import { useState, useEffect, Suspense, lazy } from 'react';
import { ThemeContext, useThemeProvider } from '@/hooks/useTheme';
import { Route, Switch, useLocation } from 'wouter';
import { Home } from '@/pages/Home';
import { LoadingSkeleton } from '@/edge-states/LoadingSkeleton';
import { fetchList, fetchStoryDetail, fetchEoDetail, fetchScotusDetail, fetchPardonDetail } from '@/lib/api';
import { getFilterConfig } from '@/lib/filters';
import { useFilters } from '@/hooks/useFilters';
import { deriveStats } from '@/types';
import type { DisplayItem } from '@/types';
import type { FetchOptions } from '@/lib/api';

const Detail = lazy(() => import('@/pages/Detail').then(m => ({ default: m.Detail })));
const About = lazy(() => import('@/pages/About').then(m => ({ default: m.About })));

type DetailFetcher = (id: string | number, signal?: AbortSignal) => Promise<DisplayItem | null>;

export function App() {
  const themeValue = useThemeProvider();
  const [, navigate] = useLocation();

  const makeOpenHandler = (prefix: string) => (id: string | number) => {
    navigate(`/${prefix}/${id}`);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  return (
    <ThemeContext.Provider value={themeValue}>
      <Suspense fallback={<LoadingSkeleton />}>
        <Switch>
          <Route path="/about">
            <About />
          </Route>
          <Route path="/eos/:id">
            {(params) => <DetailRoute id={params.id} fetcher={fetchEoDetail} onOpenItem={makeOpenHandler('eos')} />}
          </Route>
          <Route path="/scotus/:id">
            {(params) => <DetailRoute id={params.id} fetcher={fetchScotusDetail} onOpenItem={makeOpenHandler('scotus')} />}
          </Route>
          <Route path="/pardons/:id">
            {(params) => <DetailRoute id={params.id} fetcher={fetchPardonDetail} onOpenItem={makeOpenHandler('pardons')} />}
          </Route>
          <Route path="/detail/:id">
            {(params) => <DetailRoute id={params.id} fetcher={fetchStoryDetail} onOpenItem={makeOpenHandler('detail')} />}
          </Route>
          <Route path="/eos">
            <TypePage tabType="eos" onOpenItem={makeOpenHandler('eos')} />
          </Route>
          <Route path="/scotus">
            <TypePage tabType="scotus" onOpenItem={makeOpenHandler('scotus')} />
          </Route>
          <Route path="/pardons">
            <TypePage tabType="pardons" onOpenItem={makeOpenHandler('pardons')} />
          </Route>
          <Route path="/">
            <TypePage tabType="stories" onOpenItem={makeOpenHandler('detail')} />
          </Route>
        </Switch>
      </Suspense>
    </ThemeContext.Provider>
  );
}

function TypePage({
  tabType,
  onOpenItem,
}: {
  tabType: string;
  onOpenItem: (id: string | number) => void;
}) {
  const config = getFilterConfig(tabType);
  const filters = useFilters(config);
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const filtersKey = JSON.stringify(filters.activeFilters);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(false);

    const opts: FetchOptions = {
      page: filters.page,
      filters: { ...filters.activeFilters },
      signal: ac.signal,
    };
    if (filters.committedSearch) opts.filters!.q = filters.committedSearch;

    fetchList(tabType, opts)
      .then(result => {
        if (ac.signal.aborted) return;
        setItems(result.items);
        setTotal(result.total);
        setTotalPages(result.totalPages);

        if (filters.page > result.totalPages && result.totalPages > 0) {
          filters.setPage(result.totalPages);
        }
      })
      .catch(err => {
        if (err.name !== 'AbortError' && !ac.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabType, filters.page, filtersKey, filters.committedSearch]);

  const stats = deriveStats(items);

  return (
    <Home
      items={items}
      stats={stats}
      loading={loading}
      error={error}
      onOpenItem={onOpenItem}
      filterConfig={config}
      activeFilters={filters.activeFilters}
      onFilterChange={filters.setFilter}
      onClearFilters={filters.clearAll}
      hasActiveFilters={filters.hasActiveFilters}
      searchQuery={filters.searchQuery}
      onSearchChange={filters.setSearch}
      currentPage={filters.page}
      totalPages={totalPages}
      onPageChange={filters.setPage}
      total={total}
      filteredTotal={total}
    />
  );
}

function DetailRoute({
  id,
  fetcher,
  onOpenItem,
}: {
  id: string;
  fetcher: DetailFetcher;
  onOpenItem: (id: string | number) => void;
}) {
  const [item, setItem] = useState<DisplayItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    setItem(null);
    setDetailLoading(true);

    fetcher(id, ac.signal)
      .then(detail => { if (!ac.signal.aborted && detail) setItem(detail); })
      .catch(err => { if (err.name !== 'AbortError' && !ac.signal.aborted) setItem(null); })
      .finally(() => { if (!ac.signal.aborted) setDetailLoading(false); });

    return () => ac.abort();
  }, [id, fetcher]);

  return (
    <Detail
      item={item}
      loading={!item && detailLoading}
      onOpenItem={onOpenItem}
      relatedItems={[]}
    />
  );
}
