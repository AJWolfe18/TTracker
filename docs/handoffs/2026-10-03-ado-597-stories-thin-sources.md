# ADO-597: Stories agent writing past thin sources, and PROD storing no article text

**Date:** October 2-3, 2026 · **Card:** ADO-597 (Bug, Active) · **Commits:** 244ec49 + 500603f on test, PR #170 merged to main (0266a88)
**Follow-up cards:** ADO-600 (PROD ingest RPC still drops feed_id / opinion_flag / metadata), ADO-601 (4 feeds with 0 PROD articles in 30 days), ADO-602 (surface the Stories `needs_manual_review` flag)

## What started it

PROD Stories run `stories-2026-10-03T02-45-12.322Z` (9:44 PM CT October 2; routine `trig_0182WcUVyjF7Q5o2GWJMxbo1`, session `cse_01BCXvtAF2SD5KuxMwDir7ow`) flagged 3 errors in its own copy and 13 of 17 stories as thin-source. The routine log (RemoteTrigger `get_run_log`) has the agent's own notes.

## What was done

1. **3 stories corrected on PROD** (Josh ran `scripts/maintenance/2026-10-02-ado-597-fix-three-stories.sql`, verified, live on site):
   16294 spicy "loosened-up traffic stops" -> "tighten"; 16291 neutral drops unsourced first names + parties, spicy drops the Senate-majority line; 16287 ORG-DHS removed from top_entities / entity_counter.
   Text fields got `admin.content_history` rows (Undo limit documented in the file: Undo reverts the newest row only).
2. **Prompt** (`docs/features/stories-claude-agent/prompt-v1.md`): source-grounding rule (no facts or entity ids from outside the fetched text), thin-source "say less" rule (`notes='thin_source'`, `needs_manual_review=false`, never under 50 chars, thin never moves alarm_level by itself), Step 5 source check before the single PATCH, Section 6 rule 5a, Step 7 thin_source log example. Guarded by `qa:agent-prompts`.
3. **Parser** (`pickItemText` in `scripts/rss/utils/primitive.js`, used by `fetch_feed.js`): stores the longest item text field. Atom/Arc feeds put full text in rss-parser's `content`, which was never read (The Atlantic kept 64 of 21,824 chars, Vox 394 of 5,599, Votebeat nothing).
4. **Migration 121** (applied on PROD by Josh, `stores_content = true`): PROD ran the migration-005a `upsert_article_and_enqueue_jobs`, which wrote only `excerpt = left(p_content, 500)` and never `content`. 121 = PROD's exact function + the content write; guarded no-op on TEST (032 version). Tested in PGlite against PROD's live definition.
5. **Daily ingest health check** (`scripts/monitoring/alert-ingest-health.js`, step in `rss-health-check.yml`, main only): Discord when no article stored content in 24h, excerpts land empty, or an active feed's source is silent 7 days. Documented in `docs/reference/discord-alerts.md`.
6. **Process:** `/end-work` step 6 now requires an ADO card for every noticed-but-unfixed finding. The July 1, 2026 ADO-528 handoff had already noted `articles.content = NULL in PROD`; nobody acted for three months.

## Findings (numbers from PROD diagnostics, October 2)

- 60-66% of PROD stories have been thin-source every month since January (September: 862 of 1,337; 757 single-article). **Not a regression.** NYT, WaPo, PBS, Politico, CSM, Newsweek, the New Yorker, the Economist and Foreign Affairs publish only a 55-250 char blurb (confirmed live). Recommendation recorded on the card: keep blurbs plus the say-less rule, do not scrape.
- Migration 121 helps the full-text feeds (about a third of articles: Guardian, Fortune, Democracy Docket, ProPublica, and now Atlantic/Vox/Votebeat), not the blurb feeds that caused the 13 flags.
- Cost: about $0.10 a month GPT-4o-mini + embeddings; about 2.5 MB a month DB size; about 150 MB a month egress.
- Pruning (ADO-594): about 750 thin single-article stories a month are the natural prune pool; savings come from embeddings, not text.

## Gotchas

- `excerpt` is `left(content, 500)` at ingest and the August 19 cleanup kept it, so `length(excerpt) < 500` = whole stored text under 500 chars at any date (the thin test in the diagnostics SQL).
- The auto-mode classifier blocked navigating Chrome to the PROD SQL editor; all PROD SQL went through Josh's clipboard. Copying a result overwrites the clipboard, so re-set it (verify the length) before every ask, and tell Josh the first key of the expected result.
- The repo tracks a few packages under `node_modules/`, so a deploy worktree can't junction the full folder; verify the deploy files are byte-identical to the tested test commit instead.

## Verify next session

1. **First stored text on PROD:** `articles?select=source_name&content=not.is.null&limit=20` (anon key) should return rows after the first PROD RSS run following the migration (a background watcher was started October 3 at 12:12 AM CT; its result is not in this doc).
2. **Next Stories run after the merge:** thin stories log `notes='thin_source'` with `needs_manual_review=false`; no unsourced names, parties or entities (RemoteTrigger `list_runs` on `trig_0182WcUVyjF7Q5o2GWJMxbo1`, then `get_run_log`).
3. **First daily ingest check** (7 AM CT): expect one Discord message naming CSM, Time, Reason and Politico Top (ADO-601). The missing-text line must NOT appear.
4. Then move ADO-597 to Resolved. AC 5 is the only open AC.
5. Watch Clustering Judge merges for a week: embeddings of full-text articles now use up to 2,000 chars instead of 500.
