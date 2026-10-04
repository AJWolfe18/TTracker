# Traffic report: monthly re-run (ADO-596)

A plain-English "who's coming to the site" report for Josh, built from PostHog plus GA4. First run: October 3, 2026 (private claude.ai page, link on ADO-596). A re-run should take one short session.

## Before you start
- Josh logs into PostHog in Chrome: https://us.posthog.com, **Continue with Google** (ajwolfe37@gmail.com), project 572949. Claude cannot enter passwords, and the session cookie expires every few weeks.
- GA4 property `a362615303p498284230` (measurement id `G-5MDT4HFMNB`) normally stays logged in.
- Both tools filter out Josh's home IP.

## PostHog (main source: counts people, clicks and devices)
Run these in the logged-in PostHog tab with claude-in-chrome `javascript_tool`. The query API accepts the session cookie when the request carries the `posthog_csrftoken` cookie value in an `X-CSRFToken` header. No API key needed.

```js
const csrf=(document.cookie.match(/posthog_csrftoken=([^;]+)/)||[])[1]||'';
const q = async (sql) => (await (await fetch('/api/projects/572949/query/', {method:'POST',
  headers:{'Content-Type':'application/json','X-CSRFToken':csrf},
  body: JSON.stringify({query:{kind:'HogQLQuery', query: sql}})})).json()).results;
const W = "event='$pageview' and timestamp >= toDateTime('2026-08-24')";
```

| Section | HogQL |
|---|---|
| Event totals | `select event, count(), count(distinct person_id) from events where timestamp >= toDateTime('2026-08-24') group by event order by 2 desc` |
| People per week | `select toStartOfWeek(timestamp) wk, count(distinct person_id), count() from events where ${W} group by wk order by wk` |
| Pages per person | `select n, count() from (select person_id, count() n from events where ${W} group by person_id) group by n order by n` |
| Came back on a 2nd day | `select countIf(days>1), count() from (select person_id, count(distinct toDate(timestamp)) days from events where ${W} group by person_id)` |
| Sources | `select properties.$referring_domain, count(distinct person_id) from events where ${W} group by 1 order by 2 desc` |
| Pages | `select properties.$pathname, count(), count(distinct person_id) from events where ${W} group by 1 order by 2 desc limit 15` |
| Devices / browsers / country | `$device_type`, `$browser`, `$geoip_country_code`, same shape |
| Dead swipes (phone UX) | `select properties.$pathname, count(), count(distinct person_id) from events where event='$dead_swipe' group by 1` |
| Story opens / source clicks | events `card_open`, `source_click`, `share_click`, grouped by `person_id` |

Free-tier check: `await fetch('/api/billing/').then(r=>r.json())`. Read `subscription_level` (expect `free`), `has_active_subscription` (expect false), and `products[].current_usage` against `free_allocation` (product analytics: 1,000,000 events a month).

**Check for one heavy visitor.** On October 3, a single person (desktop, August 25-26, almost certainly Josh testing at launch) made every story open and source click. Look at the pages-per-person split and report the numbers with and without that person.

## GA4 (cross-check: visits, time reading)
Open these report URLs in Chrome and read them with `get_page_text`. Change the two dates to match the run.
- Traffic sources: `https://analytics.google.com/analytics/web/#/a362615303p498284230/reports/explorer?params=_u..nav%3Dmaui%26_u.date00%3D20260824%26_u.date01%3D20261003&r=lifecycle-traffic-acquisition-v2`
- New vs returning users: same URL with `&r=lifecycle-user-acquisition`
- Browser: same URL with `&r=user-technology-detail`

GA4 counts fewer people than PostHog (30 vs 40 on the first run) and lumps Chrome on iPhone in with Chrome. Use PostHog for the people, device and click numbers, and GA4 only for time spent reading.

## Report shape
Sections, in this order: headline (3 sentences), how many people, where they come from, what they read, phone vs. computer, coming back, newsletter, the three ADO-564 numbers (story open rate, source click rate, newsletter sign-ups), what to do (1 to 3 items, using the decision rules in the ADO-564 comment). Give every number a one-sentence plain-English meaning. Publish to the same claude.ai page (its URL is on ADO-596) so the link stays the same.

## Sanity check that tracking still works
Load https://trumpytracker.com in Chrome, then run:
`performance.getEntriesByType('resource').map(e=>new URL(e.name)).filter(u=>/google-analytics|posthog/.test(u.hostname)).map(u=>u.hostname+u.pathname)`.
Expect `www.google-analytics.com/g/collect` and `us-assets.i.posthog.com/...`. Leave the query strings out of the output; the Chrome tool blocks them.
