import { useState } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { TONE_SYSTEM, alarmPalette } from '@/tokens';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { ShareCardPreview } from '@/components/ShareCard';
import { fmtDate } from '@/lib/date-utils';
import { pickHeadline } from '@/lib/pick-headline';
import type { DisplayItem } from '@/types';
import { Link } from 'wouter';

interface DetailProps {
  item: DisplayItem | null;
  loading: boolean;
  onOpenItem: (id: string | number) => void;
  relatedItems: DisplayItem[];
}

export function Detail({ item, loading, onOpenItem, relatedItems }: DetailProps) {
  const { theme, headType: type, mode } = useTheme();
  const [hmode, setHmode] = useState('spicy');
  const [showShare, setShowShare] = useState(false);

  if (loading || !item) {
    return (
      <div style={{ background: theme.bg, color: theme.ink, fontFamily: type.sans, minHeight: '100vh' }}>
        <Header />
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '48px 20px', color: theme.dim }}>
          {loading ? 'Loading...' : 'Story not found.'}
        </div>
      </div>
    );
  }

  const c = alarmPalette(item.alarm, 'restrained', mode, 'midnight');

  return (
    <div style={{ background: theme.bg, color: theme.ink, fontFamily: type.sans, minHeight: '100vh' }}>
      <Header />
      <main id="main-content" style={{ maxWidth: 820, margin: '0 auto', padding: '0 20px' }}>
        <Link href="/">
          <button style={{
            fontFamily: type.mono, fontSize: 11, letterSpacing: '0.12em',
            padding: '8px 0', border: 'none', background: 'transparent', color: theme.dim,
            cursor: 'pointer', textTransform: 'uppercase', marginTop: 20,
          }}>← Back to dispatch</button>
        </Link>

        <article style={{ padding: '32px 0 48px' }}>
          {/* Kicker B */}
          <div style={{ marginBottom: 22 }}>
            <div style={{ width: 56, height: 2, background: c.accent, marginBottom: 12 }} />
            <div style={{ fontFamily: type.mono, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.18em', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ color: c.accent, fontWeight: 700 }}>Level {item.alarm} · {TONE_SYSTEM.colors[item.alarm]?.label}</span>
              <span style={{ color: theme.dim }}>·</span>
              <span style={{ color: theme.dim }}>{TONE_SYSTEM.typeLabels[item.type]}</span>
              <span style={{ color: theme.dim }}>·</span>
              <span style={{ color: theme.dim }}>{TONE_SYSTEM.labels[item.type]?.[item.alarm]?.spicy}</span>
              <span style={{ color: theme.dim }}>·</span>
              <span style={{ color: theme.dim }}>{item.category}</span>
              <span style={{ color: theme.dim }}>·</span>
              <span style={{ color: theme.dim }}>{fmtDate(item.published)}</span>
            </div>
          </div>

          <h1 style={{
            fontFamily: type.display, fontWeight: type.displayWeight,
            fontSize: 'clamp(32px, 4.4vw, 52px)', lineHeight: 1.05,
            letterSpacing: type.displayTracking, textWrap: 'balance', margin: 0,
          }}>
            {pickHeadline(item, hmode)}
          </h1>

          {/* Headline toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginTop: 22, border: `1px solid ${theme.line}`, borderRadius: 2, overflow: 'hidden', width: 'fit-content', fontFamily: type.mono, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            {([['spicy', 'Spicy'], ['neutral', 'Neutral']] as const).map(([k, lbl]) => (
              <button key={k} onClick={() => setHmode(k)} style={{
                padding: '8px 14px', border: 'none',
                background: hmode === k ? theme.ink : 'transparent',
                color: hmode === k ? theme.bg : theme.dim, cursor: 'pointer',
              }}>{lbl}</button>
            ))}
          </div>

          <p style={{ fontFamily: type.display, fontWeight: 400, fontSize: 22, lineHeight: 1.45, color: theme.dim, marginTop: 28, textWrap: 'pretty' }}>
            {item.dek}
          </p>

          <div style={{ fontFamily: type.display, fontSize: 18, lineHeight: 1.65, color: theme.ink, marginTop: 28, textWrap: 'pretty' }}>
            {item.body}
          </div>

          {/* Action row */}
          <div style={{ display: 'flex', gap: 10, marginTop: 36, flexWrap: 'wrap' }}>
            <button onClick={() => setShowShare(!showShare)} style={{ fontFamily: type.mono, fontSize: 11, letterSpacing: '0.14em', padding: '10px 16px', border: `1px solid ${theme.ink}`, background: theme.ink, color: theme.bg, cursor: 'pointer', borderRadius: 2, fontWeight: 700, textTransform: 'uppercase' }}>
              ↗ Generate Share Card
            </button>
            <button
              onClick={() => navigator.clipboard.writeText(window.location.href)}
              style={{ fontFamily: type.mono, fontSize: 11, letterSpacing: '0.14em', padding: '10px 16px', border: `1px solid ${theme.line}`, background: 'transparent', color: theme.ink, cursor: 'pointer', borderRadius: 2, textTransform: 'uppercase' }}>
              Copy Link
            </button>
            <a
              href={`mailto:corrections@trumpytracker.com?subject=Correction: ${encodeURIComponent(item.headline_neutral)}&body=Story ID: ${item.id}%0A%0AWhich claim is incorrect:%0A%0ACorrect information:%0A%0ASource URL:`}
              style={{ textDecoration: 'none' }}>
              <button style={{ fontFamily: type.mono, fontSize: 11, letterSpacing: '0.14em', padding: '10px 16px', border: `1px solid ${theme.line}`, background: 'transparent', color: theme.ink, cursor: 'pointer', borderRadius: 2, textTransform: 'uppercase' }}>
                Report Correction
              </button>
            </a>
          </div>

          {showShare && <ShareCardPreview item={item} hmode={hmode} />}

          {/* Sources */}
          {item.sources.length > 0 && (
            <section style={{ marginTop: 48, padding: '24px 24px', background: theme.bg2, border: `1px solid ${theme.line}`, borderRadius: 2 }}>
              <div style={{ fontFamily: type.mono, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.15em', color: theme.dim, marginBottom: 14 }}>
                Primary Sources · every claim cited
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {item.sources.map((src, i) => (
                  <a key={i} href={src.url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: theme.bg, border: `1px solid ${theme.line}`, borderRadius: 2, color: theme.ink, textDecoration: 'none', fontFamily: type.mono, fontSize: 12 }}>
                    <span style={{ color: c.accent, fontWeight: 700 }}>[{(i + 1).toString().padStart(2, '0')}]</span>
                    <span style={{ flex: 1 }}>{src.label}</span>
                    <span style={{ color: theme.dim }}>↗</span>
                  </a>
                ))}
              </div>
            </section>
          )}

          {/* Tags */}
          {item.tags.length > 0 && (
            <div style={{ marginTop: 28, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {item.tags.map(t => (
                <span key={t} style={{ fontFamily: type.mono, fontSize: 11, padding: '5px 10px', border: `1px solid ${theme.line}`, color: theme.dim, borderRadius: 2 }}>
                  #{t}
                </span>
              ))}
            </div>
          )}

          {/* Related */}
          {relatedItems.length > 0 && (
            <section style={{ marginTop: 56, paddingTop: 32, borderTop: `1px solid ${theme.line}` }}>
              <div style={{ fontFamily: type.mono, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.15em', color: theme.dim, marginBottom: 18 }}>Keep Reading</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }} className="tt-related">
                {relatedItems.map(r => {
                  const rc = alarmPalette(r.alarm, 'restrained', mode, 'midnight');
                  return (
                    <div key={r.id} onClick={() => onOpenItem(r.id)} style={{ cursor: 'pointer', padding: '16px 0', borderTop: `2px solid ${rc.accent}` }}>
                      <div style={{ fontFamily: type.mono, fontSize: 10, color: rc.accent, letterSpacing: '0.14em', fontWeight: 700, marginBottom: 8 }}>L{r.alarm} · {TONE_SYSTEM.typeLabels[r.type]}</div>
                      <div style={{ fontFamily: type.display, fontWeight: 600, fontSize: 16, lineHeight: 1.2, color: theme.ink, textWrap: 'balance' }}>{pickHeadline(r, hmode)}</div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </article>
        <Footer />
      </main>
      <style>{`@media (max-width: 700px) { .tt-related { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
