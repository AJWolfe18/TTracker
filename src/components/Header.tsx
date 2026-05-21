import { useTheme } from '@/hooks/useTheme';
import { Link } from 'wouter';
import { isTest } from '@/lib/supabase';

interface HeaderProps {
  current?: string;
  searchPlaceholder?: string;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
}

export function Header({ current, searchPlaceholder, searchQuery, onSearchChange }: HeaderProps) {
  const { theme, headType: type, mode, toggleMode } = useTheme();
  const isLight = mode === 'light';

  function handleSubscribeClick() {
    const el = document.getElementById('tt-newsletter-input');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
      setTimeout(() => el.focus(), 400);
    }
  }

  return (
    <header style={{
      borderBottom: `1px solid ${theme.line}`,
      background: isLight ? theme.paper : theme.bg,
      boxShadow: isLight ? '0 1px 3px rgba(0,0,0,0.05)' : 'none',
      position: 'sticky', top: 0, zIndex: 20,
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
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            TRUMPY<span style={{ color: theme.dim, fontWeight: 400 }}>/</span>TRACKER
            {isTest && (
              <span style={{
                fontFamily: type.mono, fontSize: 9, letterSpacing: '0.2em',
                padding: '2px 6px', background: '#f97316', color: '#0a0a0b',
                fontWeight: 700, borderRadius: 2, verticalAlign: 'super',
              }}>TEST</span>
            )}
          </div>
        </Link>
        <nav aria-label="Main navigation" style={{ display: 'flex', gap: 18, fontFamily: type.mono, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em' }} className="tt-nav">
          {[
            { label: 'Home', href: '/' },
            { label: 'Executive Orders', href: '/eos' },
            { label: 'Pardons', href: '/pardons' },
            { label: 'Supreme Court', href: '/scotus' },
            { label: 'About', href: '/about' },
          ].map(item => (
            <Link key={item.label} href={item.href}
              aria-current={current === item.label ? 'page' : undefined}
              style={{
                color: current === item.label ? theme.ink : theme.dim,
                textDecoration: 'none',
                borderBottom: current === item.label ? `1px solid ${theme.ink}` : '1px solid transparent',
                paddingBottom: 2,
              }}>{item.label}</Link>
          ))}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {onSearchChange && (
            <div style={{ position: 'relative' }}>
              <label htmlFor="tt-search" className="sr-only">
                {searchPlaceholder || 'Search...'}
              </label>
              <input
                id="tt-search"
                placeholder={searchPlaceholder || 'Search...'}
                value={searchQuery || ''}
                onChange={e => onSearchChange(e.target.value)}
                style={{
                  background: theme.bg2, border: `1px solid ${theme.line}`,
                  color: theme.ink, fontFamily: type.mono, fontSize: 12,
                  padding: '6px 26px 6px 10px', borderRadius: 2, width: 180, outline: 'none',
                }}
                className="tt-search"
              />
              {searchQuery && (
                <button
                  onClick={() => onSearchChange('')}
                  aria-label="Clear search"
                  style={{
                    position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                    border: 'none', background: 'none', color: theme.dim,
                    cursor: 'pointer', fontSize: 14, padding: '0 4px', lineHeight: 1,
                  }}
                >×</button>
              )}
            </div>
          )}
          <button
            onClick={toggleMode}
            aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
            title={isLight ? 'Dark mode' : 'Light mode'}
            style={{
              fontFamily: type.mono, fontSize: 10, letterSpacing: '0.14em',
              padding: '7px 12px',
              border: `1px solid ${theme.line}`, background: 'transparent',
              color: theme.ink, cursor: 'pointer', borderRadius: 2,
              textTransform: 'uppercase', fontWeight: 600,
            }}>
            {isLight ? 'Dark' : 'Light'}
          </button>
          <button
            onClick={handleSubscribeClick}
            className="tt-subscribe"
            style={{
              fontFamily: type.mono, fontSize: 10, letterSpacing: '0.14em',
              padding: '7px 12px', border: `1px solid ${theme.ink}`, background: 'transparent',
              color: theme.ink, cursor: 'pointer', borderRadius: 2, fontWeight: 600,
              textTransform: 'uppercase',
            }}>Subscribe</button>
        </div>
      </div>
      {/* Mobile nav */}
      <nav aria-label="Mobile navigation" className="tt-mobile-nav" style={{
        display: 'none', overflowX: 'auto', WebkitOverflowScrolling: 'touch',
        borderTop: `1px solid ${theme.line}`,
        padding: '8px 20px', gap: 16,
        fontFamily: type.mono, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em',
        width: '100%',
      }}>
        {[
          { label: 'Home', href: '/' },
          { label: 'EOs', href: '/eos' },
          { label: 'Pardons', href: '/pardons' },
          { label: 'SCOTUS', href: '/scotus' },
          { label: 'About', href: '/about' },
        ].map(item => (
          <Link key={item.label} href={item.href}
            aria-current={current === item.label || (item.label === 'EOs' && current === 'Executive Orders') || (item.label === 'SCOTUS' && current === 'Supreme Court') ? 'page' : undefined}
            style={{
              color: (current === item.label || (item.label === 'EOs' && current === 'Executive Orders') || (item.label === 'SCOTUS' && current === 'Supreme Court')) ? theme.ink : theme.dim,
              textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0,
            }}>{item.label}</Link>
        ))}
      </nav>
      <style>{`
        .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border-width: 0; }
        @media (max-width: 800px) {
          .tt-nav { display: none !important; }
          .tt-mobile-nav { display: flex !important; }
          .tt-search { display: none !important; }
          .tt-subscribe { display: none !important; }
        }
        @media (max-width: 480px) {
          .tt-search { display: none !important; }
        }
      `}</style>
    </header>
  );
}
