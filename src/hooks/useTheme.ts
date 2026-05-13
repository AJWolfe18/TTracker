import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { resolveTheme, TYPOGRAPHY } from '@/tokens';
import type { ThemePalette, TypographySet } from '@/tokens';

interface ThemeContextValue {
  mode: 'dark' | 'light';
  toggleMode: () => void;
  theme: ThemePalette;
  headType: TypographySet;
  bodyType: TypographySet;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getInitialMode(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  const saved = localStorage.getItem('tt-mode');
  if (saved === 'light' || saved === 'dark') return saved;
  if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

export function useThemeProvider() {
  const [mode, setMode] = useState<'dark' | 'light'>(getInitialMode);

  const toggleMode = useCallback(() => {
    setMode(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('tt-mode', next);
      document.documentElement.setAttribute('data-mode', next);
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-mode', mode);
  }, [mode]);

  const theme = resolveTheme('midnight', mode);
  const headType = TYPOGRAPHY.editorial;
  const bodyType = TYPOGRAPHY.tabloid;

  return { mode, toggleMode, theme, headType, bodyType };
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

export { ThemeContext };
