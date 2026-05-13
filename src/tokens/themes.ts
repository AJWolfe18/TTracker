export interface ThemePalette {
  bg: string;
  bg2: string;
  ink: string;
  dim: string;
  line: string;
  accent: string;
  paper: string;
}

export const THEMES: Record<string, ThemePalette> = {
  midnight: { bg: "#0a0a0b", bg2: "#121214", ink: "#f5f5f4", dim: "#a3a3a3", line: "#2a2a2d", accent: "#f5f5f4", paper: "#1a1a1c" },
  carbon: { bg: "#0c0f12", bg2: "#14181d", ink: "#e7ecef", dim: "#8a96a0", line: "#222a31", accent: "#ff4d4d", paper: "#171c21" },
  newsprint: { bg: "#111110", bg2: "#1a1a17", ink: "#ebe6d9", dim: "#9d958180", line: "#2e2c26", accent: "#e4c16f", paper: "#1c1b17" },
  riot: { bg: "#0b0a0e", bg2: "#15121c", ink: "#fde3f3", dim: "#c7b2d6", line: "#2d2340", accent: "#ff2d7a", paper: "#1a1624" },
  bunker: { bg: "#0d0f0c", bg2: "#161a14", ink: "#e6ede0", dim: "#8c9a84", line: "#253021", accent: "#a3e635", paper: "#191e16" },
  mutedEditorial: { bg: "#16161a", bg2: "#1d1d22", ink: "#e9e7e1", dim: "#8e8b83", line: "#2c2c33", accent: "#a88a4f", paper: "#1f1f25" },
  mutedMidnight: { bg: "#0a0a0b", bg2: "#121214", ink: "#f5f5f4", dim: "#a3a3a3", line: "#2a2a2d", accent: "#d96e60", paper: "#1a1a1c" },
  mono: { bg: "#0a0a0b", bg2: "#121214", ink: "#f5f5f4", dim: "#a3a3a3", line: "#2a2a2d", accent: "#f5f5f4", paper: "#1a1a1c" },
  editorialBlue: { bg: "#0a0b0d", bg2: "#121418", ink: "#eef0f3", dim: "#9aa3ad", line: "#262a31", accent: "#5b87b0", paper: "#171a20" },
  restrainedAlarm: { bg: "#100d0c", bg2: "#191513", ink: "#ece5e0", dim: "#928883", line: "#2b2522", accent: "#8b3a2e", paper: "#1c1715" },
};

export const LIGHT_THEMES: Record<string, ThemePalette> = {
  midnight: { bg: "#fcfcfa", bg2: "#f1f1ee", ink: "#0f1216", dim: "#5e636b", line: "#d8dadd", accent: "#7a1f17", paper: "#ffffff" },
  carbon: { bg: "#f4f5f6", bg2: "#e8eaec", ink: "#131618", dim: "#6a7078", line: "#c9ced3", accent: "#9a2d22", paper: "#ffffff" },
  newsprint: { bg: "#f4ecd8", bg2: "#ebe2c4", ink: "#15110a", dim: "#6b614a", line: "#d6cba1", accent: "#9a2d22", paper: "#faf3dd" },
  editorialWhite: { bg: "#fcfcfa", bg2: "#f1f1ee", ink: "#0f1216", dim: "#5e636b", line: "#d8dadd", accent: "#7a1f17", paper: "#ffffff" },
  manila: { bg: "#ece1c4", bg2: "#e1d3ae", ink: "#0e1a36", dim: "#5a5a4c", line: "#cdbf94", accent: "#a87a18", paper: "#f4ebd1" },
  riot: { bg: "#faf0f4", bg2: "#efdce6", ink: "#1a0d14", dim: "#785765", line: "#dcc3d0", accent: "#a8265f", paper: "#fff7fa" },
  bunker: { bg: "#eef0ea", bg2: "#e0e4d8", ink: "#121510", dim: "#656b5e", line: "#c4c9b9", accent: "#3f6b1a", paper: "#f7f9f2" },
  mutedEditorial: { bg: "#f6f4ef", bg2: "#ecebe3", ink: "#1c1b18", dim: "#6a6862", line: "#dad7cd", accent: "#8a6f3e", paper: "#fbfaf5" },
  mutedMidnight: { bg: "#fcfcfa", bg2: "#f1f1ee", ink: "#0f1216", dim: "#5e636b", line: "#d8dadd", accent: "#a23a2e", paper: "#ffffff" },
};

export function resolveTheme(themeName: string, mode: string): ThemePalette {
  const isLight = mode === 'light';
  const src = isLight ? LIGHT_THEMES : THEMES;
  return src[themeName] || src.midnight;
}
