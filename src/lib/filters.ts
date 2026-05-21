export type FilterType = 'pills' | 'dropdown';

export interface FilterOption {
  label: string;
  urlValue: string;
  apiValue: string;
}

export interface FilterDimension {
  key: string;
  label: string;
  type: FilterType;
  options: FilterOption[];
  postgrestColumn: string;
  postgrestOp: string;
}

export interface TabFilterConfig {
  tabType: string;
  searchPlaceholder: string;
  searchColumns: string[];
  searchVectorColumn?: string;
  baseFilters: string[];
  dimensions: FilterDimension[];
  selectFields: string;
  orderBy: string;
  pageSize: number;
  table: string;
}

const ALARM_PILLS: FilterOption[] = [
  { label: 'All', urlValue: '', apiValue: '' },
  { label: '5', urlValue: '5', apiValue: '5' },
  { label: '4', urlValue: '4', apiValue: '4' },
  { label: '3', urlValue: '3', apiValue: '3' },
  { label: '2', urlValue: '2', apiValue: '2' },
  { label: '1', urlValue: '1', apiValue: '1' },
  { label: '0', urlValue: '0', apiValue: '0' },
];

const STORIES_CONFIG: TabFilterConfig = {
  tabType: 'stories',
  table: 'stories',
  searchPlaceholder: 'Search stories...',
  searchColumns: [],
  searchVectorColumn: 'search_vector',
  baseFilters: ['status=eq.active', 'summary_neutral=not.is.null'],
  selectFields: 'id,story_hash,primary_headline,primary_source,primary_source_url,primary_source_domain,primary_actor,last_updated_at,first_seen_at,status,severity,alarm_level,category,topic_tags,source_count,has_opinion,summary_neutral,summary_spicy',
  orderBy: 'last_updated_at.desc,id.desc',
  pageSize: 20,
  dimensions: [
    {
      key: 'category',
      label: 'Category',
      type: 'dropdown',
      postgrestColumn: 'category',
      postgrestOp: 'eq',
      options: [
        { label: 'All Categories', urlValue: '', apiValue: '' },
        { label: 'Corruption & Scandals', urlValue: 'corruption_scandals', apiValue: 'corruption_scandals' },
        { label: 'Democracy & Elections', urlValue: 'democracy_elections', apiValue: 'democracy_elections' },
        { label: 'Policy & Legislation', urlValue: 'policy_legislation', apiValue: 'policy_legislation' },
        { label: 'Justice & Legal', urlValue: 'justice_legal', apiValue: 'justice_legal' },
        { label: 'Executive Actions', urlValue: 'executive_actions', apiValue: 'executive_actions' },
        { label: 'Foreign Policy', urlValue: 'foreign_policy', apiValue: 'foreign_policy' },
        { label: 'Corporate & Financial', urlValue: 'corporate_financial', apiValue: 'corporate_financial' },
        { label: 'Civil Liberties', urlValue: 'civil_liberties', apiValue: 'civil_liberties' },
        { label: 'Media & Disinformation', urlValue: 'media_disinformation', apiValue: 'media_disinformation' },
        { label: 'Epstein & Associates', urlValue: 'epstein_associates', apiValue: 'epstein_associates' },
        { label: 'Other', urlValue: 'other', apiValue: 'other' },
      ],
    },
    {
      key: 'alarm',
      label: 'Alarm Level',
      type: 'pills',
      postgrestColumn: 'alarm_level',
      postgrestOp: 'eq',
      options: ALARM_PILLS,
    },
  ],
};

const EOS_CONFIG: TabFilterConfig = {
  tabType: 'eos',
  table: 'executive_orders',
  searchPlaceholder: 'Search executive orders...',
  searchColumns: ['title', 'section_what_it_means', 'order_number'],
  baseFilters: ['is_public=eq.true'],
  selectFields: 'id,order_number,title,date,category,alarm_level,action_tier,section_what_it_means,section_why_it_matters,source_url',
  orderBy: 'date.desc,id.desc',
  pageSize: 20,
  dimensions: [
    {
      key: 'category',
      label: 'Category',
      type: 'dropdown',
      postgrestColumn: 'category',
      postgrestOp: 'eq',
      options: [
        { label: 'All Categories', urlValue: '', apiValue: '' },
        { label: 'Immigration & Border', urlValue: 'immigration_border', apiValue: 'immigration_border' },
        { label: 'Environment & Energy', urlValue: 'environment_energy', apiValue: 'environment_energy' },
        { label: 'Health Care', urlValue: 'health_care', apiValue: 'health_care' },
        { label: 'Education', urlValue: 'education', apiValue: 'education' },
        { label: 'Justice & Civil Rights', urlValue: 'justice_civil_rights_voting', apiValue: 'justice_civil_rights_voting' },
        { label: 'National Security & Foreign', urlValue: 'natsec_foreign', apiValue: 'natsec_foreign' },
        { label: 'Economy, Jobs & Taxes', urlValue: 'economy_jobs_taxes', apiValue: 'economy_jobs_taxes' },
        { label: 'Technology & Privacy', urlValue: 'technology_data_privacy', apiValue: 'technology_data_privacy' },
        { label: 'Infrastructure & Housing', urlValue: 'infra_housing_transport', apiValue: 'infra_housing_transport' },
        { label: 'Government Operations', urlValue: 'gov_ops_workforce', apiValue: 'gov_ops_workforce' },
      ],
    },
    {
      key: 'alarm',
      label: 'Alarm Level',
      type: 'pills',
      postgrestColumn: 'alarm_level',
      postgrestOp: 'eq',
      options: ALARM_PILLS,
    },
  ],
};

const SCOTUS_CONFIG: TabFilterConfig = {
  tabType: 'scotus',
  table: 'scotus_cases',
  searchPlaceholder: 'Search cases...',
  searchColumns: ['case_name', 'case_name_short', 'summary_spicy'],
  baseFilters: ['is_public=eq.true'],
  selectFields: 'id,case_name,case_name_short,docket_number,citation,term,decided_at,argued_at,vote_split,majority_author,dissent_authors,case_type,ruling_impact_level,ruling_label,summary_spicy,who_wins,who_loses,why_it_matters,source_url,pdf_url',
  orderBy: 'decided_at.desc.nullslast,id.desc',
  pageSize: 20,
  dimensions: [
    {
      key: 'term',
      label: 'Term',
      type: 'dropdown',
      postgrestColumn: 'term',
      postgrestOp: 'eq',
      options: [
        { label: 'All Terms', urlValue: '', apiValue: '' },
        { label: '2025', urlValue: '2025', apiValue: '2025' },
        { label: '2024', urlValue: '2024', apiValue: '2024' },
        { label: '2023', urlValue: '2023', apiValue: '2023' },
        { label: '2022', urlValue: '2022', apiValue: '2022' },
        { label: '2021', urlValue: '2021', apiValue: '2021' },
        { label: '2020', urlValue: '2020', apiValue: '2020' },
      ],
    },
    {
      key: 'case_type',
      label: 'Case Type',
      type: 'dropdown',
      postgrestColumn: 'case_type',
      postgrestOp: 'eq',
      options: [
        { label: 'All Types', urlValue: '', apiValue: '' },
        { label: 'Merits Decision', urlValue: 'merits', apiValue: 'merits' },
        { label: 'Procedural', urlValue: 'procedural', apiValue: 'procedural' },
        { label: 'Shadow Docket', urlValue: 'shadow_docket', apiValue: 'shadow_docket' },
        { label: 'Cert Stage', urlValue: 'cert_stage', apiValue: 'cert_stage' },
      ],
    },
    {
      key: 'impact',
      label: 'Impact Level',
      type: 'pills',
      postgrestColumn: 'ruling_impact_level',
      postgrestOp: 'eq',
      options: ALARM_PILLS,
    },
  ],
};

const PARDONS_CONFIG: TabFilterConfig = {
  tabType: 'pardons',
  table: 'pardons',
  searchPlaceholder: 'Search pardons...',
  searchColumns: [],
  searchVectorColumn: 'search_vector',
  baseFilters: ['is_public=eq.true'],
  selectFields: 'id,recipient_name,recipient_slug,nickname,photo_url,recipient_type,recipient_count,recipient_criteria,pardon_date,clemency_type,status,crime_description,crime_category,primary_connection_type,corruption_level,research_status,post_pardon_status,summary_spicy,is_public',
  orderBy: 'pardon_date.desc,id.desc',
  pageSize: 20,
  dimensions: [
    {
      key: 'corruption',
      label: 'Corruption Level',
      type: 'pills',
      postgrestColumn: 'corruption_level',
      postgrestOp: 'eq',
      options: [
        { label: 'All', urlValue: '', apiValue: '' },
        { label: 'Pay-to-Play', urlValue: '5', apiValue: '5' },
        { label: 'Friends & Fam', urlValue: '4', apiValue: '4' },
        { label: 'Swamp', urlValue: '3', apiValue: '3' },
        { label: 'Celebrity', urlValue: '2', apiValue: '2' },
        { label: 'Broken Clock', urlValue: '1', apiValue: '1' },
      ],
    },
    {
      key: 'connection',
      label: 'Connection Type',
      type: 'dropdown',
      postgrestColumn: 'primary_connection_type',
      postgrestOp: 'eq',
      options: [
        { label: 'All Connections', urlValue: '', apiValue: '' },
        { label: 'Mar-a-Lago VIP', urlValue: 'mar_a_lago_vip', apiValue: 'mar_a_lago_vip' },
        { label: 'Major Donor', urlValue: 'major_donor', apiValue: 'major_donor' },
        { label: 'Family', urlValue: 'family', apiValue: 'family' },
        { label: 'Political Ally', urlValue: 'political_ally', apiValue: 'political_ally' },
        { label: 'Campaign Staff', urlValue: 'campaign_staff', apiValue: 'campaign_staff' },
        { label: 'Business Associate', urlValue: 'business_associate', apiValue: 'business_associate' },
        { label: 'Jan 6 Defendant', urlValue: 'jan6_defendant', apiValue: 'jan6_defendant' },
        { label: 'Fake Elector', urlValue: 'fake_electors', apiValue: 'fake_electors' },
        { label: 'Celebrity', urlValue: 'celebrity', apiValue: 'celebrity' },
        { label: 'No Known Connection', urlValue: 'no_connection', apiValue: 'no_connection' },
      ],
    },
    {
      key: 'crime',
      label: 'Crime Category',
      type: 'dropdown',
      postgrestColumn: 'crime_category',
      postgrestOp: 'eq',
      options: [
        { label: 'All Crimes', urlValue: '', apiValue: '' },
        { label: 'White Collar', urlValue: 'white_collar', apiValue: 'white_collar' },
        { label: 'Obstruction', urlValue: 'obstruction', apiValue: 'obstruction' },
        { label: 'Political Corruption', urlValue: 'political_corruption', apiValue: 'political_corruption' },
        { label: 'Violent', urlValue: 'violent', apiValue: 'violent' },
        { label: 'Drug', urlValue: 'drug', apiValue: 'drug' },
        { label: 'Election', urlValue: 'election', apiValue: 'election' },
        { label: 'Jan 6', urlValue: 'jan6', apiValue: 'jan6' },
        { label: 'Other', urlValue: 'other', apiValue: 'other' },
      ],
    },
  ],
};

const CONFIGS: Record<string, TabFilterConfig> = {
  stories: STORIES_CONFIG,
  eos: EOS_CONFIG,
  scotus: SCOTUS_CONFIG,
  pardons: PARDONS_CONFIG,
};

export function getFilterConfig(tabType: string): TabFilterConfig {
  return CONFIGS[tabType] || STORIES_CONFIG;
}
