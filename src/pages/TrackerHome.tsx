import { useTheme } from '@/hooks/useTheme';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { TrackerSpine } from '@/components/TrackerSpine';

// The homepage when the rap_sheet flag is on (ADO-545, PRD §12 Q7 resolved):
// The Tracker IS the front page — tally + spine, per mockup rev 6. The story
// feed (hero/cards/filters) lives on its own Stories tab. The Scorecard strip
// is intentionally absent here: the tally is this page's number row.

export function TrackerHome() {
  const { theme, headType } = useTheme();

  return (
    <div style={{ background: theme.bg, color: theme.ink, fontFamily: headType.sans, minHeight: '100vh' }}>
      <Header current="Home" />
      <main id="main-content" style={{ maxWidth: 1400, margin: '0 auto', padding: '0 20px' }}>
        <TrackerSpine standalone />
        <Footer />
      </main>
    </div>
  );
}
