import { describe, it, expect } from 'vitest';
import {
  storyToItem,
  detailToItem,
  adaptActiveResponse,
  CATEGORY_LABELS,
  type RawStory,
  type DetailResponse,
} from '@/lib/adapter';

const makeStory = (overrides: Partial<RawStory> = {}): RawStory => ({
  id: 16878,
  story_hash: 'abc123',
  primary_headline: 'Test headline neutral',
  primary_source: 'Reuters',
  primary_source_url: 'https://reuters.com/article/test',
  primary_source_domain: 'reuters.com',
  primary_actor: 'Actor',
  last_updated_at: '2026-05-15T10:00:00Z',
  first_seen_at: '2026-05-14T08:00:00Z',
  status: 'active',
  severity: 'moderate',
  alarm_level: 3,
  category: 'democracy_elections',
  topic_tags: ['elections', 'europe'],
  source_count: 4,
  has_opinion: false,
  summary_neutral: 'A neutral summary of events.',
  summary_spicy: 'A spicy take on what happened.',
  ...overrides,
});

describe('storyToItem', () => {
  it('maps all fields correctly', () => {
    const item = storyToItem(makeStory());
    expect(item.id).toBe(16878);
    expect(item.type).toBe('stories');
    expect(item.alarm).toBe(3);
    expect(item.category).toBe('Democracy & Elections');
    expect(item.status).toBe('active');
    expect(item.published).toBe('2026-05-14T08:00:00Z');
    expect(item.updated).toBe('2026-05-15T10:00:00Z');
    expect(item.headline_spicy).toBe('Test headline neutral');
    expect(item.headline_neutral).toBe('Test headline neutral');
    expect(item.dek).toBe('A neutral summary of events.');
    expect(item.body).toBe('');
    expect(item.sources).toEqual([{ label: 'Reuters', url: 'https://reuters.com/article/test' }]);
    expect(item.tags).toEqual(['elections', 'europe']);
  });

  it('no field is undefined', () => {
    const item = storyToItem(makeStory());
    for (const [key, value] of Object.entries(item)) {
      expect(value, `field "${key}" should not be undefined`).not.toBeUndefined();
    }
  });

  it('prefers alarm_level over severity text', () => {
    const item = storyToItem(makeStory({ alarm_level: 4, severity: 'minor' }));
    expect(item.alarm).toBe(4);
  });

  it('falls back to severity text when alarm_level is null', () => {
    expect(storyToItem(makeStory({ alarm_level: null, severity: 'critical' })).alarm).toBe(5);
    expect(storyToItem(makeStory({ alarm_level: null, severity: 'severe' })).alarm).toBe(4);
    expect(storyToItem(makeStory({ alarm_level: null, severity: 'moderate' })).alarm).toBe(3);
    expect(storyToItem(makeStory({ alarm_level: null, severity: 'minor' })).alarm).toBe(2);
    expect(storyToItem(makeStory({ alarm_level: null, severity: 'low' })).alarm).toBe(1);
    expect(storyToItem(makeStory({ alarm_level: null, severity: 'positive' })).alarm).toBe(0);
  });

  it('defaults to alarm 2 when both are null', () => {
    const item = storyToItem(makeStory({ alarm_level: null, severity: null }));
    expect(item.alarm).toBe(2);
  });

  it('maps all 11 category values', () => {
    for (const [snake, display] of Object.entries(CATEGORY_LABELS)) {
      const item = storyToItem(makeStory({ category: snake }));
      expect(item.category).toBe(display);
    }
  });

  it('category null defaults to Other', () => {
    const item = storyToItem(makeStory({ category: null }));
    expect(item.category).toBe('Other');
  });

  it('category unknown value defaults to Other', () => {
    const item = storyToItem(makeStory({ category: 'unknown_value' }));
    expect(item.category).toBe('Other');
  });

  it('headline_spicy uses primary_headline', () => {
    const item = storyToItem(makeStory({ summary_spicy: 'Long spicy summary...' }));
    expect(item.headline_spicy).toBe('Test headline neutral');
  });

  it('dek falls back to summary_spicy when summary_neutral is null', () => {
    const item = storyToItem(makeStory({ summary_neutral: null, summary_spicy: 'Spicy fallback.' }));
    expect(item.dek).toBe('Spicy fallback.');
  });

  it('dek defaults to empty string when both summaries are null', () => {
    const item = storyToItem(makeStory({ summary_neutral: null, summary_spicy: null }));
    expect(item.dek).toBe('');
  });

  it('tags defaults to empty array when topic_tags is null', () => {
    const item = storyToItem(makeStory({ topic_tags: null }));
    expect(item.tags).toEqual([]);
  });

  it('sources is empty when primary_source_url is null', () => {
    const item = storyToItem(makeStory({ primary_source_url: null }));
    expect(item.sources).toEqual([]);
  });

  it('source label falls back to domain when primary_source is null', () => {
    const item = storyToItem(makeStory({ primary_source: null, primary_source_domain: 'example.com' }));
    expect(item.sources[0].label).toBe('example.com');
  });
});

describe('detailToItem', () => {
  it('maps articles to sources', () => {
    const data: DetailResponse = {
      story: makeStory(),
      articles: [
        {
          id: 'art-1', url: 'https://example.com/a1', url_hash: 'h1',
          title: 'Article One', source_name: 'Example', source_domain: 'example.com',
          published_at: '2026-05-14T08:00:00Z', content_type: 'news_report',
          opinion_flag: false, excerpt: 'excerpt', metadata: null,
          is_primary_source: true, similarity_score: 0.95, matched_at: '2026-05-14T09:00:00Z',
        },
        {
          id: 'art-2', url: 'https://other.com/a2', url_hash: 'h2',
          title: null, source_name: 'Other News', source_domain: 'other.com',
          published_at: '2026-05-14T10:00:00Z', content_type: 'opinion',
          opinion_flag: true, excerpt: null, metadata: null,
          is_primary_source: false, similarity_score: 0.8, matched_at: '2026-05-14T11:00:00Z',
        },
      ],
    };

    const item = detailToItem(data);
    expect(item.sources).toHaveLength(2);
    expect(item.sources[0]).toEqual({ label: 'Article One', url: 'https://example.com/a1' });
    expect(item.sources[1]).toEqual({ label: 'Other News', url: 'https://other.com/a2' });
  });

  it('skips articles without url', () => {
    const data: DetailResponse = {
      story: makeStory(),
      articles: [
        {
          id: 'art-1', url: '', url_hash: 'h1',
          title: 'No URL', source_name: 'Src', source_domain: 'd.com',
          published_at: null, content_type: null,
          opinion_flag: false, excerpt: null, metadata: null,
          is_primary_source: false, similarity_score: null, matched_at: null,
        },
      ],
    };

    const item = detailToItem(data);
    expect(item.sources).toEqual([{ label: 'Reuters', url: 'https://reuters.com/article/test' }]);
  });

  it('sets body from summary_neutral', () => {
    const data: DetailResponse = {
      story: makeStory({ summary_neutral: 'The body text.' }),
      articles: [],
    };
    const item = detailToItem(data);
    expect(item.body).toBe('The body text.');
  });

  it('body falls back through summary_spicy then primary_headline', () => {
    const data1: DetailResponse = {
      story: makeStory({ summary_neutral: null, summary_spicy: 'Spicy body.' }),
      articles: [],
    };
    expect(detailToItem(data1).body).toBe('Spicy body.');

    const data2: DetailResponse = {
      story: makeStory({ summary_neutral: null, summary_spicy: null, primary_headline: 'Headline as body.' }),
      articles: [],
    };
    expect(detailToItem(data2).body).toBe('Headline as body.');
  });

  it('no field is undefined', () => {
    const data: DetailResponse = { story: makeStory(), articles: [] };
    const item = detailToItem(data);
    for (const [key, value] of Object.entries(item)) {
      expect(value, `field "${key}" should not be undefined`).not.toBeUndefined();
    }
  });
});

describe('adaptActiveResponse', () => {
  it('returns items, nextCursor, hasMore', () => {
    const result = adaptActiveResponse({
      items: [makeStory(), makeStory({ id: 16879 })],
      next_cursor: 'cursor_abc',
      has_more: true,
    });
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBe('cursor_abc');
    expect(result.hasMore).toBe(true);
  });

  it('handles empty response', () => {
    const result = adaptActiveResponse({
      items: [],
      next_cursor: null,
      has_more: false,
    });
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
    expect(result.hasMore).toBe(false);
  });
});
