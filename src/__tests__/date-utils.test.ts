import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fmtDate, relDate } from '@/lib/date-utils';

describe('fmtDate', () => {
  it('formats date-only ISO string', () => {
    expect(fmtDate('2026-04-14')).toBe('14 Apr 2026');
  });

  it('formats full ISO datetime', () => {
    expect(fmtDate('2026-04-14T12:00:00Z')).toBe('14 Apr 2026');
  });

  it('formats another date correctly', () => {
    expect(fmtDate('2026-01-01')).toBe('1 Jan 2026');
  });
});

describe('relDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns today for current date', () => {
    expect(relDate('2026-05-17')).toBe('today');
  });

  it('returns yesterday', () => {
    expect(relDate('2026-05-16')).toBe('yesterday');
  });

  it('returns Xd ago for 3 days', () => {
    expect(relDate('2026-05-14')).toBe('3d ago');
  });

  it('returns Xd ago for 6 days', () => {
    expect(relDate('2026-05-11')).toBe('6d ago');
  });

  it('returns Xw ago for 2 weeks', () => {
    expect(relDate('2026-05-03')).toBe('2w ago');
  });

  it('returns Xmo ago for 2 months', () => {
    expect(relDate('2026-03-17')).toBe('2mo ago');
  });
});
