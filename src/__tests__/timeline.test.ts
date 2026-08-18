import { describe, it, expect } from 'vitest';
import {
  storyRowToEntry,
  eoRowToEntry,
  scotusRowToEntry,
  pardonRowToEntry,
  mergeEntries,
  SOURCE_ROUTES,
  type TimelineEntry,
} from '../lib/timeline';

describe('timeline row adapters', () => {
  it('maps a story row, preferring alarm_level over severity', () => {
    const e = storyRowToEntry({
      id: 12, primary_headline: 'He did a thing', first_seen_at: '2026-08-01T10:00:00Z',
      alarm_level: 4, severity: 'watch',
    });
    expect(e).toEqual({
      id: 12, source: 'stories', date: '2026-08-01T10:00:00Z',
      headline: 'He did a thing', alarm: 4,
    });
  });

  it('falls back to severity mapping when alarm_level is null', () => {
    const e = storyRowToEntry({
      id: 1, primary_headline: 'x', first_seen_at: '2026-01-01', alarm_level: null, severity: 'critical',
    });
    expect(e.alarm).toBe(5);
  });

  it('defaults story alarm to 2 when both fields are missing', () => {
    const e = storyRowToEntry({ id: 1, primary_headline: 'x', first_seen_at: '2026-01-01' });
    expect(e.alarm).toBe(2);
  });

  it('clamps out-of-range alarm values', () => {
    expect(eoRowToEntry({ id: 'eo_1', title: 't', date: '2026-01-01', alarm_level: 99 }).alarm).toBe(5);
    expect(eoRowToEntry({ id: 'eo_1', title: 't', date: '2026-01-01', alarm_level: -3 }).alarm).toBe(0);
  });

  it('keeps EO string ids intact (PROD uses varchar ids)', () => {
    const e = eoRowToEntry({ id: 'eo_abc123', title: 'Order', date: '2026-02-02', alarm_level: 3 });
    expect(e.id).toBe('eo_abc123');
    expect(e.source).toBe('eos');
  });

  it('uses case_name_short when scotus case_name is missing', () => {
    const e = scotusRowToEntry({
      id: 7, case_name: null, case_name_short: 'Trump v. X',
      decided_at: '2026-06-01', ruling_impact_level: 4,
    });
    expect(e.headline).toBe('Trump v. X');
  });

  it('prefixes pardon headlines and includes nickname when present', () => {
    const plain = pardonRowToEntry({
      id: 3, recipient_name: 'Some Guy', nickname: null, pardon_date: '2026-03-03', corruption_level: 4,
    });
    expect(plain.headline).toBe('Pardoned: Some Guy');
    const nick = pardonRowToEntry({
      id: 4, recipient_name: 'Some Guy', nickname: 'The Fixer', pardon_date: '2026-03-03', corruption_level: 4,
    });
    expect(nick.headline).toBe('Pardoned: Some Guy ("The Fixer")');
  });
});

describe('mergeEntries', () => {
  const mk = (over: Partial<TimelineEntry>): TimelineEntry => ({
    id: 1, source: 'stories', date: '2026-01-01', headline: 'h', alarm: 2, ...over,
  });

  it('merges groups into one ascending chronological list', () => {
    const merged = mergeEntries([
      [mk({ id: 1, date: '2026-03-01' }), mk({ id: 2, date: '2026-01-15' })],
      [mk({ id: 'eo_9', source: 'eos', date: '2026-02-10' })],
    ]);
    expect(merged.map(e => e.date)).toEqual(['2026-01-15', '2026-02-10', '2026-03-01']);
  });

  it('drops entries with no date or no headline', () => {
    const merged = mergeEntries([[
      mk({ id: 1 }),
      mk({ id: 2, date: '' }),
      mk({ id: 3, headline: '' }),
    ]]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe(1);
  });

  it('sorts ties deterministically by id', () => {
    const merged = mergeEntries([[
      mk({ id: 20, date: '2026-01-01' }),
      mk({ id: 10, date: '2026-01-01' }),
    ]]);
    expect(merged.map(e => e.id)).toEqual([10, 20]);
  });
});

describe('SOURCE_ROUTES', () => {
  it('maps every source to its detail route prefix', () => {
    expect(SOURCE_ROUTES).toEqual({
      stories: 'detail', eos: 'eos', scotus: 'scotus', pardons: 'pardons',
    });
  });
});
