import { useTheme } from '@/hooks/useTheme';
import { Link } from 'wouter';

export function Header({ current }: { current?: string }) {
  const { theme, headType: type, mode, toggleMode } = useTheme();
  const isLight = mode === 'light';

  return (
    <header style={{
      borderBottom: `1px solid ${theme.line}`,
      background: theme.bg, position: 'sticky', top: 0, zIndex: 20,
    }}>
      <a href="#main-content" className="skip-link">Skip to content</a>
      <div style={{
        maxWidth: 1440, margin: '0 auto', padding: '14px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24,
      }}>
        <Link href="/" style={{ textDecoration: 'none' }}>
          <div style={{
            fontFamily: type.display, fontWeight: 700, fontSize: 20,
            letterSpacing: type.displayTracking, color: theme.ink,
          }}>
            TRUMPY<span style={{ color: theme.dim, fontWeight: 400 }}>/</span>TRACKER
          </div>
        </Link>
        <nav aria-label="Main navigation" style={{ display: 'flex', gap: 18, fontFamily: type.mono, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em' }} className="tt-nav">
          {[
            { label: 'Home', href: '/' },
            { label: 'Stories', href: '/?filter=stories' },
            { label: 'EOs', href: '/?filter=eos' },
            { label: 'SCOTUS', href: '/?filter=scotus' },
            { label: 'Pardons', href: '/?filter=pardons' },
            { label: 'About', href: '/about' },
          ].map(item => (
            <Link key={item.label} href={item.href} style={{
              color: current === item.label ? theme.ink : theme.dim,
              textDecoration: 'none',
              borderBottom: current === item.label ? `1px solid ${theme.ink}` : '1px solid transparent',
              paddingBottom: 2,
            }}>{item.label}</Link>
          ))}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            placeholder="Search..."
            aria-label="Search stories"
            style={{
              background: theme.bg2, border: `1px solid ${theme.line}`,
              color: theme.ink, fontFamily: type.mono, fontSize: 12,
              padding: '6px 10px', borderRadius: 2, width: 160, outline: 'none',
            }}
            className="tt-search"
          />
          <button
            onClick={toggleMode}
            aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
            title={isLight ? 'Dark mode' : 'Light mode'}
            style={{
              fontFamily: type.mono, fontSize: 12, padding: '7px 9px',
              border: `1px solid ${theme.line}`, background: 'transparent',
              color: theme.ink, cursor: 'pointer', borderRadius: 2,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              minWidth: 30, height: 30,
            }}>
            {isLight ? '☾' : '☀'}
          </button>
          <button style={{
            fontFamily: type.mono, fontSize: 10, letterSpacing: '0.14em',
            padding: '7px 12px', border: `1px solid ${theme.ink}`, background: 'transparent',
            color: theme.ink, cursor: 'pointer', borderRadius: 2, fontWeight: 600,
            textTransform: 'uppercase',
          }}>Subscribe</button>
        </div>
      </div>
      <style>{`
        @media (max-width: 800px) {
          .tt-nav { display: none !important; }
          .tt-search { display: none !important; }
        }
        @media (max-width: 480px) {
          .tt-search { display: none !important; }
        }
      `}</style>
    </header>
  );
}
