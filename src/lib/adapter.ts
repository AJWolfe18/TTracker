import type { DisplayItem } from '@/types';

const CATEGORY_LABELS: Record<string, string> = {
  corruption_scandals: 'Corruption & Scandals',
  democracy_elections: 'Democracy & Elections',
  policy_legislation: 'Policy & Legislation',
  justice_legal: 'Justice & Legal',
  executive_actions: 'Executive Actions',
  foreign_policy: 'Foreign Policy',
  corporate_financial: 'Corporate & Financial',
  civil_liberties: 'Civil Liberties',
  media_disinformation: 'Media & Disinformation',
  epstein_associates: 'Epstein & Associates',
  other: 'Other',
};

const SEVERITY_TO_ALARM: Record<string, number> = {
  critical: 5,
  severe: 4,
  moderate: 3,
  minor: 2,
  low: 1,
  positive: 0,
};

export interface RawStory {
  id: number;
  story_hash: string;
  primary_headline: string;
  primary_source: string | null;
  primary_source_url: string | null;
  primary_source_domain: string | null;
  primary_actor: string | null;
  last_updated_at: string;
  first_seen_at: string;
  status: string;
  severity: string | null;
  alarm_level: number | null;
  category: string | null;
  topic_tags: string[] | null;
  source_count: number;
  has_opinion: boolean;
  summary_neutral: string | null;
  summary_spicy: string | null;
}

export interface RawArticle {
  id: string;
  url: string;
  url_hash: string;
  title: string | null;
  source_name: string | null;
  source_domain: string | null;
  published_at: string | null;
  content_type: string | null;
  opinion_flag: boolean;
  excerpt: string | null;
  metadata: Record<string, unknown> | null;
  is_primary_source: boolean;
  similarity_score: number | null;
  matched_at: string | null;
}

export interface ActiveResponse {
  items: RawStory[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface DetailResponse {
  story: RawStory;
  articles: RawArticle[];
}

export interface AdaptedResult {
  items: DisplayItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

function truncateDek(text: string, maxLen = 180): string {
  if (!text || text.length <= maxLen) return text;
  const cut = text.lastIndexOf(' ', maxLen);
  return text.slice(0, cut > 0 ? cut : maxLen) + '…';
}

function resolveAlarm(alarmLevel: number | null | undefined, severity: string | null | undefined): number {
  if (alarmLevel != null && alarmLevel >= 0 && alarmLevel <= 5) return alarmLevel;
  if (severity && SEVERITY_TO_ALARM[severity] != null) return SEVERITY_TO_ALARM[severity];
  return 2;
}

function resolveCategory(category: string | null | undefined): string {
  if (!category) return 'Other';
  return CATEGORY_LABELS[category] ?? 'Other';
}

export function storyToItem(raw: RawStory): DisplayItem {
  const sources: { label: string; url: string }[] = [];
  if (raw.primary_source_url) {
    sources.push({
      label: raw.primary_source || raw.primary_source_domain || 'Source',
      url: raw.primary_source_url,
    });
  }

  return {
    id: raw.id,
    type: 'stories',
    alarm: resolveAlarm(raw.alarm_level, raw.severity),
    category: resolveCategory(raw.category),
    status: raw.status || 'active',
    published: raw.first_seen_at || '',
    updated: raw.last_updated_at || '',
    headline_spicy: raw.primary_headline || '',
    headline_neutral: raw.primary_headline || '',
    dek: truncateDek(raw.summary_neutral || raw.summary_spicy || ''),
    body: '',
    sources,
    tags: raw.topic_tags || [],
  };
}

export function detailToItem(data: DetailResponse): DisplayItem {
  const base = storyToItem(data.story);

  const sources = data.articles
    .filter(a => a.url)
    .map(a => ({
      label: a.title || a.source_name || a.source_domain || 'Source',
      url: a.url,
    }));

  return {
    ...base,
    body: data.story.summary_neutral || data.story.summary_spicy || data.story.primary_headline || '',
    sources: sources.length > 0 ? sources : base.sources,
  };
}

export function adaptActiveResponse(data: ActiveResponse): AdaptedResult {
  return {
    items: (data.items || []).map(storyToItem),
    nextCursor: data.next_cursor || null,
    hasMore: data.has_more || false,
  };
}

export function adaptSearchResponse(data: ActiveResponse): AdaptedResult {
  return adaptActiveResponse(data);
}

// ── Executive Orders ──

const EO_CATEGORY_LABELS: Record<string, string> = {
  immigration_border: 'Immigration & Border',
  environment_energy: 'Environment & Energy',
  health_care: 'Health Care',
  education: 'Education',
  justice_civil_rights_voting: 'Justice & Civil Rights',
  natsec_foreign: 'National Security & Foreign',
  economy_jobs_taxes: 'Economy, Jobs & Taxes',
  technology_data_privacy: 'Technology & Privacy',
  infra_housing_transport: 'Infrastructure & Housing',
  gov_ops_workforce: 'Government Operations',
};

export function eoToItem(raw: Record<string, unknown>): DisplayItem {
  const sources: { label: string; url: string }[] = [];
  if (raw.source_url) sources.push({ label: 'Federal Register', url: raw.source_url as string });

  return {
    id: raw.id as number,
    type: 'eos',
    alarm: Math.max(0, Math.min(5, Number(raw.alarm_level) || 3)),
    category: EO_CATEGORY_LABELS[raw.category as string] ?? 'Executive Action',
    status: 'active',
    published: (raw.date as string) || '',
    updated: (raw.date as string) || '',
    headline_spicy: (raw.title as string) || '',
    headline_neutral: (raw.title as string) || '',
    dek: truncateDek((raw.section_what_it_means as string) || ''),
    body: (raw.section_why_it_matters as string) || '',
    sources,
    tags: [],
  };
}

// ── SCOTUS Cases ──

const SCOTUS_CASE_TYPES: Record<string, string> = {
  merits: 'Merits Decision',
  procedural: 'Procedural',
  shadow_docket: 'Shadow Docket',
  cert_stage: 'Cert Stage',
  unclear: 'Unclear',
};

export function scotusToItem(raw: Record<string, unknown>): DisplayItem {
  const sources: { label: string; url: string }[] = [];
  if (raw.source_url) sources.push({ label: 'Opinion', url: raw.source_url as string });
  if (raw.pdf_url) sources.push({ label: 'PDF', url: raw.pdf_url as string });

  return {
    id: raw.id as number,
    type: 'scotus',
    alarm: Math.max(0, Math.min(5, Number(raw.ruling_impact_level) || 3)),
    category: SCOTUS_CASE_TYPES[raw.case_type as string] ?? 'SCOTUS',
    status: 'active',
    published: (raw.decided_at as string) || '',
    updated: (raw.decided_at as string) || '',
    headline_spicy: (raw.case_name_short as string) || (raw.case_name as string) || '',
    headline_neutral: (raw.case_name_short as string) || (raw.case_name as string) || '',
    dek: truncateDek((raw.summary_spicy as string) || (raw.who_wins as string) || ''),
    body: (raw.why_it_matters as string) || '',
    sources,
    tags: raw.vote_split ? [raw.vote_split as string] : [],
  };
}

// ── Pardons ──

const CONNECTION_LABELS: Record<string, string> = {
  mar_a_lago_vip: 'Mar-a-Lago VIP',
  major_donor: 'Major Donor',
  family: 'Family',
  political_ally: 'Political Ally',
  campaign_staff: 'Campaign Staff',
  business_associate: 'Business Associate',
  jan6_defendant: 'Jan 6 Defendant',
  fake_electors: 'Fake Elector',
  celebrity: 'Celebrity',
  no_connection: 'No Known Connection',
};

export function pardonToItem(raw: Record<string, unknown>): DisplayItem {
  return {
    id: raw.id as number,
    type: 'pardons',
    alarm: Math.max(0, Math.min(5, Number(raw.corruption_level) || 2)),
    category: CONNECTION_LABELS[raw.primary_connection_type as string] ?? 'Pardon',
    status: 'active',
    published: (raw.pardon_date as string) || '',
    updated: (raw.pardon_date as string) || '',
    headline_spicy: (raw.recipient_name as string) || '',
    headline_neutral: (raw.recipient_name as string) || '',
    dek: truncateDek((raw.summary_spicy as string) || (raw.crime_description as string) || ''),
    body: (raw.crime_description as string) || '',
    sources: [],
    tags: [],
  };
}

export { CATEGORY_LABELS, SEVERITY_TO_ALARM };
