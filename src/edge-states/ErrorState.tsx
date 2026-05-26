import { useTheme } from '@/hooks/useTheme';
import { alarmPalette } from '@/tokens';

export function ErrorState() {
  const { theme, headType, mode } = useTheme();
  const c5 = alarmPalette(5, 'restrained', mode, 'midnight');

  return (
    <section role="alert" style={{ padding: '80px 0 60px', maxWidth: 640 }}>
      <div style={{ width: 56, height: 2, background: c5.accent, marginBottom: 14 }} />
      <div style={{ fontFamily: headType.mono, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.18em', color: c5.accent, fontWeight: 700, marginBottom: 18 }}>
        Service Disruption · Try again
      </div>
      <h1 style={{
        fontFamily: headType.display, fontWeight: 600,
        fontSize: 'clamp(28px, 3.6vw, 44px)', lineHeight: 1.06,
        letterSpacing: '-0.02em', textWrap: 'balance',
        margin: 0, color: theme.ink,
      }}>
        The dispatch didn't load. We're not going to pretend that's fine.
      </h1>
      <p style={{ fontFamily: headType.display, fontSize: 17, lineHeight: 1.55, color: theme.dim, marginTop: 18, maxWidth: 560, textWrap: 'pretty' }}>
        Something between you and the server broke. The site is up; the connection isn't. Try the reload button below, or check back in a minute.
      </p>
      <div style={{ display: 'flex', gap: 10, marginTop: 28, flexWrap: 'wrap' }}>
        <button onClick={() => location.reload()} style={{
          fontFamily: headType.mono, fontSize: 11, letterSpacing: '0.14em',
          padding: '10px 16px', border: `1px solid ${theme.ink}`, background: theme.ink,
          color: theme.bg, cursor: 'pointer', borderRadius: 2, fontWeight: 700, textTransform: 'uppercase',
        }}>Reload dispatch</button>
        <button style={{
          fontFamily: headType.mono, fontSize: 11, letterSpacing: '0.14em',
          padding: '10px 16px', border: `1px solid ${theme.line}`, background: 'transparent',
          color: theme.ink, cursor: 'pointer', borderRadius: 2, textTransform: 'uppercase',
        }}>Status page</button>
      </div>
    </section>
  );
}
