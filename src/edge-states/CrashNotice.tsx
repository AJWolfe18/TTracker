import { useContext } from 'react';
import { ThemeContext } from '@/hooks/useTheme';
import { resolveTheme, TYPOGRAPHY } from '@/tokens';

// What an ErrorBoundary shows (ADO-196). The root boundary sits outside the
// theme provider, so this never calls useTheme (it throws without one): it
// falls back to the mode index.html already put on <html>.

function fallbackMode(): 'dark' | 'light' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-mode') === 'light' ? 'light' : 'dark';
}

export function CrashNotice({ page = false }: { page?: boolean }) {
  const ctx = useContext(ThemeContext);
  const theme = ctx?.theme ?? resolveTheme('midnight', fallbackMode());
  const type = ctx?.headType ?? TYPOGRAPHY.editorial;
  // A plain link to this same URL is a full reload, which also picks up a
  // fresh build if a stale code chunk is what failed
  const here = typeof window === 'undefined' ? '/' : window.location.href;
  const Heading = page ? 'h1' : 'h2';

  const notice = (
    <section role="alert" style={{ padding: page ? '80px 20px 60px' : '48px 0', maxWidth: 640, margin: page ? '0 auto' : undefined }}>
      <div style={{ width: 56, height: 2, background: theme.dim, marginBottom: 14 }} />
      <div style={{ fontFamily: type.mono, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.18em', color: theme.dim, fontWeight: 700, marginBottom: 18 }}>
        Something broke
      </div>
      <Heading style={{
        fontFamily: type.display, fontWeight: 600,
        fontSize: page ? 'clamp(28px, 3.6vw, 44px)' : 'clamp(22px, 2.6vw, 30px)', lineHeight: 1.1,
        letterSpacing: '-0.02em', textWrap: 'balance', margin: 0, color: theme.ink,
      }}>
        {page ? 'This page hit an error.' : 'This section hit an error.'}
      </Heading>
      <p style={{ fontFamily: type.display, fontSize: 17, lineHeight: 1.55, color: theme.dim, marginTop: 14, maxWidth: 560 }}>
        Reloading usually fixes it.{' '}
        <a href={here} style={{ color: theme.ink, textDecoration: 'underline', textUnderlineOffset: 3 }}>
          Reload the page
        </a>
      </p>
    </section>
  );

  if (!page) return notice;
  return (
    <div style={{ background: theme.bg, color: theme.ink, fontFamily: type.sans, minHeight: '100vh' }}>
      <main id="main-content">{notice}</main>
    </div>
  );
}
