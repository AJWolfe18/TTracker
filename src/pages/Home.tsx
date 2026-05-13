import { useState } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { alarmPalette } from '@/tokens';
import { Header } from '@/components/Header';
import { Scorecard } from '@/components/Scorecard';
import { Footer } from '@/components/Footer';
import { Card } from '@/components/Card';
import { Kicker } from '@/components/Kicker';
import { LoadingSkeleton } from '@/edge-states/LoadingSkeleton';
import { ErrorState } from '@/edge-states/ErrorState';
import { EmptyState } from '@/edge-states/EmptyState';
import { FilterEmpty } from '@/edge-states/FilterEmpty';
import { fmtDate, relDate } from '@/lib/date-utils';
import { pickHeadline } from '@/lib/pick-headline';
import type { DisplayItem, DisplayStats } from '@/types';

interface HomeProps {
  items: DisplayItem[];
  stats: DisplayStats;
  loading: boolean;
  error: boolean;
  onOpenItem: (id: string | number) => void;
}

export function Home({ items, stats, loading, error, onOpenItem }: HomeProps) {
  const { theme, headType, mode } = useTheme();
  const [activeType, setActiveType] = useState('all');
  const headlineMode = 'spicy';

  if (loading) {
    return (
      <div style={{ background: theme.bg, color: theme.ink, fontFamily: headType.sans, minHeight: '100vh' }}>
        <Header current="Home" />
        <Scorecard stats={{ total: 0, byType: {}, byAlarm: {}, byCat: {}, active: 0, avgAlarm: 0, severe: 0 }} />
        <main id="main-content" style={{ maxWidth: 1400, margin: '0 auto', padding: '0 20px' }}>
          <LoadingSkeleton />
          <Footer />
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ background: theme.bg, color: theme.ink, fontFamily: headType.sans, minHeight: '100vh' }}>
        <Header current="Home" />
        <Scorecard stats={{ total: 0, byType: {}, byAlarm: {}, byCat: {}, active: 0, avgAlarm: 0, severe: 0 }} />
        <main id="main-content" style={{ maxWidth: 1400, margin: '0 auto', padding: '0 20px' }}>
          <ErrorState />
          <Footer />
        </main>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div style={{ background: theme.bg, color: theme.ink, fontFamily: headType.sans, minHeight: '100vh' }}>
        <Header current="Home" />
        <Scorecard stats={{ total: 0, byType: {}, byAlarm: {}, byCat: {}, active: 0, avgAlarm: 0, severe: 0 }} />
        <main id="main-content" style={{ maxWidth: 1400, margin: '0 auto', padding: '0 20px' }}>
          <EmptyState />
          <Footer />
        </main>
      </div>
    );
  }

  const filtered = activeType === 'all' ? items : items.filter(e => e.type === activeType);
  const sortedAll = [...items].sort((a, b) => b.alarm - a.alarm || b.updated.localeCompare(a.updated));
  const lead = sortedAll[0];
  const featuredSecond = sortedAll.find(e => e.id !== lead.id && e.alarm >= 4);
  const rest = filtered
    .filter(e => e.id !== lead.id && (!featuredSecond || e.id !== featuredSecond.id))
    .sort((a, b) => b.published.localeCompare(a.published));
  const cLead = alarmPalette(lead.alarm, 'restrained', mode, 'midnight');

  return (
    <div style={{ background: theme.bg, color: theme.ink, fontFamily: headType.sans, minHeight: '100vh' }}>
      <Header current="Home" />
      <Scorecard stats={stats} />

      <main id="main-content" style={{ maxWidth: 1400, margin: '0 auto', padding: '0 20px' }}>
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
              <span>·</span>
              <span>{lead.sources.length} sources</span>
            </div>
          </div>
        </section>

        {/* TYPE FILTER */}
        <div role="tablist" style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${theme.line}`, overflowX: 'auto', margin: '20px 0 0' }}>
          {([
            ['all', 'All', items.length],
            ['stories', 'Stories', stats.byType.stories],
            ['eos', 'Executive Orders', stats.byType.eos],
            ['scotus', 'SCOTUS', stats.byType.scotus],
            ['pardons', 'Pardons', stats.byType.pardons],
          ] as const).map(([k, lbl, n]) => {
            const active = activeType === k;
            return (
              <button
                key={k}
                role="tab"
                aria-selected={active}
                onClick={() => setActiveType(k)}
                style={{
                  fontFamily: headType.mono, fontWeight: 600, fontSize: 11,
                  padding: '12px 16px', border: 'none', cursor: 'pointer',
                  background: 'transparent',
                  color: active ? theme.ink : theme.dim,
                  textTransform: 'uppercase', letterSpacing: '0.14em',
                  borderBottom: active ? `2px solid ${theme.ink}` : '2px solid transparent',
                  whiteSpace: 'nowrap',
                }}>
                {lbl} <span style={{ opacity: 0.5, marginLeft: 6, fontSize: 10 }}>[{n || 0}]</span>
              </button>
            );
          })}
        </div>

        {/* FEATURED CARD */}
        {activeType === 'all' && featuredSecond && (
          <div style={{ padding: '28px 0 0' }}>
            <Card item={featuredSecond} headlineMode={headlineMode} onOpen={onOpenItem} featured />
          </div>
        )}

        {/* GRID */}
        {rest.length === 0 && activeType !== 'all' ? (
          <FilterEmpty
            label={({ stories: 'Stories', eos: 'Executive Orders', scotus: 'SCOTUS', pardons: 'Pardons' } as Record<string, string>)[activeType] || activeType}
            onReset={() => setActiveType('all')}
          />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 20, padding: '24px 0 0' }}>
            {rest.map(it => (
              <Card key={it.id} item={it} headlineMode={headlineMode} onOpen={onOpenItem} />
            ))}
          </div>
        )}

        <Footer />
      </main>
    </div>
  );
}
