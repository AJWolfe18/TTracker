# 2026-08-24 — PROD RSS pipeline outage: OpenAI out of credits

**Type:** Ops incident / diagnosis only — no code changes, no ADO ticket.

## What happened
- 5 consecutive `RSS Tracker - PROD` runs failed 18:27 → 02:51 UTC (last green 16:25 UTC).
- Every run died at the article-embedding step: `429 insufficient_quota — You have no credits remaining`
  → `FATAL: OpenAI auth/payment error (429). Aborting embeddings.` → exit 1.
- Embeddings (`text-embedding-3-small`) are the only OpenAI call left in the PROD pipeline
  (editorial enrichment is Claude agents; legacy GPT story enrichment is OFF).

## Diagnosis steps (repeatable)
```bash
gh run list --workflow "RSS Tracker - PROD" --limit 15 --json conclusion,createdAt
gh run view <id> --log-failed | grep -iE "429|quota|FATAL"
gh secret list | grep -i openai   # OPENAI_API_KEY last set 2025-06-29
```

## Gotcha
Josh's first credit top-up did NOT fix it — a manual re-run (`32807382009`) still 429'd.
Credits must land on the OpenAI org/project that the GitHub-secret key belongs to.
Second top-up ("payment cleared") worked: run `32808567473` → 41 embeddings, 0 failures.

## Recovery: self-healing, no manual steps
- Feeds/articles were still ingested during the outage; only embed → cluster → enrich were skipped.
- Each run selects `articles WHERE embedding_v1 IS NULL` (100/run) and `get_unclustered_articles`.
- First recovery run hit the 4-min runtime guard during clustering → `partial_success`
  (10 of 41 clustered). Expected; cron (every 2h) drains the rest.
- All failures were logged to `pipeline_skips` (reason `API_ERROR`) — admin → Skips tab.

## Watch item
Hybrid-clustering ANN candidate block took 7–9s/article (target <100ms) on the recovery run.
Check the 06:00/08:00 UTC runs on 2026-08-25; if it persists on normal-size runs, open an ADO story.

## Cost
Negligible — backlog is embeddings only (~$0.0001/article).
