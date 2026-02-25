# SCOTUS PROD Deployment — Session Handoff (Feb 22)

## What Was Completed

### Phase 1.5: Database + Edge Functions — DONE
- **18 migrations** applied to PROD in 4 groups (A-D), all verified
- Tables: `scotus_cases`, `scotus_sync_state`, `scotus_opinions`, `content_revisions`, `qa_gold_examples`, `qa_overrides`, `qa_batches`, `qa_batch_items`, `admin.content_history`, `admin.action_log`
- RLS policies, triggers, indexes, RPC functions all verified
- **5 edge functions** deployed via CLI: `qa-run`, `qa-batch`, `qa-override`, `qa-history`, `trigger-enrichment` — all return 401 (auth gate working)
- PRs merged: #78 (scripts/scotus + enrichment modules), #79 (hotfix: qa-issue-types.js)

### Phase 2: Backfill — DONE
- `ENABLE_PROD_SCHEDULES` = `true` (set during session)
- 1362 total cases in PROD DB (1220 from 2020 term + 142 OT2024+)
- OT2024+ status: 94 enriched, 47 flagged, 1 failed, 0 pending
- 51 cases are `is_public=true` (merits), 91 non-public (cert/procedural)
- Total enrichment cost: $0.36
- Sync state URL reset to `date_filed__gte=2024-10-01` for future runs

### Phase 3: Enable + Verify — BLOCKED
- **SCOTUS frontend code is NOT on main** — `app.js` on main has 0 ScotusFeed references
- `?tab=scotus` shows placeholder text on trumpytracker.com
- API confirmed working (anon key returns 51 public cases)

## What Still Needs to Get to Main

**The root problem:** PR #77 merged backend (migrations, workflows, edge functions) but NOT frontend. Multiple PRs were needed to fix missing scripts (#78, #79). Now the frontend delta is the final blocker.

### Files needing PR to main (11 files, ~2725 lines):
```
public/app.js                  (+640 lines — ScotusFeed component, tone system, alarm labels)
public/admin.html              (+43 lines)
public/eo-app.js               (+115 lines)
public/pardons-app.js          (+59 lines)
public/pardons.html            (+11 lines)
public/shared/feature-flags.js (+148 lines — NEW file)
public/shared/flags-prod.json  (+9 lines — NEW file, scotus: false)
public/shared/flags-test.json  (+9 lines — NEW file)
public/shared/tone-system.json (+107 lines — NEW file)
public/themes.css              (+469 lines — NEW file)
public/style-preview.html      (+1146 lines — NEW file, test-only?)
```

### Approach for Next Session
1. `git diff --stat main..test -- public/` to verify file list
2. Check `style-preview.html` — likely test-only, skip per `.claude/test-only-paths.md`
3. Create deployment branch from main, checkout files from test
4. PR to main, wait for AI review, merge
5. Verify `https://trumpytracker.com/?tab=scotus` shows cases
6. Flip feature flag: set `scotus: true` in `flags-prod.json` (separate PR or same)
7. Close ADO tickets: 354, 82, 81, 80

## ADO Ticket Status
- **ADO-354 + ADO-82**: Backend complete, frontend PR needed → keep at "Ready for Prod"
- **ADO-81**: scripts/scotus now on main (PR #78) → can close after frontend lands
- **ADO-80**: Parent epic → close after children done
