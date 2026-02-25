# ADO-390: SCOTUS Enrichment Gaps Plan

## Problem Summary

After initial enrichment run, 108 cases are flagged (unenriched) and 8 merits cases are enriched but not public. Total public cases: 51 (TEST: 20). Goal: maximize public merits cases without lowering quality.

## Data Analysis (Feb 23)

### Flagged Cases Breakdown (108 total)

| Reason Category | Count | Salvageable? |
|----------------|-------|-------------|
| **Cert stage drift** (who_wins claims merits outcome) | 37 | No — these are cert grants/denials, not merits decisions |
| **Quote too long** (>12 or >25 words) | 20 | Yes — relax quote length limits, re-run |
| **Below soft min** (opinion < 5000 chars, no anchors) | 14 | Maybe — shorter opinions, need manual review |
| **Too many quotes** (>3) | 9 | Yes — relax quote count limit, re-run |
| **Pass 1 consensus mismatch** (merits_reached or prevailing_party disagree) | 10 | Yes — improve Pass 1 prompt or use single-pass |
| **Procedural drift** (who_wins claims substantive winner) | 4 | Maybe — could be real merits decisions misclassified |
| **High confidence requires anchor quote** | 3 | Yes — relax requirement |
| **Too short** (< 1000 chars) | 4 | No — no opinion text available |
| **Cert denied/granted** | 3 | No — not merits decisions |
| **Unclear holding** | 2 | Maybe — manual review |
| **Other** (reargument order, etc.) | 2 | No |

**Summary:** ~42 clearly salvageable (quote/count limits), ~14 maybe, ~52 correctly excluded (cert/procedural/no text)

### Merits Not Public (8 cases)

| ID | Case Name | Prompt Version | Enriched? |
|----|-----------|---------------|-----------|
| 10 | Truck Insurance v. Kaiser Gypsum | v2-ado308 | Yes |
| 27 | Campos-Chaves v. Garland | null | No |
| 59 | McElrath v. Georgia | v2-ado300 | Yes |
| 60 | Great Lakes Ins. v. Raiders Retreat | v2-ado300 | Yes |
| 118 | City of San Francisco v. EPA | v2-ado300 | Yes |
| 217 | Esteras v. United States | v2-ado300 | Yes |
| 247 | Goldey v. Fields | v2-ado300 | Yes |
| 287 | Case v. Montana | v2-ado308 | Yes |

7 are enriched (just need `is_public=true`). 1 (id:27) needs enrichment first.

## Implementation Plan

### Phase 1: Quick Wins (no code changes)

**1a. Publish 7 enriched merits cases**
- UPDATE `scotus_cases` SET `is_public=true` WHERE id IN (10, 59, 60, 118, 217, 247, 287)
- Verify they appear on frontend
- +7 public cases (51→58)

**1b. Enrich case 27 (Campos-Chaves v. Garland)**
- Has opinion text, merits classification, but never enriched
- Run enrichment on this single case
- If passes: set `is_public=true`
- +1 public case (58→59)

### Phase 2: Relax Validation Thresholds (code change)

The current validators are too strict — flagging good cases for minor issues:

**2a. Quote length limits**
- Current: 12 words (short quote), 25 words (long quote), max 50 words
- Proposed: 25 words (short), 40 words (long), max 60 words
- Affects: ~20 cases

**2b. Quote count limit**
- Current: max 3 quotes
- Proposed: max 5 quotes (SCOTUS opinions are long, more quotes is better)
- Affects: ~9 cases

**2c. Anchor term requirement for high confidence**
- Current: requires anchor term in quote for high confidence
- Proposed: allow high confidence if opinion > 10K chars even without anchor in quote
- Affects: ~3 cases

**After relaxing:** Re-run enrichment on the ~32 affected cases. Expected: most will pass and auto-publish as merits.

### Phase 3: Pass 1 Consensus Fixes (code change)

10 cases have Pass 1 disagreements (two LLM calls disagree on merits_reached or prevailing_party):

**Options:**
- A) Lower consensus threshold (accept if 1/2 agree) — riskier
- B) Add tiebreaker third call — costs ~$0.003 more per case
- C) Manual review only — most conservative

**Recommendation:** Option B for `prevailing_party` mismatches (7 cases). Option C for `merits_reached` mismatches (5 cases — these genuinely might not be merits).

### Phase 4: Triage Remaining (~52 cases)

These are correctly excluded and need no action:
- 37 cert stage cases → confirm `case_type` should be set to `cert_stage` or `cert_denied`
- 4 too-short cases (no opinion text) → leave as-is
- 3 cert denied/granted → leave as-is
- 4 procedural drift → manual spot-check, likely correct
- 2 unclear holding → manual review
- 2 other → leave as-is

**Action:** Set `case_type` on these so they're properly categorized (not null). No enrichment needed.

### Phase 5: Sync to PROD

After TEST verified:
- Apply same DB updates to PROD
- Re-run enrichment on PROD for newly salvageable cases
- Verify public case count matches

## Expected Outcomes

| Phase | Public Cases Added | Code Changes | Cost |
|-------|-------------------|-------------|------|
| Phase 1 | +7-8 | None (DB only) | $0.003 (1 enrichment) |
| Phase 2 | +20-25 | Relax validators | ~$0.10 (32 enrichments) |
| Phase 3 | +5-7 | Tiebreaker logic | ~$0.03 (10 enrichments) |
| Phase 4 | 0 | Set case_type | $0 |
| Phase 5 | 0 (sync) | None | ~$0.10 |
| **Total** | **+32-40** | Modest | **~$0.25** |

Final expected public count: ~80-90 cases (up from 51)

## Session Sizing

- **Phase 1:** 15 minutes (DB updates, 1 enrichment) — same session
- **Phase 2-3:** 1 session (code changes + re-run + verify)
- **Phase 4-5:** 30 minutes (categorize + PROD sync) — end of Phase 2-3 session

**Total: 1-2 sessions**

## Acceptance Criteria (from ADO-390)
- [ ] Investigate 108 unenriched cases — categorize as salvageable or not
- [ ] Fix 7 merits cases that should be public
- [ ] Re-run enrichment on any salvageable cases
- [ ] Document which cases are intentionally excluded and why
- [ ] Final public case count after cleanup
