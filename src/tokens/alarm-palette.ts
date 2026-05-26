import { TONE_SYSTEM } from './tone-system';
import { THEME_SEVERITY, THEME_SEVERITY_LIGHT, type SeverityColor } from './severity';

const LIGHT_RESTRAINED: Record<number, SeverityColor> = {
  5: { accent: "#8b1a12", bg: "#f7ebe6", text: "#5c1810", ring: "#8b1a12" },
  4: { accent: "#b8860b", bg: "#faf0d4", text: "#4a3506", ring: "#b8860b" },
  3: { accent: "#7a6a3e", bg: "#f2ede3", text: "#3a2e18", ring: "#8a7a5e" },
  2: { accent: "#4a6a80", bg: "#e8edf2", text: "#1e2e3a", ring: "#5e7a8a" },
  1: { accent: "#4a7a8a", bg: "#e6f0f2", text: "#1a2e35", ring: "#5a8a9a" },
  0: { accent: "#1a7a4a", bg: "#e3f2ea", text: "#0a3e22", ring: "#3a9a68" },
};

const LIGHT_FULL: Record<number, SeverityColor> = {
  5: { accent: "#b91c1c", bg: "#fee2e2", text: "#7f1d1d", ring: "#dc2626" },
  4: { accent: "#c2410c", bg: "#fed7aa", text: "#7c2d12", ring: "#ea580c" },
  3: { accent: "#a16207", bg: "#fef3c7", text: "#713f12", ring: "#f59e0b" },
  2: { accent: "#1d4ed8", bg: "#dbeafe", text: "#1e3a8a", ring: "#3b82f6" },
  1: { accent: "#0e7490", bg: "#cffafe", text: "#155e75", ring: "#06b6d4" },
  0: { accent: "#047857", bg: "#d1fae5", text: "#064e3b", ring: "#10b981" },
};

const DARK_FALLBACK: SeverityColor = { accent: "#a8a29e", bg: "#18181a", text: "#d4d1cd", ring: "#57534e" };
const LIGHT_FALLBACK: SeverityColor = { accent: "#57534e", bg: "#ecebe7", text: "#2b2a27", ring: "#78716c" };

export function alarmPalette(
  level: number,
  intensity: string = 'restrained',
  mode: string = 'dark',
  themeName: string = 'midnight',
): SeverityColor {
  const light = mode === 'light';
  const fallback = light ? LIGHT_FALLBACK : DARK_FALLBACK;

  try {
    if (!light && themeName && THEME_SEVERITY[themeName]?.[level]) {
      return THEME_SEVERITY[themeName][level];
    }
    if (light && themeName && THEME_SEVERITY_LIGHT[themeName]?.[level]) {
      return THEME_SEVERITY_LIGHT[themeName][level];
    }
    if (intensity === 'mono') return fallback;
    if (light) {
      if (intensity === 'full') return LIGHT_FULL[level] || fallback;
      return LIGHT_RESTRAINED[level] || fallback;
    }
    if (intensity === 'full') return TONE_SYSTEM.darkColors[level] || fallback;
    return TONE_SYSTEM.restrainedColors[level] || TONE_SYSTEM.darkColors[level] || fallback;
  } catch {
    return fallback;
  }
}
