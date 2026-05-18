import { useState, useEffect } from 'react';
import { ThemeContext, useThemeProvider } from '@/hooks/useTheme';
import { Route, Switch, useLocation } from 'wouter';
import { Home } from '@/pages/Home';
import { Detail } from '@/pages/Detail';
import { About } from '@/pages/About';
import {
  fetchActiveStories, fetchStoryDetail,
  fetchExecutiveOrders, fetchEoDetail,
  fetchScotusCases, fetchScotusDetail,
  fetchPardons, fetchPardonDetail,
} from '@/lib/api';
import { deriveStats } from '@/types';
import type { DisplayItem } from '@/types';
import type { FetchResult } from '@/lib/api';

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
          <TypePage fetcher={fetchExecutiveOrders} onOpenItem={makeOpenHandler('eos')} />
        </Route>
        <Route path="/scotus">
          <TypePage fetcher={fetchScotusCases} onOpenItem={makeOpenHandler('scotus')} />
        </Route>
        <Route path="/pardons">
          <TypePage fetcher={fetchPardons} onOpenItem={makeOpenHandler('pardons')} />
        </Route>
        <Route path="/">
          <TypePage fetcher={fetchActiveStories} onOpenItem={makeOpenHandler('detail')} />
        </Route>
      </Switch>
    </ThemeContext.Provider>
  );
}

function TypePage({
  fetcher,
  onOpenItem,
}: {
  fetcher: (options?: { signal?: AbortSignal }) => Promise<FetchResult>;
  onOpenItem: (id: string | number) => void;
}) {
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(false);
    fetcher({ signal: ac.signal })
      .then(result => { setItems(result.items); setError(false); })
      .catch(err => { if (err.name !== 'AbortError') setError(true); })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, [fetcher]);

  const stats = deriveStats(items);

  return (
    <Home
      items={items}
      stats={stats}
      loading={loading}
      error={error}
      onOpenItem={onOpenItem}
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
    setDetailLoading(true);

    fetcher(id, ac.signal)
      .then(detail => { if (detail) setItem(detail); })
      .catch(err => { if (err.name !== 'AbortError') setItem(null); })
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
