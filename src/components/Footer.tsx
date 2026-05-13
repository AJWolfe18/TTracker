import { useTheme } from '@/hooks/useTheme';

export function Footer() {
  const { theme, headType: type } = useTheme();

  return (
    <footer style={{ padding: '56px 0 40px', marginTop: 40, borderTop: `1px solid ${theme.line}` }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 40 }} className="tt-footer-grid">
        <div>
          <div style={{ fontFamily: type.display, fontWeight: 700, fontSize: 22, color: theme.ink, letterSpacing: type.displayTracking, marginBottom: 10 }}>
            TrumpyTracker
          </div>
          <p style={{ fontFamily: type.sans, fontSize: 14, color: theme.dim, lineHeight: 1.55, maxWidth: 360 }}>
            A daily accountability log. Sourced, cited, updated. We publish both the spicy headline and the neutral one — your choice which to share.
          </p>
          <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
            <input placeholder="your email" aria-label="Newsletter email" style={{ flex: 1, maxWidth: 240, background: theme.bg2, border: `1px solid ${theme.line}`, color: theme.ink, fontFamily: type.mono, fontSize: 12, padding: '8px 12px', borderRadius: 2, outline: 'none' }} />
            <button style={{ fontFamily: type.mono, fontSize: 10, letterSpacing: '0.14em', padding: '8px 14px', border: 'none', background: theme.ink, color: theme.bg, cursor: 'pointer', borderRadius: 2, fontWeight: 700, textTransform: 'uppercase' }}>Get the newsletter</button>
          </div>
        </div>
        {([
          ['Tracking', ['Stories', 'Executive Orders', 'SCOTUS', 'Pardons']],
          ['The Site', ['About', 'Editorial Standards', 'Contact', 'RSS']],
          ['Legal', ['Sources', 'Corrections', 'Privacy', 'Fair Use']],
        ] as const).map(([title, links]) => (
          <div key={title}>
            <div style={{ fontFamily: type.mono, fontSize: 10, color: theme.dim, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 14 }}>{title}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {links.map(l => <a key={l} href="#" style={{ fontFamily: type.sans, fontSize: 13, color: theme.ink, textDecoration: 'none' }}>{l}</a>)}
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 40, paddingTop: 20, borderTop: `1px solid ${theme.line}`, fontFamily: type.mono, fontSize: 10, color: theme.dim, display: 'flex', justifyContent: 'space-between', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        <span>© 2026 TrumpyTracker · reader-supported</span>
        <span>last updated: {new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
      </div>
      <style>{`@media (max-width: 800px) { .tt-footer-grid { grid-template-columns: 1fr 1fr !important; } }`}</style>
    </footer>
  );
}
