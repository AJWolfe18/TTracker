# Handoff: SCOTUS Enrichment Validation + Test Infrastructure

**Date:** 2026-01-24
**Branch:** test
**Status:** SCOTUS enrichment partially working - bugs identified in quote extraction

**Critical:** 3 cases with good source text failing due to quote extraction bug. Need to investigate before fetching more cases.

---

## Completed This Session

### ADO-285: Test Infrastructure Fixes - DONE
- Added job queue gate check (story_enrich/story_cluster)
- Added `--force` flag for cooldown bypass
- Added `--dry-run` mode for cohort preview
- Added MCP/RLS sanity check
- Fixed EO order_number URL encoding
- Code review caught false-positive service key check (fixed)

**Commits:**
- `24b5d05` - Test infra fixes
- `58907c3` - ADO-282 EO query fix
- `8c6feb0` - Code review fix (service key check)

### ADO-282: EO Enrichment Query Fix - DONE
- Added `prompt_version.is.null` to OR clause
- Catches legacy EOs with NULL enriched_at
- Needs PROD run to backfill 35 EOs

### ADO-85: SCOTUS Enrichment Validation
- Fetched 20 cases from CourtListener
- 8 cases enriched, 4 auto-published
- Fixed Trump v. Anderson to say "President Trump" (not "former")
- Identified cert-stage limitation (see below)

---

## SCOTUS Cases Breakdown (20 total)

### ENRICHED + PUBLIC (4 cases)
| ID | Case | Confidence | Impact | Why Public |
|----|------|-----------|--------|------------|
| 63 | Trump v. Anderson | high | 4 (Rubber-stamping) | Merits, anchor terms, no drift |
| 60 | Great Lakes v. Raiders | high | 2 (Sidestepping) | Merits, anchor terms, no drift |
| 11 | FDA v. Alliance | high | 2 (Sidestepping) | Merits, anchor terms |
| 9 | Becerra v. San Carlos | high | 1 (Crumbs) | Merits, anchor terms, no drift |

### ENRICHED + NOT PUBLIC (4 cases)
| ID | Case | Confidence | Why Not Public |
|----|------|-----------|----------------|
| 4 | Connelly v. United States | **high** | Pre-dates auto-publish (should publish!) |
| 51 | Dept of Ag v. Kirtz | high | Soft drift: disposition missing from summary |
| 23 | Vidal v. Elster | medium | No anchor terms (4647 chars) |
| 12 | Starbucks v. McKinney | medium | No anchor terms (1158 chars) |
| 10 | Truck Insurance v. Kaiser | medium | No anchor terms (4784 chars) |

### FLAGGED - CERT STAGE (4 cases)
| ID | Case | Reason |
|----|------|--------|
| 49 | Smith v. Hamm | Cert denied - drift: who_wins claims merits outcome |
| 54 | Missouri v. Finney | Cert denied - drift: who_wins claims merits outcome |
| 55 | Coalition for TJ | Cert denied - drift: who_wins claims merits outcome |
| 57 | In re Bowe | Cert denied - drift: who_wins claims merits outcome |

**Root cause:** Pass 2 generates "who wins/loses" as if merits decided, but cert denials have no real winner. Drift detector catches mismatch.

### FLAGGED - BUGS TO INVESTIGATE (3 cases)
These have GOOD source text but fail - likely prompt/logic bugs:

| ID | Case | Source | Has Anchors | Bug |
|----|------|--------|-------------|-----|
| 27 | Campos-Chaves v. Garland | 87,987 chars | YES | GPT quotes lack anchor terms |
| 50 | Murray v. UBS | 44,416 chars | YES | Consensus too strict on "remanded" |
| 59 | McElrath v. Georgia | 29,239 chars | YES | GPT quotes lack anchor terms |

### FLAGGED - EXPECTED (1 case)
| ID | Case | Reason |
|----|------|--------|
| 56 | 74 Pinehurst v. New York | Below soft min (2458 chars) + no anchors |

### FLAGGED - NO SOURCE TEXT (3 cases - 2020 term)
| ID | Case | Reason |
|----|------|--------|
| 40 | Tyndall v. United States | 0 chars - no text on CourtListener |
| 1 | Barr v. Am. Ass'n | 0 chars - no text on CourtListener |
| 2 | Rutledge v. Pharm. | 0 chars - no text on CourtListener |

---

## Key Findings

### What's Working
- Merits cases with good source text enrich reliably
- High-confidence cases auto-publish correctly
- Anchor term detection prevents hallucination on bad input
- Drift detection catches Pass 1/Pass 2 mismatches
- Two-pass architecture prevents publishing bad data

### Known Limitations
1. **Cert-stage cases fail** - Need to detect `case_type: cert_stage` in Pass 1 and skip Pass 2
2. **Old cases lack text** - CourtListener doesn't have full text for some older cases
3. **Medium confidence not published** - By design, but could review manually
4. **Pre-auto-publish cases** - Case 4 (Connelly) has high confidence but is_public=false

### Anchor Terms Explained
Legal phrases proving source is real opinion:
- "judgment is affirmed/reversed/vacated/remanded"
- "held that" / "we hold"
- "dismissed for lack of standing/jurisdiction"

Without these, confidence capped to medium (might be syllabus-only).

---

## Next Session Tasks

### Priority 1: Fetch 2025 Cases
We only have 2024 cases. Need current term:
```bash
node scripts/scotus/fetch-cases.js --since=2025-01-01 --limit=20
```

### Priority 2: Investigate Quote Extraction Bug
**Cases 27, 50, 59 have good source text but fail enrichment:**

| Case | Issue | Investigation |
|------|-------|---------------|
| Campos-Chaves (87K chars) | Quote lacks anchor token | GPT extracting wrong quotes |
| McElrath (29K chars) | Quote lacks anchor token | GPT extracting wrong quotes |
| Murray (44K chars) | "reversed and remanded" vs "reversed" | Consensus too strict |

**Questions to answer:**
1. Why does GPT extract quotes without anchor terms when source HAS them?
2. Is "reversed and remanded" vs "reversed" a real difference or should we normalize?
3. Check Pass 1 prompt - is it clear about extracting quotes WITH anchor terms?

**Files to investigate:**
- `scripts/enrichment/scotus-fact-extraction.js` - ANCHOR_TOKEN_REGEX, validatePass1()
- Pass 1 prompt template - quote extraction instructions

### Priority 3: Cert-Stage Skip
After Pass 1, if `case_type: cert_stage` + `merits_reached: false`:
- Set `enrichment_status: 'cert_stage'`
- Skip Pass 2
- Don't show on frontend

### Priority 4: Publish Connelly
```sql
UPDATE scotus_cases SET is_public = true WHERE id = 4;
```

---

## Quick Commands

```bash
# Test spicy prompts (validates #285)
node scripts/test-spicy-prompts.js --dry-run --limit=3

# Fetch more SCOTUS cases
node scripts/scotus/fetch-cases.js --since=2024-01-01 --limit=10

# Enrich SCOTUS cases
node scripts/scotus/enrich-scotus.js --limit=10

# Check case status
# Via MCP: GET /scotus_cases?select=id,case_name,enrichment_status,is_public
```

---

## ADO Status (SCOTUS-related only)

| Item | State | Notes |
|------|-------|-------|
| #85 | Testing | Enrichment working for merits, bugs identified |
| #285 | Testing | Test infra validated |

**Bugs to track:** Quote extraction issue (cases 27, 50, 59) - may need new ADO item

---

## Files Changed

| File | Changes |
|------|---------|
| `scripts/test-spicy-prompts.js` | +150 lines - CLI args, gates, cohort selection |
| `scripts/enrichment/enrich-executive-orders.js` | +10 lines - NULL prompt_version fix |
| `scripts/executive-orders-tracker-supabase.js` | URL encoding fix |
| `scripts/check-missing-eo-fields.js` | URL encoding fix |
