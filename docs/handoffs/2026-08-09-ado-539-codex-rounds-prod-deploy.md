# 2026-08-09 — ADO-539: Codex rounds 1–3 fixed, DEPLOYED TO PROD

**Ticket:** ADO-539 → stays **Testing** (24h live verify pending). **PR #113 squash-merged to main
04:56 UTC** after three Codex review rounds, all findings verified against the code and fixed.
**Branch:** `test` @ `398bccc` (all PR fixes cherry-picked back).

## The six Codex findings (all real, all fixed)

| # | Finding | Fix |
|---|---------|-----|
| P1 | Verdict `created_at` isn't the evidence snapshot — an article attaching mid-deliberation was suppressed unseen | `clustering_judge_log.evidence_as_of` + predicate `LEAST(COALESCE(evidence_as_of, created_at), created_at) >= GREATEST(...)` (mig 106) |
| P1 | Human unmerge memory wasn't atomic — a failed post-commit log insert let the Judge re-merge a human unmerge | **Migration 107**: `unmerge_story` writes its `'unmerge'` row in-transaction; `admin-judge-merge` dropped its insert (redeployed to both envs) |
| P2 | Prompt claimed a wrong `keep` is "repaired next run" — false under verdict memory | Both occurrences corrected; prompt now says keep/uncertain suppress identically, prefer `uncertain` when torn |
| P2 | Advertised dryrun checks (3/3 flips, 11/11 traps, July 4th) were print-only | All gate the exit code now, mutation-tested |
| P2 (r3) | Agent-clock skew could still fake coverage (`date -u` ahead of a real attach) | `evidence_as_of` is now a **DB-issued watermark**: the RPC returns `membership_seen_at`, the agent echoes it verbatim — `date -u` is gone from the prompt |
| P2 (r3) | Gates didn't assert cohort completeness — deleting gs-209 from VERDICTS passed 2/2 | Pinned ID lists + gold-set-derived expected sets checked BEFORE scoring; gold DE count pinned at 100 |

Plus review-pass extras: the **load-bearing deploy order** (see below), and a Step-6 insert-failure
recovery path in the prompt (retry once, then retry with `evidence_as_of` omitted — NULL degrades to
the `created_at` fallback).

## Deploy sequence (honored, and why the order matters)

Migrations **before** merge: the Judge cron is live off `main` and bootstrap hard-resets to
`origin/main`, so merging prompt v1.1 against an unmigrated DB would 400 every Step-6 insert
(PGRST204 — executed merges unlogged, no memory, empty Discord digest). Josh applied current 106 +
107 on TEST and PROD in the SQL Editor, THEN the merge, then `admin-judge-merge` redeployed to both
projects. Josh's PROD verification: `logs_atomically=t`, anon=f, service_role=t.

## TEST verification (via supabase-test MCP, DB left byte-identical)

Pair 16981/17005; fixture row inserted/patched/deleted, borrowed `matched_at` restored:
- **(c)** live keep, NULL watermark → suppressed (created_at fallback) ✓
- **(r)** watermark older than newest attach → REOPENS (the Codex race, closed) ✓
- **(s)** watermark newer than membership → suppressed ✓
- **(t)** hallucinated 2036 watermark + new article → clamp wins, reopens ✓

`membership_seen_at` confirmed in RPC output. Full 9-check fixture:
`scripts/tests/ado-539-verdict-memory-fixture.sql` (test-only).

## Remaining to close ADO-539

1. Josh: `EXPLAIN ANALYZE SELECT * FROM get_clustering_judge_candidates(0.83, 7, 30);` on PROD +
   security advisor re-run (verification SQL block is in the deployment manifest §1).
2. **24h / 3-run live verify:** settled pairs stay silent, new agent rows carry `evidence_as_of`,
   uncertain volume drops, spot-check every `merged=true`. PROD `clustering_judge_log` needs
   service_role — use the admin Judge tab or Josh.
3. AC gate (card has no formal AC bullets; the bar is this verification plan), then Closed.
4. **Then: ADO-531 backfill** — plan approved at `docs/features/clustering-judge/backfill-plan.md`,
   EXECUTE it, don't re-plan. It benefits directly from the merged=false carve-out and cohort gates.

## Five open decisions for Josh (none block closure)

gs-209 saga-recap rule gap · `uncertain` surfaces once, no resolved/unresolved state · optional
~48h suppression floor · blinded real-model gold run (~$1/sweep) · **new:** transient fetch failure
logs `uncertain` which now creates settled memory (suppresses until next attach).

## Session rule change

**No subagents in TTracker** — Josh banned them after ~260K tokens went to review agents in one
evening. `permissions.deny: ["Agent","Task"]` in `.claude/settings.json` (committed). Reviews are
done inline; ADO writes go direct via `mcp__azure-devops__*` (small payloads); ADO reads stay on
the REST+jq route.
