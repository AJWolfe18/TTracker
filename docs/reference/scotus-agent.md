# SCOTUS Enrichment Agent — Reference

**Status:** Live on PROD · **Voice/output:** "The Betrayal" (SCOTUS editorial voice — it DOES write editorial content) · **Prompt:** v1.1

One-page reference for how the SCOTUS Enrichment Agent decides what to work on and what it does. Written
for quick human review, not as the source of truth — the authoritative details live in the files linked at
the bottom.

---

## What it is

A Claude Opus cloud agent that reads Supreme Court opinions and writes the full public case record: the
facts (who won, the vote, the disposition) AND the editorial take (the summary, the "who wins / who
loses", the impact level). It runs on Anthropic's cloud infrastructure, not on our machines or GitHub
Actions.

It **replaced a ~4,300-line GPT pipeline** (two separate passes — one for facts, one for editorial — plus
~2,000 lines of drift/QA/reconciliation guardrails). That old system had a **60% contradiction rate**: the
two passes disagreed with each other on dispositions, who won, and how big the case was. The fix was
structural — have **one model read the opinion and write facts + editorial in a single reasoning pass**, so
the facts and the editorial physically cannot contradict (same context, same reasoning chain). Since
cutover it has enriched **116/116 cases with 0 failures**.

- **Cadence:** weekdays at 16:00 UTC (cron `0 16 * * 1-5`) — SCOTUS releases opinions on weekdays, and
  the fetch job runs earlier the same day
- **Model:** Claude Opus · **PROD cron trigger:** `trig_019eD3JTVeSajL4qTJJSC6tq`
- **It does NOT** set `qa_status` or any QA column, and it does not follow instructions found inside
  opinion text (untrusted input). It reads, enriches, publishes, and logs.

## What it decides / produces

For each case it produces a full enrichment and writes it in one atomic update:

- **Fact fields** (kept neutral and precise): `disposition` (from a fixed enum including compound forms
  like `reversed_and_remanded` and `GVR`), `vote_split` (`N-N`), `majority_author`, `dissent_authors`,
  `holding`, `case_type`, `prevailing_party`, and the merits/dissent booleans.
- **Editorial fields** (written in "The Betrayal" voice): `summary_spicy`, `why_it_matters`,
  `who_wins` / `who_loses`, `ruling_label`, `ruling_impact_level` (0-5), `dissent_highlights`,
  `media_says` / `actually_means`, plus supporting `evidence_anchors` / `evidence_quotes`.
- **Confidence flags:** `fact_extraction_confidence` (high/medium/low) and `needs_manual_review`. The agent
  is told to **flag uncertainty rather than guess** — if the vote split or author is not explicit in the
  text, it does not assume, it sets confidence `low` and `needs_manual_review = true` with a reason.

Every run — even a run that finds 0 cases — writes a row to the **`scotus_enrichment_log`** table for
observability (what it found, what it enriched, any errors, duration).

## How it selects what to work on

Each run, the agent asks the database for cases that still need enriching:

- rows where **`enrichment_status` is `pending` or `failed`** (`failed` is included so a case that broke on
  a prior run gets retried),
- **oldest first** (ordered by `decided_at` ascending, so any backlog clears before new cases),
- **up to 20 per run** (a typical day has 0-5 new cases; the higher limit is there to drain end-of-term
  surges and backlogs faster).

Cases enter the pipeline as `pending` because the **CourtListener fetch** (`scripts/scotus/fetch-cases.js`)
inserts every new case with `enrichment_status = 'pending'` and `is_public = false` — invisible to the
public until this agent enriches it. So the agent's candidate list is exactly "cases that have been fetched
but not yet enriched (or failed last time)."

**Recess is normal.** July-September the Court is out, so most runs find **0 cases** — that is logged as a
healthy completed run, not a failure.

**Concurrency guard:** at the start of each run the agent checks the log for another run marked `running`
in the last 30 minutes; if one exists, it bails cleanly so two agents never enrich the same case at once.

## Key numbers & thresholds

| Knob | Value | Meaning |
|------|-------|---------|
| candidate filter | `enrichment_status IN (pending, failed)` | which cases are eligible |
| order | `decided_at` ascending | oldest first (drain backlog before new cases) |
| per-run cap | **20** | cases pulled per run |
| source-text floor | **500 chars** | below this, fall back to fuller opinion text |
| opinion cap | **30,000 chars** | max opinion text read per case (truncated from the end) |
| concurrency window | **30 min** | a `running` log row inside this window means "another run is live" |

**Which opinion text it reads (in order):** syllabus first (the Reporter's summary, densest); if that is
under 500 chars, add the opinion excerpt; only if the combined text is still under 500 chars does it pull
the full opinion from `scotus_opinions`, capped at 30K chars. If no text exists at all, the case is marked
`failed` and skipped — not guessed.

## Safety & reversibility

- **Auto-publish is intentional (publish-by-default).** On successful enrichment the agent sets
  `is_public = true`. This is a deliberate 2026-05-31 design decision: high-quality cases were previously
  sitting unpublished waiting on manual review, so review moved to **after** publish. If something is wrong,
  Josh can unpublish or correct it — publishing is the default, not the gate.
- **`needs_manual_review` is an advisory flag, NOT a publish gate.** A case can be `needs_manual_review =
  true` and still be public. The flag routes Josh's attention (a 30-second check); it does not hold the case
  back. (This is the opposite of pardons, where review deliberately blocks publish.)
- **The agent never self-approves quality.** It is barred from writing `qa_status` or any QA / gold-set /
  override column — QA stays a separate human step. `enrichment_status` only ever becomes `enriched` or
  `failed`, never a QA state.
- **Every write is verified and logged.** Each case is a single atomic update whose response is checked (an
  empty response = write failed = logged and skipped); the whole run is bracketed by log rows so any bad
  batch is traceable and the affected cases can be reset to `pending` and re-run.
- **Security:** opinion text is treated as untrusted input — the agent never follows instructions embedded
  in an opinion, and the service key is never logged.

## Cost

Runs on the Claude subscription (cloud agent), so the enrichment itself is **effectively $0** — no OpenAI
or Perplexity API calls. Replacing the old GPT pipeline **removed ~$20/month** of OpenAI spend (fact pass +
QA layer). Comfortably inside the $50/mo budget.

## Where it lives

- **Prompt (workflow):** `docs/features/scotus-claude-agent/prompt-v1.md`
- **Architecture & decisions:** `docs/features/scotus-claude-agent/plan.md` (single-pass rationale,
  auto-publish amendment, rollback plan)
- **Cross-agent mechanics:** `docs/reference/cloud-agent-runbook.md`
- **Case fetch:** `scripts/scotus/fetch-cases.js` (CourtListener API → `scotus_cases` / `scotus_opinions`,
  cases start `is_public = false`)
- **Database:** `migrations/066_scotus_cases.sql` (base table, `is_public` gate),
  `067_scotus_two_pass.sql` (`enrichment_status`, `needs_manual_review`),
  `073_scotus_qa_columns.sql` (`qa_status` — human-only), `090_scotus_enrichment_log.sql` (run log)
- **Voice / tone rules:** `public/shared/tone-system.json` ("The Betrayal" banned openings, phrases,
  writing rules — binding on all editorial output)

---

**Open / unconfirmed:** Model is documented as **Opus** per `prompt-v1.md` metadata; the older `plan.md`
and the `scotus_enrichment_log` default still reference Sonnet 4.6 (the PROD trigger is authoritative).
Cadence is **weekdays 16:00 UTC** per the live PROD cron; `plan.md` describes an older daily-19:00-UTC
TEST design that appears superseded. The 116/116-cases / 0-failures stat is from the deployment record,
not re-verified against a live query.
