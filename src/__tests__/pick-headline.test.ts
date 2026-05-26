import { describe, it, expect } from 'vitest';
import { pickHeadline } from '@/lib/pick-headline';

describe('pickHeadline', () => {
  const item = {
    headline_spicy: 'The spicy take',
    headline_neutral: 'The neutral take',
  };

  it('returns headline_spicy when mode is spicy', () => {
    expect(pickHeadline(item, 'spicy')).toBe('The spicy take');
  });

  it('returns headline_neutral when mode is neutral', () => {
    expect(pickHeadline(item, 'neutral')).toBe('The neutral take');
  });

  it('defaults to spicy for unknown mode', () => {
    expect(pickHeadline(item, 'other')).toBe('The spicy take');
  });

  it('handles empty headline_spicy gracefully', () => {
    const emptySpicy = { headline_spicy: '', headline_neutral: 'Neutral' };
    expect(pickHeadline(emptySpicy, 'spicy')).toBe('');
  });

  it('handles empty headline_neutral gracefully', () => {
    const emptyNeutral = { headline_spicy: 'Spicy', headline_neutral: '' };
    expect(pickHeadline(emptyNeutral, 'neutral')).toBe('');
  });
});
