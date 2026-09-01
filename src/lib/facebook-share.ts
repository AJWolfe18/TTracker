/**
 * Facebook share URL builder (ADO-575).
 *
 * `facebook.com/sharer/sharer.php` now redirects to Facebook's `share_channel`
 * dialog, which hangs at "Posting" forever when posting as a Page (reproduced
 * August 29, 2026). The official Share Dialog does not. `quote` is deprecated
 * and dropped; the receipt card comes from the page's og:image (ADO-571).
 *
 * The App ID is a public identifier (it ships in every fb:app_id meta tag), so
 * it is fine in client code. Never put the App Secret anywhere near here.
 */
export const FB_APP_ID = '2112907866245245';

export function facebookShareUrl(pageUrl: string): string {
  const params = new URLSearchParams({ app_id: FB_APP_ID, href: pageUrl, display: 'popup' });
  return `https://www.facebook.com/dialog/share?${params.toString()}`;
}
