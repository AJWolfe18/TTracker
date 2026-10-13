import { describe, it, expect } from 'vitest';
import { getFilterConfig } from '@/lib/filters';
import { TONE_SYSTEM } from '@/tokens';
import toneJson from '../../public/shared/tone-system.json';

describe('getFilterConfig', () => {
  it('returns stories config', () => {
    const config = getFilterConfig('stories');
    expect(config.table).toBe('stories');
    expect(config.baseFilters).toContain('status=eq.active');
    expect(config.baseFilters).toContain('summary_neutral=not.is.null');
    expect(config.searchVectorColumn).toBe('search_vector');
  });

  it('returns eos config with correct search columns', () => {
    const config = getFilterConfig('eos');
    expect(config.table).toBe('executive_orders');
    expect(config.searchColumns).toEqual(['title', 'section_what_it_means', 'order_number']);
    expect(config.baseFilters).toContain('is_public=eq.true');
  });

  it('returns scotus config with correct search columns', () => {
    const config = getFilterConfig('scotus');
    expect(config.table).toBe('scotus_cases');
    expect(config.searchColumns).toEqual(['case_name', 'case_name_short', 'summary_spicy']);
  });

  it('returns pardons config with search vector', () => {
    const config = getFilterConfig('pardons');
    expect(config.table).toBe('pardons');
    expect(config.searchVectorColumn).toBe('search_vector');
    expect(config.baseFilters).toContain('is_public=eq.true');
  });

  it('stories has category and alarm dimensions', () => {
    const config = getFilterConfig('stories');
    const keys = config.dimensions.map(d => d.key);
    expect(keys).toContain('category');
    expect(keys).toContain('alarm');
  });

  it('scotus has term, case_type, and impact dimensions', () => {
    const config = getFilterConfig('scotus');
    const keys = config.dimensions.map(d => d.key);
    expect(keys).toContain('term');
    expect(keys).toContain('case_type');
    expect(keys).toContain('impact');
  });

  it('pardons corruption pills match the card labels, 5 down to 0 (ADO-629)', () => {
    const config = getFilterConfig('pardons');
    const corr = config.dimensions.find(d => d.key === 'corruption');
    expect(corr).toBeDefined();
    const pills = corr!.options.slice(1);
    expect(corr!.options[0]).toEqual({ label: 'All', urlValue: '', apiValue: '' });
    expect(pills.map(o => o.urlValue)).toEqual(['5', '4', '3', '2', '1', '0']);
    for (const o of pills) {
      expect(o.apiValue).toBe(o.urlValue);
      expect(o.label).toBe(TONE_SYSTEM.labels.pardons[Number(o.urlValue) as 0 | 1 | 2 | 3 | 4 | 5].spicy);
      // the shared JSON the legacy page and the agents read says the same thing
      expect(o.label).toBe((toneJson.labels.pardons as unknown as Record<string, { spicy: string }>)[o.urlValue].spicy);
    }
    expect(pills.map(o => o.label)).toContain('Actual Mercy');
  });

  it('pardons connection dropdown covers every DB-allowed value (migration 062)', () => {
    // Mirrors pardons_primary_connection_type_check — a value the agent can
    // write but the dropdown can't filter renders unreachable (Codex P2, PR #126)
    const dbValues = [
      'mar_a_lago_vip', 'major_donor', 'family', 'political_ally',
      'campaign_staff', 'business_associate', 'jan6_defendant',
      'fake_electors', 'celebrity', 'cabinet_connection', 'lobbyist',
      'wealthy_unknown', 'no_connection',
    ];
    const config = getFilterConfig('pardons');
    const conn = config.dimensions.find(d => d.key === 'connection');
    expect(conn).toBeDefined();
    const values = conn!.options.map(o => o.apiValue);
    for (const v of dbValues) expect(values).toContain(v);
  });

  it('eos category dimension maps to correct DB column', () => {
    const config = getFilterConfig('eos');
    const cat = config.dimensions.find(d => d.key === 'category');
    expect(cat?.postgrestColumn).toBe('category');
    expect(cat?.postgrestOp).toBe('eq');
  });

  it('defaults to stories for unknown tab', () => {
    const config = getFilterConfig('unknown');
    expect(config.table).toBe('stories');
  });
});
