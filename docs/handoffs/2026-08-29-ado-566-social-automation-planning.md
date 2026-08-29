# Handoff: ADO-566 Social Automation Planning (August 29, 2026)

## What happened

Planning-only session. No app code changed.

1. **Housekeeping from the August 26 session** (no handoff had been written for it):
   - ADO-568 (homepage first paint) was already shipped to PROD via PR #134 and Closed.
   - ADO-515 verified AC-by-AC and **Closed**. Only AC 7 (Threads clipboard fallback) was never built; accepted as a gap and documented on the card.
   - Project memory refreshed (it still thought 568 was in flight).
2. **ADO-566 delivered and Closed**: `docs/features/growth/prd-social-automation.md` + `plan-social-automation.md`.
3. **Decisions Josh made** (recorded with dates in PRD section 0): Facebook Page first (he already has the Page); draft-then-approve for month 1; branded receipt-style card, no outlet photos, no AI images; no money ask yet; hourly "top pick" is a dial, off at launch; alarm-5 stories/EOs/pardons always post.
4. **Card design chosen**: the receipt (paper slip on black). Canvas with the chosen card, a 140-char worst-case headline, and the two rejected directions on page 2: https://claude.ai/code/artifact/a77a84dd-3904-412c-ab32-aa76363abe8c. Slip rows: Filed under (Story / Executive Order / SCOTUS / Pardon) and an alarm badge = level number + spicy label ("5 · Constitutional Dumpster Fire"); no "Sources cited" row.
5. **ADO cards**: created 571 (card renderer), 572 (draft queue + admin Social tab), 573 (Facebook poster + workflow, with Josh's token checklist), 574 (cadence + digest), all children of Epic 299. Retired 131/149/236/249 as duplicates (Removed).

## Cost

$0/month for the whole v1 (Netlify Edge, GitHub Actions ~240 min/mo of the free 2,000, Graph API free, Discord webhook already in use).

## Next session

Run `/start-work ADO-571`. Read the plan's S1 section and the design canvas Main artboard first; the Satori card must reproduce the receipt layout (flex only; rotate + box-shadow are supported). The `og-card-props.mjs` mapper is testable in Node and shared with the Deno edge function.

Before ADO-573 can post, Josh does the ~30-minute Meta token setup (PRD section 6 / checklist on the card) and adds `FB_PAGE_ID` + `FB_PAGE_ACCESS_TOKEN` GitHub secrets.

## Gotchas learned

- The ADO PAT cannot create tags: `System.Tags` on create fails with TF401289. Create without tags.
- The design canvas working files live in the session scratchpad (ephemeral); the published canvas is the source of truth for the card markup.

## Verification

Docs-only: no QA suite run, no code review pass (nothing under `src/`, `scripts/`, `supabase/`, or `migrations/` changed).
