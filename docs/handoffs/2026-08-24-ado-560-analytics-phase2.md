# Handoff: ADO-560 — Product Analytics v1, Phase 2: named KPI events in the React app

**Date:** August 24, 2026
**Ticket:** ADO-560 (Testing) under Epic 254
**Commit:** `70f6a92` on `test`
**Cost:** $0 — no new vendors, no new network calls; every event rides the Phase 1 `track()` wrapper (PostHog free tier + GA4).

---

## What Josh needs to do

Nothing for this card. It ships to PROD with Phase 5 (ADO-563), which is the only place real PostHog/GA4 events can be observed.

If you want to see it working on TEST: open DevTools console on the TEST site and click around — every event logs as `[analytics:off-prod] <event> {props}` because the environment gate (ADO-558) keeps TEST silent to the vendors.

---

## What shipped

Every PRD §4 event in the React app now fires through the typed wrapper from `src/lib/analytics.ts` (ADO-559). Files touched: `Home.tsx`, `Detail.tsx`, `TrackerSpine.tsx`, `useFilters.ts`, `analytics.ts` (one type literal).

| Event | Surface | Props seen in verification |
|---|---|---|
| `card_open` | Home hero / featured / grid | `{item_type:'eo', alarm_level:5, feed_position:'hero', tab:'eos'}`, `'featured'`, numeric index |
| `card_open` | **TrackerSpine entries** | `{item_type:'story', alarm_level:5, feed_position:1, tab:'tracker'}` |
| `card_open` | Detail "Keep Reading" | `feed_position:'related'`, `tab:'detail'` (path currently dead — see below) |
| `source_click` | Detail sources list | `{item_type:'story', outlet_domain:'nytimes.com', source_position:0}` |
| `source_click` | Detail Receipts timeline (pardons) | `{item_type:'pardon', outlet_domain:'justice.gov', source_position:1}` |
| `share_click` | Detail share row | channels `native`, `x`, `threads`, `facebook`, `reddit`, `copy_link` |
| `correction_click` | Detail mailto | `{item_type:'story'}` |
| `filter_apply` | Any feed tab pill/dropdown, clear-all | `{tab:'eos', filter_key:'alarm', filter_value:'5'}`, clear = `{filter_key:'all', filter_value:'clear'}` |
| `filter_apply` | **Tracker view + source toggles** | `{tab:'tracker', filter_key:'view', filter_value:'5'}`, `{filter_key:'source_pardons', filter_value:'off'}` |
| `search` | Any feed tab | `{tab:'eos', query_length:6}` — fires once after the 300ms debounce, never per keystroke, never the text |
| `pagination` | Any feed tab | `{tab:'eos', page:2}` |

### Design decisions

- **`card_open` belongs to the surface, not `Card`.** `Home` builds a per-slot closure (`openWithTracking(item, position)`) and hands it to the hero `<h1>`, the featured card, and each grid card. `Card`'s `onOpen` interface is unchanged, so its keyboard handler is covered for free.
- **Two plan gaps closed.** The plan was written the morning the Tracker became the homepage (Q7, PR #118). `TrackerSpine` is therefore a fourth open surface and its controls are filters; both now instrument with `tab: 'tracker'` so they never blend into News-tab numbers.
- **`useFilters` is the single choke point** for filter/search/pagination. Every tab funnels through it, so instrumenting the hook once covers stories/EOs/SCOTUS/pardons. `tab` comes from `config.tabType`.
- **Tracker `toggleSource` records the resulting state** (`on`/`off`), not the click, so "how many readers hide pardons" is a direct count.
- **`outlet_domain` is hostname only** (`www.` stripped) — the outbound URL never reaches a vendor.

### Property hygiene check (PRD §4)
No free text anywhere: the search box sends length only, sources send hostname only, shares/corrections send item type only. The runtime allowlist in `analytics.ts` would drop anything else regardless.

---

## Two pieces of dead code worth knowing about (not fixed — out of scope)

1. `src/components/ShareCard.tsx` has zero importers. Not instrumented; delete or wire it in a later card.
2. `Detail`'s "Keep Reading" strip is instrumented but `App.tsx` passes `relatedItems={[]}` unconditionally, so it never renders today. The `'related'` `FeedPosition` literal is there for when related items come back.

---

## How to verify

```bash
npx tsc --noEmit -p .        # clean
npx vitest run               # 174/174
npm run qa:smoke             # exit 0
```

Manual: `npx vite --port 5199`, open `http://127.0.0.1:5199/?ff_rap_sheet=true`, DevTools console. Click a spine entry, a toggle, a share button, a source; type in a search box on `/eos`. Each action logs one `[analytics:off-prod]` line with the props above. Gotcha from this session: clicking via accessibility refs in the automation tool silently missed the Tracker buttons — coordinate clicks worked.

## Review

Two-pass review done inline (no agents per Josh's token rule). One finding fixed before commit: the `analytics` import and `TRACKER_TAB` const had landed mid-import-block in `TrackerSpine.tsx`. No Codex review — this went straight to `test` as a direct push, not a PR.

## Next — resequenced August 24, 2026 (Josh)

PROD rollout pulled forward: **ADO-563 is now "Phase 5a: early PROD rollout of Phases 1-2 + Engagement dashboard" and runs NEXT.** Plan §"Phase 5a" + PRD §0 carry the decision. 561/562 follow, with their own small deploy (5b).

### Kickoff prompt for the next session (supervised — Josh present)

```
/start-work ADO-563: Phase 5a early PROD rollout of analytics. Follow docs/features/analytics/plan-product-analytics-v1.md "Phase 5a" exactly.
1. Pre-gate: confirm PostHog project 572949 has no payment method.
2. Deploy branch from main; cherry-pick 877c0bf, ed39e72, 70f6a92 from test (check .claude/test-only-paths.md). If ADO-554 has passed AC7, fold in the Tracker debut (migration 112 on PROD BEFORE the code cherry-picks; seed PROD fronts; flip rap_sheet last) — ask Josh first.
3. PR to main, @codex review, merge; Netlify deploys.
4. Verify on trumpytracker.com with claude-in-chrome: GA4 real-time still receiving + no TEST/localhost hosts; PostHog live events show $pageview and every Phase 2 named event from real clicks; replay sampled + masked.
5. Build the Content Engagement dashboard in PostHog via claude-in-chrome (Josh logged in); paste URL on ADO-563.
6. Update docs/ARCHITECTURE.md current-state tables; create the 2-week north-star follow-up card; close 558/559/560/563.
```

Cost: $0. No migrations/edge functions/secrets unless the Tracker debut is folded in (then migration 112 only).
