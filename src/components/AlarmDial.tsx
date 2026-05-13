import { TONE_SYSTEM, alarmPalette } from '@/tokens';
import { useTheme } from '@/hooks/useTheme';

interface AlarmDialProps {
  level: number;
  size?: number;
  showLabel?: boolean;
  variant?: 'dot' | 'bars' | 'siren';
}

export function AlarmDial({ level, size = 44, showLabel = false, variant = 'dot' }: AlarmDialProps) {
  const { mode } = useTheme();
  const c = alarmPalette(level, 'restrained', mode, 'midnight');
  const lbl = TONE_SYSTEM.colors[level]?.label ?? '';

  if (variant === 'bars') {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 2, height: size * 0.6 }}>
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} style={{
            width: size * 0.09, height: (i + 1) * (size * 0.1),
            background: i <= level ? c.accent : 'rgba(255,255,255,0.09)',
            borderRadius: 1,
          }} />
        ))}
        {showLabel && <span style={{ marginLeft: 8, fontSize: size * 0.27, color: c.accent, fontWeight: 600, letterSpacing: '0.05em' }}>L{level} · {lbl}</span>}
      </div>
    );
  }

  if (variant === 'siren') {
    return (
      <div style={{ position: 'relative', width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: c.bg, border: `2px solid ${c.accent}` }} />
        {level >= 4 && (
          <div style={{ position: 'absolute', inset: -4, borderRadius: '50%', border: `2px solid ${c.accent}`, opacity: 0.3, animation: 'tt-pulse 1.6s ease-out infinite' }} />
        )}
        <span style={{ position: 'relative', fontSize: size * 0.42, fontWeight: 800, color: c.accent, fontFamily: "'JetBrains Mono', monospace" }}>{level}</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: size * 0.36, height: size * 0.36, borderRadius: '50%',
        background: c.accent, boxShadow: `0 0 0 3px ${c.bg}, 0 0 12px ${c.accent}40`,
      }} />
      {showLabel && (
        <span style={{ fontSize: 11, color: c.accent, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: "'JetBrains Mono', monospace" }}>
          L{level} · {lbl}
        </span>
      )}
    </div>
  );
}
