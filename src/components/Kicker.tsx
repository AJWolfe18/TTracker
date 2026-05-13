import { TONE_SYSTEM, type TypographySet, type ThemePalette } from '@/tokens';

interface DisplayItem {
  alarm: number;
  type: string;
}

interface KickerProps {
  theme: ThemePalette;
  type: TypographySet;
  item: DisplayItem;
  accent: string;
}

export function Kicker({ theme, type, item, accent }: KickerProps) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ width: 56, height: 2, background: accent, marginBottom: 10 }} />
      <div style={{
        fontFamily: type.mono, fontSize: 11, textTransform: 'uppercase',
        letterSpacing: '0.18em', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
      }}>
        <span style={{ color: accent, fontWeight: 700 }}>
          Level {item.alarm} · {TONE_SYSTEM.colors[item.alarm]?.label}
        </span>
        <span style={{ color: theme.dim }}>·</span>
        <span style={{ color: theme.dim }}>{TONE_SYSTEM.typeLabels[item.type]}</span>
        <span style={{ color: theme.dim }}>·</span>
        <span style={{ color: theme.dim }}>{TONE_SYSTEM.labels[item.type]?.[item.alarm]?.spicy}</span>
      </div>
    </div>
  );
}
