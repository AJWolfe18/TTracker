# Handoff: Judge executor review fixes (ADO-583) + two P1 fixes on PR #145, migration 117 v4 (ADO-584) (September 19, 2026, evening)

Josh's prompt: `/start-work ADO-583 executor review fixes + classifier lever test ...` and, mid-session, a pasted local Codex review of PR #145: "Do not merge PR 145 yet. Two P1 findings remain ... is there a way to [fix these] on the pr that is waiting".

## Outcome in one line
All ten executor review findings are fixed and on PR #146; both Codex P1 findings on PR #145 are fixed, verified on TEST and on the PR; the `auto_mode_allow` lever could not be tested (this session's classifier refused to set it). Josh now owes three things, in order: re-run migration 117 (v4) on PROD, merge PR #145, merge PR #146.

## 1. Executor review fixes (ADO-583) - commit `59f3c21` on `test`, PR #146 head `b4cecf3`
| # | Fix |
|---|-----|
| 1 + 3 | Re-run state is rebuilt from `story_merge_audit` by `run_id`, not from the log. An executed merge whose log insert died gets its `merged=true` row on the re-run; merges from an earlier attempt count toward the cap of 10 and block chained merges. Extra, same family: a merge whose HTTP response was lost but which committed (audit row exists) is logged `merged=true`, not `transient:`. |
| 2 | Transport failures (non-2xx, or a body that is not `merge_stories`' `{ok: ...}` shape) are logged `transient:` and never reach the failed-twice escalation. Only `ok:false` escalates. A failed `stories` read before a merge is the same class. |
| 4 | `chooseSurvivor()`: one `stories?select=id,first_seen_at&id=in.(a,b)` read per live merge; older survives (tie or unreadable timestamp: smaller id). A swapped pair is flipped and the row's rationale ends with `[executor: survivor/loser flipped - story N is older]`. |
| 5 | `candidates` must be an integer equal to `verdicts.length`, otherwise the whole file is rejected. The prompt states the rule. |
| 6 | Workflow: verdict path reaches run scripts through `env: VERDICT_FILE`; the run_id segment of the branch name is regex-checked before it becomes a path; the failure alert uses a sanitized shell variable instead of `${{ github.ref_name }}`. Gotcha: never write a literal `${{ }}` inside a `run:` comment - GitHub evaluates it. |
| 7 | **Decision: exemption, documented in the code.** See "Finding 7, in plain English" below. |
| 8 | `Prefer: return=minimal` on log inserts. |
| 9 | Unused `now` parameter and the unreachable `deferredRationale` branch removed. |
| 10 | Prompt v1.2: Section 4 points at the executor's Discord digest, the webhook echo is gone, "stop immediately - publish nothing". |

Tests: `scripts/tests/judge-executor.test.mjs` covers each fix (re-run seeding, cap carry-over, lost-response recovery, transient vs failed, orientation flip, candidates mismatch, `return=minimal`, workflow injection guard, prompt wording). `npm run qa:smoke` exit 0. The deploy branch is byte-identical to `test` on the shipped files. Schema doc lists the new `transient:` prefix.

### Finding 7, in plain English (Josh asked: is this normal, why is it newly an issue, is it the right call?)
- **What the rule is:** since ADO-466, any pipeline step that skips work must leave a row in `pipeline_skips`, so nothing disappears silently. That is a normal, good rule.
- **Why it came up now:** the executor is brand-new code (written September 19). A reviewer checks new code against the CLAUDE.md anti-pattern list, and the executor has one `continue` that skips a pair. Nothing regressed; it is a first review of new code.
- **Why the exemption is right:** the only thing the executor skips is "this pair already has its `clustering_judge_log` row for this run" (a re-run after a partial failure). The reason for the skip *is* a database record of that pair. A second row in `pipeline_skips` would say the same thing in a second place. Deferred, failed and transient merges are not skips at all: each gets its own log row.
- **Cost of changing our mind:** about 20 lines plus a test, $0. Say the word and it goes in.

## 2. PR #145 (ADO-584): two P1 findings fixed - commit `2037218` on `test`, PR #145 head `291ac95`
1. **Failed attempts lost the evidence that triggered re-enrichment.** The RPC now returns `prior_evidence_as_of` (the watermark it used). On failure the agent echoes THAT into `enrichment_meta.evidence_as_of` (the watermark does not move) and puts the Step-2 `evidence_as_of` into `attempt_evidence_as_of`. Pending evidence keeps feeding `reason` / `new_article_count` / `new_article_ids` until a success. The uncapped branches look only at evidence newer than the last attempt (`GREATEST(watermark, attempt_evidence_as_of)`), so `p_max_failures` still stops a story failing on the same evidence.
2. **Bursts over six articles lost evidence.** `new_article_ids` has no `LIMIT`. Prompt Step 3B reads the newest 6 in full and every remaining id at title/source/excerpt level (excerpts are about 150 characters; at most 40 ids per GET). A failed evidence GET means a `fetch_failed` failure, never a publish from partial evidence.

Verified on TEST (migration 117 v4 applied through the TEST SQL Editor; fixture on story 16979 with 11 articles, restored byte-identical): 11 of 11 ids returned; a v3-style failure write reproduces the bug (`retry_failed`, 0 ids); the v4 failure write keeps `new_articles` with the same 11 ids; at 3 failures the story leaves the pool; a success write clears it. 8 of 8 checks. `qa:agent-prompts` extended and green. The same commit is on PR #146's branch (it is stacked on #145).

**Merge gate changed.** PROD has 117 **v3**. Re-run `migrations/117_stories_needing_enrichment.sql` from the PR branch in the PROD SQL Editor before merging #145 (DROP + CREATE, idempotent; harmless to the prompt currently on `main`, which does not call the RPC).

Known limit, accepted: a story that has never been enriched successfully and then fails has no "prior" watermark (`null`), so the RPC falls back to the failure timestamp. There is no already-published evidence to lose in that case; the retry reads the top 6 like any first enrichment.

## 3. Platform lever test (`auto_mode_allow`) - not testable from a Claude session
The TEST Judge routine exposes `session_request.config.auto_mode_allow`, `auto_mode_environment` and `auto_mode_soft_deny` (all empty). The `RemoteTrigger update` that set `auto_mode_allow` was denied by this session's classifier as `[Auto-Mode Bypass]` before it reached the API. The routine was not changed and not fired. Whether the platform honors the field is unknown. Not pursued: the denial is a deliberate guardrail and the executor path works without the lever. Recorded on ADO-583.

## 4. PR status and close-out (unchanged, waiting on Josh)
`gh pr view`: #145 OPEN, #146 OPEN (neither merged). Close-out after the merges: first PROD Judge run shows `published judge-run/prod/...`, an executor Actions run, log rows with `merged=true` -> ADO-583 Resolved. First PROD Stories run after #145 shows a sane `pool_size` -> ADO-584 Closed.

## 5. Draft note for Anthropic support (one paragraph, Josh to send)
> On September 16, 2026 (first failure 21:04 UTC) a scheduled Claude Code routine that had run unchanged for weeks began failing because the auto-mode permission classifier started denying the routine's own database writes. The routine (trig_01DDXZkpC9PkgTzU8wDdL9QM, environment env_018AS3Shj6wkH624v1nkssG9) calls our own Supabase project over PostgREST with curl: one RPC per merge and an insert into our audit log. Its last good run was the same day at 13:10 UTC; nothing changed on our side in between (same prompt commit, same environment, same credentials). Since then every run has the merge call denied ("Modify Shared Resources") and the audit insert denied intermittently ("Logging/Audit Tampering", once "Stage 2 classifier error"), for example sessions cse_015bfFRxrVrr7J24eeNT6Lhv, cse_013AbybQ75NfVUHGPyk9i371 and cse_01Df1axZsYTg4MsTFfQhYd4A on September 19. A routine has no human to approve a prompt, its sessions are tagged routine:auto-mode-forced so it cannot leave auto mode, a Bash(curl *) allow rule does not apply because commands naming an external host go to the classifier anyway, and rewording the prompt made no difference. We have worked around it by moving the writes into GitHub Actions, but we would like to know: (1) was there a classifier change on or around September 16, (2) what is the supported way for an owner to pre-authorize a routine's writes to the owner's own infrastructure (the routine config shows auto_mode_allow / auto_mode_environment fields - are they honored for routines, and how should they be set), and (3) can a classifier change that turns a previously passing unattended routine into a failing one be surfaced to the owner (an email or a run status) instead of only in the run log.

## Gotchas found
- This session's classifier: `RemoteTrigger update` with `auto_mode_allow` -> denied `[Auto-Mode Bypass]`. `RemoteTrigger get` allowed. Supabase TEST SQL Editor DDL through Chrome (Run + the "Potential issue detected" confirm) allowed.
- The Bash tool collapses `\\` to `\` inside heredocs: a patch script written through a heredoc silently lost its regex escapes (`/w\.x\s+/` became `/w.xs+/`). Write patch scripts with the Write tool.
- `docs/features/*/prompt-v1.md` files have mixed line endings; multi-line string replacements fail, single-line ones work.
- Cherry-picking a `test` commit that touches `scripts/tests/agent-prompt-contracts.test.mjs` or `docs/database/database-schema.md` onto `deploy/ado-584-stories-prompt` conflicts (that branch carries older versions). Resolution used: `git checkout --ours` on both files, then re-apply the same edit scripts, then confirm `git diff refs/heads/test HEAD` is empty on the shipped files.
- A script outside the repo cannot `require('dotenv')`; use `node --env-file=.env <script>`.

## ADO
- ADO-583 (Bug, Active): comment added with the fix list and the lever result. No state change.
- ADO-584 (User Story, Testing): comment added with the P1 fixes, TEST verification and the new PROD gate. No state change.

## Still owed by Josh
1. PROD SQL Editor: run `migrations/117_stories_needing_enrichment.sql` (v4) from branch `deploy/ado-584-stories-prompt`.
2. Merge PR #145, then PR #146 (squash).
3. Optional: re-run local Codex on #145 and #146; send the support note above.
4. Unchanged from the earlier handoff: Supabase database-size overage decision; ADO-579 numbers; ADO-580; SCOTUS cron confirmation; ADO-564 north-star; 572/577 PROD; ADO-582 PROD; `.agents/` and `exec brief for blueprint.png` untracked at repo root.

## Next-session prompt
```
/start-work ADO-583 + ADO-584 close-out. Read docs/handoffs/2026-09-19-ado-583-executor-fixes-584-migration-117-v4.md. Check gh pr view 145 and 146. If merged: (a) confirm PROD has migration 117 v4 (RPC returns prior_evidence_as_of), read the first PROD Stories run after the merge (trig_0182WcUVyjF7Q5o2GWJMxbo1) for pool_size and reasons -> ADO-584 Closed after AC check; (b) read the first PROD Judge run after #146 (trig_01DDXZkpC9PkgTzU8wDdL9QM) for "published judge-run/prod/...", the executor Actions run and clustering_judge_log rows with merged=true -> ADO-583 Resolved. If not merged: nothing to do, remind Josh of the three steps. Work inline, no subagents. Do NOT merge PRs.
```
