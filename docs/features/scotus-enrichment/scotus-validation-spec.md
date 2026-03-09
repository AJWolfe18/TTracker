# SCOTUS Enrichment Validation Spec

## What a "Full Check" Looks Like

Every enriched SCOTUS case must be verified against external ground truth (SCOTUSblog, official court records, Wikipedia case summary). This spec defines the per-field checks.

---

## Per-Case Scorecard Fields

### 1. Disposition (Hard)
- **Source of truth:** Official opinion (first page, last paragraph of syllabus)
- **Check:** Does `disposition` match the actual ruling? (affirmed, reversed, vacated, dismissed, etc.)
- **Common pitfall:** Confusing "reversed and remanded" with just "reversed"

### 2. Who Wins / Who Loses (Hard)
- **Source of truth:** Syllabus + SCOTUSblog analysis
- **Check:** Does `who_wins` correctly identify the benefiting party? Does `who_loses` correctly identify the harmed party?
- **Common pitfall:** Flipping petitioner/respondent, or identifying the wrong entity

### 3. Majority Author (Hard)
- **Source of truth:** Official opinion header ("JUSTICE X delivered the opinion of the Court")
- **Check:** Does `majority_author` match? Per curiam cases should have `null`.
- **Common pitfall:** Confusing concurrence authors with opinion author

### 4. Dissent Authors (Hard)
- **Source of truth:** Official opinion + SCOTUSblog
- **Check:** Does `dissent_authors` list ALL justices who dissented (in whole or in part)?
- **Common pitfall:** Missing partial dissenters, including concurrence-only justices

### 5. Vote Split (Hard)
- **Source of truth:** SCOTUSblog, official opinion
- **Check:** Does `vote_split` match the actual vote? (e.g., "5-4", "9-0", "7-2")
- **Common pitfall:** Miscounting when there are concurrences in judgment

### 6. Severity Level (Soft — judgment call)
- **Source of truth:** SCOTUSblog impact analysis + editorial judgment
- **Check:** Is `ruling_impact_level` reasonable given the case's actual significance?
- **Scoring:** Within 1 level of reasonable = PASS, off by 2+ = FLAG

### 7. Case Type (Hard)
- **Source of truth:** Official opinion type
- **Check:** Does `case_type` match? (merits, cert_stage, procedural, unclear)

### 8. Summary Factual Accuracy (Hard)
- **Source of truth:** Official opinion text
- **Check:** Does `summary_spicy` contain any factual errors?
  - Wrong statutes cited
  - Wrong parties described
  - Wrong outcome stated
  - Made-up facts not in the record
  - Claims of unanimity when there were dissenters (or vice versa)

### 9. Evidence Anchors (Soft)
- **Source of truth:** Official opinion text
- **Check:** Are `evidence_anchors` actual quotes/paraphrases from the opinion?
- **Common pitfall:** Hallucinated quotes, quotes from wrong section

### 10. Dissent Highlights (Soft — when applicable)
- **Source of truth:** Dissent text + SCOTUSblog
- **Check:** Does `dissent_highlights` accurately represent the dissent's key argument?
- **Only applicable** when dissenters exist

### 11. Tone Appropriateness (Soft)
- **Check:** Is the editorial tone consistent with TrumpyTracker's voice?
  - Should be critical/accountability-focused, not neutral wire-service
  - Should not contain hallucinated emotional claims
  - Should not claim unanimity falsely or misrepresent the vote

---

## Severity Ratings

| Grade | Meaning |
|-------|---------|
| PASS | Field is factually correct |
| FLAG | Soft field is questionable but not factually wrong |
| FAIL | Field contains a factual error |
| N/A | Field not applicable (e.g., dissent_highlights on unanimous case) |

## Blocking Rules

- Any FAIL on a Hard field = case is BLOCKED
- 3+ FLAGs on Soft fields = case is BLOCKED
- FAIL on summary factual = always BLOCKED (highest severity)
