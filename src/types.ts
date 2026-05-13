export interface DisplayItem {
  id: string | number;
  type: string;
  alarm: number;
  category: string;
  status: string;
  published: string;
  updated: string;
  headline_spicy: string;
  headline_neutral: string;
  dek: string;
  body: string;
  sources: { label: string; url: string }[];
  tags: string[];
}

export interface DisplayStats {
  total: number;
  byType: Record<string, number>;
  byAlarm: Record<number, number>;
  byCat: Record<string, number>;
  active: number;
  avgAlarm: number;
  severe: number;
}

export function deriveStats(items: DisplayItem[]): DisplayStats {
  const total = items.length;
  const byType: Record<string, number> = {};
  const byAlarm: Record<number, number> = {};
  const byCat: Record<string, number> = {};
  items.forEach(e => {
    byType[e.type] = (byType[e.type] || 0) + 1;
    byAlarm[e.alarm] = (byAlarm[e.alarm] || 0) + 1;
    byCat[e.category] = (byCat[e.category] || 0) + 1;
  });
  const active = items.filter(e => e.status === 'active').length;
  const avgAlarm = total > 0 ? items.reduce((s, e) => s + e.alarm, 0) / total : 0;
  const severe = items.filter(e => e.alarm >= 4).length;
  return { total, byType, byAlarm, byCat, active, avgAlarm, severe };
}
