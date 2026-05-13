import { useTheme } from '@/hooks/useTheme';

interface FilterEmptyProps {
  label: string;
  onReset: () => void;
}

export function FilterEmpty({ label, onReset }: FilterEmptyProps) {
  const { theme, headType } = useTheme();

  return (
    <section style={{ padding: '60px 0 40px', textAlign: 'left', maxWidth: 540 }}>
      <div style={{ fontFamily: headType.mono, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.18em', color: theme.dim, marginBottom: 12 }}>
        No entries · {label}
      </div>
      <h2 style={{
        fontFamily: headType.display, fontWeight: 600,
        fontSize: 28, lineHeight: 1.15, letterSpacing: '-0.01em',
        margin: 0, color: theme.ink, textWrap: 'balance',
      }}>
        Nothing filed under {label} yet.
      </h2>
      <p style={{ fontFamily: headType.display, fontSize: 16, lineHeight: 1.5, color: theme.dim, marginTop: 14, textWrap: 'pretty' }}>
        It's a category, not a quota — we don't manufacture entries to fill it. Try a different filter, or read everything.
      </p>
      <button onClick={onReset} style={{
        marginTop: 18, fontFamily: headType.mono, fontSize: 11, letterSpacing: '0.14em',
        padding: '9px 14px', border: `1px solid ${theme.ink}`, background: 'transparent',
        color: theme.ink, cursor: 'pointer', borderRadius: 2, textTransform: 'uppercase', fontWeight: 600,
      }}>Show all</button>
    </section>
  );
}
