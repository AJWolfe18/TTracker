export interface SeverityColor {
  accent: string;
  bg: string;
  text: string;
  ring: string;
}

export const THEME_SEVERITY: Record<string, Record<number, SeverityColor>> = {
  mutedMidnight: {
    5: { accent: "#d96e60", bg: "#1f120f", text: "#f0c5bd", ring: "#d96e60" },
    4: { accent: "#c4885e", bg: "#1d160e", text: "#e6c8a6", ring: "#c4885e" },
    3: { accent: "#9a958d", bg: "#18181a", text: "#cdc9c2", ring: "#5a564f" },
    2: { accent: "#7e7a73", bg: "#16161a", text: "#a8a39c", ring: "#3e3b35" },
    1: { accent: "#5f5c56", bg: "#141416", text: "#827e78", ring: "#2f2c28" },
    0: { accent: "#4a4844", bg: "#131315", text: "#6a6661", ring: "#282623" },
  },
  mono: {
    5: { accent: "#fafaf7", bg: "#1c1c1e", text: "#fafaf7", ring: "#fafaf7" },
    4: { accent: "#cfccc4", bg: "#18181a", text: "#cfccc4", ring: "#7a766f" },
    3: { accent: "#a8a59f", bg: "#161618", text: "#bcb8b1", ring: "#5a574f" },
    2: { accent: "#82807a", bg: "#141416", text: "#9a968f", ring: "#3e3b35" },
    1: { accent: "#5f5c56", bg: "#131315", text: "#7a766f", ring: "#2f2c28" },
    0: { accent: "#4a4844", bg: "#121214", text: "#65615b", ring: "#262420" },
  },
  editorialBlue: {
    5: { accent: "#5b87b0", bg: "#10171f", text: "#bcd4e8", ring: "#5b87b0" },
    4: { accent: "#6b7e91", bg: "#13171c", text: "#bdc7d2", ring: "#6b7e91" },
    3: { accent: "#9aa3ad", bg: "#15171b", text: "#c5cad1", ring: "#4a525c" },
    2: { accent: "#7e8389", bg: "#14161a", text: "#a3a8ae", ring: "#3a3e44" },
    1: { accent: "#5f6166", bg: "#131418", text: "#828489", ring: "#2c2e33" },
    0: { accent: "#4a4c4f", bg: "#121317", text: "#6a6c6f", ring: "#252830" },
  },
  mutedEditorial: {
    5: { accent: "#a88a4f", bg: "#1c1812", text: "#dcc28a", ring: "#a88a4f" },
    4: { accent: "#e9e7e1", bg: "#1d1d22", text: "#e9e7e1", ring: "#6b6862" },
    3: { accent: "#b8b5ae", bg: "#1d1d22", text: "#cfccc4", ring: "#525049" },
    2: { accent: "#8e8b83", bg: "#1d1d22", text: "#a8a59f", ring: "#3f3d39" },
    1: { accent: "#6b6862", bg: "#1d1d22", text: "#8a8780", ring: "#33312e" },
    0: { accent: "#55534e", bg: "#1d1d22", text: "#73706a", ring: "#2c2c33" },
  },
  restrainedAlarm: {
    5: { accent: "#b9483a", bg: "#241310", text: "#eab8ad", ring: "#b9483a" },
    4: { accent: "#94503e", bg: "#1f1815", text: "#d4afa1", ring: "#94503e" },
    3: { accent: "#7a5b53", bg: "#1c1715", text: "#bba59c", ring: "#5a4942" },
    2: { accent: "#665652", bg: "#1a1614", text: "#9d8e88", ring: "#463b37" },
    1: { accent: "#544845", bg: "#181513", text: "#82776f", ring: "#382f2c" },
    0: { accent: "#443c3a", bg: "#171413", text: "#6b625d", ring: "#2b2522" },
  },
};

export const THEME_SEVERITY_LIGHT: Record<string, Record<number, SeverityColor>> = {
  midnight: {
    5: { accent: "#7a1f17", bg: "#fbe7e3", text: "#4a0f0a", ring: "#7a1f17" },
    4: { accent: "#8a4a2e", bg: "#fbe7d9", text: "#4a200f", ring: "#8a4a2e" },
    3: { accent: "#5e636b", bg: "#eef0f2", text: "#1a1d22", ring: "#7a8089" },
    2: { accent: "#5e636b", bg: "#eef0f2", text: "#1a1d22", ring: "#7a8089" },
    1: { accent: "#6c727a", bg: "#eef0f2", text: "#262a30", ring: "#8a9098" },
    0: { accent: "#6c727a", bg: "#eef0f2", text: "#262a30", ring: "#8a9098" },
  },
  mutedEditorial: {
    5: { accent: "#8a6f3e", bg: "#f0e8d2", text: "#3a2e15", ring: "#8a6f3e" },
    4: { accent: "#5b574e", bg: "#eceae3", text: "#1c1b18", ring: "#7a766c" },
    3: { accent: "#6a665d", bg: "#eceae3", text: "#2a2825", ring: "#8a867d" },
    2: { accent: "#7a766d", bg: "#eceae3", text: "#3a3835", ring: "#9a9690" },
    1: { accent: "#8a867d", bg: "#eceae3", text: "#4a4845", ring: "#a8a59f" },
    0: { accent: "#8a867d", bg: "#eceae3", text: "#4a4845", ring: "#a8a59f" },
  },
  newsprint: {
    5: { accent: "#9a2d22", bg: "#f4ddc8", text: "#5a160e", ring: "#9a2d22" },
    4: { accent: "#a85e2a", bg: "#f1dfb8", text: "#5a2c0a", ring: "#a85e2a" },
    3: { accent: "#6b614a", bg: "#ebe2c4", text: "#2a2316", ring: "#8a7e5e" },
    2: { accent: "#6b614a", bg: "#ebe2c4", text: "#2a2316", ring: "#8a7e5e" },
    1: { accent: "#7a7158", bg: "#ebe2c4", text: "#3a3320", ring: "#9a907a" },
    0: { accent: "#7a7158", bg: "#ebe2c4", text: "#3a3320", ring: "#9a907a" },
  },
  editorialWhite: {
    5: { accent: "#7a1f17", bg: "#fbe7e3", text: "#4a0f0a", ring: "#7a1f17" },
    4: { accent: "#8a4a2e", bg: "#fbe7d9", text: "#4a200f", ring: "#8a4a2e" },
    3: { accent: "#5e636b", bg: "#eef0f2", text: "#1a1d22", ring: "#7a8089" },
    2: { accent: "#5e636b", bg: "#eef0f2", text: "#1a1d22", ring: "#7a8089" },
    1: { accent: "#6c727a", bg: "#eef0f2", text: "#262a30", ring: "#8a9098" },
    0: { accent: "#6c727a", bg: "#eef0f2", text: "#262a30", ring: "#8a9098" },
  },
  manila: {
    5: { accent: "#a87a18", bg: "#f0d98c", text: "#3e2b06", ring: "#a87a18" },
    4: { accent: "#8a5a1f", bg: "#ecd29c", text: "#3a2208", ring: "#8a5a1f" },
    3: { accent: "#3a4868", bg: "#dccdab", text: "#0a1530", ring: "#5a6580" },
    2: { accent: "#3a4868", bg: "#dccdab", text: "#0a1530", ring: "#5a6580" },
    1: { accent: "#4a5778", bg: "#dccdab", text: "#1a2540", ring: "#6a7590" },
    0: { accent: "#4a5778", bg: "#dccdab", text: "#1a2540", ring: "#6a7590" },
  },
};
