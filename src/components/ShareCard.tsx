import { useRef, useState, useEffect } from 'react';
import { toBlob } from 'html-to-image';
import { TONE_SYSTEM, alarmPalette } from '@/tokens';
import { useTheme } from '@/hooks/useTheme';
import { pickHeadline } from '@/lib/pick-headline';
import type { DisplayItem } from '@/types';

interface ShareCardPreviewProps {
  item: DisplayItem;
  hmode: string;
}

export function ShareCardPreview({ item, hmode }: ShareCardPreviewProps) {
  const { theme, headType: type, mode } = useTheme();
  const c = alarmPalette(item.alarm, 'restrained', mode, 'midnight');
  const cardRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 2500);
    return () => clearTimeout(t);
  }, [status]);

  const headline = pickHeadline(item, hmode);
  const pageUrl = window.location.href;

  async function handleCopyImage() {
    if (!cardRef.current) return;
    try {
      const blob = await toBlob(cardRef.current, { pixelRatio: 2 });
      if (!blob) throw new Error('Failed to render');
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ]);
      setStatus('Copied to clipboard!');
    } catch {
      handleDownload();
      setStatus('Clipboard unavailable — downloading instead');
    }
  }

  async function handleDownload() {
    if (!cardRef.current) return;
    try {
      const blob = await toBlob(cardRef.current, { pixelRatio: 2 });
      if (!blob) throw new Error('Failed to render');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `trumpytracker-${item.id}.png`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('Downloaded!');
    } catch {
      setStatus('Export failed. Try again.');
    }
  }

  function shareUrl(platform: string) {
    const text = encodeURIComponent(headline);
    const url = encodeURIComponent(pageUrl);
    const urls: Record<string, string> = {
      Facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}&quote=${text}`,
      Twitter: `https://twitter.com/intent/tweet?text=${text}&url=${url}`,
      Threads: `https://threads.net/intent/post?text=${encodeURIComponent(headline + ' ' + pageUrl)}`,
    };
    window.open(urls[platform], '_blank', 'noopener,noreferrer');
  }

  return (
    <div style={{ marginTop: 24, padding: 20, background: theme.bg2, border: `1px dashed ${theme.line}`, borderRadius: 2 }}>
      <div style={{ fontFamily: type.mono, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.15em', color: theme.dim, marginBottom: 14 }}>
        Share Card Preview &middot; 1200 &times; 630
      </div>
      <div ref={cardRef} style={{
        aspectRatio: '1200/630', background: '#0a0a0b', borderRadius: 2,
        padding: '40px 48px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        border: `1px solid ${c.accent}`, position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', right: -60, top: -60, width: 260, height: 260, borderRadius: '50%', border: `3px solid ${c.accent}30` }} />
        <div style={{ position: 'absolute', right: -40, top: -40, width: 220, height: 220, borderRadius: '50%', border: `2px solid ${c.accent}50` }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', zIndex: 1 }}>
          <div style={{ fontFamily: type.display, fontWeight: 700, fontSize: 20, color: '#f5f5f4', letterSpacing: '-0.02em' }}>
            TRUMPY<span style={{ color: c.accent }}>/</span>TRACKER
          </div>
          <div style={{ padding: '6px 12px', background: c.accent, color: '#0a0a0b', fontFamily: type.mono, fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', borderRadius: 2 }}>
            LEVEL {item.alarm} &middot; {TONE_SYSTEM.colors[item.alarm]?.label}
          </div>
        </div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ fontFamily: type.mono, fontSize: 12, color: c.accent, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 14 }}>
            {TONE_SYSTEM.typeLabels[item.type]} &middot; {TONE_SYSTEM.labels[item.type]?.[item.alarm]?.spicy}
          </div>
          <h2 style={{
            fontFamily: type.display, fontWeight: type.displayWeight,
            fontSize: 'clamp(20px, 3.2vw, 38px)', lineHeight: 1.1, color: '#f5f5f4',
            letterSpacing: type.displayTracking, margin: 0, textWrap: 'balance',
          }}>
            {headline}
          </h2>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: type.mono, fontSize: 11, color: '#a3a3a3', letterSpacing: '0.1em', textTransform: 'uppercase', position: 'relative', zIndex: 1 }}>
          <span>trumpytracker.com</span>
          <span>{item.sources.length} sources cited</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {['Facebook', 'Twitter', 'Threads'].map(p => (
          <button key={p} onClick={() => shareUrl(p)} style={{ fontFamily: type.mono, fontSize: 10, letterSpacing: '0.12em', padding: '7px 12px', border: `1px solid ${theme.line}`, background: 'transparent', color: theme.ink, cursor: 'pointer', borderRadius: 2, textTransform: 'uppercase' }}>{p}</button>
        ))}
        <button onClick={handleCopyImage} style={{ fontFamily: type.mono, fontSize: 10, letterSpacing: '0.12em', padding: '7px 12px', border: `1px solid ${theme.line}`, background: 'transparent', color: theme.ink, cursor: 'pointer', borderRadius: 2, textTransform: 'uppercase' }}>Copy Image</button>
        <button onClick={handleDownload} style={{ fontFamily: type.mono, fontSize: 10, letterSpacing: '0.12em', padding: '7px 12px', border: `1px solid ${theme.line}`, background: 'transparent', color: theme.ink, cursor: 'pointer', borderRadius: 2, textTransform: 'uppercase' }}>Download PNG</button>
        {status && (
          <span style={{ fontFamily: type.mono, fontSize: 10, color: status.includes('fail') ? '#f87171' : '#4ade80' }}>
            {status}
          </span>
        )}
      </div>
    </div>
  );
}
