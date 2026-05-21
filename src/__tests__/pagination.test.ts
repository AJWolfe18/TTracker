import { describe, it, expect } from 'vitest';
import { getPageWindow } from '@/components/Pagination';

describe('getPageWindow', () => {
  it('shows all pages when total <= 7', () => {
    expect(getPageWindow(1, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('shows all pages when total is 1', () => {
    expect(getPageWindow(1, 1)).toEqual([1]);
  });

  it('returns empty for total 0', () => {
    expect(getPageWindow(1, 0)).toEqual([]);
  });

  it('shows ellipsis for page 1 of 20', () => {
    const win = getPageWindow(1, 20);
    expect(win[0]).toBe(1);
    expect(win[1]).toBe(2);
    expect(win).toContain('...');
    expect(win[win.length - 1]).toBe(20);
  });

  it('shows correct window for page 5 of 20', () => {
    const win = getPageWindow(5, 20);
    expect(win).toEqual([1, '...', 4, 5, 6, '...', 20]);
  });

  it('shows correct window for last page', () => {
    const win = getPageWindow(20, 20);
    expect(win[win.length - 1]).toBe(20);
    expect(win[win.length - 2]).toBe(19);
    expect(win).toContain('...');
    expect(win[0]).toBe(1);
  });

  it('shows no left ellipsis when near start', () => {
    const win = getPageWindow(2, 20);
    expect(win[0]).toBe(1);
    expect(win[1]).toBe(2);
    expect(win[2]).toBe(3);
  });

  it('shows no right ellipsis when near end', () => {
    const win = getPageWindow(19, 20);
    expect(win).toContain(18);
    expect(win).toContain(19);
    expect(win).toContain(20);
  });
});
