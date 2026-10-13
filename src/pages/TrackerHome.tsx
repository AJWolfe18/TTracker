import { useEffect, useState } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { TrackerSpine } from '@/components/TrackerSpine';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { CrashNotice } from '@/edge-states/CrashNotice';

// The homepage when the rap_sheet flag is on (ADO-545, PRD §12 Q7 resolved):
// The Tracker IS the front page — tally + spine, per mockup rev 6. The story
// feed (hero/cards/filters) lives on its own News tab. The Scorecard strip
// is intentionally absent here: the tally is this page's number row.

/**
 * Counts navigations, including clicking Home or the logo while already on
 * "/". wouter has no location key and its path does not change there, but
 * its Link still pushes history (wouter patches pushState to fire an event).
 */
function useNavigationCount(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const bump = () => setN(c => c + 1);
    addEventListener('pushState', bump);
    addEventListener('popstate', bump);
    return () => {
      removeEventListener('pushState', bump);
      removeEventListener('popstate', bump);
    };
  }, []);
  return n;
}

export function TrackerHome() {
  const { theme, headType } = useTheme();
  const navCount = useNavigationCount();

  return (
    <div style={{ background: theme.bg, color: theme.ink, fontFamily: headType.sans, minHeight: '100vh' }}>
      <Header current="Home" />
      <main id="main-content" style={{ maxWidth: 1400, margin: '0 auto', padding: '0 20px' }}>
        {/* A spine crash keeps the header and footer; clicking Home tries again (ADO-196) */}
        <ErrorBoundary resetKey={navCount} fallback={<CrashNotice />}>
          <TrackerSpine standalone />
        </ErrorBoundary>
        <Footer />
      </main>
    </div>
  );
}
