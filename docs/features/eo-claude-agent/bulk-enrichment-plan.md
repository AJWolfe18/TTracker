# EO Bulk Enrichment Plan

**Created:** 2026-04-21 | **Updated:** 2026-04-21 (post-review)
**Ticket:** ADO-481 (Active)
**Goal:** Re-enrich all ~224 remaining EOs from legacy GPT pipeline to v1.1

## Current State

- **Done:** 27 at v1.1 (all factual errors fixed, all reviewed against FR text)
- **Remaining:** 224 (171 at v1 + 53 at NULL)
- **Daily cron:** Active, 5/day weekdays via PROD trigger
- **Next in queue:** EO 14189 "Celebrating America's 250th Birthday" (2025-02-03) — 14187 already done

## Per-EO Process (NO EXCEPTIONS)

1. **Fetch FR text** via `body_html_url`:
   ```
   https://www.federalregister.gov/documents/full_text/html/{year}/{month}/{day}/{doc_number}.html
   ```
2. **Fallback chain** if body_html_url fails:
   - Try govinfo: `https://www.govinfo.gov/content/pkg/FR-{year}-{month}-{day}/html/{doc_number}.htm`
   - Try FR API: `https://www.federalregister.gov/api/v1/documents/{doc_number}.json`
   - If all fail (<500 chars): mark failed, skip. **NEVER write from knowledge.**
3. **Write editorial** from actual source text per prompt-v1.md
4. **Quality check** invariants (banned phrases, word counts, named-actor rule, alarm calibration)
5. **UPDATE via SQL** with `enrichment_meta.source = "federal-register"`

## Session Execution Pattern

Each session:

1. Query next 5 unenriched EOs: `WHERE prompt_version = 'v1' ORDER BY date ASC LIMIT 5`
2. Fetch FR text for all 5 in **parallel** (5 concurrent WebFetch calls)
3. Write editorial for each from FR text
4. Execute 3-5 SQL UPDATEs in **parallel**
5. Repeat until context runs low
6. **Expected throughput:** 10-15 EOs/session (FR fetch + editorial + SQL)

## Throughput Optimization

| Channel | Rate | Notes |
|---|---|---|
| Manual (in-session) | 10-15/session | Parallel FR fetch + parallel SQL |
| PROD trigger (auto) | 5/day weekdays | Confirmed v1.1 output with git-pull fix |
| **Combined** | **~20/day** | If 1 session/day + auto-cron |
| **Time to drain** | **~12 sessions** | 224 ÷ 20 ≈ 12 days |

**Trigger limit bump (optional):** Test increasing Step 2 `limit=5` to `limit=10` — Opus processed 5 with turns to spare. If 10 works, auto-cron doubles to 10/day and drain time drops to ~9 sessions.

## Quality Gates

- `enrichment_meta.source` MUST be `"federal-register"` — anything else means the process was skipped
- FR text < 500 chars = failed fetch, skip the EO
- Alarm levels start at 2, earn upgrades with cited evidence
- Named actors from FR text or clearly identified affected parties (not fabricated)
- Statutory authorities from order text only
- **Spot-check cadence:** Josh reviews 5 random EOs every ~50 enriched via admin dashboard

## Backlog Drain Tracking

Update this after each session:

| Session | Date | Manual | Trigger | Total Done | Remaining |
|---|---|---|---|---|---|
| 2 | 2026-04-21 | 17 | 10 | 27 | 224 |
| 3 | | | | | |
| 4 | | | | | |

## Pre-Session Checklist

- [ ] `git branch --show-current` → test
- [ ] Read this plan + memory
- [ ] ADO-489 done? (SCOTUS trigger git-pull fix — do first if not)
- [ ] Query remaining count: `SELECT COUNT(*) FROM executive_orders WHERE prompt_version != 'v1.1' OR prompt_version IS NULL`
- [ ] Start enrichment loop
