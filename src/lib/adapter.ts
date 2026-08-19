import type { DisplayItem, TimelineEvent } from '@/types';

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

  const sections: { heading: string; content: string }[] = [];
  if (data.story.summary_neutral) {
    sections.push({ heading: 'The Story', content: data.story.summary_neutral });
  }
  if (data.story.summary_spicy && data.story.summary_spicy !== data.story.summary_neutral) {
    sections.push({ heading: 'The Real Take', content: data.story.summary_spicy });
  }

  return {
    ...base,
    dek: '',
    body: '',
    sources: sources.length > 0 ? sources : base.sources,
    sections: sections.length > 0 ? sections : undefined,
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

const ACTION_TIER_LABELS: Record<string, string> = {
  direct: 'Act Now',
  systemic: 'Watch Closely',
  tracking: 'Tracking',
};

export function eoToItem(raw: Record<string, unknown>): DisplayItem {
  const sources: { label: string; url: string }[] = [];
  if (raw.source_url) sources.push({ label: 'Federal Register', url: raw.source_url as string });

  const tags: string[] = [];
  if (raw.order_number) tags.push(`EO ${raw.order_number}`);
  const tierLabel = ACTION_TIER_LABELS[raw.action_tier as string];
  if (tierLabel) tags.push(tierLabel);

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
    tags,
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
    headline_spicy: (raw.case_name as string) || (raw.case_name_short as string) || '',
    headline_neutral: (raw.case_name as string) || (raw.case_name_short as string) || '',
    dek: truncateDek((raw.summary_spicy as string) || (raw.who_wins as string) || ''),
    body: (raw.why_it_matters as string) || '',
    sources,
    tags: [raw.ruling_label, raw.vote_split, raw.majority_author].filter(Boolean) as string[],
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

const POST_PARDON_LABELS: Record<string, string> = {
  quiet: 'Quiet',
  under_investigation: 'Under Investigation',
  re_offended: 'Re-offended',
};

export function pardonToItem(raw: Record<string, unknown>): DisplayItem {
  const name = (raw.recipient_name as string) || '';
  const nickname = raw.nickname as string;
  const displayName = nickname ? `${name} ("${nickname}")` : name;

  const sources: { label: string; url: string }[] = [];
  if (raw.primary_source_url) sources.push({ label: 'Source', url: raw.primary_source_url as string });
  const sourceUrls = raw.source_urls as string[] | null;
  if (Array.isArray(sourceUrls)) {
    sourceUrls.forEach((u, i) => {
      if (u && !sources.some(s => s.url === u)) sources.push({ label: `Source ${i + 2}`, url: u });
    });
  }

  const tags: string[] = [];
  if (raw.recipient_type === 'group' && raw.recipient_count) {
    tags.push(`~${raw.recipient_count} people`);
  }

  return {
    id: raw.id as number,
    type: 'pardons',
    alarm: Math.max(0, Math.min(5, Number(raw.corruption_level) || 2)),
    category: CONNECTION_LABELS[raw.primary_connection_type as string] ?? 'Pardon',
    status: 'active',
    published: (raw.pardon_date as string) || '',
    updated: (raw.pardon_date as string) || '',
    headline_spicy: displayName,
    headline_neutral: displayName,
    dek: truncateDek((raw.summary_spicy as string) || (raw.crime_description as string) || ''),
    body: (raw.crime_description as string) || '',
    sources,
    tags,
  };
}

// ── Detail-Specific Adapters ──

function formatMoney(amount: number): string {
  return '$' + amount.toLocaleString('en-US');
}

function fmtMetaDate(val: unknown): string | null {
  if (val == null || val === '') return null;
  const s = String(val);
  const d = new Date(s.includes('T') ? s : s + 'T00:00:00');
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function pushMeta(arr: { label: string; value: string }[], label: string, raw: unknown) {
  if (raw == null || raw === '') return;
  if (typeof raw === 'number' && isNaN(raw)) return;
  arr.push({ label, value: String(raw) });
}

function pushMetaDate(arr: { label: string; value: string }[], label: string, raw: unknown) {
  const formatted = fmtMetaDate(raw);
  if (formatted) arr.push({ label, value: formatted });
}

function pushSection(arr: { heading: string; content: string }[], heading: string, raw: unknown) {
  if (raw == null || (typeof raw === 'string' && raw.trim() === '')) return;
  arr.push({ heading, content: String(raw) });
}

export function eoDetailToItem(raw: Record<string, unknown>): DisplayItem {
  const base = eoToItem(raw);
  const meta: { label: string; value: string }[] = [];
  if (raw.order_number) meta.push({ label: 'Executive Order', value: `EO ${raw.order_number}` });
  pushMetaDate(meta, 'Signed', raw.date);

  const sections: { heading: string; content: string }[] = [];
  pushSection(sections, 'What They Say', raw.section_what_they_say);
  pushSection(sections, 'What It Really Means', raw.section_what_it_means);
  pushSection(sections, 'Reality Check', raw.section_reality_check);
  pushSection(sections, 'Why It Matters', raw.section_why_it_matters);
  return { ...base, dek: '', body: '', meta: meta.length > 0 ? meta : undefined, sections };
}

export function scotusDetailToItem(raw: Record<string, unknown>): DisplayItem {
  const base = scotusToItem(raw);
  const meta: { label: string; value: string }[] = [];
  pushMeta(meta, 'Docket', raw.docket_number);
  pushMeta(meta, 'Citation', raw.citation);
  pushMetaDate(meta, 'Decided', raw.decided_at);
  pushMetaDate(meta, 'Argued', raw.argued_at);
  if (raw.disposition) meta.push({ label: 'Disposition', value: String(raw.disposition).charAt(0).toUpperCase() + String(raw.disposition).slice(1) });
  pushMeta(meta, 'Vote', raw.vote_split);
  pushMeta(meta, 'Majority Opinion', raw.majority_author);
  const dissentAuthors = raw.dissent_authors;
  if (Array.isArray(dissentAuthors) && dissentAuthors.length > 0) {
    meta.push({ label: 'Dissenting', value: dissentAuthors.join(', ') });
  } else if (typeof dissentAuthors === 'string' && dissentAuthors) {
    meta.push({ label: 'Dissenting', value: dissentAuthors });
  }
  pushMeta(meta, 'Term', raw.term);

  const sections: { heading: string; content: string }[] = [];
  pushSection(sections, 'Summary', raw.summary_spicy);
  pushSection(sections, 'Why It Matters', raw.why_it_matters);
  pushSection(sections, 'Who Wins', raw.who_wins);
  pushSection(sections, 'Who Loses', raw.who_loses);
  pushSection(sections, 'Dissent Highlights', raw.dissent_highlights);

  return { ...base, dek: '', body: '', meta, sections };
}

export function pardonDetailToItem(raw: Record<string, unknown>): DisplayItem {
  const base = pardonToItem(raw);
  const meta: { label: string; value: string }[] = [];

  pushMetaDate(meta, 'Pardon Date', raw.pardon_date);
  if (raw.clemency_type) meta.push({ label: 'Clemency Type', value: String(raw.clemency_type).charAt(0).toUpperCase() + String(raw.clemency_type).slice(1) });
  pushMeta(meta, 'Crime', raw.crime_category);
  pushMeta(meta, 'Original Sentence', raw.original_sentence);

  const connType = raw.primary_connection_type as string;
  if (connType && CONNECTION_LABELS[connType]) {
    meta.push({ label: 'Trump Connection', value: CONNECTION_LABELS[connType] });
  }

  const donation = Number(raw.donation_amount_usd);
  if (!isNaN(donation) && donation > 0) {
    meta.push({ label: 'Donation Amount', value: formatMoney(donation) });
  }

  if (raw.recipient_type === 'group' && raw.recipient_criteria) {
    meta.push({ label: 'Group Criteria', value: String(raw.recipient_criteria) });
  }

  const postStatus = POST_PARDON_LABELS[raw.post_pardon_status as string];
  if (postStatus && raw.post_pardon_status !== 'quiet') {
    meta.push({ label: 'Post-Pardon Status', value: postStatus });
  }

  const sections: { heading: string; content: string }[] = [];
  pushSection(sections, 'The Real Story', raw.summary_spicy);
  pushSection(sections, 'The Connection', raw.trump_connection_detail);
  pushSection(sections, 'Why It Matters', raw.why_it_matters);
  pushSection(sections, 'The Pattern', raw.pattern_analysis);

  const timeline = raw.receipts_timeline;
  let timelineEvents: TimelineEvent[] | undefined;
  if (Array.isArray(timeline) && timeline.length > 0) {
    timelineEvents = timeline
      .map((e: Record<string, unknown>): TimelineEvent => ({
        event_type: String(e.event_type || 'other'),
        date: String(e.date || ''),
        description: String(e.description || ''),
        amount_usd: e.amount_usd ? Number(e.amount_usd) : undefined,
        source_url: e.source_url ? String(e.source_url) : undefined,
      }))
      .sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date.localeCompare(b.date);
      });
    const timelineText = timelineEvents.map(e => {
      const parts: string[] = [];
      if (e.event_type) parts.push(e.event_type.toUpperCase());
      if (e.date) parts.push(e.date);
      if (e.description) parts.push(e.description);
      if (e.amount_usd) parts.push(formatMoney(e.amount_usd));
      return parts.join(' — ');
    }).join('\n\n');
    pushSection(sections, 'The Receipts', timelineText);
  } else if (typeof timeline === 'string' && timeline.trim()) {
    pushSection(sections, 'The Receipts', timeline);
  }

  pushSection(sections, 'What Happened Next', raw.post_pardon_notes);

  return { ...base, dek: '', body: '', meta, sections, timelineEvents };
}

export { CATEGORY_LABELS, SEVERITY_TO_ALARM };
