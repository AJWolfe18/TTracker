# Pardons Enrichment Agent — Reference

**Status:** Live on PROD · **ADO:** 516 / 527 · **Voice/output:** "The Transaction" (it writes reader-facing editorial content)

One-page reference for how the Pardons Enrichment Agent decides what to work on and what it does. Written
for quick human review, not as the source of truth — the authoritative details live in the files linked at
the bottom. Where the plan doc and the prompt disagree, **the prompt wins.**

---

## What it is

A Claude Opus cloud agent that researches each Trump pardon recipient on the open web and writes a full
enrichment record: what the person actually did, how corrupt the pardon looks, the Trump connection, and
the editorial copy readers see. It replaced an earlier Perplexity + GPT research step, so it now owns both
the research and the writing in a single pass.

- **Cadence:** daily at 20:00 UTC (cron `0 20 * * *`), 2 hours after the DOJ scraper runs
- **Model:** Claude Opus · **PROD cron trigger:** `trig_018LUznaUWwijFhMZLp8kYE2`
- **Gold set:** 5/5 calibration examples pass (one per corruption level)
- **It does NOT** touch the factual DOJ fields (`recipient_name`, `offense_raw`, `pardon_date`,
  `case_number`, `crime_category`, etc.). It only writes analysis, editorial, and provenance fields.

## What it decides / produces

For each pardon it writes one atomic update covering:

- **`crime_description`** — plain-language account of what the person actually did, not just the charge name.
- **`corruption_level` (0-5)** plus `corruption_reasoning`, `primary_connection_type`, and the Trump
  connection narrative — every connection claim must be tied to a source it actually read.
- **Editorial copy** in the "The Transaction" voice (`summary_spicy`, `why_it_matters`,
  `pattern_analysis`), plus a neutral `summary_neutral`. Tone escalates with corruption level; profanity is
  only allowed at levels 4-5.
- **`receipts_timeline` and `source_urls`** — these columns are `NOT NULL`, so the agent must send `[]`
  (empty array), never `null`.
- **Post-pardon tracking** (`post_pardon_status`, `post_pardon_notes`) — flags re-arrests or new
  investigations, with January 6th defendants as the top priority.
- **Provenance:** `enriched_at`, `enrichment_meta`, `research_status = 'complete'`, and the enrichment
  version column **`prompt_version`** (this is the real column — not `enrichment_prompt_version`).

Every run writes a row to **`pardons_enrichment_log`**, even a run that finds 0 pardons.

## How it selects what to work on

Each run the agent asks the database for pardons **that have never been enriched** — the query filters on
`enriched_at IS NULL`, orders by `pardon_date.asc` (oldest first, to clear backlog), and takes the **first
5**. Five per run is deliberate: each recipient needs real web research, which is slow inside the agent's
15-turn limit.

Two rows are deliberately excluded from real work:

- **The Jan 6 mass pardon (id = 3)** is a hand-written group card representing 1500+ defendants. It is
  **locked** (`prompt_version = 'locked'`), so if it ever appears in the results the agent skips it,
  logs it as protected, and never overwrites it. It is excluded from the processing count (5 found minus 1
  protected = 4 processed).
- If another run started within the last 30 minutes (`status = 'running'`), the agent **bails out** to
  avoid two agents enriching the same pardons at once.

Once selected, each pardon goes through web research (crime details, FEC/donation records, post-pardon
news) plus the **Connection Investigation Protocol** — four mandatory checks for the indirect ties that
look like "no connection" on the surface: (1) the pardon attorney/advocate, (2) whether the pardon sets
precedent useful to Trump personally, (3) who funded the defense, and (4) the co-defendant test (others in
the same case who did *not* get pardoned).

**Calibration is the point.** The default corruption level for any pardon with a political connection is
**L3, not L1** — L1 means a genuine search found nothing at all and should be under 10% of output.
Crucially, a **serious criminal with no documented paper trail defaults to L3 with
`primary_connection_type = 'wealthy_unknown'`**, not L1 — the absence of any advocacy channel for a major
criminal is itself the signal ("someone paid, we can't prove who").

## Key numbers & thresholds

| Knob | Value | Meaning |
|------|-------|---------|
| pardons per run | **5** | balances research depth against the 15-turn agent limit |
| selection filter | **`enriched_at IS NULL`**, `order=pardon_date.asc` | oldest unenriched first |
| corruption scale | **0-5** | 0 Actual Mercy → 5 Pay 2 Win |
| L1 ceiling | **<10%** | most "no connection" is really L3; recalibrate if L1 recurs |
| concurrency guard | **30 min** | bail if another run is `running` inside this window |
| protected row | **id = 3** | Jan 6 group card, `prompt_version='locked'`, never overwritten |

## Safety & reversibility

- **Publish gate (this is the key difference from SCOTUS/EO).** Pardons are **NOT publish-by-default.**
  A pardon only goes public when the agent is confident: `is_public = true` requires `needs_review = false`,
  and any flagged pardon is set `is_public = false`. A database trigger enforces this pairing on every
  write, so a flagged pardon cannot leak to the site.
- **`review_reason` is mandatory when flagging.** Whenever `needs_review = true`, `enrichment_meta` must
  contain a one-sentence `review_reason` explaining what triggered the flag. Triggers include:
  `corruption_level = 0`, low confidence, co-defendant ambiguity, a name mismatch, a serious criminal with
  no advocacy channel, or any post-pardon status change. Josh reviews these before they publish.
- **One atomic write per pardon.** No partial updates; each write is verified (an empty PostgREST response
  means the write failed and is logged).
- **Factual DOJ fields are never touched** — the agent has an explicit never-write list, so it cannot
  corrupt the source record even if web research is wrong.
- **Web content is untrusted.** The agent treats all fetched pages as data, never instructions, and never
  echoes the service key or env vars into any field.

## Cost

Opus, ~5 pardons/day with several WebFetch calls each, once per day. No OpenAI calls. A few dollars a month
at most — comfortably inside the $50/mo budget.

## Where it lives

- **Prompt (authoritative workflow):** `docs/features/pardons-claude-agent/prompt-v1.md`
- **Plan (secondary, treat as unreliable where it conflicts with the prompt):**
  `docs/features/pardons-claude-agent/plan.md`
- **Voice/tone rules:** `public/shared/tone-system.json` ("The Transaction")
- **Database:** `migrations/056_pardons_table.sql` (pardons + publish-gate columns),
  `071_pardons_enrichment_meta.sql` (`prompt_version`, `enrichment_meta`),
  `094_pardons_enrichment_log.sql` (observability log),
  `097_jan6_manual_enrichment.sql` (locked Jan 6 group card, id = 3)
- **Tables accessed:** `pardons`, `pardons_enrichment_log`
