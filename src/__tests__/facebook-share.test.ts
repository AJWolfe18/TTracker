import { describe, it, expect } from 'vitest';
import { facebookShareUrl, FB_APP_ID } from '../lib/facebook-share';

describe('facebookShareUrl (ADO-575)', () => {
  const page = 'https://trumpytracker.com/detail/16936?ref=x&y=1';
  const u = new URL(facebookShareUrl(page));

  it('targets the official Share Dialog, not sharer.php (share_channel hangs at Posting)', () => {
    expect(u.origin + u.pathname).toBe('https://www.facebook.com/dialog/share');
    expect(facebookShareUrl(page)).not.toContain('sharer.php');
  });

  it('carries app_id, encoded href, and display=popup', () => {
    expect(u.searchParams.get('app_id')).toBe(FB_APP_ID);
    expect(u.searchParams.get('href')).toBe(page);
    expect(u.searchParams.get('display')).toBe('popup');
    expect(facebookShareUrl(page)).toContain('href=https%3A%2F%2Ftrumpytracker.com%2Fdetail%2F16936%3Fref%3Dx%26y%3D1');
  });

  it('never sends the deprecated quote param', () => {
    expect(u.searchParams.has('quote')).toBe(false);
  });
});
