import { describe, it, expect } from 'vitest';
import { sanitizeLike, buildIlikeOr, buildFtsParam, buildPostgrestUrl, parseContentRange } from '@/lib/postgrest';

describe('sanitizeLike', () => {
  it('escapes % wildcard', () => {
    expect(sanitizeLike('10%')).toBe('10\\%');
  });
  it('escapes _ wildcard', () => {
    expect(sanitizeLike('user_name')).toBe('user\\_name');
  });
  it('escapes * wildcard', () => {
    expect(sanitizeLike('test*')).toBe('test\\*');
  });
  it('handles empty string', () => {
    expect(sanitizeLike('')).toBe('');
  });
  it('preserves unicode', () => {
    expect(sanitizeLike('café')).toBe('café');
  });
  it('escapes multiple special chars', () => {
    expect(sanitizeLike('100% of user_*')).toBe('100\\% of user\\_\\*');
  });
  it('preserves parentheses and commas', () => {
    expect(sanitizeLike('case (test), other')).toBe('case (test), other');
  });
});

describe('buildIlikeOr', () => {
  it('builds single column', () => {
    expect(buildIlikeOr(['title'], 'trump')).toBe('or=(title.ilike.*trump*)');
  });
  it('builds multiple columns', () => {
    const result = buildIlikeOr(['title', 'summary', 'order_number'], 'tariff');
    expect(result).toBe('or=(title.ilike.*tariff*,summary.ilike.*tariff*,order_number.ilike.*tariff*)');
  });
  it('URL-encodes spaces', () => {
    const result = buildIlikeOr(['title'], 'executive order');
    expect(result).toContain('executive%20order');
  });
  it('escapes and encodes special chars', () => {
    const result = buildIlikeOr(['title'], '10%');
    expect(result).toContain('10%5C%25');
  });
  it('returns empty string for empty query', () => {
    expect(buildIlikeOr(['title'], '')).toBe('');
  });
  it('returns empty string for whitespace query', () => {
    expect(buildIlikeOr(['title'], '   ')).toBe('');
  });
  it('trims whitespace', () => {
    const result = buildIlikeOr(['title'], '  trump  ');
    expect(result).toBe('or=(title.ilike.*trump*)');
  });
});

describe('buildFtsParam', () => {
  it('builds with default config', () => {
    expect(buildFtsParam('search_vector', 'trump')).toBe('search_vector=wfts(english).trump');
  });
  it('uses custom config', () => {
    expect(buildFtsParam('sv', 'test', 'simple')).toBe('sv=wfts(simple).test');
  });
  it('returns empty for empty query', () => {
    expect(buildFtsParam('sv', '')).toBe('');
  });
  it('returns empty for whitespace', () => {
    expect(buildFtsParam('sv', '  ')).toBe('');
  });
  it('URL-encodes spaces', () => {
    expect(buildFtsParam('sv', 'trump tariff')).toBe('sv=wfts(english).trump%20tariff');
  });
});

describe('buildPostgrestUrl', () => {
  it('computes offset from page 1', () => {
    const { url } = buildPostgrestUrl('http://api', 'stories', {
      select: 'id', filters: [], order: 'id.desc', limit: 20, page: 1,
    });
    expect(url).toContain('offset=0');
  });
  it('computes offset from page 3', () => {
    const { url } = buildPostgrestUrl('http://api', 'stories', {
      select: 'id', filters: [], order: 'id.desc', limit: 20, page: 3,
    });
    expect(url).toContain('offset=40');
  });
  it('includes filters', () => {
    const { url } = buildPostgrestUrl('http://api', 'eos', {
      select: 'id', filters: ['is_public=eq.true', 'category=eq.health'], order: 'date.desc', limit: 10, page: 1,
    });
    expect(url).toContain('is_public=eq.true');
    expect(url).toContain('category=eq.health');
  });
  it('skips empty filter strings', () => {
    const { url } = buildPostgrestUrl('http://api', 'eos', {
      select: 'id', filters: ['is_public=eq.true', ''], order: 'date.desc', limit: 10, page: 1,
    });
    expect(url).not.toContain('&&');
  });
  it('includes Prefer header', () => {
    const { headers } = buildPostgrestUrl('http://api', 'eos', {
      select: 'id', filters: [], order: 'id.desc', limit: 20, page: 1,
    });
    expect(headers['Prefer']).toBe('count=exact');
  });
});

describe('parseContentRange', () => {
  it('parses standard range', () => {
    expect(parseContentRange('0-19/250')).toBe(250);
  });
  it('parses zero total', () => {
    expect(parseContentRange('*/0')).toBe(0);
  });
  it('parses single item', () => {
    expect(parseContentRange('0-0/1')).toBe(1);
  });
  it('returns null for null header', () => {
    expect(parseContentRange(null)).toBeNull();
  });
  it('returns null for malformed header', () => {
    expect(parseContentRange('invalid')).toBeNull();
  });
});
