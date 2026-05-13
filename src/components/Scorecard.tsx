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
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const cL5 = alarmPalette(5, 'restrained', mode, 'midnight');
  const cL4 = alarmPalette(4, 'restrained', mode, 'midnight');

  const Cell = ({ label, value, color }: { label: string; value: number | string; color?: string }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <span style={{ fontSize: 11, color: theme.dim, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 500 }}>{label}</span>
      <span style={{ fontFamily: type.display, fontWeight: 600, fontSize: 18, color: color || theme.ink, letterSpacing: '-0.01em', lineHeight: 1 }}>{value}</span>
    </div>
  );

  const inaugurationDay = new Date('2025-01-20T00:00:00');
  const dayCount = Math.round((today.getTime() - inaugurationDay.getTime()) / 86400000);

  return (
    <div style={{ background: theme.bg2, borderBottom: `1px solid ${theme.line}` }}>
      <div style={{
        maxWidth: 1400, margin: '0 auto', padding: '12px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24,
        fontFamily: type.mono, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 10, color: theme.dim, letterSpacing: '0.22em', textTransform: 'uppercase', fontWeight: 600 }}>The Scorecard</span>
          <span style={{ fontSize: 11, color: theme.ink, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Week of {fmt(weekStart)}–{fmt(today)}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap' }}>
          <Cell label="Active" value={stats.active} />
          <Cell label="L5" value={stats.byAlarm[5] || 0} color={cL5.accent} />
          <Cell label="L4" value={stats.byAlarm[4] || 0} color={cL4.accent} />
          <Cell label="L3" value={stats.byAlarm[3] || 0} />
          <span style={{ width: 1, height: 20, background: theme.line }} />
          <Cell label="Stories" value={stats.byType.stories || 0} />
          <Cell label="EOs" value={stats.byType.eos || 0} />
          <Cell label="SCOTUS" value={stats.byType.scotus || 0} />
          <Cell label="Pardons" value={stats.byType.pardons || 0} />
          <span style={{ width: 1, height: 20, background: theme.line }} />
          <Cell label="Day" value={dayCount} />
        </div>
      </div>
    </div>
  );
}
