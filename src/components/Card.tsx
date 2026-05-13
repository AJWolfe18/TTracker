import { TONE_SYSTEM, alarmPalette } from '@/tokens';
import { useTheme } from '@/hooks/useTheme';
import { relDate } from '@/lib/date-utils';
import { pickHeadline } from '@/lib/pick-headline';
import type { DisplayItem } from '@/types';

interface CardProps {
  item: DisplayItem;
  headlineMode: string;
  onOpen: (id: string | number) => void;
  featured?: boolean;
}

export function Card({ item, headlineMode, onOpen, featured }: CardProps) {
  const { theme, headType, bodyType, mode } = useTheme();
  const c = alarmPalette(item.alarm, 'restrained', mode, 'midnight');

  return (
    <article
      tabIndex={0}
      role="link"
      aria-label={pickHeadline(item, headlineMode)}
      onClick={() => onOpen(item.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(item.id); } }}
      style={{
        cursor: 'pointer', position: 'relative',
        background: theme.paper, border: `1px solid ${theme.line}`,
        padding: '0 22px 18px',
        transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.15s',
        gridColumn: featured ? '1 / -1' : 'auto',
        minHeight: featured ? 240 : 220,
        display: 'flex', flexDirection: 'column',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-1px)';
        e.currentTarget.style.boxShadow = '0 6px 18px rgba(0,0,0,0.18)';
        e.currentTarget.style.borderColor = theme.dim;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.borderColor = theme.line;
      }}>
      <div style={{ height: 2, background: c.accent, margin: '0 -22px 16px' }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, fontFamily: headType.mono, fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
        <span style={{ color: c.accent, fontWeight: 700 }}>
          L{item.alarm} · {TONE_SYSTEM.labels[item.type]?.[item.alarm]?.spicy}
        </span>
        <span style={{ color: theme.dim }}>{TONE_SYSTEM.typeLabels[item.type]}</span>
      </div>

      <h3 style={{
        fontFamily: bodyType.display, fontWeight: bodyType.displayWeight,
        fontSize: featured ? 34 : 22, lineHeight: 1.05,
        letterSpacing: bodyType.displayTracking, textWrap: 'balance',
        margin: '4px 0 12px', color: theme.ink, textTransform: 'uppercase',
      }}>
        {pickHeadline(item, headlineMode)}
      </h3>

      {featured && (
        <p style={{
          fontFamily: headType.display, fontSize: 17, lineHeight: 1.45,
          color: theme.dim, margin: '0 0 18px', maxWidth: 760, textWrap: 'pretty',
        }}>{item.dek}</p>
      )}

      <div style={{
        marginTop: 'auto', paddingTop: 12, borderTop: `1px dashed ${theme.line}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontFamily: headType.mono, fontSize: 10, color: theme.dim,
        textTransform: 'uppercase', letterSpacing: '0.12em',
      }}>
        <span>{item.category}</span>
        <span>{relDate(item.updated)} · {item.sources.length} src</span>
      </div>
    </article>
  );
}
