# ADO-537 — Finish Unmerge Verification + PROD Promotion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get ADO-537 (admin Judge tab manual merge + unmerge) verified end-to-end on TEST and deployed to PROD in the load-bearing order, so a wrong story merge is reversible before the ADO-531 backfill runs 12k stories through the Judge.

**Architecture:** No new feature code is written in this plan — all of ADO-537 is already committed on `test` and code-reviewed: the six feature commits `50b2ce6`..`dfdaf6a` **plus `5134782`** (codex round-3 foldin that added `NOTIFY pgrst` to migration 105 — Task 6 must cherry-pick all seven). What is missing is (a) migration 105 was never applied to TEST, so the unmerge path has never executed even once, and (b) nothing from ADO-537 has reached PROD. This plan applies the SQL, redeploys the two edge functions, drives a full merge→unmerge round trip through the admin UI, then promotes via a PR to `main` with a strict SQL → edge functions → frontend ordering.

**Tech Stack:** Supabase Postgres (migrations pasted by hand into the SQL Editor), Supabase Edge Functions (Deno, deployed via `npx supabase functions deploy`), vanilla-React `public/admin.html` served by Netlify, ADO for status.

**Cost:** $0. No AI/API calls, no new infra, no new secrets. Egress is a handful of single-row PostgREST reads.

## Global Constraints

- **Branch:** all work happens on `test`. `git push origin main` is BLOCKED — PROD ships via PR only.
- **I cannot run raw SQL.** Every migration step is Josh pasting a file into the Supabase SQL Editor. I verify the result read-only via PostgREST.
- **Project refs:** TEST = `wnrjrywpcadwutfykflu` · PROD = `osjbulmltfpcoldydexg`.
- **TEST admin URL:** `https://test--taupe-capybara-0ff2ed.netlify.app/admin.html` → Judge tab (password-gated).
- **PROD admin URL:** `https://trumpytracker.com/admin.html` → Judge tab.
- **Load-bearing deploy order per environment (violating it silently breaks the audit trail):**
  **both migrations (either order between themselves) → edge functions → `admin.html`.**
  - `104_manual_merge_source.sql` adds `'manual'` to the source CHECK; `105_unmerge_story.sql` adds
    `unmerged_at`, the `'unmerge'` verdict, and the `unmerge_story` RPC. They touch *different*
    constraints, and 104's own header says order between migrations doesn't matter — so 104-before-105
    is convention, **not** a real dependency. Don't treat it as one, or you'll doubt the arrows that are.
  - The two real arrows: **migrations before the edge functions** (functions call `unmerge_story` and
    insert `source='manual'` / `verdict='unmerge'` rows), and **edge functions before `admin.html`**
    (the UI's buttons call them).
- **Decline the Supabase SQL Editor's "Enable RLS" suggestion** on both migrations (known dashboard gotcha — it injects `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` into function bodies and breaks dollar-quoting).
- **Migration 103 stays reserved** for the ADO-531 backfill plan. Do not renumber 104/105.
- Do not touch `docs/features/clustering-judge/backfill-plan.md` scope — ADO-531 is a separate ticket.

## Rollback

**Point of no return: Task 8 Step 1.** Nothing before it mutates a single PROD story. Tasks 7.1–7.4 are
all reversible, and the SQL and edge functions are *inert* on their own — `admin-judge-merge` is
password-gated and the Judge tab is its only caller, so **reverting the UI alone is a complete rollback
of user-facing behaviour.**

Roll back in **reverse deploy order: UI → functions → SQL.**

**Pull the trigger if any of these happen:** an `admin-judge-merge` 500 on PROD · an unmerge reporting
success while `merged_into_story_id` stays non-null · any `log_error` warning on PROD (means a CHECK
didn't take, i.e. a migration didn't apply) · the dashboard failing to render after the PR merge.

**(a) `admin.html` / the PR merge — fully reversible**
- Fastest, do this first if the dashboard is broken: Netlify → trumpytracker.com → Deploys → last good
  deploy → **Publish deploy**. Instant, no git.
- Durable (a squash merge is one commit, and `main` needs a PR):
  ```bash
  git fetch origin && git checkout -b revert/ado-537 origin/main
  git revert --no-edit <squash-sha>
  git push -u origin revert/ado-537
  gh pr create --base main --title "Revert ADO-537 admin merge/unmerge UI"
  ```

**(b) Edge functions — no CLI version rollback; rollback means redeploying older source**
- **Never run `supabase functions download` inside this repo** — it overwrites
  `supabase/functions/admin-judge-log/index.ts` with the deployed (old) build, and the next deploy then
  ships stale code. The older source already lives in git; use that:
- `admin-judge-log` (pre-existing): `git checkout 93d952c -- supabase/functions/admin-judge-log/index.ts`,
  deploy, then `git checkout HEAD -- supabase/functions/admin-judge-log/index.ts` to restore the worktree.
- `admin-judge-merge` is new to PROD, so rollback is deletion:
  `npx supabase functions delete admin-judge-merge --project-ref osjbulmltfpcoldydexg`
- Only after the UI is off, or the live UI 404s on every button.

**(c) Migration 105 — functions drop cleanly, the column does not**
```sql
DROP FUNCTION IF EXISTS public.unmerge_story(BIGINT, TEXT);
DROP FUNCTION IF EXISTS public.recompute_story_from_members(BIGINT);
```
Safe — both are new objects with no other callers (`merge_stories` inlines the same recompute recipe
rather than calling the new function). The verdict CHECK narrows back **only if no `unmerge` rows exist**:
```sql
SELECT COUNT(*) FROM clustering_judge_log WHERE verdict = 'unmerge';  -- must be 0
ALTER TABLE clustering_judge_log DROP CONSTRAINT IF EXISTS clustering_judge_log_verdict_check;
ALTER TABLE clustering_judge_log ADD CONSTRAINT clustering_judge_log_verdict_check
  CHECK (verdict IN ('merge','keep','uncertain'));
```
If it's non-zero, leave it widened — deleting audit rows to satisfy a rollback is worse than the rollback.

**Do NOT run `ALTER TABLE story_merge_audit DROP COLUMN unmerged_at` once any row is non-null.** It won't
corrupt stories, but it destroys the only record of which snapshots were consumed. For a loser that was
unmerged and then re-merged — exactly what Task 8 Step 1 does — you'd be left with two snapshots for the
same loser, both looking unconsumed, with no way to tell which is current. The column is nullable and
free; keep it.

**(d) Migration 104 — treat as not rolled back.** Narrowing `source` back fails the moment one manual
merge is logged, and the only way to make it succeed is deleting audit rows. It's a widened CHECK on one
column of a log table. Leave it.

**(e) If the PROD round trip (Task 8 Step 1) goes wrong** — two cases, very different blast radius:
- **The unmerge refuses or errors** (`not_merged_pair`, `survivor_moved`, `no_merge_snapshot`,
  `snapshot_mismatch`): **nothing to roll back.** `unmerge_story` is a single plpgsql body = one
  transaction, and every refusal returns before the first `UPDATE`. Read the reason, pick another pair.
- **The unmerge succeeds but the re-merge doesn't** — the only genuinely bad state, and it's live:
  1. Read the merge's reason code. `loser_already_merged` pointing at an unfamiliar survivor means the
     Judge cron beat you to it — check where it points before touching anything.
  2. `survivor_is_merged` means S itself got merged away; re-merge L into S's *current* survivor.
  3. If `admin-judge-merge` is 500ing, re-merge from the PROD SQL Editor (`p_run_id` is required, and a
     fresh one dodges the 10/run cap):
     ```sql
     SELECT merge_stories(<L>::bigint, <S>::bigint,
                          'manual-recovery-' || extract(epoch from now())::bigint::text);
     ```
  4. **Never** repair by hand-editing `stories.status` / `merged_into_story_id` / `article_story`. That
     reproduces the merge with no snapshot, and the next unmerge then works off a stale audit row.
- **The honest abort:** if the re-merge can't be made to work, the end state is L living as its own
  story. That is the pre-Judge state of the world, not corruption. Don't panic-edit rows.

## Current State (verified 2026-08-03)

| Artifact | `test` branch | TEST DB | `main` branch | PROD DB |
|---|---|---|---|---|
| migration 104 (manual source) | ✅ | ✅ applied | ❌ | ❌ |
| migration 105 (unmerge) | ✅ | ❌ **not applied** | ❌ | ❌ |
| `admin-judge-merge` edge fn | ✅ | ⚠️ phase-1 build deployed, pre-dates unmerge | ❌ | ❌ |
| `admin-judge-log` edge fn | ✅ (`VALID_VERDICTS` gained `'unmerge'`) | ⚠️ stale build | ✅ (older) | ✅ (older) |
| `admin.html` unmerge UI | ✅ | n/a | ❌ (Judge tab yes, unmerge no) | ❌ |

Already on `main` from ADO-533's go-live, do **not** redo: migrations 100/101/102, `candidate-generation.js` + `hybrid-clustering.js` tombstone exclusion, `stories-active/detail/search`, the Judge tab itself, `prompt-v1.md`, the live cron. The ⬜ boxes in `docs/features/clustering-judge/prod-deployment-manifest.md` §2–§5 are stale and get corrected in Task 8.

**TEST fixtures that already exist** (confirmed by query):
- `story_merge_audit` id=1: loser **16998** → survivor **16981**, snapshot holds 2 article ids, `run_id='smoke-test-20260706'`. Story 16981 currently holds 4 articles (2 own + 2 absorbed). No `clustering_judge_log` row, so **no UI unmerge button** for this pair.
- `story_merge_audit` id=2: loser **17085** → survivor **17087**, snapshot is **empty** (`loser_article_ids = []`), from Josh's 2026-07-18 manual-merge test. This one *does* have a log row (id=34, `source='manual'`, `merged=true`), so it is the only pair with a UI unmerge button today.
- Neither is a good article-restoration proof on its own, which is why Task 4 merges a fresh pair through the UI.
- **`stories.source_count` is NOT trustworthy on TEST.** The top active stories by `source_count`
  (17094/17092/17090/17088, all reporting 10) hold **zero** rows in `article_story` — they are
  QA-concurrency fixtures. Survivor 17087 reads 0 while its tombstone 17085 reads 1. Anywhere this plan
  needs "does this story actually have articles", it counts `article_story` rows instead.

---

### Task 1: Apply migration 105 to TEST

**Files:**
- Apply: `migrations/105_unmerge_story.sql` (no edits — apply as-is)

**Interfaces:**
- Produces: `story_merge_audit.unmerged_at` (TIMESTAMPTZ, nullable); `clustering_judge_log_verdict_check` allowing `'unmerge'`; `public.recompute_story_from_members(p_story_id BIGINT) RETURNS VOID`; `public.unmerge_story(p_loser_id BIGINT, p_run_id TEXT DEFAULT NULL) RETURNS JSONB`. Both functions SECURITY DEFINER, service_role-only.
- `unmerge_story` returns on success: `{ok:true, loser_id, survivor_id, articles_restored, audit_id}`. On refusal: `{ok:false, reason}` where reason ∈ `invalid_ids | missing_run_id | no_merge_snapshot | loser_not_found | not_merged | snapshot_mismatch | survivor_not_found | survivor_moved`.

- [ ] **Step 1: Hand the migration to Josh**

Tell Josh: open the TEST project SQL Editor (`wnrjrywpcadwutfykflu`), paste the entire contents of
`file:///C:/Users/Josh/GitHub/TTracker/migrations/105_unmerge_story.sql`, run it, and **decline the
"Enable RLS" suggestion** if the dashboard offers it. Everything below the `VERIFICATION` banner is
commented out and safe to include.

- [ ] **Step 2: Verify the column landed**

Run (Supabase TEST MCP):
```
GET /story_merge_audit?select=id,unmerged_at&limit=2
```
Expected: rows return with `"unmerged_at": null` — **not** the `42703 column ... does not exist`
error that this same query returns today.

- [ ] **Step 3: Verify the RPC exists and is service_role-locked**

Ask Josh to run these two read-only queries in the TEST SQL Editor (they are the verification block at
the bottom of the migration file):
```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conname = 'clustering_judge_log_verdict_check';

SELECT p.proname,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('unmerge_story','recompute_story_from_members');
```
Expected: the CHECK lists `'unmerge'`; both functions show `anon=f, authenticated=f, service_role=t`.
**If anon or authenticated is `t`, STOP** — Part E of the migration didn't run; re-run just that DO block.

- [ ] **Step 4: Confirm PostgREST sees the new RPC (schema cache)**

Migration 105 ends with `NOTIFY pgrst, 'reload schema'` (Part F) — verify it took before deploying
anything that calls the RPC. Run (Supabase TEST MCP, non-mutating):
```
POST /rpc/unmerge_story  {"p_loser_id": null}
```
Expected: **either** `{"ok": false, "reason": "invalid_ids"}` (the key has EXECUTE) **or** a `42501`
permission-denied (the key is anon and the Part E lockdown is working). Both outcomes prove the schema
cache knows the function. The failure this catches is `PGRST202` / "Could not find the function" —
if you see that, the cache is stale: Josh runs `NOTIFY pgrst, 'reload schema';` in the TEST SQL Editor
and re-check.

- [ ] **Step 5: No commit** — nothing in the repo changed in this task.

---

### Task 2: Redeploy both edge functions to TEST

**Files:**
- Deploy: `supabase/functions/admin-judge-merge/index.ts` (gained the `'unmerge'` action)
- Deploy: `supabase/functions/admin-judge-log/index.ts` (`VALID_VERDICTS` gained `'unmerge'`)

**Interfaces:**
- Consumes: `unmerge_story` RPC from Task 1. Deploying before Task 1 completes produces
  `Unmerge failed / function not found` — that ordering is the whole point of Task 1 going first.
- Produces: `POST /admin-judge-merge` accepting `{action:'preview'|'merge'|'unmerge', survivor_id, loser_id}`,
  password-gated via the `x-admin-password` header that `admin.html` already sends. For `'unmerge'` the
  two ids are just "the pair" — the function resolves which one is actually tombstoned into the other
  and refuses with `{ok:false, reason:'not_merged_pair'}` if neither is.

- [ ] **Step 1: Deploy both functions**

Run:
```bash
npx supabase functions deploy admin-judge-merge --project-ref wnrjrywpcadwutfykflu
npx supabase functions deploy admin-judge-log   --project-ref wnrjrywpcadwutfykflu
```
Expected: two successful deploys. A Docker warning is normal and non-fatal. If it asks to log in,
Josh runs `npx supabase login` once.

- [ ] **Step 2: Confirm the log function accepts the new verdict filter**

In the TEST admin Judge tab, select the **unmerge** verdict filter. Expected: an empty list, **not**
a 400 error. (A 400 means the stale `admin-judge-log` build is still live — redeploy.)

- [ ] **Step 3: No commit** — deploys don't change the repo.

---

### Task 3: Reverse the existing empty-snapshot merge (smallest real unmerge)

Exercises the UI → edge function → RPC path on the one pair that already has an unmerge button, before
creating new test data. Restores 0 articles by design.

**What this task actually proves:** the UI wiring, the edge function's pair resolution, tombstone
clearing, snapshot consumption, the `unmerge` log insert (which needs *both* 104 and 105 applied), and
the `not_merged_pair` guard.

**What it does NOT prove:** anything about article restoration. With `loser_article_ids = []` the restore
clause is `WHERE article_id = ANY(ARRAY[]::text[])` — trivially false, `v_moved = 0`. An array-type or
ID-format mismatch would sail straight through this task. That is Task 4's job; don't read a green Task 3
as "the feature works."

**Files:** none (UI-driven)

**Interfaces:**
- Consumes: `admin-judge-merge` `'unmerge'` action (Task 2), `unmerge_story` RPC (Task 1).

- [ ] **Step 1: Record the before-state**

Run (Supabase TEST MCP):
```
GET /stories?id=in.(17085,17087)&select=id,status,merged_into_story_id,source_count
```
Expected now: `17085` = `status:'merged_into'`, `merged_into_story_id:17087`. `17087` = `status:'active'`.

- [ ] **Step 2: Click unmerge**

Josh: TEST admin → Judge tab → find log row id 34 (`manual` / `merge`, headlines
"Trump signs executive order slashing federal workforce protections" ↔ "Federal judge temporarily
blocks workforce executive order") → click **unmerge** → confirm in the popup.

Expected banner: `Unmerged #17085 from #17087 — 0 articles restored, story is live again.`
(0 is correct — this snapshot is empty.) **No** "Warning: Judge log write failed".

- [ ] **Step 3: Verify the tombstone cleared**

Run:
```
GET /stories?id=in.(17085,17087)&select=id,status,merged_into_story_id,source_count
```
Expected: `17085` = `status:'active'`, `merged_into_story_id:null`, and `source_count: 0` (the unmerge
recomputes it from real membership, which is zero — it currently reads a stale `1`).

- [ ] **Step 4: Verify the snapshot was consumed and the reversal logged**

Run:
```
GET /story_merge_audit?id=eq.2&select=id,loser_id,survivor_id,unmerged_at
GET /clustering_judge_log?select=id,source,verdict,story_id_a,story_id_b,run_id&order=id.desc&limit=3
```
Expected: audit id=2 has a non-null `unmerged_at`; a new log row with `source:'manual'`,
`verdict:'unmerge'`, `run_id` starting `manual-admin-`.

- [ ] **Step 5: Verify double-unmerge is refused**

Josh: click unmerge on that same row a second time.
Expected: `Unmerge not executed: Neither story is currently merged into the other (maybe already
unmerged?)` — the `not_merged_pair` guard, refused *before* the RPC. The stories must be unchanged.

- [ ] **Step 6: Note the TEST residue**

This leaves 17085 live on TEST as an empty story with zero articles. Harmless, but it will show up on
the TEST site. Either re-merge it via the Manual Merge card (survivor 17087, loser 17085) or accept it
and say so — don't leave it undocumented for the next session to rediscover.

- [ ] **Step 7: No commit.**

---

### Task 4: Full merge → unmerge round trip with real articles

The proof that matters: articles actually move back and both stories' stats recompute.

**Files:** none (UI-driven)

**Interfaces:**
- Consumes: everything from Tasks 1–3.

- [ ] **Step 1: Confirm the two fixture stories still hold their articles**

> ⚠️ **Do NOT pick candidates by `source_count`.** On TEST it is unreliable: the highest-`source_count`
> active stories are synthetic QA-concurrency fixtures reporting `source_count: 10` with **zero** rows
> in `article_story` (verified — 17094/17092/17090/17088 all return `[]`). The plan's own fixture makes
> the same point: survivor 17087 reads `source_count: 0` while tombstone 17085 reads `1`. Selecting on
> `source_count` would silently repeat Task 3's zero-article non-proof while Step 4 told you to expect
> real restoration. **Membership in `article_story` is the only trustworthy signal.**

Fixtures chosen by actual membership (verified 2026-08-03):
- **S (survivor, KEEP)** = **17024** — "Supreme Court rejects Trump's bid to end birthright citizenship", 3 articles
- **L (loser, ABSORB)** = **17022** — "Supreme Court sides with GOP, loosens campaign spending rules", 2 articles

Re-verify before touching anything (the TEST RSS pipeline may have attached more articles since):
```
GET /stories?id=in.(17024,17022)&select=id,primary_headline,status,merged_into_story_id
GET /article_story?story_id=in.(17024,17022)&select=story_id,article_id
```
Expected: both `status:'active'` with `merged_into_story_id: null`; 17024 has ≥3 rows, 17022 has ≥2.
**Record the exact article_id lists — Step 5 compares against them.**

If either has since been merged or emptied, pick replacements the same way — count rows per story in
`GET /article_story?select=story_id&order=story_id.desc&limit=300` and choose two ids that each appear
at least twice, then confirm both are `active`. Known-good alternates: 17002 (4), 16982 (3), 17028 (2).

- [ ] **Step 2: Merge them through the UI**

Josh: TEST admin → Judge tab → **Manual Merge** card → survivor = **17024** (KEEP), loser = **17022**
(ABSORB) → **Preview** → confirm in the popup.

Expected: success banner naming articles moved; the preview must have shown both headlines and
`first_seen_at` for each.

- [ ] **Step 3: Verify the merge**

Run:
```
GET /stories?id=in.(17024,17022)&select=id,status,merged_into_story_id,source_count
GET /article_story?story_id=in.(17024,17022)&select=story_id,article_id
```
Expected: 17022 is `merged_into` pointing at 17024; **every article_id recorded on 17022 in Step 1 now
reads `story_id: 17024`**, and 17022 has zero rows. `source_count` on 17024 should equal the combined
membership — but treat membership as the pass/fail criterion and `source_count` as corroboration only
(see the Step 1 warning).

- [ ] **Step 4: Unmerge it**

Josh: the merge you just made appears as a new `manual`/`merge` row at the top of the Judge tab →
click **unmerge** → confirm.

Expected banner: `Unmerged #17022 from #17024 — 2 articles restored, story is live again.` — where the
count is **exactly the number of article_story rows 17022 held in Step 1** (2 unless the TEST RSS
pipeline attached more in the meantime). A count of 0 here is a FAILURE, not a pass.

- [ ] **Step 5: Verify full restoration**

Run:
```
GET /stories?id=in.(17024,17022)&select=id,status,merged_into_story_id,source_count,latest_article_published_at
GET /article_story?story_id=in.(17024,17022)&select=story_id,article_id
```
Expected: membership is **identical to the Step 1 state, article_id for article_id**; 17022 is `active`
with `merged_into_story_id: null`; both `source_count`s now equal their true membership (the unmerge
recomputes them, so these are freshly correct even if they were stale before).

Known-and-accepted deviations (documented in migration 105's header, do not treat as failures):
17024's `first_seen_at` / `last_updated_at` stay widened and its `topic_slugs` keeps the union — those
were never snapshotted, they are cosmetic, and they self-heal on the survivor's next enrichment.

- [ ] **Step 6: If anything above failed, stop and debug before proceeding**

Use superpowers:systematic-debugging. Any code fix means a new commit on `test` plus a re-run of
Tasks 3–4. Do not carry a known defect into the PROD promotion.

- [ ] **Step 7: No commit** (unless Step 6 produced a fix).

---

### Task 5: QA suite + acceptance criteria on the card

ADO-537 currently has **no acceptance criteria**, and the `/start-work` hard gate forbids advancing a
story whose AC can't be verified. Write them, then verify them.

**Files:**
- Modify: ADO work item 537 (Acceptance Criteria field)

- [ ] **Step 1: Run the QA suite**

Run:
```bash
npm run qa:smoke
```
Expected: all 7 sub-suites pass (boundaries, integration, idempotency, concurrency, silent-skips,
eo-admin-unit, clustering-eval). Paste the real tail of the output into the ADO comment in Task 8 —
do not claim green without it.

**State plainly what this proves:** none of the seven suites touch `unmerge_story`, `admin-judge-merge`,
or the Judge tab. Green smoke means **no clustering regression** — worth having, but it is not evidence
for this feature. The feature evidence is Tasks 3 and 4. Don't let the PR body imply otherwise.

- [ ] **Step 2: Write the AC onto ADO-537**

Use the `/ado` skill's subagent write route (reuse the `ado-agent` if one is already running). ADO rich
text is HTML, not markdown:
```
Update work item 537, set /fields/Microsoft.VSTS.Common.AcceptanceCriteria to:
<ul>
<li>AC1: Admin Judge tab can merge two arbitrary stories (survivor kept / loser absorbed), with a preview showing both headlines + first_seen_at and a confirmation popup before anything executes.</li>
<li>AC2: Every manual merge writes a clustering_judge_log row with source='manual', verdict='merge' (migration 104), and a story_merge_audit snapshot of the loser's article ids.</li>
<li>AC3: Admin Judge tab can unmerge a merged pair: snapshot articles return to the loser, the tombstone clears (status='active', merged_into_story_id=NULL), and both stories' centroid/entities/source_count recompute (migration 105).</li>
<li>AC4: Unmerge writes a clustering_judge_log row with verdict='unmerge' and marks the story_merge_audit snapshot consumed (unmerged_at set), so the same merge cannot be reversed twice.</li>
<li>AC5: Guard paths refuse rather than corrupt: a pair that is not merged returns not_merged_pair (verified live on TEST). The survivor_moved guard and the confirm-button double-click guard are present and code-reviewed but NOT staged live (staging survivor_moved needs a three-merge setup; see plan self-review).</li>
<li>AC6: unmerge_story and recompute_story_from_members are SECURITY DEFINER, service_role-only (anon and authenticated EXECUTE revoked).</li>
<li>AC7: Deployed to PROD in order (migration 104 then 105, then admin-judge-merge + admin-judge-log, then admin.html) and proven with one real round trip on PROD.</li>
</ul>
```

- [ ] **Step 3: Mark AC1–AC6 verified**

Against the actual observed output from Tasks 1–4 — AC1/AC2 from Task 4 Steps 2–3, AC3 from Task 4
Step 5, AC4 from Task 3 Step 4 + Task 4, AC6 from Task 1 Step 3. AC7 stays open until Task 8.

AC5 is deliberately split-evidence (codex P2): its live half (`not_merged_pair`) is proven by Task 3
Step 5; its code-review half (`survivor_moved`, migration 105 lines 176–185, and the confirm-button
double-click guard in `admin.html`) is **not** staged live. The AC text itself now says which is which,
so marking AC5 MET against that text is honest — do not silently upgrade the code-review half to
"verified live" in the ADO comment. **Any AC you cannot evidence stays NOT MET** — fix it or write it
on the card.

- [ ] **Step 4: No commit.**

---

### Task 6: Build the PROD promotion PR

**Files:**
- Create branch: `deploy/ado-537-manual-merge-unmerge` from `origin/main`
- Cherry-pick: `50b2ce6`, `1646366`, `8b19b16`, `96187f1`, `c80b83f`, `dfdaf6a`

**Interfaces:**
- Produces: a PR to `main` carrying `migrations/104_*.sql`, `migrations/105_*.sql`,
  `supabase/functions/admin-judge-{merge,log}/index.ts`, `public/admin.html`, and the two
  clustering-judge doc updates. **The PR is created now but MERGED LAST** (Task 7 Step 4) — merging it
  ships `admin.html` to Netlify, which must land after the SQL and the edge functions.

- [ ] **Step 1: Create the deployment branch**

```bash
git fetch origin
git checkout -b deploy/ado-537-manual-merge-unmerge origin/main
```

- [ ] **Step 2: Cherry-pick the six ADO-537 commits in order, then the codex-foldin commit**

```bash
git cherry-pick 50b2ce6 1646366 8b19b16 96187f1 c80b83f dfdaf6a
git cherry-pick 5134782
```

`5134782` (codex round-3 foldins) MUST ride along: it added Part F (`NOTIFY pgrst, 'reload schema'`)
to `migrations/105_unmerge_story.sql`, and without it `main` would carry the pre-NOTIFY migration.
It will hit the same modify/delete conflict pattern as below — it also edits this plan doc, which does
not exist on `main`. Resolve the same way: `git rm docs/superpowers/plans/2026-08-03-ado-537-unmerge-verify-and-prod.md`
then `git cherry-pick --continue`. The plan doc stays test-only; only the migration change ships.

> ⚠️ **The first commit WILL conflict. This is expected and the resolution is counter-intuitive.**
> Verified by dry-run against `origin/main`:
> ```
> CONFLICT (modify/delete): docs/features/clustering-judge/backfill-plan.md
> deleted in HEAD and modified in 50b2ce6
> ```
> Cause: `backfill-plan.md` was created by `a3e896d` (the ADO-531 planning commit), which lives only on
> `test` and is deliberately **not** in this cherry-pick list. Commits `50b2ce6` and `1646366` each edit
> one line of it, so on `main` they have no base file.
>
> **Correct resolution — drop the file, do not restore it:**
> ```bash
> git rm docs/features/clustering-judge/backfill-plan.md
> git cherry-pick --continue
> ```
> Repeat for `1646366` if it conflicts the same way. Taking "the `test` version" instead would add the
> entire 114-line ADO-531 backfill plan to `main`, contradicting this plan's own scope constraint.
> The one-line edits being dropped are ADO-537 cross-references inside a doc that doesn't exist on
> `main` — nothing of value is lost, and the file ships with ADO-531 when that ticket promotes.

After the `backfill-plan.md` conflict is resolved the remaining 5 of the six apply clean and
`public/admin.html` auto-merges (verified). Sanity-check the result before pushing:
```bash
git diff --stat origin/main..HEAD
```
Expected: exactly **6** files — `migrations/104_manual_merge_source.sql`,
`migrations/105_unmerge_story.sql`, `supabase/functions/admin-judge-merge/index.ts`,
`supabase/functions/admin-judge-log/index.ts`, `public/admin.html`,
`docs/features/clustering-judge/prod-deployment-manifest.md` — and `migrations/105_unmerge_story.sql`
must contain `NOTIFY pgrst` (proves `5134782` made it). **If `backfill-plan.md` or the
`docs/superpowers/plans/` doc appears, a conflict was resolved the wrong way — redo it.**

Note: the resulting `admin.html` will differ from `test`'s by 6 unrelated lines (a "Pardons needs
review" block that is on `test` but not `main`). That is correct and out of scope here.

Deliberately **excluded**: `27ae8b2`, `16d62f4`, `4ecee8e` (ADO skill + MCP PAT docs). Dev tooling with
no runtime effect; they can ride a later docs PR.

- [ ] **Step 3: Push and open the PR**

Write the PR body to a file first (shell-agnostic — a Bash here-doc breaks if this runs under
PowerShell, and `--body-file` works everywhere). Save the content below as
`pr-body-ado-537.md` in the session scratchpad (or any path outside the repo), then:

```bash
git push -u origin deploy/ado-537-manual-merge-unmerge
gh pr create --base main --title "ADO-537: admin Judge tab manual merge + unmerge (PROD)" --body-file <path-to>/pr-body-ado-537.md
```

PR body content:
```markdown
## Summary
Promotes the ADO-537 admin Judge tab manual merge + unmerge to PROD. Human override for a wrong
Clustering Judge merge — the prerequisite safety net for the ADO-531 backfill.

## Deploy order (LOAD-BEARING — do not merge this PR first)
1. Apply `migrations/104_manual_merge_source.sql` in the PROD SQL Editor
2. Apply `migrations/105_unmerge_story.sql` in the PROD SQL Editor
3. `npx supabase functions deploy admin-judge-merge --project-ref osjbulmltfpcoldydexg`
   and redeploy `admin-judge-log` (its VALID_VERDICTS gained `unmerge`)
4. Merge this PR (ships `public/admin.html` via Netlify)

Merging before step 1 leaves manual merges executing with no Judge-tab audit row.

## Verified on TEST
Full merge → unmerge round trip through the admin UI: articles restored to the original story,
tombstone cleared, both stories recomputed, snapshot marked consumed, double-unmerge refused.
`npm run qa:smoke` green.

## Cost
$0 — no new infra, API calls, or secrets.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 4: Request the AI review**

**Capture the PR number from `gh pr create` — call it `<N>` — and use it explicitly from here on.** Task 6
Step 5 switches back to `test`, and a bare `gh pr merge` resolves *the PR for the current branch*, which
would error (or worse, hit the wrong PR).

```bash
gh pr comment <N> --body "@codex review"
```
Then check back with `gh pr view <N> --comments`. Address anything Critical/Important before Task 7.
Per `superpowers:receiving-code-review`: verify each claim against the code rather than agreeing
reflexively — but do not wave off a finding without a technical reason.

- [ ] **Step 5: Return to the test branch**

```bash
git checkout test
```

---

### Task 7: Deploy to PROD in order

**Files:**
- Apply to PROD: `migrations/104_manual_merge_source.sql`, then `migrations/105_unmerge_story.sql`
- Deploy to PROD: `admin-judge-merge`, `admin-judge-log`

- [ ] **Step 0: PRECONDITION — confirm migrations 101/102 actually ran on PROD**

Migration 105 Part A does `ALTER TABLE story_merge_audit ADD COLUMN ... unmerged_at`, and
`story_merge_audit` is **created by migration 101**. The repo proves 101's *code* is on `main`; it does
not prove the *SQL was executed* on PROD — and the deployment manifest still shows §1.2/§1.3 as
"PROD not applied". If 101 never ran, Task 7 Step 1 fails partway through.

Josh runs in the PROD SQL Editor:
```sql
-- 1) Tables created by 101 — both must be non-NULL
SELECT to_regclass('public.story_merge_audit')     AS audit_table,
       to_regclass('public.judge_run_merge_count') AS cap_table;

-- 2) merge_stories must be the 3-arg signature (2-arg = 101/102 never applied)
SELECT p.oid::regprocedure AS sig
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'merge_stories';

-- 3) 102's concurrency hardening actually present
SELECT pg_get_functiondef('merge_stories(bigint,bigint,text)'::regprocedure) LIKE '%FOR UPDATE%' AS has_102;

-- 4) Preflight for 104 (see note): must return 0, or ADD CONSTRAINT will error and roll back
SELECT COUNT(*) FROM clustering_judge_log WHERE source NOT IN ('inline','judge-agent','manual');
```
Expected: both tables non-NULL · `merge_stories(bigint,bigint,text)` · `has_102 = true` · count 0.

**If `story_merge_audit` is NULL:** stop. Apply `migrations/101_clustering_judge_hardening.sql` then
`migrations/102_merge_stories_concurrency.sql` to PROD first, re-run the checks, and note the correction
on the ADO card — it would mean the Judge has been merging on PROD without the hardening, which is a
finding in its own right (and also means `admin-judge-merge`'s 3-arg RPC call would have 500'd on every
PROD manual merge).

**If `merge_stories` shows 2 args, or `has_102` is false:** the missing migration goes in before 104/105.

Why check 4 lives *here* rather than after applying 104: the SQL Editor runs a pasted script as one
implicit transaction, so if bad rows existed, 104's `ADD CONSTRAINT` would error and its `DROP
CONSTRAINT` would roll back with it. Run after the fact it can never fail; run here it tells you
something either way.

- [ ] **Step 1: Josh applies both migrations to PROD**

PROD SQL Editor (`osjbulmltfpcoldydexg`), in this order, declining "Enable RLS" on both:
1. `file:///C:/Users/Josh/GitHub/TTracker/migrations/104_manual_merge_source.sql`
2. `file:///C:/Users/Josh/GitHub/TTracker/migrations/105_unmerge_story.sql`

Then the verification queries from each file's footer, and the grant check from Task 1 Step 3 against
PROD. **`anon=f, authenticated=f, service_role=t` is a hard gate — do not proceed if either function is
callable by anon.**

- [ ] **Step 2: Deploy the two edge functions**

Do **NOT** run `supabase functions download` here (codex P1): it writes into this repo's
`supabase/functions/admin-judge-log/`, overwriting the ADO-537 source with the old PROD build — so the
very next deploy would ship the stale function (no `unmerge` in `VALID_VERDICTS`). Rollback doesn't
need a download: the old build's source is already in git (`93d952c`, see Rollback (b)).
```bash
npx supabase functions deploy admin-judge-merge --project-ref osjbulmltfpcoldydexg
npx supabase functions deploy admin-judge-log   --project-ref osjbulmltfpcoldydexg
```

- [ ] **Step 3: Confirm the Judge tab reads, and functionally test the NEW function**

Josh: `https://trumpytracker.com/admin.html` → Judge tab. It should load agent verdicts exactly as
before (this is still the *old* `admin.html` — the new one ships in the next step). Confirms the
`admin-judge-log` redeploy didn't regress the existing tab.

Then prove `admin-judge-merge` actually works on PROD **before** Task 8 depends on it. It is brand new
there, and if the `ADMIN_DASHBOARD_PASSWORD` secret isn't visible to it, every call 401s. Run a
`preview` — read-only, and it proves auth + the new build + the pair's state in one call. Use the exact
pair you intend to use in Task 8:
```bash
curl -s -X POST "https://osjbulmltfpcoldydexg.supabase.co/functions/v1/admin-judge-merge" \
  -H "Content-Type: application/json" -H "x-admin-password: <ADMIN_DASHBOARD_PASSWORD>" \
  -d '{"action":"preview","survivor_id":<S>,"loser_id":<L>}'
```
Expected: JSON with both story objects and a warning that the loser is already merged into the survivor.
A 401 means the secret isn't set on PROD — fix that before going further.

- [ ] **Step 4: Merge the PR (LAST)**

```bash
gh pr merge <N> --squash
```
Use `--squash`: `main` is governed by ruleset 9175237, which allows merge/squash/rebase but pairs the
PR rule with `required_linear_history` — so a **merge commit** is what gets rejected, not squash or
rebase. `required_approving_review_count` is 0, so Josh can self-merge after the Codex review.
Netlify auto-deploys `trumpytracker.com` on the `main` merge.

---

### Task 8: Prove it on PROD, then close out

**Files:**
- Modify: `docs/features/clustering-judge/prod-deployment-manifest.md`
- Create: `docs/handoffs/2026-08-03-ado-537-unmerge-prod-deploy.md`

- [ ] **Step 1a: PAUSE the two automatic jobs first — this is the one step that can corrupt PROD**

The unmerge leaves loser **L** live on PROD until Josh finishes re-merging. If the **Judge cron**
(05:00 / 13:00 / 21:00 UTC) fires in that window it sees L as a live fragment of *the very pair it
already ruled "merge" on* — so a re-merge by the agent is the **likely** outcome, not a freak one:
- Judge merges L→S itself → your re-merge returns `{ok:true, skipped:true, reason:'loser_already_merged'}`.
  Data ends up right, but the expected banner is wrong and you get an extra agent row + audit snapshot.
- Judge merges L into a **different** story T → your re-merge is refused pointing at T, and **PROD is now
  in a different shape than before your test**. Fixing it means a second real unmerge, then re-merging.
  "Net effect zero" is gone.

Smaller version of the same hazard: PROD RSS runs `0 */2 * * *` and can attach a brand-new article to the
restored L. The re-merge absorbs it so nothing is lost, but before/after membership then isn't identical.

**Turn both jobs off, and write down that you did (Step 1e turns them back on):**
- Judge: disable the RemoteTrigger cron, or set `JUDGE_DRY_RUN=true` in its env (verified fail-safe —
  `prompt-v1.md` treats anything that isn't exactly the string `false` as dry-run).
- RSS: set repo variable `ENABLE_PROD_SCHEDULES=false` (verified — `rss-tracker-prod.yml` gates
  scheduled runs on `vars.ENABLE_PROD_SCHEDULES == 'true'`; `workflow_dispatch` still works).
- Do the unmerge and re-merge **in one sitting, minutes apart**, and never within ~15 minutes of an even
  UTC hour or of 05/13/21 UTC.

**Then confirm nothing is ALREADY mid-run — pausing schedules does not stop a job in flight:**
```bash
gh run list --workflow=rss-tracker-prod.yml --status=in_progress
gh run list --workflow=rss-tracker-prod.yml --status=queued
```
Both must be empty. For the Judge, confirm the RemoteTrigger shows no active run (its run list /
cloud console), and corroborate from the PROD SQL Editor — no agent activity in the last 30 minutes:
```sql
SELECT MAX(created_at) FROM clustering_judge_log WHERE source = 'judge-agent';
```
If anything is in flight, **wait for it to finish before Step 1b** — an RSS run can attach articles
and a Judge run can merge stories in the middle of your round trip.

- [ ] **Step 1b: Pick the pair and record the BEFORE state**

There is no PROD PostgREST MCP, so these run in the **PROD SQL Editor**. Pick a recent agent merge from
the Judge tab (`source='judge-agent'`, `merged=true`), then precheck it — `unmerge_story` refuses
otherwise, and an empty snapshot would "pass" the step while proving nothing:
```sql
-- Pair must be genuinely merged: one 'merged_into' pointing at the other, the other 'active'/NULL
SELECT id, status, merged_into_story_id FROM stories WHERE id IN (<S>,<L>);

-- Snapshot must be unconsumed and NON-EMPTY
SELECT id, cardinality(loser_article_ids) AS n FROM story_merge_audit
WHERE loser_id = <L> AND unmerged_at IS NULL ORDER BY merged_at DESC, id DESC LIMIT 1;
-- n must be >= 1
```
Then record the BEFORE state **verbatim** — this is the evidence Step 1d compares against:
```sql
SELECT id, status, merged_into_story_id, source_count FROM stories WHERE id IN (<S>,<L>);
SELECT story_id, article_id FROM article_story WHERE story_id IN (<S>,<L>) ORDER BY article_id;
SELECT id, loser_id, survivor_id, unmerged_at, cardinality(loser_article_ids) AS n
FROM story_merge_audit WHERE loser_id IN (<S>,<L>) ORDER BY id;
```

- [ ] **Step 1c: Unmerge, then immediately re-merge**

Judge tab → the chosen row → **unmerge** → confirm. Expected: `N articles restored` with **N ≥ 1**.

> `articles_restored` can legitimately come back *lower* than the snapshot's `n` if an article was
> re-clustered elsewhere since the original merge — migration 105 only moves rows still sitting on the
> survivor. That is correct behaviour, not a failure.

Then **immediately** re-merge via the Manual Merge card: survivor = **S**, loser = **L**.

> While L is live, trumpytracker.com shows S carrying an AI summary describing content that is
> simultaneously live as its own story — neither direction recomputes `primary_headline`,
> `summary_neutral`, or `search_vector`. A real, public, duplicate-content window. Keep it to minutes.

- [ ] **Step 1d: Verify — falsifiable pass criteria**

Re-run all three BEFORE queries. **Pass =**
- `stories` rows **identical** to BEFORE (L tombstoned into S again, same `source_count`s)
- `article_story` **identical** to BEFORE, article_id for article_id
- `story_merge_audit`: **exactly one** row newly flipped to non-null `unmerged_at`, and **exactly one**
  new row (the re-merge's fresh snapshot)

Then in the Judge tab: both new rows appear (`manual`/`unmerge`, then `manual`/`merge`) with **no**
log-write warning on either.

**Be honest about what "net-zero" means here:** the round trip is net-zero on **story and article
state**, and **additive on the audit tables**. It permanently consumes the original snapshot, writes a
new one, and adds two `clustering_judge_log` rows plus two `judge_run_merge_count` rows. The original
agent log row will still render an unmerge button afterward, and clicking it would consume the *new*
snapshot — harmless, but the audit trail is no longer 1:1. Accepted, not hidden.

One thing that does *not* compound: the KNOWN IRREVERSIBLES (`first_seen_at`/`last_updated_at` widening
and the `topic_slugs` union) are idempotent, so the second merge adds no further drift.

- [ ] **Step 1e: TURN THE TWO JOBS BACK ON**

Re-enable the Judge cron (and set `JUDGE_DRY_RUN=false` again if you changed it) and set
`ENABLE_PROD_SCHEDULES=true`. Confirm the next scheduled RSS run actually fires.

**Leaving these off is worse than the risk pausing them avoided** — the site would quietly stop picking
up news. Do not mark Task 8 complete with this unchecked.

- [ ] **Step 2: Refresh the deployment manifest**

Update `docs/features/clustering-judge/prod-deployment-manifest.md`. Tick each box **only against
evidence of the matching kind** — the manifest tracks "on `main`" and "deployed" as separate columns,
and repo state proves only the first:
- §2 (backend JS), §4 (admin.html), §5 (agent prompt): tick ✅ — verified present on `origin/main`.
- §1.2/§1.3 (migrations 101/102): tick ✅ **only if Task 7 Step 0 confirmed they ran on PROD**. If Step 0
  had to apply them, record that with today's date instead of back-dating it to ADO-533.
- §3 (edge functions `stories-active/detail/search`, `admin-judge-log`): the *deployed* column cannot be
  ticked from repo evidence. Either confirm via the Supabase dashboard's function list (deploy
  timestamps) or leave it ⬜ with a note. Do not invent a green check.
- Add 104/105 + `admin-judge-merge` + the ADO-537 `admin.html` as ✅ shipped by this plan (Tasks 6–7).

The file's job is to be the accurate running tally; leaving it stale is how the next session gets
misled — and ticking it on faith is worse.

- [ ] **Step 3: Commit the doc updates on `test`**

```bash
git checkout test
git add docs/features/clustering-judge/prod-deployment-manifest.md
git commit -m "ADO-537: manifest reflects PROD deploy of manual merge + unmerge

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push origin test
```

⚠️ This lands the correction on `test` only — **`main`'s copy of the manifest stays stale**, and `main`
is what the next PROD deploy session reads if it branches from `main`. That recreates the exact staleness
problem this step exists to fix. Either fold this commit into the ADO-537 PR before merging it (cleanest,
if the PR is still open), or note on the ADO card that it must ride the next PROD PR.

- [ ] **Step 4: Verify AC7 and close ADO-537**

Via `/ado`: post a comment recording what shipped (migrations applied, functions deployed, PR number,
the PROD round-trip result with the real article count, `qa:smoke` output tail), mark AC7 MET, and move
537 from **Testing** → **Closed**. Only close if AC1–AC7 are all evidenced.

- [ ] **Step 5: Run `/end-work`**

It writes the handoff doc, refreshes memory, and pushes. Memory's HOT tier is badly stale — it still
describes ADO-533 as mid-monitoring and ADO-531 as gated. `/end-work` must correct `active-work` and
`clustering-quality` to: 533 Closed, 537 Closed, **531 is the next open piece of work and its gate is
clear**.

---

## Self-Review

**Spec coverage:** unmerge verified on TEST (Tasks 1–4) · guard paths exercised (Task 3 Step 5) ·
security posture checked in both envs (Task 1 Step 3, Task 7 Step 1) · AC written and verified
(Task 5, Task 8 Step 4) · PROD promotion in the load-bearing order (Tasks 6–7) · PROD proof (Task 8
Step 1) · stale manifest and stale memory corrected (Task 8 Steps 2, 5).

**Known gap, stated rather than hidden:** the `survivor_moved` guard (AC5, migration 105 lines 176–185)
is verified by code review only — staging it requires merging the survivor away in a second merge, and
the cheaper `not_merged_pair` guard covers the same "refuse rather than corrupt" contract. If you want
it staged, it is a three-merge setup on TEST and belongs in Task 4 as an extra step, not in PROD.

**Not in scope:** ADO-531 backfill (next ticket, plan already approved at
`docs/features/clustering-judge/backfill-plan.md` — execute, don't re-plan), and the three ADO-skill
tooling commits sitting unpromoted on `test`.

## Review History (2026-08-03)

Reviewed twice before execution; every finding below was independently reproduced before being applied.

**Fact-check (repo + live TEST DB) — 3 execution-breaking errors found:**
1. The cherry-pick conflicts on the first commit (`backfill-plan.md`, modify/delete), and the original
   "resolve in favour of `test`" rule would have shipped the ADO-531 plan to `main`. → Task 6 Step 2.
2. The original candidate query returned only zero-article QA fixtures (`source_count: 10`, no
   `article_story` rows), which would have silently reproduced Task 3's non-proof. → Task 4 Step 1.
3. Nothing proved migrations 101/102 ever ran on PROD, and the plan was going to mark the manifest ✅
   using its own assumption as the evidence. → Task 7 Step 0.
Also corrected: squash is *permitted*, not required (`required_linear_history` is what rejects merge
commits); manifest "deployed" boxes can't be ticked from repo evidence. Everything else verified true —
commit hashes and order, file list, `main`'s contents, all TEST fixtures, UI strings, `qa:smoke`, refs.

**Operational review — 3 must-fixes:**
1. No rollback section at all. → added, with the point-of-no-return, per-artifact procedures, named
   rollback triggers, and the two failure cases of the PROD round trip separated by blast radius.
2. The two automatic PROD jobs (the Judge, 3x/day; RSS, every 2 hours) were never paused, and Task 8
   Step 1 opened exactly the window in which they can do damage. → Task 8 Steps 1a / 1e.
3. "Net effect on PROD data: zero" was false (additive on the audit tables), and the step's pass
   criterion was an unfalsifiable eyeball. → rewritten with BEFORE/AFTER SQL and explicit pass criteria.
Plus: `gh pr merge` ran from the wrong branch; the 104 bad-rows check could never fail where it was;
the "load-bearing order" overstated 104→105; Task 3's coverage was oversold; `qa:smoke` isn't feature
evidence; the manifest correction never reached `main`.

**Codex round 3 (2026-08-03, post-plan) — all three findings reproduced and folded in:**
1. [P1] Task 7 Step 2's `supabase functions download` would have overwritten the local
   `admin-judge-log` source with the old PROD build immediately before deploying it (confirmed via CLI
   help — download writes into the project's `supabase/functions/`). → download removed from Task 7
   Step 2; Rollback (b) now warns against running it in-repo and relies on git (`93d952c`).
2. [P1] Migration 105 created a new RPC + column without reloading PostgREST's schema cache, and the
   edge function calls `unmerge_story` via `/rpc/`. → `NOTIFY pgrst, 'reload schema'` added to the
   migration (Part F) plus a non-mutating PostgREST smoke as Task 1 Step 4 (`invalid_ids` or `42501`
   both pass; `PGRST202` fails).
3. [P2] Task 5 claimed AC5 verified by Task 3 Step 5, which only proves `not_merged_pair`. → AC5 text
   and Task 5 Step 3 now state explicitly which half is live-verified and which is code-review-only.

**Codex round 4 (2026-08-03, final) — folded in:**
1. [P1] PR-create used a Bash here-doc; workspace shell is PowerShell. Partially disputed (the plan's
   commands run via the Git-Bash tool, where the here-doc works) but fixed anyway with the
   shell-agnostic `--body-file` form — strictly more robust, zero cost.
2. [P2] Pausing the schedules doesn't stop a job already in flight. → Step 1a now hard-gates on
   `gh run list --status=in_progress/queued` empty for `rss-tracker-prod.yml` plus a no-active-Judge-run
   check (RemoteTrigger run list + last-30-min `clustering_judge_log` corroboration; `created_at`
   column verified present).
3. [P3] The architecture summary still said "6 commits" after Task 6 grew to seven. → summary updated.

**One reviewer claim rejected:** that `article_story` has `PRIMARY KEY(article_id)`. The repo doesn't
support it — that line is commented out in `migrations/001_rss_system_PRODUCTION_READY.sql:170` and the
schema doc calls the table a plain many-to-many junction. It changes no step (membership comparison is
the criterion either way), so the plan simply doesn't rely on it.
