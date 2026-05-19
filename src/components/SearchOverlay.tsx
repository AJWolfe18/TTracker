import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { useTheme } from '@/hooks/useTheme';
import { searchStories } from '@/lib/api';
import { alarmPalette } from '@/tokens';
import { pickHeadline } from '@/lib/pick-headline';
import { relDate } from '@/lib/date-utils';
import type { DisplayItem } from '@/types';

interface SearchOverlayProps {
  query: string;
  onClose: () => void;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
}

export function SearchOverlay({ query, onClose, wrapperRef }: SearchOverlayProps) {
  const { theme, headType: type, mode } = useTheme();
  const [, navigate] = useLocation();
  const [results, setResults] = useState<DisplayItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }

    const timeout = setTimeout(() => {
      controllerRef.current?.abort();
      const ac = new AbortController();
      controllerRef.current = ac;

      setLoading(true);
      searchStories(query, { signal: ac.signal, limit: 8 })
        .then(result => {
          if (!ac.signal.aborted) {
            setResults(result.items);
            setSearched(true);
          }
        })
        .catch(err => {
          if (err.name !== 'AbortError' && !ac.signal.aborted) {
            setResults([]);
            setSearched(true);
          }
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false);
        });
    }, 300);

    return () => {
      clearTimeout(timeout);
      controllerRef.current?.abort();
    };
  }, [query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose, wrapperRef]);

  function handleSelect(item: DisplayItem) {
    const prefix = item.type === 'stories' ? 'detail' : item.type;
    navigate(`/${prefix}/${item.id}`);
    onClose();
  }

  return (
    <div style={{
      position: 'absolute', top: '100%', right: 0, marginTop: 4,
      width: 'min(100vw - 40px, 500px)', maxHeight: 420, overflowY: 'auto',
      background: theme.bg, border: `1px solid ${theme.line}`,
      borderRadius: 2, zIndex: 30, boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
    }}>
      {loading && (
        <div style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2, 3].map(i => (
            <div key={i} className="tt-shimmer" style={{
              height: 18, background: theme.bg2, borderRadius: 2, opacity: 0.6,
            }} />
          ))}
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <div style={{
          padding: '20px 14px', fontFamily: type.mono, fontSize: 12,
          color: theme.dim, textAlign: 'center',
        }}>
          No results for &ldquo;{query}&rdquo;
        </div>
      )}

      {!loading && results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {results.map(item => {
            const c = alarmPalette(item.alarm, 'restrained', mode, 'midnight');
            return (
              <button
                key={item.id}
                onClick={() => handleSelect(item)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px', border: 'none', background: 'transparent',
                  cursor: 'pointer', textAlign: 'left', width: '100%',
                  borderBottom: `1px solid ${theme.line}`,
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = theme.bg2; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: c.accent, flexShrink: 0,
                }} />
                <span style={{
                  flex: 1, fontFamily: type.sans, fontSize: 13,
                  color: theme.ink, lineHeight: 1.3,
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                }}>
                  {pickHeadline(item, 'spicy')}
                </span>
                <span style={{
                  fontFamily: type.mono, fontSize: 10, color: theme.dim,
                  flexShrink: 0, whiteSpace: 'nowrap',
                }}>
                  {relDate(item.updated)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div style={{
        padding: '8px 14px', fontFamily: type.mono, fontSize: 9,
        color: theme.dim, textTransform: 'uppercase', letterSpacing: '0.12em',
        borderTop: results.length > 0 ? `1px solid ${theme.line}` : 'none',
        textAlign: 'center',
      }}>
        Searching stories only
      </div>
    </div>
  );
}
