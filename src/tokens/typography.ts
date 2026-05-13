export interface TypographySet {
  display: string;
  sans: string;
  mono: string;
  displayWeight: number;
  displayTracking: string;
}

export const TYPOGRAPHY: Record<string, TypographySet> = {
  editorial: {
    display: "'Newsreader', 'GT Alpina', Georgia, serif",
    sans: "'Inter Tight', 'Inter', system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
    displayWeight: 500,
    displayTracking: "-0.02em",
  },
  tabloid: {
    display: "'Archivo Black', 'Anton', Impact, sans-serif",
    sans: "'Archivo', system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
    displayWeight: 900,
    displayTracking: "-0.03em",
  },
};
