import { describe, it, expect } from 'vitest';
import { getFilterConfig } from '@/lib/filters';

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

  it('pardons corruption pills have named labels', () => {
    const config = getFilterConfig('pardons');
    const corr = config.dimensions.find(d => d.key === 'corruption');
    expect(corr).toBeDefined();
    const labels = corr!.options.map(o => o.label);
    expect(labels).toContain('Pay-to-Play');
    expect(labels).toContain('Friends & Fam');
    expect(labels).toContain('Swamp');
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
