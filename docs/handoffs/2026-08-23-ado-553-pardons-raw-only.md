# 2026-08-23 — ADO-553: Pardons raw-only + the stale-prompt discovery

**Session type:** interactive with Josh, evening→late night. **ADO-553: CLOSED** (one AC
deliberately outstanding, see below). Three PRs merged: #123 (test), #124 (PROD deploy),
#125 (agent-prompt fix to main). NOTE: this handoff was written while a CONCURRENT session
held the worktree (`deploy/tracker-544-545-546`, mid-cherry-pick) — it is uncommitted;
commit it from the next test-branch session.

## What shipped

1. **`pardons-tracker.yml` raw-only** (EO/ADO-540 pattern): budget guard + Perplexity +
   GPT phases stripped; deployed to main via PR #124; dispatched runs green on BOTH the
   feature branch (TEST DB) and main (PROD DB) — AC5 validated with a real run.
2. **Deleted** `research-pardons.yml`, `enrich-pardons.yml`, and the 4 legacy npm entry
   points (`research:pardons*`, `enrich:pardons*`). Scripts remain in git history only.
3. **`trigger-enrichment` edge fn** (redeployed TEST + PROD, PROD by Josh — the classifier
   blocks Claude from PROD deploys): the pardon path no longer dispatches a workflow.
   Re-enrich = null-fields reset → agent's next daily run picks it up. Locked rows
   (`prompt_version='locked'`, e.g. Jan 6) get 409 via `or=(prompt_version.is.null,
   prompt_version.neq.locked)` — plain `.neq` would wrongly exclude NULL rows. Sets
   `is_public=false` (public APIs gate only on is_public; a nulled row would serve a
   hollow card). Cost $0 (`?? 0.003` — `||` was eating the falsy zero). GITHUB_PAT is
   now story-only. admin.html toast says "reset and unpublished", spinner clears
   immediately (completion is hours away).
4. **PROD data fix executed**: reset SQL committed by Josh (24 rows, ids 119–142, bounded
   to the 2026-08-20 UTC window, manual COMMIT after in-transaction sanity check). Bad GPT
   copy went dark instantly. Agent fired (session cse_01MMet82a2dNn1YAYAMXLbKV).
   Row 143 (Spurlock) = the "25th row": already agent-enriched, sitting in the
   needs_review queue — Josh should review/publish it in admin.

## The big discovery: PROD agents ran stale v1 prompts since May 31

Re-enriched rows came back `prompt_version='v1'`. Cause: the v1.1 prompt upgrade
(5865910) and the tone-system binding + em-dash removal for ALL 3 agents (e8e580d)
only ever landed on **test** — cloud agents hard-reset to `origin/main` every run.
Masked for months by the zero-new-pardons scraper bug. **Fixed: PR #125** cherry-picked
both to main (024ec92, AI review pass) — pardons, SCOTUS, and EO prompts now current
on main. Durable rule saved to memory: agent-prompt commits must reach main in the
same session they merge to test.

## Codex rounds (4 total, all verified before acting)

R1: admin re-enrich button broke (real — fixed via #3 above); reset SQL unbounded +
auto-COMMIT (real — bounded window + manual COMMIT); TOAST-size guard (applied).
R2: hollow-public-card (real — is_public=false added); `|| 0.003` falsy-zero (real).
Post-merge on #125: F1 "097 writes nonexistent columns" — FALSE (migration 071 adds
prompt_version + enrichment_meta); F3 "wealthy_unknown rejected by CHECK" — FALSE
(migration 062 widened it; PROD serves such rows, ids 62/64); F2 hardcoded `id=3` in
migration 097 — accepted as low-priority hardening (match `recipient_type='group'` +
Jan 6 name + row-count assert instead). Verdicts posted on PR #125.

## TEST verification done before the PROD deploy

Real workflow run green; edge-fn reset exercised on TEST id 2 (Bannon) then restored
from snapshot; locked guard verified on TEST id 3 (0 rows). Side finding now in memory:
**pardons has NO prevent-update trigger** (the restore succeeded) — the 553 card's
trigger caveat doesn't apply to this table.

## Next session — in order

1. **Verify/finish the cohort**: tonight's rows enriched before #125 merged are v1.
   Re-run the reset SQL (`scripts/maintenance/2026-08-22-ado-553-pardons-legacy-reset.sql`,
   on test) with predicate changed to `AND prompt_version = 'v1'` (window keeps it safe),
   re-fire `trig_018LUznaUWwijFhMZLp8kYE2`. Success = ids 119–142 all `v1.1`, tone voice,
   colors on the pardons page. If broken → reopen ADO-553.
2. **Tracker PROD deploy** (544/545/546) — but FIRST check the concurrent session's
   `deploy/tracker-544-545-546` branch state; it may be done or abandoned mid-conflict.
   Main moved twice tonight (2a759d0, 024ec92) — rebase/re-branch if stale.
3. **ADO-547** (admin fronts UI — card is the contract).
4. Small items: migration 097 predicate hardening (Codex F2); Josh deletes the
   `PERPLEXITY_API_KEY` GitHub secret (zero consumers); Spurlock review; commit this
   handoff.
