# EO Bulk Enrichment Plan

**Created:** 2026-04-21 (ADO-481 Session 2)
**Status:** In progress — 26/250 done, 224 remaining
**Ticket:** ADO-481 (Active)

## Background

251 PROD EOs needed re-enrichment from legacy GPT pipeline (88% level-4 saturation, fabricated cronyism, banned phrases). Session 2 enriched 26 (16 manual + 10 trigger). Review found 7 of 15 manual enrichments have factual errors in specific claims (wrong statutes, wrong timelines, wrong organization names). Alarm levels are all correct.

## Process (MANDATORY — no shortcuts)

For every EO:
1. **Fetch FR text** via `body_html_url`: `https://www.federalregister.gov/documents/full_text/html/{year}/{month}/{day}/{doc_number}.html`
2. **Read the text** — extract statutory authorities, mechanisms, named entities, timelines
3. **Write editorial** from the actual source text following prompt-v1.md rules
4. **Quality check** all invariants (banned phrases, word counts, named-actor rule, alarm-level calibration)
5. **UPDATE via SQL** with `source: "federal-register"` in enrichment_meta
6. **INSERT log row** for observability

**NEVER write from knowledge alone.** The Session 2 review proved this produces ~47% factual error rate on specific claims.

## Session 3 Plan (Next Session)

### Step 1: Fix 7 factual errors (30 min)

Fetch FR text, fix the specific wrong claims, UPDATE via SQL:

| EO | Fix |
|---|---|
| 14150 | Remove false EO 13985 rescission + 120-day timeline |
| 14153 | Correct statutory authorities, remove "13M acres" and "Tax Cuts and Jobs Act" |
| 14155 | Replace Green Climate Fund reference (wrong institution) |
| 14157 | Fix org names (generic cartels + TdA + MS-13, not Sinaloa/CJNG), add Alien Enemies Act |
| 14167 | Remove Insurrection Act / 10 USC § 252 citations |
| 14173 | Fix timeline (90/120 days not 60), add certification + investigation mechanisms |
| 14164 | Add commutation reversal, precedent overruling, alien targeting provisions |

### Step 2: Fix 3 minor precision issues (10 min)

| EO | Fix |
|---|---|
| 14160 | Specify two-category parent definition |
| 14175 | Clarify 30+15 day designation process |
| 14181 | Note NC disaster coverage |

### Step 3: ADO-489 SCOTUS trigger fix (5 min)

Update SCOTUS PROD trigger Step A to include `git fetch + git reset --hard origin/main`.

### Step 4: Continue new enrichments (remaining time)

Resume from EO 14187 (already done in Session 2 with correct FR-text process).
Next in queue after 14187: remaining v1 EOs from Feb 2025 onward.

**Pace:** ~10-12 EOs per session with FR text fetch (slower than knowledge-only but accurate).
**Remaining:** 224 EOs. At 10/session + 5/day trigger = ~15 sessions to drain.
**Daily cron:** Active, processing 5/day automatically with correct v1.1 output.

## Quality Gates

- Every enrichment must have `source: "federal-register"` in enrichment_meta
- If FR text fetch fails (404, <500 chars), mark as failed and skip — do not guess
- Alarm levels start at 2, earn upgrades with evidence from FR text
- Named actors must appear in FR text or be clearly identified affected parties
- Statutory authorities must come from the order text, not external knowledge

## Tracking

| Metric | Value |
|---|---|
| Total PROD EOs | ~250 |
| Enriched at v1.1 | 27 (26 session 2 + 1 session 2 trigger run 3) |
| Need factual fix | 7 |
| Need minor fix | 3 |
| Clean | 17 |
| Remaining v1 backlog | 171 |
| Remaining NULL backlog | 53 |
| Daily trigger rate | 5/day weekdays |
| Manual enrichment rate | ~10-12/session |
