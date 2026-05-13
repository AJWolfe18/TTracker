export interface HeadlineItem {
  headline_spicy: string;
  headline_neutral: string;
}

export function pickHeadline(item: HeadlineItem, mode: string): string {
  return mode === 'neutral' ? item.headline_neutral : item.headline_spicy;
}
