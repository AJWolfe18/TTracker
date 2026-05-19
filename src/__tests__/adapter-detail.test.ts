import { describe, it, expect } from 'vitest';
import {
  eoDetailToItem,
  scotusDetailToItem,
  pardonDetailToItem,
} from '@/lib/adapter';

describe('eoDetailToItem', () => {
  const fullEo = {
    id: 42,
    order_number: '14200',
    title: 'Test Executive Order',
    date: '2025-03-15',
    category: 'immigration_border',
    alarm_level: 4,
    action_tier: 'direct',
    source_url: 'https://federalregister.gov/d/2025-00001',
    section_what_they_say: 'Official framing.',
    section_what_it_means: 'What it really means.',
    section_reality_check: 'Reality check content.',
    section_why_it_matters: 'Why it matters.',
  };

  it('maps all 4 sections', () => {
    const item = eoDetailToItem(fullEo);
    expect(item.sections).toHaveLength(4);
    expect(item.sections![0]).toEqual({ heading: 'What They Say', content: 'Official framing.' });
    expect(item.sections![1]).toEqual({ heading: 'What It Really Means', content: 'What it really means.' });
    expect(item.sections![2]).toEqual({ heading: 'Reality Check', content: 'Reality check content.' });
    expect(item.sections![3]).toEqual({ heading: 'Why It Matters', content: 'Why it matters.' });
  });

  it('skips null sections', () => {
    const item = eoDetailToItem({ ...fullEo, section_what_they_say: null, section_reality_check: '' });
    expect(item.sections).toHaveLength(2);
    expect(item.sections![0].heading).toBe('What It Really Means');
    expect(item.sections![1].heading).toBe('Why It Matters');
  });

  it('maps meta with order_number and action_tier', () => {
    const item = eoDetailToItem(fullEo);
    expect(item.meta).toBeDefined();
    expect(item.meta!.find(m => m.label === 'Executive Order')?.value).toBe('EO 14200');
    expect(item.meta!.find(m => m.label === 'Signed')?.value).toBe('2025-03-15');
    expect(item.meta!.find(m => m.label === 'Action Level')?.value).toBe('Act Now');
  });

  it('body and dek are empty (content in sections)', () => {
    const item = eoDetailToItem(fullEo);
    expect(item.body).toBe('');
    expect(item.dek).toBe('');
  });

  it('preserves base fields', () => {
    const item = eoDetailToItem(fullEo);
    expect(item.type).toBe('eos');
    expect(item.alarm).toBe(4);
    expect(item.id).toBe(42);
  });
});

describe('scotusDetailToItem', () => {
  const fullScotus = {
    id: 100,
    case_name: 'Smith v. United States',
    case_name_short: 'Smith',
    docket_number: '23-456',
    citation: '600 U.S. 100',
    term: '2024',
    decided_at: '2025-06-15',
    argued_at: '2025-03-01',
    vote_split: '6-3',
    majority_author: 'Roberts',
    dissent_authors: ['Sotomayor', 'Kagan', 'Jackson'],
    case_type: 'merits',
    ruling_impact_level: 4,
    ruling_label: 'Major',
    disposition: 'Reversed',
    summary_spicy: 'A spicy SCOTUS take.',
    who_wins: 'The government',
    who_loses: 'Individual rights',
    why_it_matters: 'Sets dangerous precedent.',
    dissent_highlights: 'Sotomayor dissented strongly.',
    source_url: 'https://supremecourt.gov/opinions/23pdf/23-456.pdf',
    pdf_url: 'https://supremecourt.gov/opinions/23pdf/23-456.pdf',
  };

  it('maps all meta fields including new ones', () => {
    const item = scotusDetailToItem(fullScotus);
    const labels = item.meta!.map(m => m.label);
    expect(labels).toContain('Docket');
    expect(labels).toContain('Citation');
    expect(labels).toContain('Decided');
    expect(labels).toContain('Argued');
    expect(labels).toContain('Disposition');
    expect(labels).toContain('Vote');
    expect(labels).toContain('Majority Opinion');
    expect(labels).toContain('Dissenting');
    expect(labels).toContain('Term');
    expect(item.meta!.find(m => m.label === 'Dissenting')?.value).toBe('Sotomayor, Kagan, Jackson');
    expect(item.meta!.find(m => m.label === 'Citation')?.value).toBe('600 U.S. 100');
  });

  it('skips null meta values', () => {
    const item = scotusDetailToItem({ ...fullScotus, citation: null, argued_at: null, dissent_authors: [] });
    const labels = item.meta!.map(m => m.label);
    expect(labels).not.toContain('Citation');
    expect(labels).not.toContain('Argued');
    expect(labels).not.toContain('Dissenting');
    expect(labels).toContain('Docket');
    expect(labels).toContain('Vote');
  });

  it('maps all 5 sections', () => {
    const item = scotusDetailToItem(fullScotus);
    expect(item.sections!.map(s => s.heading)).toEqual([
      'Summary', 'Why It Matters', 'Who Wins', 'Who Loses', 'Dissent Highlights',
    ]);
  });

  it('skips null sections', () => {
    const item = scotusDetailToItem({ ...fullScotus, dissent_highlights: null, who_loses: null });
    expect(item.sections!.map(s => s.heading)).toEqual(['Summary', 'Why It Matters', 'Who Wins']);
  });
});

describe('pardonDetailToItem', () => {
  const fullPardon = {
    id: 200,
    recipient_name: 'John Doe',
    recipient_slug: 'john-doe',
    nickname: 'Johnny',
    photo_url: null,
    recipient_type: 'person',
    recipient_count: 1,
    recipient_criteria: null,
    pardon_date: '2025-01-20',
    clemency_type: 'full pardon',
    status: 'active',
    crime_description: 'Tax fraud and conspiracy.',
    crime_category: 'white_collar',
    primary_connection_type: 'major_donor',
    corruption_level: 4,
    research_status: 'complete',
    post_pardon_status: 'under_investigation',
    post_pardon_notes: 'Subject of new federal probe.',
    summary_spicy: 'A spicy pardon take.',
    trump_connection_detail: 'Donated $500k to inaugural committee.',
    why_it_matters: 'Undermines rule of law.',
    pattern_analysis: 'Part of a donor-to-pardon pipeline.',
    donation_amount_usd: 500000,
    primary_source_url: 'https://example.com/pardon',
    source_urls: ['https://example.com/extra'],
    receipts_timeline: [
      { event_type: 'conviction', date: '2020-03-15', description: 'Convicted of tax fraud.' },
      { event_type: 'pardon_granted', date: '2025-01-20', description: 'Full pardon granted.' },
    ],
    original_sentence: '5 years federal prison',
  };

  it('maps corruption level as dots', () => {
    const item = pardonDetailToItem(fullPardon);
    const corruptionMeta = item.meta!.find(m => m.label === 'Corruption Level');
    expect(corruptionMeta?.value).toBe('●●●●○');
  });

  it('formats donation amount', () => {
    const item = pardonDetailToItem(fullPardon);
    const donationMeta = item.meta!.find(m => m.label === 'Donation Amount');
    expect(donationMeta?.value).toBe('$500,000');
  });

  it('maps connection type label', () => {
    const item = pardonDetailToItem(fullPardon);
    const connMeta = item.meta!.find(m => m.label === 'Trump Connection');
    expect(connMeta?.value).toBe('Major Donor');
  });

  it('includes pardon date and crime in meta', () => {
    const item = pardonDetailToItem(fullPardon);
    expect(item.meta!.find(m => m.label === 'Pardon Date')?.value).toBe('2025-01-20');
    expect(item.meta!.find(m => m.label === 'Crime')?.value).toBe('white_collar');
    expect(item.meta!.find(m => m.label === 'Original Sentence')?.value).toBe('5 years federal prison');
  });

  it('includes post-pardon status when not quiet', () => {
    const item = pardonDetailToItem(fullPardon);
    expect(item.meta!.find(m => m.label === 'Post-Pardon Status')?.value).toBe('Under Investigation');
  });

  it('skips post-pardon status when quiet', () => {
    const item = pardonDetailToItem({ ...fullPardon, post_pardon_status: 'quiet' });
    expect(item.meta!.find(m => m.label === 'Post-Pardon Status')).toBeUndefined();
  });

  it('maps sections matching prod names', () => {
    const item = pardonDetailToItem(fullPardon);
    const headings = item.sections!.map(s => s.heading);
    expect(headings).toContain('The Connection');
    expect(headings).toContain('The Real Story');
    expect(headings).toContain('Why It Matters');
    expect(headings).toContain('The Pattern');
    expect(headings).toContain('The Receipts');
    expect(headings).toContain('What Happened Next');
  });

  it('renders receipts timeline as formatted text', () => {
    const item = pardonDetailToItem(fullPardon);
    const receipts = item.sections!.find(s => s.heading === 'The Receipts');
    expect(receipts?.content).toContain('CONVICTION');
    expect(receipts?.content).toContain('2020-03-15');
    expect(receipts?.content).toContain('PARDON_GRANTED');
  });

  it('skips null sections', () => {
    const sparse = pardonDetailToItem({ ...fullPardon, trump_connection_detail: null, pattern_analysis: '', receipts_timeline: null, post_pardon_notes: null });
    const headings = sparse.sections!.map(s => s.heading);
    expect(headings).toEqual(['The Real Story', 'Why It Matters']);
  });

  it('includes nickname in headline', () => {
    const item = pardonDetailToItem(fullPardon);
    expect(item.headline_spicy).toBe('John Doe ("Johnny")');
  });

  it('corruption dots clamps at 5', () => {
    const item = pardonDetailToItem({ ...fullPardon, corruption_level: 7 });
    const corruptionMeta = item.meta!.find(m => m.label === 'Corruption Level');
    expect(corruptionMeta?.value).toBe('●●●●●');
  });
});
