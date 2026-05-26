import { useTheme } from '@/hooks/useTheme';
import { alarmPalette } from '@/tokens';
import type { DisplayStats } from '@/types';

interface ScorecardProps {
  stats: DisplayStats;
}

export function Scorecard({ stats }: ScorecardProps) {
  const { theme, headType: type, mode } = useTheme();

  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - 6);
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const cL5 = alarmPalette(5, 'restrained', mode, 'midnight');
  const cL4 = alarmPalette(4, 'restrained', mode, 'midnight');

  const Cell = ({ label, value, color }: { label: string; value: number | string; color?: string }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span className="tt-sc-label" style={{ fontSize: 11, color: theme.dim, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 500 }}>{label}</span>
      <span className="tt-sc-value" style={{ fontFamily: type.display, fontWeight: 600, fontSize: 18, color: color || theme.ink, letterSpacing: '-0.01em', lineHeight: 1 }}>{value}</span>
    </div>
  );

  const inaugurationDay = new Date('2025-01-20T00:00:00');
  const dayCount = Math.round((today.getTime() - inaugurationDay.getTime()) / 86400000);

  return (
    <div style={{ background: theme.bg2, borderBottom: `1px solid ${theme.line}` }}>
      <div className="tt-scorecard" style={{
        maxWidth: 1400, margin: '0 auto', padding: '10px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        fontFamily: type.mono, flexWrap: 'wrap',
      }}>
        <div className="tt-sc-header" style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 10, color: theme.dim, letterSpacing: '0.22em', textTransform: 'uppercase', fontWeight: 600 }}>The Scorecard</span>
          <span className="tt-sc-date" style={{ fontSize: 11, color: theme.ink, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {fmt(weekStart)}–{fmt(today)}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <Cell label="Active" value={stats.active} />
          <Cell label="Crisis" value={stats.byAlarm[5] || 0} color={cL5.accent} />
          <Cell label="Severe" value={stats.byAlarm[4] || 0} color={cL4.accent} />
          <Cell label="Day" value={dayCount} />
        </div>
      </div>
      <style>{`
        @media (max-width: 800px) {
          .tt-scorecard { padding: 8px 16px !important; gap: 8px !important; }
          .tt-sc-header { width: 100%; }
          .tt-sc-label { font-size: 9px !important; letter-spacing: 0.12em !important; }
          .tt-sc-value { font-size: 15px !important; }
          .tt-sc-date { font-size: 10px !important; }
        }
      `}</style>
    </div>
  );
}
