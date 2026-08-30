# Handoff: ADO-575 - Facebook share via official Share Dialog (August 29, 2026)

**Ticket:** ADO-575 (Testing - code on `test`, verification blocked on a Facebook account setting) · **Epic:** 299 · **Cost:** $0

## Problem
`facebook.com/sharer/sharer.php` now redirects to Facebook's `share_channel` dialog, which hangs at "Posting" forever when posting as the TrumpyTracker Page. The card renderer (ADO-571) is fine; the endpoint was the problem.

## What shipped (commit `43ce885` on `test`)

| File | Change |
|---|---|
| `src/lib/facebook-share.ts` | New. `facebookShareUrl(pageUrl)` -> `https://www.facebook.com/dialog/share?app_id=2112907866245245&href=<encoded>&display=popup`. No `quote` (deprecated). `FB_APP_ID` is a public identifier; the App Secret is not needed and must never be committed. |
| `src/pages/Detail.tsx` | `shareToFacebook()` uses the helper; `trackShare('facebook')` unchanged. |
| `src/components/ShareCard.tsx` | `shareUrl('Facebook')` uses the helper. Twitter/Threads untouched. |
| `index.html` | `<meta property="fb:app_id" content="2112907866245245">` (clears the Sharing Debugger "Missing Properties" warning). |
| `src/__tests__/facebook-share.test.ts` | Pins endpoint, params, encoding, and absence of `quote`. |

Verification run: `tsc --noEmit` clean, vitest 180/180, `npm run qa:smoke` green, `vite build` bundle contains `facebook.com/dialog/share` and zero `sharer.php`.

## Browser check on TEST
`test--taupe-capybara-0ff2ed.netlify.app/detail/16936` -> Share -> Facebook opened a new tab at the exact dialog URL. It did **not** redirect to `share_channel`, so the copy-link fallback from the ticket is NOT needed. Facebook then rendered:

> User opted out of platform - The action attempted is disallowed, because the user has opted out of Facebook platform.

That is a setting on the logged-in Facebook account, not code.

## Josh to do (blocks AC 1 and AC 2)
1. On the Facebook account used for sharing: Settings & privacy -> Settings -> Apps and websites -> turn **on** "Apps, websites and games". If Chrome is switched into the TrumpyTracker *Page* profile, switch back to the personal profile first (Page profiles cannot use platform apps).
2. Retry Share -> Facebook on the TEST story page. Expect the dialog with the receipt card preview; post as the Page; should publish in under 15s.
3. If the dialog says "Can't load URL: the domain of this URL isn't included in the app's domains", add `trumpytracker.com` and `test--taupe-capybara-0ff2ed.netlify.app` under App Dashboard -> Settings -> Basic -> App Domains.
4. Screenshot the result onto the ADO card (AC 1 asks for it).

## AC status
- AC 1 (PROD story page dialog + post <15s): NOT YET VERIFIED (blocked above; also needs the PROD deploy)
- AC 2 (admin ShareCard): NOT YET VERIFIED (same blocker; same helper, same URL)
- AC 3 (fb:app_id, no debugger warning): MET on TEST for the meta tag; re-run the Sharing Debugger on a PROD URL after deploy
- AC 4 (X/Threads/Reddit/native unchanged): MET (diff touches only the Facebook branch)
- AC 5 (vitest + qa:smoke green, trackShare fires): MET

## PROD deployment
Cherry-pick `43ce885` (plus this handoff commit if wanted) onto a deploy branch from `main`, PR, squash merge. No migrations, secrets, flags, or edge-function changes. After deploy: run the Sharing Debugger on one PROD story URL (Scrape Again) to confirm the warning is gone, then do the Share -> Facebook post as the Page.

## Gotcha for future browser sessions
`claude-in-chrome` `javascript_tool` redacts any returned value that contains a query string (`[BLOCKED: Cookie/query string data]`). Read the opened tab's URL from `tabs_context_mcp` instead, and assert URL shape in vitest.
