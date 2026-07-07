# Executive Order Enrichment Agent - Reference

**Status:** Live on PROD · **ADO:** 476 (build), 477 (log), 480 (admin tab), 481 (backlog drain), 482 (legacy cleanup, open) · **Voice/output:** "The Power Grab" (per `public/shared/tone-system.json`)

One-page reference for how the EO agent decides what to work on and what it produces. Written for
quick human review, not as the source of truth - the authoritative details live in the files linked at
the bottom.

---

## What it is

A Claude Opus cloud agent that reads newly published Executive Orders and writes structured, on-brand
enrichment for each one: a neutral summary, a 4-part editorial analysis in the "The Power Grab" voice,
categorized metadata, and a reader action framework. It runs unattended on Anthropic cloud
infrastructure on a daily schedule.

It **replaced a GPT-4o-mini pipeline** that failed on tone and accuracy - it rated ~88% of EOs at the
top alarm level (level-4 saturation) and fabricated cronyism/motivations the source text did not
support. The Claude agent enriched all ~250 existing EOs at prompt `v1.1` and drained that backlog; it
now handles the trickle of new EOs (typically 0-3 signed per day).

- **Cadence:** weekdays 16:00 UTC (cron `0 16 * * 1-5`) - 4PM UTC / 11AM Chicago
- **Model:** Claude Opus · **PROD cron trigger:** `trig_01McAzRLMuu8cawTzbskQkmJ`
- **It reads** the official Federal Register text (and a signing statement if one exists), never guesses
  content, and logs every run for observability.

## What it decides / produces

For each EO it writes one atomic update to the `executive_orders` row:

- **`summary`** - neutral, 2-3 sentences, zero editorial framing.
- **4-part editorial** (150-200 words each): `section_what_they_say` (neutral), `section_what_it_means`,
  `section_reality_check`, `section_why_it_matters` (the last three carry the voice).
- **`alarm_level`** 0-5 with a matching `severity_rating`, plus `category` (one of 10 fixed values),
  `regions`, `policy_areas`, `affected_agencies` (max 3 each).
- **Action framework** - one of `direct` / `systemic` / `tracking`, with an `action_section` payload for
  the first two.
- **`is_public = true`** - EOs auto-publish on enrichment.

Every EO processed gets a row in **`executive_orders_enrichment_log`** (the audit trail behind the admin
**EO tab**): a `running` row on start, PATCHed to `completed` or `failed` at the end, sharing one
`run_id` per agent run. Anything the agent is unsure about (ambiguous alarm level, unclear named actor,
any level-0 result) sets `needs_manual_review = true` for a human to confirm before it is trusted.

## How it selects what to work on

Each run the agent asks the database for unenriched EOs, oldest-first, with this filter (PostgREST):

```
executive_orders?or=(enriched_at.is.null,prompt_version.is.null,prompt_version.neq.v1.1)&order=date.asc
```

In plain language, it picks up an EO row if **any** of these is true:

- it has never been enriched (`enriched_at` is null), OR
- it has no prompt version recorded (`prompt_version` is null), OR
- it was enriched by something **other than** the current Claude prompt (`prompt_version` is not `v1.1`).

That third clause is the key to the old-vs-new split. The retired GPT pipeline also stamped the string
`v1` into `prompt_version`, so the version string alone collided. Bumping the Claude prompt to **`v1.1`**
(a cosmetic string change, ADO-481) means the filter `prompt_version.neq.v1.1` automatically re-queues
every legacy `v1` row without any manual SQL - which is how the backlog drained. Rows already at `v1.1`
fall out of the candidate set and are left alone.

It processes oldest EOs first (`order=date.asc`) so any backlog drains in signing order, and takes only
a small batch per run (the prompt caps a daily run at ~5 EOs; a human raises the limit manually for a
bulk catch-up). If the query returns nothing, that is a healthy empty run - it stops and writes no log
rows.

**Note on IDs:** PROD EO ids are strings of the form `eo_<timestamp>_<suffix>` (e.g.
`eo_1775754706788_9yyufp4qa`), not integers. They must be JSON-quoted in bodies and URL-safe in
PostgREST `id=eq.<value>` filters - a mismatch here silently matches zero rows.

## Key numbers & thresholds

| Knob | Value | Meaning |
|------|-------|---------|
| cron | `0 16 * * 1-5` | weekdays, 16:00 UTC |
| per-run batch | ~5 EOs | typical daily volume; raised manually for backfill |
| `prompt_version` | `v1.1` | current Claude version; the gate that excludes done rows and legacy `v1` |
| `alarm_level` | 0-5 | starts at 2, every upgrade must be earned with specific evidence |
| editorial length | 150-200 words | hard ceiling 200 per section |
| array fields | max 3 | `regions`, `policy_areas`, `affected_agencies` |

**Alarm discipline is the whole point.** The prompt forbids defaulting to level 4 (the exact failure mode
of the old pipeline), starts every EO at level 2, and requires a named beneficiary/victim with concrete
harm before upgrading. Two lazy phrases from the legacy audit (`dangerous precedent`, `under the guise
of`) are hard-banned, along with 27 banned section openings from `tone-system.json`.

## Safety & reversibility

- **`prevent_enriched_at_update` trigger (migration 023):** a `BEFORE UPDATE` trigger on
  `executive_orders` rejects any change to `enriched_at` unless `prompt_version` strictly increases. So an
  EO can never be silently re-enriched at the same version. To legitimately redo one, a human either bumps
  the prompt to `v1.2+` or manually nulls that row's `enriched_at`. This also fails-safe against a
  duplicate concurrent run: the second write is rejected and surfaces as a `failed` log row, not corrupted
  data.
- **`CLAUDE_AGENT_VERSIONS` allow-list (`['v1.1']`):** the admin edge functions
  (`admin-executive-orders`, `admin-update-executive-orders`) treat an EO as Claude-enriched only if its
  `prompt_version` is in this allow-list. Legacy `v1` rows cannot be published or edited through the admin
  UI - the API returns `not_enriched`. A contract test keeps the constant in lockstep across the two edge
  functions and `admin.html`.
- **Untrusted input:** EO text and signing statements are treated as raw data, never as instructions. The
  agent never follows anything embedded in them, never logs the service-role key (only its length), and
  never writes enrichment from guessed content (source text under 500 chars = failed fetch, skip).
- **Human backstop:** enrichment is auto-published (`is_public = true`), but anything flagged
  `needs_manual_review` (uncertainty, or any level-0 result) surfaces in the admin EO tab for Josh to
  confirm or correct.

## Cost

Opus, ~5 short EOs/day on the Anthropic subscription. Effectively **~$0 marginal** - no OpenAI or
Perplexity calls. Retiring the old GPT/Perplexity enrichment removed ~$20/mo of API spend. Comfortably
inside the $50/mo budget.

## Where it lives

- **Prompt (workflow, voice, gold set, invariants):** `docs/features/eo-claude-agent/prompt-v1.md` (v1.1)
- **Backlog drain plan & history:** `docs/features/eo-claude-agent/bulk-enrichment-plan.md`
- **Admin tab plan:** `docs/features/eo-claude-agent/ado-480-admin-tab-plan.md` · validation:
  `docs/features/eo-claude-agent/validation-v1.md`
- **Decision rationale:** `docs/decisions/0001-claude-agents-over-gpt-pipelines.md`
- **Cross-agent mechanics:** `docs/reference/cloud-agent-runbook.md`
- **Database:** `executive_orders`, `executive_orders_enrichment_log`; `prevent_enriched_at_update` trigger
  (migration 023)
- **Admin surface:** EO tab → `admin-executive-orders` / `admin-update-executive-orders` edge functions

---

**Open / unconfirmed:** The legacy GPT enrichment script (`scripts/enrichment/enrich-executive-orders.js`)
still exists in the repo. ADR 0001 lists the legacy scripts as "retired via ADO-473/482," but ADO-482
(retire legacy EO scripts) is tracked as still open, and the legacy script historically still ran on PROD.
Sources are ambiguous on whether the legacy path is fully decommissioned yet - confirm against ADO-482
before assuming it is gone. The live enrichment path is the Claude agent described above.
