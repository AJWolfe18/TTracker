# ADO-531: Backfill-cluster ~12k legacy PROD stories with the Clustering Judge

## Context

The Clustering Judge (ADO-533) is LIVE on PROD (cron `trig_01DDXZkpC9PkgTzU8wDdL9QM`, 3×/day, Sonnet, 10/10 correct on first live run). It only sees stories from the **last 7 days**, so the ~12,214 legacy stories (2026-01-03 → today, ~2,000/month, 12,198 with centroids, all `active`) never get the repair pass — known fragmentation (July-4th-style multi-story events) sits uncorrected in the archive.

**Approach is DECIDED (Josh, ADO-531 comment 2026-07-06) — do not re-litigate:** a **sliding 7-day window walking backward** from today to the oldest story, NOT a widened window (widening reintroduces the 100+day generic-phrasing false merges the 7-day window kills). Reuses the live Judge's prompt criteria, merge machinery (`merge_stories`, tombstones, `story_merge_audit`), and log/admin surfaces unchanged.

**Sizing (done this session, read-only PROD PostgREST):** oldest story 2026-01-03, 12,214 total, ~460–530/week evenly spread, 12,198 with centroids. ~186 days ÷ 3-day step ≈ **62 anchor positions**, est. 1–4 runs each to drain ≈ **80–250 runs** (~4–10 days at hourly cadence). Cash cost ≈ **$0** (Sonnet cloud-agent runs on the subscription, same as the live Judge; no OpenAI). Egress ~150KB/run → **<100MB total** (negligible vs 5GB cap). Real constraint = subscription usage from hourly runs; refine after the dry-run bucket.

## Design (validated by Plan-agent review + 2 Codex rounds; all findings fixed: window geometry, cursor off-by-one, dry-run/live exclusion interplay, run lease/CAS + renewal, knob CHECKs)

### 1. Migration `migrations/103_judge_backfill.sql`

**a. `judge_backfill_state` — singleton cursor (resumable, auditable, all knobs runtime-tunable via SQL):**
```sql
CREATE TABLE IF NOT EXISTS judge_backfill_state (
  id INT PRIMARY KEY CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,      -- master kill switch (flip via SQL/MCP)
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,       -- backfill-own mode; NOT the live judge's JUDGE_DRY_RUN env var
  anchor_date TIMESTAMPTZ NOT NULL,            -- window upper bound; walks backward
  oldest_target TIMESTAMPTZ NOT NULL,          -- 2026-01-03 (oldest first_seen_at)
  window_days INT NOT NULL DEFAULT 7,
  step_days INT NOT NULL DEFAULT 3,
  merge_cap INT NOT NULL DEFAULT 5,            -- prompt-level; DB hard cap 10 (mig 102) unchanged
  done BOOLEAN NOT NULL DEFAULT FALSE,
  last_run_id TEXT,                            -- doubles as lease holder (claimed_by)
  lease_until TIMESTAMPTZ,                     -- run lease; NULL/past = claimable
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Codex P1: knobs are PROD-tunable by hand — constrain so a typo can't widen the window,
  -- stall the cursor, or out-cap the DB limit:
  CHECK (window_days BETWEEN 1 AND 7),         -- Josh ruling: never wider than 7
  CHECK (step_days BETWEEN 1 AND window_days),
  CHECK (merge_cap BETWEEN 1 AND 10),          -- 0 would stall the drain rule (0<0 never true); pause = enabled=false
  CHECK (oldest_target <= anchor_date)
);
-- seed: INSERT (1, false, true, NOW(), '2026-01-03', ...) ON CONFLICT DO NOTHING
-- RLS on, no anon/authenticated grants (service_role only) — same as judge_run_merge_count (mig 101)
```

**Run lease / CAS guard (Codex P1):** overlapping runs (hourly cron + a slow >60min run, or a manual fire during the burn) must not process the same anchor twice or race cursor updates. No new RPC needed — PostgREST single-statement PATCH is atomic:
- **Claim at Step 0:** `PATCH /judge_backfill_state?id=eq.1&enabled=eq.true&done=eq.false&or=(lease_until.is.null,lease_until.lt.<now-ISO>)` setting `lease_until=<now+50min>, last_run_id=<RUN_ID>` with `Prefer: return=representation`. Empty response → disabled, done, or another run holds the lease → exit silently. **The returned row is the authoritative config snapshot** (anchor, dry_run, caps) — no separate read, so a concurrent `enabled=false` flip can't be raced past (Codex P2).
- **Lease renewal (Codex P1 — cadence can outrun a slow run):** renew before processing pair 1, 6, 11, 16, 21, 26, and immediately before EVERY `merge_stories` call — re-PATCH `?id=eq.1&last_run_id=eq.<RUN_ID>` extending `lease_until` by 50min. 0 rows returned → lease lost to a newer run → **stop before logging or merging that pair**. Duplicate work if a lease is ever double-held is non-corrupting anyway — `merge_stories` is idempotent with a deterministic survivor (second call returns `loser_already_merged`) — the renewal just avoids wasted duplicate judgments and duplicate log rows.
- **Every later state write (cursor advance, done=true) is guarded** with `&last_run_id=eq.<RUN_ID>` (CAS — a run that lost its lease can't move the cursor), and clears `lease_until` on normal completion. An expired lease self-heals: the next run claims over it.
Why DB-row config, not env var: **both crons share the PROD cloud environment** (`env_018AS3Shj6wkH624v1nkssG9`), so an env var can't distinguish backfill from live — and the ADO-533 self-halt gotcha says mode must have ONE authoritative source. Here that's this row.

**b. Anchored candidate RPC** — DROP the 3-arg `get_clustering_judge_candidates`, CREATE 5-arg (same DROP-then-CREATE pattern migration 101 used for `merge_stories`; PostgREST named-arg calls `{p_min_sim,p_days,p_max_pairs}` from the live prompt keep working via defaults — verified no overload ambiguity since the 3-arg is dropped):
- `p_anchor TIMESTAMPTZ DEFAULT NULL` → window becomes `first_seen_at BETWEEN COALESCE(p_anchor, NOW()) - p_days AND COALESCE(p_anchor, NOW())` (live behavior unchanged at NULL).
- `p_exclude_judged BOOLEAN DEFAULT FALSE` → when true, drop pairs with an existing `clustering_judge_log` row (either ID order) where `verdict IN ('keep','uncertain') AND dry_run = false` — **and ONLY those**. Merge verdicts are never excluded (live cap-deferred merges must re-surface; executed ones vanish via tombstone; dry-run merge rows from gate (b) must not suppress the later live merge — Codex P1). Dry-run keep/uncertain rows are also not excluded (Codex P1 round 2): gate (b) exists to validate the judge on old data, and if it triggers a prompt revision, stale dry-run verdicts must not pin the old prompt's judgments — the only cost is the live walk re-judging one bucket's ~30–60 pairs once. Net effect: **only live-mode keep/uncertain verdicts are final**; no mode-aware params needed. The dry-run stall this exclusion originally hedged against can't occur because dry-run advances unconditionally after one pass (below). Excluding pairs the LIVE 3×/day judge already judged (its rows are dry_run=false) stays intentional — no re-judging.
- New index: `CREATE INDEX ... ON clustering_judge_log (story_id_a, story_id_b)` (supports the NOT EXISTS; BitmapOr covers both OR branches).
- **Fresh security-lockdown block with `pronargs = 5`** (mig 100's block hardcodes 3; a new pg_proc row gets PUBLIC EXECUTE by default — review finding #4). REVOKE PUBLIC/anon/authenticated, GRANT service_role.
- **End of migration: `NOTIFY pgrst, 'reload schema';`** (Codex P1) — PostgREST can hold a stale RPC schema cache after the arity change, which would break the LIVE judge's named-arg call ("function not found") or hide `p_anchor` from backfill. After applying (each env), verify BOTH call shapes through `/rest/v1/rpc/get_clustering_judge_candidates` — the old 3-named-arg body and the new anchored body — before any agent run.

**c. Extend `clustering_judge_log` source CHECK** → `('inline','judge-agent','judge-backfill')` (drop + re-add constraint).

### 2. Backfill prompt `docs/features/clustering-judge/prompt-backfill-v1.md`

Delta-doc: "follow prompt-v1.md with these overrides" — **the live prompt file is untouched** (zero risk to the live cron, which bootstraps prompt-v1.md from main).

- **Step 0 — claim-first, no separate read (Codex P2):** the atomic claim PATCH above (`enabled=eq.true&done=eq.false&or=(lease_until.is.null,lease_until.lt.<now>)`, `Prefer: return=representation`) is the FIRST and ONLY state access. Empty response → disabled, done, or lease held → stop, **no log row** (avoids 24 junk rows/day post-completion; the trigger's own run history is the audit). Non-empty → the returned row is the sole source for `dry_run`, `anchor_date`, `window_days`, `merge_cap`.
- `RUN_ID="judge-backfill-<ts>"`; all log rows `source='judge-backfill'`.
- **Step 2:** call RPC with `p_anchor=anchor_date, p_days=window_days, p_max_pairs=30, p_exclude_judged=true`.
- **Merges** (only when `enabled AND NOT dry_run`): cap = `LEAST(merge_cap, 10)`, survivor = older story, always pass RUN_ID (DB hard cap enforces 10 regardless).
- **Cursor advance (drain-based, fixes review findings #2 & #3):**
  - Window is **drained** when `pairs_returned < 30 AND executed_merges < cap`. In **dry-run, advance unconditionally after one pass** (dry-run is sampling, not completeness — prevents the all-merge-verdict stall).
  - On drain: if `anchor_date - window_days <= oldest_target` → `done=true` (+ one Discord line "backfill complete") — the just-drained window already reached the bottom, so the oldest stories ARE processed (fixes the off-by-one that skipped up to 3 days of the oldest stories). Else `anchor_date -= step_days`, clamped so the final window's lower edge lands on `oldest_target`.
  - Not drained → leave anchor; next run continues the same window (exclusion makes progress monotonic).
  - 0 candidates → heartbeat row (as live) + advance.
  - All advance/done writes go through the lease-guarded CAS PATCH (`&last_run_id=eq.<RUN_ID>`).
- **No per-run Discord uncertain digest** (hourly cadence on old data = spam; uncertains reviewed in the admin Judge tab via the `judge-backfill` source filter). Discord only on completion or a safety-halt.
- Known coverage bound, documented in the prompt + plan: window 7d / step 3d **guarantees** co-windowing only for pairs ≤4 days apart; 5–7-day-apart pairs can straddle anchors. Acceptable: fragments form within ~72h in practice, and a missed merge is cosmetic (wrong merges are the risk, not missed ones). `step_days` is runtime-tunable (drop to 2 → guarantees ≤5d) if spot-checks show cross-boundary misses. Window stays 7 per Josh's ruling.

### 3. Admin visibility (needed BEFORE the dry-run eyeball — review finding #5)

- `supabase/functions/admin-judge-log/index.ts:32` — add `'judge-backfill'` to `VALID_SOURCES` (today an unknown source is silently dropped → filter would show everything).
- `public/admin.html:5515` — add `'judge-backfill'` to `SOURCES`.
- Deploy the edge function to PROD before gate (b).

### 4. Cron

New RemoteTrigger cron "Clustering Judge Backfill (PROD)", **hourly at :15** (offset from RSS :30 and Judge :00), same PROD env, bootstraps prompt-backfill-v1.md from main (git fetch+reset per `claude-agent-patterns`). **Created only at gate (d)**; gates (b)/(c) fire the agent manually via RemoteTrigger. Delete (or disable) the cron when `done=true`. Mechanics: `docs/reference/cloud-agent-runbook.md`.

## Rollout gates (in order — do not skip)

- **(a) Sizing — DONE** (numbers above). Refine total-run estimate from observed pairs/window during (b).
- **(b) DRY-RUN one historical bucket on PROD:** apply migration 103 to PROD (SQL editor/manual, per convention), deploy edge fn + admin.html, seed state row `enabled=true, dry_run=true, anchor=e.g. 2026-04-15`, fire manually, eyeball verdicts on OLD data in the Judge tab (source=judge-backfill). Old stories may cluster differently than live — this is the go/no-go evidence.
- **(c) Live, low cap, few buckets:** `dry_run=false`, cap 5, manual fires; verify merges in Judge tab + `story_merge_audit`. **HARD GATE: only after ADO-533's 3-day monitoring window is clean (~2026-07-10) or Josh explicitly green-lights** — backfilling 12k with an unproven judge multiplies systematic error 12,000×.
- **(d) Full walk:** create the hourly cron, optionally raise cap to 10 (state-row SQL, no deploy). Monitor via Judge tab; everything logged to `clustering_judge_log` + reversible via `story_merge_audit`.

This session realistically delivers: build + TEST validation + PR to main + (b). (c)/(d) are gated.

## Files

| File | Change |
|---|---|
| `migrations/103_judge_backfill.sql` | NEW — state table, 5-arg RPC, source CHECK, index, lockdown |
| `docs/features/clustering-judge/prompt-backfill-v1.md` | NEW — backfill mode delta-doc |
| `supabase/functions/admin-judge-log/index.ts` | +1 source value |
| `public/admin.html` | +1 source value |
| `docs/reference/clustering-judge.md` | short backfill section |
| `docs/features/clustering-judge/prod-deployment-manifest.md` | add 103 + edge fn redeploy |

Constraints honored: test branch, Node only (no Python), PostgREST minimal `select=`+`limit`, centroid math stays in SQL (no embedding egress), live Judge untouched.

## Verification

1. **TEST DB:** apply 103 via Supabase MCP/SQL editor (ends with `NOTIFY pgrst, 'reload schema'`). Smoke — through `/rest/v1/rpc/` (PostgREST layer, not raw SQL, to prove the schema cache reloaded): 3-named-arg RPC call still works (live-prompt compatibility); anchored call returns only `[anchor-7d, anchor]` pairs; `p_exclude_judged=true` drops ONLY a seeded live (dry_run=false) keep-verdict pair — **keeps** a live cap-deferred merge pair, a dry-run merge pair, AND a dry-run keep pair (Codex P1 regression tests, both rounds); lease claim: second concurrent claim gets empty response, claim on enabled=false row gets empty response, CAS advance/renewal with wrong last_run_id matches 0 rows; knob CHECKs reject window_days=8 / step_days>window / merge_cap=0 / merge_cap=11 / oldest_target>anchor; grants locked (anon=f/service_role=t, pronargs=5); source CHECK accepts `judge-backfill`.
2. **Task(general-purpose) validation** of migration + prompt edge cases (advance rule: drain/stall/off-by-one at oldest_target; dry-run unconditional advance; lease expiry self-heal) — CLAUDE.md rule #1.
3. Two-pass code review (`Task(feature-dev:code-reviewer)` → `Agent(superpowers:code-reviewer)`), then `npm run qa:smoke`.
4. **PROD gate (b)** is the end-to-end verification: one manual dry-run bucket, verdicts eyeballed in the Judge tab.

## ADO

Move 531 → Active. **Its description/AC are stale** (old "blocked on thread-tracking, combined pass" framing predates Josh's 2026-07-06 decision): update description + AC on the card to match this decided approach (sliding-window backfill via the Judge; AC ≈ anchored RPC keeps live signature working, resumable cursor, backfill mode logs source=judge-backfill, gates a–d sequenced, reversibility preserved). AC verification is the hard gate before any later state change.
