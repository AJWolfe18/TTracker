import { useTheme } from '@/hooks/useTheme';

export function EmptyState() {
  const { theme, headType } = useTheme();

  return (
    <section style={{ padding: '80px 0 60px', maxWidth: 640 }}>
      <div style={{ width: 56, height: 2, background: theme.dim, marginBottom: 14 }} />
      <div style={{ fontFamily: headType.mono, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.18em', color: theme.dim, fontWeight: 700, marginBottom: 18 }}>
        Quiet day · No entries yet
      </div>
      <h1 style={{
        fontFamily: headType.display, fontWeight: 600,
        fontSize: 'clamp(28px, 3.6vw, 44px)', lineHeight: 1.06,
        letterSpacing: '-0.02em', textWrap: 'balance',
        margin: 0, color: theme.ink,
      }}>
        Nothing on the wire. We'll have something the moment we do.
      </h1>
      <p style={{ fontFamily: headType.display, fontSize: 17, lineHeight: 1.55, color: theme.dim, marginTop: 18, maxWidth: 560, textWrap: 'pretty' }}>
        Subscribe and we'll send the next dispatch direct. No spam, no engagement bait, no urgency theater.
      </p>
      <div style={{ display: 'flex', gap: 10, marginTop: 28, flexWrap: 'wrap' }}>
        <input placeholder="your email" aria-label="Newsletter email" style={{
          flex: 1, minWidth: 220, background: theme.bg2, border: `1px solid ${theme.line}`,
          color: theme.ink, fontFamily: headType.mono, fontSize: 13, padding: '10px 14px',
          borderRadius: 2, outline: 'none',
        }} />
        <button style={{
          fontFamily: headType.mono, fontSize: 11, letterSpacing: '0.14em',
          padding: '10px 16px', border: `1px solid ${theme.ink}`, background: theme.ink,
          color: theme.bg, cursor: 'pointer', borderRadius: 2, fontWeight: 700, textTransform: 'uppercase',
        }}>Subscribe</button>
      </div>
    </section>
  );
}
