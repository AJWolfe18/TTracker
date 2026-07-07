# Handoff — ADO-533 Clustering Judge, session 3 (GO LIVE)

**Date:** 2026-07-06 (UTC 2026-07-07) · **ADO:** 533 → **Active** (live on PROD; only the 3-day monitoring AC remains)
**Prior:** session 1 = build + dry-run; session 2 = hardening + PROD prep (`2026-07-06-ado-533-clustering-judge-session2.md`).

---

## TL;DR — the Judge is LIVE and executing correctly

Everything is deployed and running on PROD. The Judge cron fires 3×/day, executes real merges (capped,
logged, reversible), and pings Discord on `uncertain` verdicts. The **only** open item is the 3-day
monitoring window before ADO-533 can close. First live run merged 10/10 correctly.

## What shipped this session

- **PR #107 → main** (merge engine: `prompt-v1.md`, gold set, RSS JS) — merged (squash).
- **PR #108 → main** (Discord uncertain-alert, prompt Step 7) — merged (squash). Also on `test` (`871bbbf`).
- **Judge cron created:** `trig_01DDXZkpC9PkgTzU8wDdL9QM` — "Clustering Judge Agent (PROD)", `0 5,13,21 * * *`,
  `claude-sonnet-5`, env `env_018AS3Shj6wkH624v1nkssG9`, bootstraps `prompt-v1.md` from `main`.
- **GO LIVE:** Josh set `JUDGE_DRY_RUN=false` **and** `DISCORD_WEBHOOK_URL` in the PROD cloud env
  (claude.ai → Settings → Environments → Claude Code → "TTracker PROD" → Edit environment).
- **5 agent reference docs** added under `docs/reference/` (clustering-judge, scotus-agent, eo-agent,
  pardons-agent, stories-agent) — committed to `test` (`a2682b5`). One-pagers on how each prod agent
  selects work + what it does. NOT yet promoted to main (docs; promote whenever convenient).

## Verification (evidence, not assertion)

- **Dry-run** (fired first, JUDGE_DRY_RUN unset): 30 verdicts (21 merge / 8 keep / 1 uncertain), 0 executed —
  reviewed in the admin Judge tab, same-event⇒merge and chain-of-events⇒keep both correct.
- **First LIVE run: 10/10 correct merges executed** (SCOTUS birthright cluster collapsed 4 fragments into
  survivor 11921; Roosevelt library; NATO loyalty; Anthropic export limits; FBI Georgia; Platner
  same-statement). **Cap-defer confirmed** (#11946/#11956 logged `merge` but not executed —
  `run_merge_cap_reached`; re-surfaces next run). **Chaining confirmed** (#11924/#11934 already merged into
  survivor 11921 earlier in the run). **No wrong merges.**
- **Discord alert confirmed firing** (Josh saw the ping) — the McConnell-condition uncertain verdict.
- `npm run qa:smoke` green (incl. clustering-eval-fidelity tripwire, 100% replay-vs-live).

## Gotchas / decisions worth keeping

- **Cron bootstrap message must defer to the env var — never hardcode a mode.** The first live fire
  SELF-HALTED (correctly): the trigger message still said "JUDGE_DRY_RUN unset = dry-run, do not assume
  otherwise" while the env had `JUDGE_DRY_RUN=false`. The agent refused to merge on a destructive-action
  mismatch and pushed a notification instead. Fixed via `RemoteTrigger action=update` — the message now says
  "trust the env var; false = live, approved." **Any future go-live that flips a mode must update the trigger
  message too.** (This self-halt is the safety model working, not a bug.)
- **Run-to-run wobble on the merge/keep boundary.** The live run was *more conservative* than the dry-run on
  the FIFA/Balogun "reaction" pairs (dry-run merged Cruz/EU/fan reactions into the FIFA story; live-run kept
  them separate as chain-of-events). Both defensible; it wobbled toward `keep` (safe, default-DENY). This is
  the boundary to watch during monitoring — it errs cautious, so low risk.
- **Merge is NOT a decluttering tool.** Josh's instinct to "merge all the FIFA ones" was topic-disinterest,
  not a same-event judgment. Merging distinct events to declutter a disliked topic corrupts the event graph
  AND the Judge's training data. The right lever for off-mission content is suppress/hide (ADO-536), not
  merge.
- **Manual override today is SQL only.** The Judge tab is read-only. To force a merge:
  `select merge_stories(p_loser_id=>L, p_survivor_id=>S, p_run_id=>'manual-...')` (older story = survivor).
  Unmerge = manual reversal from `story_merge_audit` (no RPC yet). ADO-537 makes both one-click.

## New follow-up tickets (created this session)

- **ADO-536** — Content relevance: suppress off-mission stories (e.g. sports). FIFA cluster is the example.
- **ADO-537** — Admin Judge tab: manual merge + unmerge (human override). Merge button (reuses `merge_stories`)
  first; unmerge RPC (built on `story_merge_audit`) second.
- **ADO-531** (existing) — backfill: commented with the decided approach (see below).

## Backfill approach (ADO-531) — decided, gated on 533 monitoring

Use a **sliding 7-day window walking backward**, NOT a widened window (widening reintroduces the 100+ day
generic-phrasing false merges the 7-day window kills). Needs: an anchor-date param on
`get_clustering_judge_candidates` (scan `[anchor-7d, anchor]`), a `backfill_state` cursor (today → oldest),
low per-run cap, higher cadence for a weekend burn (~24 runs × ≤10 = ≤240 merges/window, all logged +
reversible). **Do NOT start until 533's 3-day window is clean** — backfilling 12k with an unproven judge
multiplies any systematic error 12,000×. Size cost + egress against the story date-distribution first.

## NEXT SESSION — pick up here

1. **3-day PROD monitoring** (through ~2026-07-10): scan the admin Judge tab (30d filter) + Discord for any
   *wrong merge*. Unwind any via `story_merge_audit` / SQL (or note IDs). Watch the merge/keep wobble.
2. **Verify ADO-533 AC** (all met except monitoring) → **close 533** + `/end-work` once the window is clean.
3. Then **ADO-531 backfill** (approach above), and schedule **536/537** as capacity allows.

**Weekend note (Josh away):** the cron runs itself; nothing to do. If you spot a merge to make or undo, send
the two story IDs. Missed merges are cosmetic (low harm); wrong merges are the thing to catch, and they're
reversible.

## Cost
$0 this session (the dry-run + live run are Sonnet on the subscription; the smoke test was a SQL RPC). Live
cron = Sonnet 3×/day, already approved. No new secrets beyond the Discord webhook Josh added to the PROD env.
