import { useTheme } from '@/hooks/useTheme';
import type { TabFilterConfig, FilterDimension } from '@/lib/filters';

interface FilterBarProps {
  config: TabFilterConfig;
  activeFilters: Record<string, string>;
  onFilterChange: (key: string, value: string | null) => void;
  onClearAll: () => void;
  hasActiveFilters: boolean;
  total: number;
  filteredTotal: number;
}

export function FilterBar({
  config,
  activeFilters,
  onFilterChange,
  onClearAll,
  hasActiveFilters,
}: FilterBarProps) {
  const { theme, headType: type } = useTheme();

  return (
    <div style={{ padding: '16px 0', borderBottom: `1px solid ${theme.line}` }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        {config.dimensions.map(dim => (
          dim.type === 'pills'
            ? <PillGroup key={dim.key} dim={dim} active={activeFilters[dim.key] || ''} onChange={v => onFilterChange(dim.key, v || null)} />
            : <DropdownFilter key={dim.key} dim={dim} active={activeFilters[dim.key] || ''} onChange={v => onFilterChange(dim.key, v || null)} />
        ))}
      </div>

      {/* Active filter chips */}
      {hasActiveFilters && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 10 }}>
          {Object.entries(activeFilters).map(([key, value]) => {
            const dim = config.dimensions.find(d => d.key === key);
            const opt = dim?.options.find(o => o.urlValue === value);
            if (!dim || !opt) return null;
            return (
              <span key={key} style={{
                fontFamily: type.mono, fontSize: 11, padding: '3px 8px',
                border: `1px solid ${theme.line}`, borderRadius: 2,
                color: theme.ink, display: 'inline-flex', alignItems: 'center', gap: 6,
              }}>
                {dim.label}: {opt.label}
                <button
                  onClick={() => onFilterChange(key, null)}
                  aria-label={`Remove ${dim.label} filter`}
                  style={{
                    border: 'none', background: 'none', color: theme.dim,
                    cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1,
                  }}
                >×</button>
              </span>
            );
          })}
          <button
            onClick={onClearAll}
            style={{
              fontFamily: type.mono, fontSize: 11, padding: '3px 8px',
              border: 'none', background: 'none', color: theme.dim,
              cursor: 'pointer', textDecoration: 'underline',
            }}
          >Clear all</button>
        </div>
      )}
    </div>
  );
}

function PillGroup({ dim, active, onChange }: { dim: FilterDimension; active: string; onChange: (v: string) => void }) {
  const { theme, headType: type } = useTheme();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontFamily: type.mono, fontSize: 10, color: theme.dim, letterSpacing: '0.12em', textTransform: 'uppercase', marginRight: 4 }}>
        {dim.label}:
      </span>
      {dim.options.map(opt => {
        const isActive = active === opt.urlValue;
        return (
          <button
            key={opt.urlValue}
            onClick={() => onChange(opt.urlValue)}
            aria-pressed={isActive}
            style={{
              fontFamily: type.mono, fontSize: 11, fontWeight: isActive ? 700 : 400,
              padding: '4px 10px', borderRadius: 2, cursor: 'pointer',
              border: `1px solid ${isActive ? theme.ink : theme.line}`,
              background: isActive ? theme.ink : 'transparent',
              color: isActive ? theme.bg : theme.dim,
              transition: 'all 0.15s',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function DropdownFilter({ dim, active, onChange }: { dim: FilterDimension; active: string; onChange: (v: string) => void }) {
  const { theme, headType: type } = useTheme();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <label htmlFor={`filter-${dim.key}`} style={{
        fontFamily: type.mono, fontSize: 10, color: theme.dim,
        letterSpacing: '0.12em', textTransform: 'uppercase',
      }}>
        {dim.label}:
      </label>
      <select
        id={`filter-${dim.key}`}
        value={active}
        onChange={e => onChange(e.target.value)}
        style={{
          fontFamily: type.mono, fontSize: 12,
          padding: '5px 8px', borderRadius: 2,
          border: `1px solid ${theme.line}`,
          background: theme.bg2, color: theme.ink,
          cursor: 'pointer', outline: 'none',
        }}
      >
        {dim.options.map(opt => (
          <option key={opt.urlValue} value={opt.urlValue}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}
