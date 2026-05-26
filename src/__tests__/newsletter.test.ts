// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { isValidEmail, EMAIL_RE } from '@/lib/newsletter';

describe('isValidEmail', () => {
  it('accepts valid emails', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('a.b+c@domain.co.uk')).toBe(true);
    expect(isValidEmail('test@sub.domain.org')).toBe(true);
  });

  it('rejects invalid emails', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('@domain.com')).toBe(false);
    expect(isValidEmail('user@')).toBe(false);
    expect(isValidEmail('user @domain.com')).toBe(false);
    expect(isValidEmail('user@domain')).toBe(false);
  });

  it('trims whitespace', () => {
    expect(isValidEmail('  user@example.com  ')).toBe(true);
  });

  it('regex matches server-side pattern', () => {
    expect(EMAIL_RE.source).toBe('^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$');
  });
});
