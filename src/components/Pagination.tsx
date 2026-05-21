import { useTheme } from '@/hooks/useTheme';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function getPageWindow(current: number, total: number): (number | '...')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | '...')[] = [1];
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);

  if (left > 2) pages.push('...');
  for (let i = left; i <= right; i++) pages.push(i);
  if (right < total - 1) pages.push('...');
  if (total > 1) pages.push(total);

  return pages;
}

export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  const { theme, headType: type } = useTheme();

  if (totalPages <= 1) return null;

  const window = getPageWindow(page, totalPages);

  const btnBase: React.CSSProperties = {
    fontFamily: type.mono, fontSize: 13,
    width: 36, height: 36,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    border: `1px solid ${theme.line}`, borderRadius: 2,
    cursor: 'pointer', background: 'transparent', color: theme.ink,
    transition: 'all 0.15s',
  };

  const activeStyle: React.CSSProperties = {
    ...btnBase,
    background: theme.ink, color: theme.bg,
    fontWeight: 700, borderColor: theme.ink,
  };

  const disabledStyle: React.CSSProperties = {
    ...btnBase,
    opacity: 0.35, cursor: 'default',
  };

  return (
    <nav aria-label="Pagination" style={{
      display: 'flex', justifyContent: 'center', gap: 6,
      padding: '32px 0',
    }}>
      <button
        onClick={() => page > 1 && onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
        style={page <= 1 ? disabledStyle : btnBase}
      >
        ←
      </button>

      {window.map((item, i) => {
        if (item === '...') {
          return (
            <span key={`e${i}`} style={{
              ...btnBase, border: 'none', cursor: 'default', opacity: 0.5,
            }}>…</span>
          );
        }
        const isCurrent = item === page;
        return (
          <button
            key={item}
            onClick={() => !isCurrent && onPageChange(item)}
            aria-label={`Go to page ${item}`}
            aria-current={isCurrent ? 'page' : undefined}
            style={isCurrent ? activeStyle : btnBase}
          >
            {item}
          </button>
        );
      })}

      <button
        onClick={() => page < totalPages && onPageChange(page + 1)}
        disabled={page >= totalPages}
        aria-label="Next page"
        style={page >= totalPages ? disabledStyle : btnBase}
      >
        →
      </button>
    </nav>
  );
}
