import { useTheme } from '@/hooks/useTheme';
import { alarmPalette } from '@/tokens';
import { Header } from '@/components/Header';
import { Scorecard } from '@/components/Scorecard';
import { Footer } from '@/components/Footer';
import { Card } from '@/components/Card';
import { Kicker } from '@/components/Kicker';
import { FilterBar } from '@/components/FilterBar';
import { Pagination } from '@/components/Pagination';
import { LoadingSkeleton } from '@/edge-states/LoadingSkeleton';
import { ErrorState } from '@/edge-states/ErrorState';
import { EmptyState } from '@/edge-states/EmptyState';
import { FilterEmpty } from '@/edge-states/FilterEmpty';
import { fmtDate, relDate } from '@/lib/date-utils';
import { pickHeadline } from '@/lib/pick-headline';
import type { DisplayItem, DisplayStats } from '@/types';
import type { TabFilterConfig } from '@/lib/filters';

interface HomeProps {
  items: DisplayItem[];
  stats: DisplayStats;
  loading: boolean;
  error: boolean;
  onOpenItem: (id: string | number) => void;
  filterConfig?: TabFilterConfig;
  activeFilters?: Record<string, string>;
  onFilterChange?: (key: string, value: string | null) => void;
  onClearFilters?: () => void;
  hasActiveFilters?: boolean;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  currentPage?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
  total?: number;
  filteredTotal?: number;
}

export function Home({
  items, stats, loading, error, onOpenItem,
  filterConfig, activeFilters, onFilterChange, onClearFilters,
  hasActiveFilters, searchQuery, onSearchChange,
  currentPage, totalPages, onPageChange,
  total, filteredTotal,
}: HomeProps) {
  const { theme, headType, mode } = useTheme();
  const headlineMode = 'spicy';
  const showFiltered = hasActiveFilters || false;

  const navLabel = filterConfig?.tabType === 'eos' ? 'Executive Orders'
    : filterConfig?.tabType === 'scotus' ? 'Supreme Court'
    : filterConfig?.tabType === 'pardons' ? 'Pardons'
    : 'Home';

  const filterBar = filterConfig && activeFilters && onFilterChange && onClearFilters ? (
    <FilterBar
      config={filterConfig}
      activeFilters={activeFilters}
      onFilterChange={onFilterChange}
      onClearAll={onClearFilters}
      hasActiveFilters={hasActiveFilters || false}
      total={total ?? items.length}
      filteredTotal={filteredTotal ?? items.length}
    />
  ) : null;

  const shell = (children: React.ReactNode) => (
    <div style={{ background: theme.bg, color: theme.ink, fontFamily: headType.sans, minHeight: '100vh' }}>
      <Header
        current={navLabel}
        searchPlaceholder={filterConfig?.searchPlaceholder}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
      />
      <Scorecard stats={stats} />
      <main id="main-content" style={{ maxWidth: 1400, margin: '0 auto', padding: '0 20px' }}>
        {children}
        {totalPages != null && totalPages > 1 && onPageChange && (
          <Pagination page={currentPage ?? 1} totalPages={totalPages} onPageChange={(p) => {
            onPageChange(p);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }} />
        )}
        <Footer />
      </main>
    </div>
  );

  if (loading) return shell(<LoadingSkeleton />);
  if (error) return shell(<ErrorState />);
  if (items.length === 0 && showFiltered) return shell(<FilterEmpty label="these filters" onReset={onClearFilters!} />);
  if (items.length === 0) return shell(<EmptyState />);

  // When filters active: flat grid (no hero/featured)
  if (showFiltered) {
    return shell(
      <>
        {filterBar}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
          gap: 20, padding: '24px 0 0',
        }}>
          {items.map(it => (
            <Card key={it.id} item={it} headlineMode={headlineMode} onOpen={onOpenItem} />
          ))}
        </div>
      </>
    );
  }

  // Default: hero + featured + grid
  const sortedAll = [...items].sort((a, b) => b.alarm - a.alarm || b.updated.localeCompare(a.updated));
  const lead = sortedAll[0];
  const featuredSecond = sortedAll.find(e => e.id !== lead.id && e.alarm >= 4);
  const rest = items
    .filter(e => e.id !== lead.id && (!featuredSecond || e.id !== featuredSecond.id))
    .sort((a, b) => b.published.localeCompare(a.published));
  const cLead = alarmPalette(lead.alarm, 'restrained', mode, 'midnight');

  return shell(
    <>
      {/* HERO */}
      <section aria-label="Lead story" style={{ padding: '44px 0 36px', borderBottom: `1px solid ${theme.line}`, position: 'relative' }}>
        <div style={{ maxWidth: 920 }}>
          <Kicker theme={theme} type={headType} item={lead} accent={cLead.accent} />
          <h1 onClick={() => onOpenItem(lead.id)} style={{
            fontFamily: headType.display, fontWeight: 600,
            fontSize: 'clamp(32px, 4.0vw, 52px)', lineHeight: 1.04,
            letterSpacing: '-0.02em', textWrap: 'balance',
            margin: 0, cursor: 'pointer', color: theme.ink,
          }}>
            {pickHeadline(lead, headlineMode)}
          </h1>
          <p style={{ fontFamily: headType.display, fontSize: 18, lineHeight: 1.5, color: theme.dim, marginTop: 18, maxWidth: 720, textWrap: 'pretty' }}>
            {lead.dek}
          </p>
          <div style={{ fontFamily: headType.mono, fontSize: 11, color: theme.dim, marginTop: 18, display: 'flex', gap: 12, flexWrap: 'wrap', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            <span>Filed {fmtDate(lead.published)}</span>
            <span>·</span>
            <span>Updated {relDate(lead.updated)}</span>
            {lead.sources.length > 1 && (<><span>·</span><span>{lead.sources.length} sources</span></>)}
          </div>
        </div>
      </section>

      {/* FILTERS (below hero, above featured) */}
      {filterBar}

      {/* FEATURED CARD */}
      {featuredSecond && (
        <div style={{ padding: '28px 0 0' }}>
          <Card item={featuredSecond} headlineMode={headlineMode} onOpen={onOpenItem} featured />
        </div>
      )}

      {/* GRID */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 20, padding: '24px 0 0' }}>
        {rest.map(it => (
          <Card key={it.id} item={it} headlineMode={headlineMode} onOpen={onOpenItem} />
        ))}
      </div>
    </>
  );
}
