import { useTheme } from '@/hooks/useTheme';

export function LoadingSkeleton() {
  const { theme } = useTheme();

  const bar = (w: string, h = 16, extra: React.CSSProperties = {}) => (
    <div style={{
      width: w, height: h, background: theme.bg2, borderRadius: 2,
      animation: 'tt-shimmer 1.6s ease-in-out infinite',
      ...extra,
    }} />
  );

  return (
    <div role="status" aria-live="polite" aria-label="Loading dispatch">
      <section style={{ padding: '44px 0 36px', borderBottom: `1px solid ${theme.line}` }}>
        <div style={{ width: 56, height: 2, background: theme.line, marginBottom: 14 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {bar('60%')}
          {bar('90%', 36)}
          {bar('80%', 36)}
          {bar('50%', 18, { marginTop: 8 })}
        </div>
      </section>
      <div style={{ display: 'flex', gap: 22, borderBottom: `1px solid ${theme.line}`, padding: '16px 0' }}>
        {[80, 70, 130, 90, 80].map((w, i) => (
          <div key={i} style={{ width: w, height: 14, background: theme.bg2, borderRadius: 2, animation: 'tt-shimmer 1.6s ease-in-out infinite' }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 20, padding: '24px 0 0' }}>
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} style={{ background: theme.paper, border: `1px solid ${theme.line}`, padding: '0 22px 18px', minHeight: 220, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ height: 2, background: theme.line, margin: '0 -22px 16px' }} />
            {bar('40%', 10)}
            {bar('90%', 26)}
            {bar('70%', 26)}
            <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: `1px dashed ${theme.line}`, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              {bar('80px', 10)}{bar('70px', 10)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
