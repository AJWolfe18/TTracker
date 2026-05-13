import { TONE_SYSTEM } from './tone-system';
import { THEME_SEVERITY, THEME_SEVERITY_LIGHT, type SeverityColor } from './severity';

const LIGHT_RESTRAINED: Record<number, SeverityColor> = {
  5: { accent: "#9a2d22", bg: "#f7ebe6", text: "#5c1810", ring: "#9a2d22" },
  4: { accent: "#8a5a1f", bg: "#f6efd9", text: "#4c2e0a", ring: "#8a5a1f" },
  3: { accent: "#57534e", bg: "#ecebe7", text: "#2b2a27", ring: "#78716c" },
  2: { accent: "#57534e", bg: "#ecebe7", text: "#2b2a27", ring: "#78716c" },
  1: { accent: "#57534e", bg: "#ecebe7", text: "#2b2a27", ring: "#78716c" },
  0: { accent: "#57534e", bg: "#ecebe7", text: "#2b2a27", ring: "#78716c" },
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
