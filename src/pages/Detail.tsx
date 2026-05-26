import { useState, useEffect } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { TONE_SYSTEM, alarmPalette } from '@/tokens';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { ShareCardPreview } from '@/components/ShareCard';
import { fmtDate } from '@/lib/date-utils';
import { pickHeadline } from '@/lib/pick-headline';
import type { DisplayItem, TimelineEvent } from '@/types';
import type { ThemePalette } from '@/tokens/themes';
import { Link } from 'wouter';

interface DetailProps {
  item: DisplayItem | null;
  loading: boolean;
  onOpenItem: (id: string | number) => void;
  relatedItems: DisplayItem[];
}

export function Detail({ item, loading, onOpenItem, relatedItems }: DetailProps) {
  const { theme, headType: type, mode } = useTheme();
  const hmode = 'spicy';
  const [showShare, setShowShare] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

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

  const correctionSubject = `Correction: ${item.headline_neutral}`;
  const correctionBody = `Story ID: ${item.id}\n\nWhich claim is incorrect:\n\nCorrect information:\n\nSource URL:`;
  const mailtoHref = `mailto:corrections@trumpytracker.com?subject=${encodeURIComponent(correctionSubject)}&body=${encodeURIComponent(correctionBody)}`;

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div style={{ background: theme.bg, color: theme.ink, fontFamily: type.sans, minHeight: '100vh' }}>
      <Header />
      <main id="main-content" style={{ maxWidth: 820, margin: '0 auto', padding: '0 20px' }}>
        <Link href="/">
          <button style={{
            fontFamily: type.mono, fontSize: 11, letterSpacing: '0.12em',
            padding: '8px 0', border: 'none', background: 'transparent', color: theme.dim,
            cursor: 'pointer', textTransform: 'uppercase', marginTop: 20,
          }}>&larr; Back to dispatch</button>
        </Link>

        <article style={{ padding: '32px 0 48px' }}>
          {/* Kicker B */}
          <div style={{ marginBottom: 22 }}>
            <div style={{ width: 56, height: 2, background: c.accent, marginBottom: 12 }} />
            <div style={{ fontFamily: type.mono, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.18em', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ color: c.accent, fontWeight: 700 }}>{TONE_SYSTEM.labels[item.type]?.[item.alarm]?.spicy}</span>
              <span style={{ color: theme.dim }}>&middot;</span>
              <span style={{ color: theme.dim }}>{TONE_SYSTEM.typeLabels[item.type]}</span>
              <span style={{ color: theme.dim }}>&middot;</span>
              <span style={{ color: theme.dim }}>{item.category}</span>
              <span style={{ color: theme.dim }}>&middot;</span>
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

          {item.dek && (
            <p style={{ fontFamily: type.display, fontWeight: 400, fontSize: 22, lineHeight: 1.45, color: theme.dim, marginTop: 28, textWrap: 'pretty' }}>
              {item.dek}
            </p>
          )}

          {/* Body text (for stories that have plain body) */}
          {item.body && (
            <div style={{ fontFamily: type.display, fontSize: 18, lineHeight: 1.65, color: theme.ink, marginTop: 28, textWrap: 'pretty' }}>
              {item.body}
            </div>
          )}

          {/* Meta grid (SCOTUS vote split, Pardons corruption level, etc.) */}
          {item.meta && item.meta.length > 0 && (
            <div className="tt-meta-grid" style={{
              marginTop: 32, padding: '20px 24px', background: theme.bg2,
              border: `1px solid ${theme.line}`, borderRadius: 2,
              display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px 32px',
            }}>
              {item.meta.map((m, i) => (
                <div key={i}>
                  <div style={{ fontFamily: type.mono, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.15em', color: theme.dim, marginBottom: 6 }}>
                    {m.label}
                  </div>
                  {m.label === 'Corruption Level' ? (
                    <CorruptionBar value={m.value} accent={c.accent} dim={theme.line} />
                  ) : (
                    <div style={{ fontFamily: type.sans, fontSize: 16, fontWeight: 600, color: theme.ink, lineHeight: 1.4 }}>
                      {m.value}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Sections (EO editorial sections, SCOTUS dissent, Pardons detail) */}
          {item.sections && item.sections.length > 0 && (
            <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 28 }}>
              {item.sections.map((s, i) => {
                if (s.heading === 'The Receipts' && item.timelineEvents && item.timelineEvents.length > 0) {
                  return (
                    <section key={i}>
                      <h3 style={{
                        fontFamily: type.display, fontSize: 20, fontWeight: 700,
                        color: theme.ink, marginBottom: 14, marginTop: 0,
                        borderBottom: `3px solid ${c.accent}`, paddingBottom: 10,
                      }}>
                        {s.heading}
                      </h3>
                      <ReceiptsTimeline events={item.timelineEvents} theme={theme} type={type} />
                    </section>
                  );
                }
                return (
                  <section key={i}>
                    <h3 style={{
                      fontFamily: type.display, fontSize: 20, fontWeight: 700,
                      color: theme.ink, marginBottom: 14, marginTop: 0,
                      borderBottom: `3px solid ${c.accent}`, paddingBottom: 10,
                    }}>
                      {s.heading}
                    </h3>
                    <div style={{ fontFamily: type.display, fontSize: 17, lineHeight: 1.65, color: theme.ink, textWrap: 'pretty' }}>
                      {s.content}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {/* Action row */}
          <div style={{ display: 'flex', gap: 10, marginTop: 36, flexWrap: 'wrap' }}>
            <button onClick={() => setShowShare(!showShare)} style={{ fontFamily: type.mono, fontSize: 11, letterSpacing: '0.14em', padding: '10px 16px', border: `1px solid ${theme.ink}`, background: theme.ink, color: theme.bg, cursor: 'pointer', borderRadius: 2, fontWeight: 700, textTransform: 'uppercase' }}>
              ↗ Generate Share Card
            </button>
            <button
              onClick={handleCopyLink}
              style={{ fontFamily: type.mono, fontSize: 11, letterSpacing: '0.14em', padding: '10px 16px', border: `1px solid ${theme.line}`, background: 'transparent', color: copied ? '#4ade80' : theme.ink, cursor: 'pointer', borderRadius: 2, textTransform: 'uppercase', transition: 'color 0.2s' }}>
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
            <a
              href={mailtoHref}
              style={{ textDecoration: 'none', fontFamily: type.mono, fontSize: 11, letterSpacing: '0.14em', padding: '10px 16px', border: `1px solid ${theme.line}`, background: 'transparent', color: theme.ink, cursor: 'pointer', borderRadius: 2, textTransform: 'uppercase', display: 'inline-block' }}>
              Report Correction
            </a>
          </div>

          {showShare && <ShareCardPreview item={item} hmode={hmode} />}

          {/* Sources */}
          {item.sources.length > 0 && (
            <section style={{ marginTop: 48, padding: '24px 24px', background: theme.bg2, border: `1px solid ${theme.line}`, borderRadius: 2 }}>
              <div style={{ fontFamily: type.mono, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.15em', color: theme.dim, marginBottom: 14 }}>
                Primary Sources &middot; every claim cited
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
                      <div style={{ fontFamily: type.mono, fontSize: 10, color: rc.accent, letterSpacing: '0.14em', fontWeight: 700, marginBottom: 8 }}>{TONE_SYSTEM.typeLabels[r.type]}</div>
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
      <style>{`
        @media (max-width: 700px) {
          .tt-related { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 500px) {
          .tt-meta-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

const TIMELINE_COLORS: Record<string, string> = {
  donation: '#6b7280',
  conviction: '#6b7280',
  pardon_request: '#6b7280',
  pardon_granted: '#6b7280',
  mar_a_lago_visit: '#6b7280',
  sentencing: '#6b7280',
  investigation: '#6b7280',
  legal_filing: '#6b7280',
  other: '#6b7280',
};

const TIMELINE_LABELS: Record<string, string> = {
  donation: 'Donation',
  conviction: 'Conviction',
  pardon_request: 'Pardon Request',
  pardon_granted: 'Pardon Granted',
  mar_a_lago_visit: 'Mar-a-Lago Visit',
  sentencing: 'Sentencing',
  investigation: 'Investigation',
  legal_filing: 'Legal Filing',
  other: 'Other',
};

function ReceiptsTimeline({ events, theme, type }: { events: TimelineEvent[]; theme: ThemePalette; type: { mono: string; display: string; sans: string } }) {
  return (
    <div style={{ position: 'relative', paddingLeft: 28 }}>
      {events.map((evt, i) => {
        const color = TIMELINE_COLORS[evt.event_type] || TIMELINE_COLORS.other;
        const label = TIMELINE_LABELS[evt.event_type] || evt.event_type;
        const isLast = i === events.length - 1;
        return (
          <div key={i} style={{ position: 'relative', paddingBottom: isLast ? 0 : 24 }}>
            {/* Dot */}
            <div style={{
              position: 'absolute', left: -28, top: 2,
              width: 12, height: 12, borderRadius: '50%',
              background: color, zIndex: 1,
            }} />
            {/* Connecting line */}
            {!isLast && (
              <div style={{
                position: 'absolute', left: -23, top: 14,
                width: 2, bottom: 0, background: theme.line,
              }} />
            )}
            {/* Content */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{
                  fontFamily: type.mono, fontSize: 10, fontWeight: 700,
                  letterSpacing: '0.1em', textTransform: 'uppercase',
                  padding: '2px 8px', borderRadius: 2,
                  background: color, color: '#ffffff',
                }}>
                  {label}
                </span>
                {evt.date && (
                  <span style={{ fontFamily: type.mono, fontSize: 12, color: theme.dim }}>
                    {evt.date}
                  </span>
                )}
              </div>
              {evt.description && (
                <div style={{ fontFamily: type.display, fontSize: 15, lineHeight: 1.5, color: theme.ink, marginTop: 4 }}>
                  {evt.description}
                </div>
              )}
              {evt.amount_usd != null && evt.amount_usd > 0 && (
                <div style={{ fontFamily: type.mono, fontSize: 14, fontWeight: 700, color: theme.ink, marginTop: 4 }}>
                  ${evt.amount_usd.toLocaleString('en-US')}
                </div>
              )}
              {evt.source_url && (
                <a href={evt.source_url} target="_blank" rel="noopener noreferrer"
                  style={{ fontFamily: type.mono, fontSize: 12, color: '#3b82f6', marginTop: 4, display: 'inline-block' }}>
                  Source ↗
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CorruptionBar({ value, accent, dim }: { value: string; accent: string; dim: string }) {
  const filled = (value.match(/●/g) || []).length;
  const total = 5;
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} style={{
          width: 18, height: 18, borderRadius: 2,
          background: i < filled ? accent : dim,
          opacity: i < filled ? 1 : 0.3,
        }} />
      ))}
      <span style={{ marginLeft: 8, fontSize: 14, fontWeight: 700, color: accent }}>
        {filled}/{total}
      </span>
    </div>
  );
}
