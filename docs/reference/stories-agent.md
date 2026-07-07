# Stories Enrichment Agent - Reference

**Status:** Live on PROD (2026-07-05) · **ADO:** 528 · **Voice/output:** "The Chaos" (editorial `summary_spicy`) + neutral `summary_neutral`

One-page reference for how the Stories Enrichment Agent decides what to work on and what it writes. Written
for quick human review, not as the source of truth - the authoritative details live in the files linked at
the bottom.

---

## What it is

A Claude Sonnet cloud agent that reads freshly clustered stories and writes their AI enrichment: a neutral
summary, an on-brand "The Chaos"-voice summary, a category, an alarm level, and canonical entities. It is
the **replacement** for the retired GPT-4o-mini inline pipeline, which had saturated the ratings - roughly
67% of live stories sat at alarm_level 4-5, the "everything is a crisis" failure mode this agent exists to
fix by earning every alarm-level upgrade with specific evidence.

- **Cadence:** every 2 hours at :30 past (cron `30 */2 * * *`), 30 minutes offset from the RSS clustering cron
- **Model:** Sonnet (claude-sonnet-5 on the PROD trigger) · **Cron trigger:** `trig_0182WcUVyjF7Q5o2GWJMxbo1`
- **It does NOT** cluster articles, merge stories, or write `needs_review`/`is_public`. Clustering stays
  inline and GPT-free in the RSS pipeline; story merging is the separate **Clustering Judge** agent
  (see `docs/reference/clustering-judge.md`). This agent only enriches.

## What it decides / produces

For each story it can enrich, it produces all fields in a single reasoning pass and writes them in one
atomic update:

- **`summary_neutral`** - 2-3 neutral sentences. Writing this is what makes the story appear on the site
  (see the publish gate below).
- **`summary_spicy`** - the "The Chaos"-voice editorial take, tone-calibrated to the alarm level.
- **`category`** - one of the 11 fixed database categories (never a new one).
- **`alarm_level`** (0-5) and derived **`severity`** - started at 2, upgraded only with a named actor and
  concrete, non-speculative consequence. `severity` is mechanically mapped from the level, never chosen.
- **`primary_actor`, `top_entities`, `entity_counter`** - the most central actor plus canonical entity IDs
  (validated against `scripts/lib/entity-normalization.js`, since these IDs feed future clustering).

Every run leaves an audit trail in **`stories_enrichment_log`**: one row per story processed (success or
failure), or a single heartbeat row on a healthy empty run (see below).

## How it selects what to work on

This is the most important part. Each run the agent queries the `stories` table for **active** stories that
match one of two conditions:

1. **Never enriched** - `last_enriched_at IS NULL`. First-time clustering output, always eligible.
2. **Its own output, now stale** - `enrichment_meta->>'source' = 'claude-agent'` AND `last_enriched_at` is
   older than 12 hours. This re-enriches a story as its cluster grows, and retries a story whose prior
   attempt failed (a failed attempt also writes the `source: claude-agent` marker, so it re-qualifies here).

The `enrichment_meta->>'source' = 'claude-agent'` check is the **critical discriminator**. It is what keeps
the agent from ever sweeping up the old GPT-enriched backlog. Almost every legacy story has a stale
`last_enriched_at`, so without this filter the agent would try to reprocess the entire back catalogue on the
first few cycles. Stories written by the old GPT pipeline (marked `model: gpt-4o-mini`, no `source` key) stay
**frozen and invisible to this query forever**, by design. Reprocessing that historical backlog is explicitly
out of scope - it only happens if a human deliberately clears those markers on targeted rows.

The query also inner-joins `article_story`, so stories with zero linked articles (nothing to enrich from)
are excluded. It orders oldest-first and takes up to 40 per run.

**Publish gate (unchanged, reused):** the site already hides any story with `summary_neutral IS NULL` (the
`stories-active` edge function, TTRC-119). This agent reuses that exact gate - the moment it writes
`summary_neutral`, the story goes live. **No new column and no frontend change** were needed. Because the
agent processes one story at a time (write, then move on), stories appear on the site as a progressive
trickle rather than all at once at the end of a run.

## Key numbers & thresholds

| Knob | Value | Meaning |
|------|-------|---------|
| cadence | `30 */2 * * *` | every 2 hours at :30, offset 30 min after clustering |
| candidate limit | **40** | stories evaluated per run (headroom over the ~5-8/run typical load) |
| source articles | **6** | max articles read per story (ordered primary-source first) |
| staleness cooldown | **12 h** | how old its own enrichment must be to re-qualify |
| alarm start | **2** | every story starts here; upgrades must be earned with evidence |
| profanity | levels **4-5 only** | `summary_spicy` only; never at 0-3 |

**The alarm-level discipline is the point.** Level 3 needs a named institutional actor in a real pattern of
corruption/spin; level 4 needs concrete, non-speculative criminal or constitutional harm; level 5 needs a
verified constitutional-crisis-scale event (courts defied, elections subverted). If a run's first three
stories all land at level 4, that is the old saturation bug reappearing and the agent is told to re-examine.

## Safety & reversibility

- **Concurrency has no DB trigger.** Unlike the EO agent (which relies on a `prevent_enriched_at_update`
  trigger to reject a second write), this agent guards against overlapping runs with **optimistic filtering**:
  every write is conditional on `last_enriched_at` not having changed since the story was read. If another
  run got there first, the update matches zero rows, and the agent logs it as `concurrent_write_lost` rather
  than silently overwriting. A coarse pre-check also lets an obviously-overlapping run exit early.
- **Failures never corrupt content.** On a failure path the agent stamps `last_enriched_at`, increments
  `enrichment_failure_count`, and records an error category - but leaves `summary_neutral`, `summary_spicy`,
  and the rest exactly as they were (blank on a first failure), never partial or guessed.
- **Every run leaves a trace.** Empty runs are common at 12 runs/day (overnight lulls, a just-drained
  backlog), so on a 0-candidate run the agent writes one **heartbeat row** to `stories_enrichment_log` with a
  null `story_id`. That keeps "the agent stopped running" distinguishable from "nothing to do."
- **Legacy kill switch.** The old GPT enrichment path is gated behind the repo variable
  `ENABLE_LEGACY_STORY_ENRICHMENT`, off by default. Flipping it to `true` re-enables the inline GPT path for
  rollback with no code change; pausing this agent is done from the trigger side.
- **Untrusted input.** Article titles and content are treated as data, never as instructions - the agent
  never follows anything embedded in a source article.

## Cost

Sonnet, up to ~40 short stories/run, 12 runs/day, subscription-included cloud agent - **no incremental
OpenAI cost**. It actually **removes** the ~$5.60/month the GPT-4o-mini story pipeline used to spend, so it
reduces spend against the $50/month cap rather than adding to it. (Clustering embeddings are separate, cheap,
and unchanged.)

## Where it lives

- **Prompt (workflow):** `docs/features/stories-claude-agent/prompt-v1.md`
- **Architecture & decisions:** `docs/features/stories-claude-agent/plan.md`
- **Database:** `migrations/098_stories_enrichment_log.sql` (log table with nullable `story_id` for the
  heartbeat row); enrichment writes go to the existing `stories` table
- **Kill switch:** repo variable `ENABLE_LEGACY_STORY_ENRICHMENT` + the gate in `scripts/rss-tracker-supabase.js`
- **Voice / tone rules:** `public/shared/tone-system.json` ("The Chaos") · **Entity IDs:** `scripts/lib/entity-normalization.js`
- **Related agent:** Clustering Judge (story merging) - `docs/reference/clustering-judge.md`
- **Validation results:** `docs/features/stories-claude-agent/validation-results/`
