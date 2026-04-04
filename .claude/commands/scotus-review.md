---
description: SCOTUS Enrichment Review
---

# SCOTUS Enrichment Review

Review SCOTUS enrichment output for hard field accuracy and editorial tone alignment.

## Usage

```
/scotus-review <case_ids>
```

Examples:
- `/scotus-review 23,108,118` — Review specific cases
- `/scotus-review latest` — Review most recently enriched cases
- `/scotus-review latest 5` — Review last 5 enriched cases

## Arguments

```
$ARGUMENTS
```

## What This Does

### 1. Fetch Enriched Cases

Query TEST DB for the specified cases:

```
GET /scotus_cases?id=in.(<IDS>)&select=id,case_name,case_name_short,disposition,holding,vote_split,majority_author,dissent_authors,case_type,ruling_impact_level,ruling_label,who_wins,who_loses,summary_spicy,why_it_matters,dissent_highlights,evidence_anchors,evidence_quotes,issue_area,prevailing_party,practical_effect,merits_reached,dissent_exists,fact_extraction_confidence,low_confidence_reason,needs_manual_review,enrichment_status,enriched_at,prompt_version,media_says,actually_means,substantive_winner
```

If "latest" was specified, use:
```
GET /scotus_cases?enrichment_status=eq.enriched&order=enriched_at.desc&limit=<N>&select=...
```

### 2. Fetch Gold Truth

Read the gold truth file: `tests/scotus-gold-truth.json`

Match each fetched case by `id` against `gold_cases`, `non_gold_cases`, and `edge_cases`. If a match exists, use it for hard field validation.

### 3. Hard Field Validation

For each case with a gold truth match, check these fields:

| Field | Check |
|-------|-------|
| `disposition` | Exact match |
| `vote_split` | Exact match |
| `majority_author` | Exact match (null = per curiam) |
| `dissent_authors` | All expected authors present (order doesn't matter) |
| `case_type` | Exact match |

**Scoring:**
- PASS: All 5 hard fields correct
- SOFT FAIL: 4/5 correct AND `needs_manual_review = true` for the wrong field(s)
- FAIL: Any hard field wrong without manual review flag

For cases without gold truth: note "No gold truth available — editorial review only."

### 4. Editorial Tone Review

For each case, evaluate `summary_spicy` and `why_it_matters` against the tone system.

**Reference:** `public/shared/tone-system.json` — SCOTUS voice is "The Betrayal."

**Check these against `ruling_impact_level`:**

| Level | Expected Tone | Profanity? |
|-------|---------------|------------|
| 5 | ALARM BELLS: Cold fury, prosecutorial | YES (for incredulity) |
| 4 | ANGRY ACCOUNTABILITY: Name names, victims/beneficiaries | YES |
| 3 | SARDONIC CRITIQUE: Dark humor, weary, absurdity | NO |
| 2 | EYE-ROLL: Measured critique, system dysfunction | NO |
| 1 | CAUTIOUS SKEPTICISM: Credit + asterisk | NO |
| 0 | SUSPICIOUS CELEBRATION: Disbelief it worked | NO |

**Tone checks:**
- [ ] Voice matches "The Betrayal" — not neutral wire copy, not generic angry
- [ ] Tone intensity matches the level (level 2 shouldn't read like level 5)
- [ ] Profanity only at levels 4-5 (flag any profanity at 0-3)
- [ ] No profanity missing at level 5 where it would add impact (note, don't flag)
- [ ] No banned openings (check against `bannedOpenings` in tone-system.json)
- [ ] Varied approach — not starting every summary the same way
- [ ] Makes it personal (YOUR rights, YOUR taxes) where appropriate
- [ ] Names names — donors, beneficiaries, specific parties
- [ ] Claims anchored in opinion text (not invented)
- [ ] Not academic or AP-wire neutral

### 5. Completeness Check

For each case, verify:
- [ ] All required fields populated (no nulls where values expected)
- [ ] `ruling_label` is 3-8 words and not generic
- [ ] `evidence_anchors` has 2-4 actual quotes
- [ ] `evidence_quotes` has 1-3 entries with context
- [ ] `who_wins` / `who_loses` name specific parties
- [ ] `holding` is 1-3 sentences
- [ ] `summary_spicy` is 2-4 sentences
- [ ] `enrichment_status` = 'enriched'
- [ ] `enriched_at` is set

### 6. Output Report

For each case, output:

```
## Case ID <id>: <case_name_short>
Impact Level: <level> | Disposition: <disposition> | Vote: <vote_split>

### Hard Fields: [PASS/SOFT FAIL/FAIL/NO GOLD TRUTH]
- disposition: [correct/WRONG (expected X, got Y)]
- vote_split: [correct/WRONG]
- majority_author: [correct/WRONG]
- dissent_authors: [correct/WRONG]
- case_type: [correct/WRONG]

### Tone: [ALIGNED/NEEDS WORK]
- Voice match: [yes/no — detail]
- Level calibration: [yes/no — detail]
- Profanity compliance: [yes/no — detail]
- Banned openings: [clean/VIOLATION — which one]
- Engagement: [high/medium/low — detail]

### Completeness: [COMPLETE/GAPS]
- [list any missing fields]

### summary_spicy preview:
> [first 200 chars of summary_spicy]
```

Then a summary table:

```
| ID | Case | Hard Fields | Tone | Complete | Verdict |
|----|------|-------------|------|----------|---------|
```

Verdicts: PASS (all three good), REVIEW (tone needs work but fields ok), FAIL (hard field errors)
