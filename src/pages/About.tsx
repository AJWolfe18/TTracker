import { useTheme } from '@/hooks/useTheme';
import { TONE_SYSTEM, alarmPalette } from '@/tokens';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { Link } from 'wouter';

export function About() {
  const { theme, headType: type, mode } = useTheme();

  return (
    <div style={{ background: theme.bg, color: theme.ink, fontFamily: type.sans, minHeight: '100vh' }}>
      <Header current="About" />
      <main id="main-content" style={{ maxWidth: 760, margin: '0 auto', padding: '48px 20px' }}>
        <Link href="/">
          <button style={{ fontFamily: type.mono, fontSize: 11, letterSpacing: '0.12em', padding: '8px 0', border: 'none', background: 'transparent', color: theme.dim, cursor: 'pointer', textTransform: 'uppercase', marginBottom: 24 }}>← Home</button>
        </Link>

        <h1 style={{ fontFamily: type.display, fontWeight: type.displayWeight, fontSize: 'clamp(40px, 6vw, 72px)', lineHeight: 1, letterSpacing: type.displayTracking, margin: 0, textWrap: 'balance' }}>
          We keep the receipts.
        </h1>
        <p style={{ fontFamily: type.display, fontSize: 22, lineHeight: 1.45, color: theme.dim, marginTop: 24, textWrap: 'pretty' }}>
          TrumpyTracker is a daily accountability log for the Trump administration. Every item is sourced, dated, and graded on a six-level alarm scale. No both-sidesing. No "observers are divided." If it's bullshit, we say so — and we show you why.
        </p>

        <h2 style={{ fontFamily: type.display, fontWeight: 600, fontSize: 28, letterSpacing: type.displayTracking, marginTop: 56, marginBottom: 16 }}>How the alarm scale works</h2>
        <p style={{ fontFamily: type.display, fontSize: 17, lineHeight: 1.6, color: theme.ink, marginBottom: 20 }}>
          Every entry gets a severity grade. The grade drives the tone — Level 5 gets the full cold fury; Level 0 gets cautious celebration.
        </p>
        <div style={{ display: 'grid', gap: 10, marginTop: 20 }}>
          {[5, 4, 3, 2, 1, 0].map(lvl => {
            const c = alarmPalette(lvl, 'restrained', mode, 'midnight');
            return (
              <div key={lvl} style={{ display: 'grid', gridTemplateColumns: '8px 120px 1fr', gap: 18, alignItems: 'center', padding: '16px 0', borderBottom: `1px solid ${theme.line}` }}>
                <div style={{ width: 4, height: 36, background: c.accent }} />
                <div style={{ fontFamily: type.mono, fontWeight: 700, fontSize: 12, color: c.accent, letterSpacing: '0.15em', textTransform: 'uppercase' }}>L{lvl} · {TONE_SYSTEM.colors[lvl]?.label}</div>
                <div style={{ fontFamily: type.sans, fontSize: 14, color: theme.ink, lineHeight: 1.45 }}>
                  {lvl === 5 && "Cold fury. Constitutional crisis territory. Profanity for incredulity. 'They actually did it.'"}
                  {lvl === 4 && "Suspicious, pointed. Name names. Focus on victims and beneficiaries."}
                  {lvl === 3 && "Sardonic critique. 'Seen this before' energy. Dark humor, let absurdity speak."}
                  {lvl === 2 && "Eye-roll. Measured critique of system dysfunction."}
                  {lvl === 1 && "Cautious skepticism. Credit where due, but flag the asterisk."}
                  {lvl === 0 && "Suspicious celebration. Genuine disbelief the system worked. Don't get used to it."}
                </div>
              </div>
            );
          })}
        </div>

        <h2 style={{ fontFamily: type.display, fontWeight: 600, fontSize: 28, letterSpacing: type.displayTracking, marginTop: 56, marginBottom: 16 }}>Four beats, four voices</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 16 }} className="tt-about-beats">
          {(['stories', 'eos', 'scotus', 'pardons'] as const).map(k => {
            const l = TONE_SYSTEM.labels[k];
            return (
              <div key={k} style={{ padding: '20px 22px', background: theme.bg2, border: `1px solid ${theme.line}`, borderRadius: 2 }}>
                <div style={{ fontFamily: type.mono, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.15em', color: theme.dim, marginBottom: 8 }}>{TONE_SYSTEM.typeLabels[k]}</div>
                <div style={{ fontFamily: type.display, fontWeight: 700, fontSize: 22, color: theme.ink, letterSpacing: type.displayTracking, marginBottom: 8 }}>{l.voice}</div>
                <div style={{ fontFamily: type.display, fontSize: 15, fontStyle: 'italic', color: theme.dim, lineHeight: 1.5 }}>"{l.framing}"</div>
              </div>
            );
          })}
        </div>

        <h2 style={{ fontFamily: type.display, fontWeight: 600, fontSize: 28, letterSpacing: type.displayTracking, marginTop: 56, marginBottom: 16 }}>Editorial rules</h2>
        <ul style={{ fontFamily: type.display, fontSize: 17, lineHeight: 1.7, color: theme.ink, paddingLeft: 20 }}>
          <li>Every claim links to a primary source. Every one.</li>
          <li>We publish both a spicy and a neutral headline. Share whichever you prefer.</li>
          <li>Corrections are logged publicly. Mistakes happen; cover-ups shouldn't.</li>
          <li>We don't both-sides. We don't "it remains to be seen." We don't "observers note."</li>
          <li>If we got it wrong, tell us. If you need us to pull a name for safety, tell us faster.</li>
        </ul>

        <div style={{ marginTop: 56, padding: '32px 28px', background: theme.bg2, border: `1px solid ${theme.line}`, borderRadius: 2 }}>
          <div style={{ fontFamily: type.mono, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.15em', color: theme.dim, marginBottom: 10 }}>Stay current</div>
          <div style={{ fontFamily: type.display, fontWeight: 600, fontSize: 22, letterSpacing: type.displayTracking, marginBottom: 14 }}>
            One email a week. The five things you should not miss.
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input placeholder="your email" aria-label="Newsletter email" style={{ flex: 1, minWidth: 220, background: theme.bg, border: `1px solid ${theme.line}`, color: theme.ink, fontFamily: type.mono, fontSize: 13, padding: '10px 14px', borderRadius: 2, outline: 'none' }} />
            <button style={{ fontFamily: type.mono, fontSize: 11, letterSpacing: '0.14em', padding: '10px 16px', border: `1px solid ${theme.ink}`, background: theme.ink, color: theme.bg, cursor: 'pointer', borderRadius: 2, fontWeight: 700, textTransform: 'uppercase' }}>Subscribe</button>
          </div>
        </div>
        <Footer />
      </main>
      <style>{`@media (max-width: 700px) { .tt-about-beats { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
