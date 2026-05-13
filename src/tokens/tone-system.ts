export interface ToneColor {
  bg: string;
  text: string;
  border: string;
  emoji: string;
  label: string;
}

export interface ToneLabel {
  spicy: string;
  neutral: string;
}

export interface TypeLabels {
  voice: string;
  framing: string;
  icon: string;
  [level: number]: ToneLabel;
}

export interface ToneSystem {
  colors: Record<number, ToneColor>;
  darkColors: Record<number, { accent: string; bg: string; text: string; ring: string }>;
  restrainedColors: Record<number, { accent: string; bg: string; text: string; ring: string }>;
  labels: Record<string, TypeLabels>;
  typeLabels: Record<string, string>;
  categories: string[];
}

export const TONE_SYSTEM: ToneSystem = {
  colors: {
    5: { bg: "#fee2e2", text: "#7f1d1d", border: "#dc2626", emoji: "\u{1F534}", label: "CRISIS" },
    4: { bg: "#fed7aa", text: "#7c2d12", border: "#ea580c", emoji: "\u{1F7E0}", label: "SEVERE" },
    3: { bg: "#fef3c7", text: "#713f12", border: "#f59e0b", emoji: "\u{1F7E1}", label: "SERIOUS" },
    2: { bg: "#dbeafe", text: "#1e3a8a", border: "#3b82f6", emoji: "\u{1F535}", label: "NOTABLE" },
    1: { bg: "#cffafe", text: "#155e75", border: "#06b6d4", emoji: "⚪", label: "WATCH" },
    0: { bg: "#d1fae5", text: "#064e3b", border: "#10b981", emoji: "\u{1F7E2}", label: "WIN" },
  },
  darkColors: {
    5: { accent: "#ff4d4d", bg: "#2a0e0e", text: "#fecaca", ring: "#ef4444" },
    4: { accent: "#ff8c3a", bg: "#2a1609", text: "#fed7aa", ring: "#f97316" },
    3: { accent: "#fbbf24", bg: "#231a05", text: "#fef3c7", ring: "#f59e0b" },
    2: { accent: "#60a5fa", bg: "#0f1a2e", text: "#dbeafe", ring: "#3b82f6" },
    1: { accent: "#22d3ee", bg: "#07232a", text: "#cffafe", ring: "#06b6d4" },
    0: { accent: "#34d399", bg: "#072018", text: "#d1fae5", ring: "#10b981" },
  },
  restrainedColors: {
    5: { accent: "#c94a3e", bg: "#1d0e0c", text: "#e8bcb5", ring: "#c94a3e" },
    4: { accent: "#b8894a", bg: "#1a140a", text: "#d9c19a", ring: "#b8894a" },
    3: { accent: "#a8a29e", bg: "#18181a", text: "#d4d1cd", ring: "#78716c" },
    2: { accent: "#a8a29e", bg: "#18181a", text: "#d4d1cd", ring: "#57534e" },
    1: { accent: "#a8a29e", bg: "#18181a", text: "#d4d1cd", ring: "#44403c" },
    0: { accent: "#a8a29e", bg: "#18181a", text: "#d4d1cd", ring: "#44403c" },
  },
  labels: {
    pardons: {
      voice: "The Transaction",
      framing: "This isn't mercy; it's a receipt for a donation.",
      icon: "✎",
      5: { spicy: "Pay 2 Win", neutral: "Transaction" },
      4: { spicy: "Cronies-in-Chief", neutral: "Direct Relationship" },
      3: { spicy: "The Party Favor", neutral: "Network Connection" },
      2: { spicy: "The PR Stunt", neutral: "Celebrity/Fame" },
      1: { spicy: "The Ego Discount", neutral: "Flattery" },
      0: { spicy: "Actual Mercy", neutral: "Merit-Based" },
    },
    stories: {
      voice: "The Chaos",
      framing: "Look at this specific dumpster fire inside the larger dumpster fire.",
      icon: "☰",
      5: { spicy: "Constitutional Dumpster Fire", neutral: "Constitutional Crisis" },
      4: { spicy: "Criminal Bullshit", neutral: "Criminal Activity" },
      3: { spicy: "The Deep Swamp", neutral: "Institutional Corruption" },
      2: { spicy: "The Great Gaslight", neutral: "Misleading/Spin" },
      1: { spicy: "Accidental Sanity", neutral: "Mixed Outcome" },
      0: { spicy: "A Broken Clock Moment", neutral: "Positive Outcome" },
    },
    eos: {
      voice: "The Power Grab",
      framing: "The King's pen is moving. Here's who gets hurt and who gets rich.",
      icon: "§",
      5: { spicy: "Authoritarian Power Grab", neutral: "Unprecedented Authority" },
      4: { spicy: "Weaponized Executive", neutral: "Targeted Action" },
      3: { spicy: "Corporate Giveaway", neutral: "Industry Benefit" },
      2: { spicy: "Smoke and Mirrors", neutral: "Symbolic Action" },
      1: { spicy: "Surprisingly Not Terrible", neutral: "Neutral Impact" },
      0: { spicy: "Actually Helpful", neutral: "Beneficial Policy" },
    },
    scotus: {
      voice: "The Betrayal",
      framing: "The people supposed to protect the law are lighting it on fire.",
      icon: "⚖",
      5: { spicy: "Constitutional Crisis", neutral: "Landmark Reversal" },
      4: { spicy: "Rubber-stamping Tyranny", neutral: "Executive Deference" },
      3: { spicy: "Institutional Sabotage", neutral: "Precedent Erosion" },
      2: { spicy: "Judicial Sidestepping", neutral: "Narrow Ruling" },
      1: { spicy: "Crumbs from the Bench", neutral: "Limited Victory" },
      0: { spicy: "Democracy Wins", neutral: "Rights Affirmed" },
    },
  },
  typeLabels: {
    stories: "Story",
    scotus: "SCOTUS",
    eos: "Executive Order",
    pardons: "Pardon",
  },
  categories: [
    "Corruption & Scandals",
    "Democracy & Elections",
    "Policy & Legislation",
    "Justice & Legal",
    "Executive Actions",
    "Foreign Policy",
    "Corporate & Financial",
    "Civil Liberties",
    "Media & Disinformation",
    "Epstein & Associates",
    "Other",
  ],
};
