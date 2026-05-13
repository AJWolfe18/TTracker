import { ThemeContext, useThemeProvider } from '@/hooks/useTheme';
import { Route, Switch, useLocation } from 'wouter';
import { Home } from '@/pages/Home';
import { Detail } from '@/pages/Detail';
import { About } from '@/pages/About';
import { SAMPLE_ITEMS } from '@/lib/sample-data';
import { deriveStats } from '@/types';

export function App() {
  const themeValue = useThemeProvider();
  const [, navigate] = useLocation();

  const items = SAMPLE_ITEMS;
  const stats = deriveStats(items);

  const handleOpenItem = (id: string | number) => {
    navigate(`/detail/${id}`);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  return (
    <ThemeContext.Provider value={themeValue}>
      <Switch>
        <Route path="/about">
          <About />
        </Route>
        <Route path="/detail/:id">
          {(params) => {
            const item = items.find(e => String(e.id) === params.id) ?? null;
            const related = items
              .filter(e => e.id !== item?.id && (e.category === item?.category || e.type === item?.type))
              .slice(0, 3);
            return (
              <Detail
                item={item}
                loading={false}
                onOpenItem={handleOpenItem}
                relatedItems={related}
              />
            );
          }}
        </Route>
        <Route path="/">
          <Home
            items={items}
            stats={stats}
            loading={false}
            error={false}
            onOpenItem={handleOpenItem}
          />
        </Route>
      </Switch>
    </ThemeContext.Provider>
  );
}
