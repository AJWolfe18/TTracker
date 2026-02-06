# Gold Set Curation Tracker

**ADO:** 325
**Status:** In Progress
**Created:** 2026-02-02
**Goal:** 15-20 human-approved examples for Layer B calibration

---

## Evaluation Criteria

Each case is evaluated on 7 dimensions. Score 1-3 (1=Bad, 2=Needs Work, 3=Good).

| Criterion | What We're Checking | 1 (Bad) | 2 (Needs Work) | 3 (Good) |
|-----------|---------------------|---------|----------------|----------|
| **Accuracy** | Summary matches actual holding | Contradicts holding | Minor inaccuracy | Faithful to holding |
| **Scope** | Claims appropriate impact | Wildly overstates | Slightly broad | Proportional to ruling |
| **Tone** | Matches impact level | Wrong register entirely | Slightly off | Appropriate for level |
| **Facts** | All claims grounded in source | Hallucinated facts | Unsupported claims | All verifiable |
| **Label** | ruling_label fits the case | Wrong category | Borderline fit | Clear fit |
| **Level** | ruling_impact_level (1-5) appropriate | Off by 2+ | Off by 1 | Correct |
| **Procedural** | If no merits, avoids merits claims | Claims merits outcome | Implies merits | Stays procedural |

### Tone Expectations by Level

| Level | Label | Expected Tone |
|-------|-------|---------------|
| 0-1 | Crumbs from the Bench | Positive, measured, "small win" framing |
| 2 | Judicial Sidestepping | Neutral, procedural, no merits claims |
| 3 | Institutional Sabotage | Measured concern, factual, no hyperbole |
| 4 | Rubber-stamping Tyranny | Justified alarm, specific harms cited |
| 5 | Constitutional Crisis | Urgent but grounded, systemic implications |

### Automatic Disqualifiers

- [ ] Hallucinated dissent (claims dissenters that don't exist)
- [ ] Made-up statistics ("millions affected" without source)
- [ ] Wrong outcome stated (says reversed when affirmed)
- [ ] Procedural case treated as merits win/loss

---

## Gold Set Categories Needed

| Category | Target | Purpose | Candidates |
|----------|--------|---------|------------|
| Procedural dismissals | 2-3 | Level 2, no merits claims | 11, 174, 203 |
| People-side wins | 2-3 | Level 0-1, positive framing | 50, 51, 227, 285, 9, 113, 192 |
| Narrow defendant wins | 3-4 | Level 3, measured tone | 4, 23, 64, 65, 120, 126, 133, 173, 175, 191, 212, 237 |
| Broad rights restrictions | 3-4 | Level 4-5, justified alarm | 27, 63, 68, 108, 109, 131, 214, 215, 238, 280 |
| Bad: Hallucination | 2 | Show what to reject | TBD |
| Bad: Scope overreach | 2 | Show what to reject | TBD |

---

## Review Log

### Legend
- **Verdict:** GOLD (approved), FIX (needs edits), SKIP (not suitable), BAD-EXAMPLE (use as negative example)
- **Scores:** Format is Accuracy/Scope/Tone/Facts/Label/Level/Procedural (each 1-3)

---

### Level 2: Procedural Dismissals (merits_reached=false)

| ID | Case Name | Scores | Verdict | Notes |
|----|-----------|--------|---------|-------|
| 11 | FDA v. Alliance for Hippocratic Medicine | | | |
| 174 | Laboratory Corp. v. Davis | | | |
| 203 | NRC v. Texas | | | |

---

### Level 1: People-Side Wins

| ID | Case Name | Scores | Verdict | Notes |
|----|-----------|--------|---------|-------|
| 9 | Becerra v. San Carlos Apache Tribe | | | |
| 50 | Murray v. UBS Securities, LLC | | | |
| 51 | Dept. of Agriculture v. Kirtz | | | |
| 113 | Waetzig v. Halliburton | | | |
| 192 | Soto v. United States | | | |
| 227 | Gutierrez v. Saenz | | | |
| 285 | Bowe v. United States | | | |

---

### Level 3: Narrow Defendant Wins

| ID | Case Name | Scores | Verdict | Notes |
|----|-----------|--------|---------|-------|
| 4 | Connelly v. United States | | | |
| 23 | Vidal v. Elster | | | |
| 64 | Royal Canin v. Wullschleger | | | |
| 65 | E.M.D. Sales v. Carrera | | | |
| 120 | Bufkin v. Collins | | | |
| 126 | Thompson v. United States | | | |
| 133 | United States v. Miller | | | |
| 173 | BLOM Bank v. Honickman | | | |
| 175 | Catholic Charities Bureau v. Wisconsin | | | |
| 191 | Commissioner v. Zuch | | | |
| 212 | Stanley v. City of Sanford | | | |
| 237 | Mahmoud v. Taylor | | | |

---

### Level 4-5: Broad Rights Restrictions

| ID | Case Name | Scores | Verdict | Notes |
|----|-----------|--------|---------|-------|
| 27 | Campos-Chaves v. Garland | | | |
| 63 | Trump v. Anderson | | | |
| 68 | TikTok Inc. v. Garland | | | |
| 108 | Glossip v. Oklahoma | | | |
| 109 | Lackey v. Stinnie (Level 5) | | | |
| 131 | Bondi v. Vanderstok | | | |
| 214 | FDA v. R.J. Reynolds | | | |
| 215 | Diamond Alternative Energy v. EPA | | | |
| 238 | Free Speech Coalition v. Paxton | | | |
| 280 | Abbott v. LULAC | | | |

---

### Bad Examples (for negative training)

| ID | Case Name | Issue Type | Why It's Bad |
|----|-----------|------------|--------------|
| | | hallucination | |
| | | hallucination | |
| | | scope_overreach | |
| | | scope_overreach | |

---

## Session Notes

### 2026-02-02 - Initial Review Session

Starting with Level 2 (procedural) cases since there are only 3 and they have clear criteria (must NOT make merits claims).

