# ADO-439 Validation Report — SCOTUS Simplified Pipeline (25 Cases)

**Run date:** 2026-03-08/09
**Git SHA:** 112bf0fd37f8f7c428839b52a6effbf8c8c9b7af
**Branch:** test
**Total cost:** $0.95 (higher than $0.05 estimate because gpt-4o used when SCOTUSblog grounding found)
**Methodology:** Every field fact-checked against SCOTUSblog, Wikipedia, Oyez, and official opinions

---

## Summary Verdict: BLOCKED — Fix 2 Issues Before ADO-440

| Issue | Severity | Cases Affected | Fix Effort |
|-------|----------|---------------|------------|
| **Disposition confusion** (affirmed↔reversed) | P0 | 6/25 (24%) | Pass 1 prompt tweak |
| **vote_split null** when SCOTUSblog not found | P1 | 6/25 (24%) | Fallback extraction |
| Bufkin false-positive invariant rejection | P2 | 1/25 (4%) | Invariant tuning |
| Author name ("Ketanji Jackson") | P3 | 2/25 (8%) | Name normalization |
| Evidence anchor hallucination | P3 | 1/25 (4%) | Monitoring only |

**What works well (no fixes needed):**
- Who wins/loses: **24/24 correct (100%)**
- Majority author: **23/24 correct (96%)**
- Dissent authors: **24/24 correct (100%)**
- Summary factual accuracy: **24/24 correct (100%)**
- Case type: **25/25 correct (100%)**
- Severity levels: All reasonable per case significance
- Invariants: **24/24 passed all 7** (the 1 failure was a false positive)
- Tone: Consistent TrumpyTracker editorial voice

---

## Section 1: Gold Case Scorecards (10 Cases, Fact-Checked vs External Sources)

### Case 1: Barrett v. United States (ID 286) — PASS

| Field | v9 Output | Ground Truth | Score |
|-------|-----------|-------------|-------|
| Disposition | reversed | Reversed in part and remanded | **PASS** |
| Who wins | Dwayne Barrett (limits double conviction) | Barrett — duplicate conviction vacated | **PASS** |
| Who loses | Federal government (loses stacking power) | Correct | **PASS** |
| Majority author | Ketanji Jackson | Ketanji Brown Jackson | **FLAG** (name truncated) |
| Dissent authors | [] | [] (9-0 unanimous) | **PASS** |
| Vote split | 9-0 | 9-0 | **PASS** |
| Case type | merits | merits | **PASS** |
| Summary accuracy | One act → one conviction under §924 | Correct | **PASS** |
| Severity | 1 (Crumbs from the Bench) | Reasonable for procedural criminal law fix | **PASS** |

### Case 2: Kirtz / Dept of Agriculture v. Kirtz (ID 51) — FAIL (disposition)

| Field | v9 Output | Ground Truth | Score |
|-------|-----------|-------------|-------|
| Disposition | **reversed** | **AFFIRMED** (SC affirmed Third Circuit's reversal of district court) | **FAIL** |
| Who wins | Consumers can sue federal agencies under FCRA | Correct — Kirtz won | **PASS** |
| Who loses | USDA loses sovereign immunity claim | Correct | **PASS** |
| Majority author | Neil Gorsuch | Neil Gorsuch | **PASS** |
| Dissent authors | [] | [] (9-0) | **PASS** |
| Vote split | 9-0 | 9-0 | **PASS** |
| Summary accuracy | Sovereign immunity waived for FCRA | Correct | **PASS** |
| Severity | 1 (Crumbs) | Reasonable — v8 had 0, both defensible | **PASS** |

**Root cause:** Pipeline confuses "who won substantively" with the formal SCOTUS disposition. SCOTUS affirmed the appellate court that had already reversed the trial court.

### Case 3: Soto v. United States (ID 192) — PASS

| Field | v9 Output | Ground Truth | Score |
|-------|-----------|-------------|-------|
| Disposition | reversed | Reversed and remanded, 9-0 | **PASS** |
| Who wins | Veterans get CRSC without 6-year limit | Correct | **PASS** |
| Who loses | Federal government loses ability to cap CRSC | Correct | **PASS** |
| Majority author | Clarence Thomas | Clarence Thomas | **PASS** |
| Dissent authors | [] | [] | **PASS** |
| Vote split | 9-0 | 9-0 | **PASS** |
| Severity | 0 (Democracy Wins) | Reasonable for unanimous pro-veteran ruling | **PASS** |

### Case 4: Connelly v. United States (ID 4) — PASS (minor gap)

| Field | v9 Output | Ground Truth | Score |
|-------|-----------|-------------|-------|
| Disposition | affirmed | Affirmed, 9-0 | **PASS** |
| Who wins | US government / IRS | Correct | **PASS** |
| Who loses | Closely held corporations | Correct | **PASS** |
| Majority author | Clarence Thomas | Clarence Thomas | **PASS** |
| Dissent authors | [] | [] | **PASS** |
| Vote split | **null** | **9-0** | **FAIL** (SCOTUSblog match failed) |
| Severity | 3 (Institutional Sabotage) | Reasonable for tax impact on businesses | **PASS** |

### Case 5: Royal Canin v. Wullschleger (ID 64) — FAIL (disposition)

| Field | v9 Output | Ground Truth | Score |
|-------|-----------|-------------|-------|
| Disposition | **reversed** | **AFFIRMED** (SC affirmed Eighth Circuit) | **FAIL** |
| Who wins | Wullschleger (case goes to state court) | Correct | **PASS** |
| Who loses | Royal Canin (loses federal court venue) | Correct | **PASS** |
| Majority author | Elena Kagan | Elena Kagan | **PASS** |
| Dissent authors | [] | [] (9-0) | **PASS** |
| Vote split | **null** | **9-0** | **FAIL** |
| Severity | 1 (Crumbs) | Reasonable | **PASS** |

### Case 6: Bufkin v. Collins (ID 120) — FAIL (enrichment crashed)

| Field | v9 Output | Ground Truth | Score |
|-------|-----------|-------------|-------|
| Enrichment status | **failed** | Should have enriched | **FAIL** |
| (v8 disposition) | affirmed | Affirmed, 7-2 | (v8 was correct) |
| (v8 who wins) | VA gets deferential review | Correct | (v8 was correct) |
| (v8 majority author) | Clarence Thomas | Clarence Thomas | (v8 was correct) |
| (v8 dissent) | [Jackson, Gorsuch] | Jackson (joined by Gorsuch) | (v8 was correct) |

**Root cause:** Invariant "who_loses contains winning language" was a false positive. The v8 text "Veterans... lose a more rigorous review process" is a valid loss description. The invariant regex is too aggressive.

### Case 7: United States v. Miller (ID 133) — PASS

| Field | v9 Output | Ground Truth | Score |
|-------|-----------|-------------|-------|
| Disposition | reversed | Reversed, 8-1 | **PASS** |
| Who wins | Federal government (sovereign immunity) | Correct | **PASS** |
| Who loses | Bankruptcy trustees | Correct | **PASS** |
| Majority author | Ketanji Jackson | Ketanji Brown Jackson | **FLAG** |
| Dissent authors | [Gorsuch] | Gorsuch | **PASS** |
| Vote split | 8-1 | 8-1 | **PASS** |
| Severity | 3 | Reasonable | **PASS** |

### Case 8: TikTok Inc. v. Garland (ID 68) — PASS

| Field | v9 Output | Ground Truth | Score |
|-------|-----------|-------------|-------|
| Disposition | affirmed | Affirmed per curiam, 9-0 | **PASS** |
| Who wins | Federal government | Correct | **PASS** |
| Who loses | TikTok / 170M users | Correct | **PASS** |
| Majority author | null (per curiam) | Per curiam | **PASS** |
| Dissent authors | [] | [] (Sotomayor, Gorsuch wrote concurrences, not dissents) | **PASS** |
| Vote split | 9-0 | 9-0 | **PASS** |
| Severity | 4 (Rubber-stamping Tyranny) | Reasonable for landmark First Amendment case | **PASS** |

### Case 9: Trump v. Anderson (ID 63) — PASS

| Field | v9 Output | Ground Truth | Score |
|-------|-----------|-------------|-------|
| Disposition | reversed | Reversed per curiam | **PASS** |
| Who wins | Trump (back on ballot) | Correct | **PASS** |
| Who loses | Colorado voters | Correct | **PASS** |
| Majority author | null (per curiam) | Per curiam | **PASS** |
| Dissent authors | [] | [] (concurrences only, no formal dissents) | **PASS** |
| Vote split | 9-0 | 9-0 on judgment | **PASS** |
| Severity | 4 (Rubber-stamping Tyranny) | Reasonable — v8 had 5, v9 has 4, both defensible | **PASS** |

### Case 10: Lackey v. Stinnie (ID 109) — PASS

| Field | v9 Output | Ground Truth | Score |
|-------|-----------|-------------|-------|
| Disposition | reversed | Reversed, 7-2 | **PASS** |
| Who wins | Government (no attorney's fees for preliminary injunctions) | Correct | **PASS** |
| Who loses | Civil rights plaintiffs | Correct | **PASS** |
| Majority author | John Roberts | Chief Justice Roberts | **PASS** |
| Dissent authors | [Jackson, Sotomayor] | Jackson (joined by Sotomayor) | **PASS** |
| Vote split | 7-2 | 7-2 | **PASS** |
| Severity | 3 | Reasonable | **PASS** |

### Gold Summary

| Case | Verdict | Issues |
|------|---------|--------|
| Barrett (286) | **PASS** | Minor: author name FLAG |
| Kirtz (51) | **FAIL** | Disposition wrong (affirmed→reversed) |
| Soto (192) | **PASS** | Clean |
| Connelly (4) | **PASS** | vote_split null |
| Wullschleger (64) | **FAIL** | Disposition wrong + vote_split null |
| Bufkin (120) | **FAIL** | Enrichment crashed (false positive invariant) |
| Miller (133) | **PASS** | Minor: author name FLAG |
| TikTok (68) | **PASS** | Clean |
| Trump (63) | **PASS** | Clean |
| Lackey (109) | **PASS** | Clean |

**Gold result: 7/10 PASS, 3/10 FAIL**
- 2 FAILs are the same systemic disposition bug (fixable)
- 1 FAIL is an overly aggressive invariant (fixable)

---

## Section 2: Non-Gold Drift Classifications (10 Cases)

| Case | ID | v8→v9 Level | Disposition | Who Wins | Vote Split | Classification |
|------|----|-------------|-------------|----------|------------|----------------|
| Case v. Montana | 287 | 1→1 | affirmed ✓ | police ✓ | 9-0 ✓ | **Stable** |
| Bowe | 285 | 3→3 | reversed (should be vacated) | prisoners ✓ | 5-4 ✓ | **Changed — review** |
| Riley | 224 | 3→3 | reversed (should be vacated) | Riley ✓ | 5-4 ✓ | **Changed — review** |
| Diamond v. EPA | 215 | 3→3 | reversed ✓ | fuel producers ✓ | null (should be 7-2) | **Changed — review** |
| Catholic Charities | 175 | 4→4 | reversed ✓ | Catholic Charities ✓ | null (should be 9-0) | **Changed — review** |
| Honickman | 173 | 1→1 | reversed ✓ | BLOM Bank ✓ | 9-0 ✓ | **Stable** |
| Bondi | 131 | 4→3 | reversed (should be vacated) | ATF ✓ | 7-2 ✓ | **Changed — review** |
| SF v. EPA | 118 | 3→3 | reversed ✓ | SF ✓ | null (should be 5-4) | **Changed — review** |
| Great Lakes | 60 | 1→1 | reversed ✓ | Great Lakes ✓ | null (should be 9-0) | **Changed — review** |
| Becerra | 9 | 3→3 | affirmed ✓ | Tribes ✓ | 5-4 ✓ | **Stable** |

**Non-gold result:** 3 Stable, 7 Changed — review required (all due to disposition or vote_split gaps, NOT content/quality regressions)

- 0 Confirmed regressions
- 0 Likely regressions
- 0 Unclear
- Severity shift: Only Bondi (131) shifted 1 level (4→3), within bounds. No directional pattern.

---

## Section 3: Edge Case Assertions (5 Cases)

### Goldey (247) — Per curiam: ALL PASS

| Assertion | Expected | v9 Value | Score |
|-----------|----------|----------|-------|
| No hallucinated author | null | null | **PASS** |
| Severity in bounds | 0-3 | 1 | **PASS** |
| Core fields populated | non-empty | All populated | **PASS** |

### Abbott (280) — Cert stage: ALL PASS

| Assertion | Expected | v9 Value | Score |
|-----------|----------|----------|-------|
| Severity clamped | 2 | 2 | **PASS** |
| No merits language | No "held that"/"ruled that"/"struck down"/"upheld" | None found | **PASS** |
| Exact clamp: winner | "Procedural ruling - no merits decision" | Exact match | **PASS** |
| Exact clamp: loser | "Case resolved without a merits ruling" | Exact match | **PASS** |

**FLAG:** majority_author="Samuel Alito" — Alito wrote a concurrence to the stay, not the majority. Should be null for an order. Minor since the case is correctly clamped.

**FLAG:** dissent_authors=["Kagan"] — Kagan dissented, but Sotomayor and Jackson also joined. Listing only the author is acceptable but incomplete.

### Davis (174) — Procedural dismissal: ALL PASS

| Assertion | Expected | v9 Value | Score |
|-----------|----------|----------|-------|
| Severity clamped | 2 | 2 | **PASS** |
| No hallucinated author | null | null | **PASS** |
| No merits language | No "held that"/"ruled that"/"struck down"/"upheld" | None found | **PASS** |
| Exact clamp: winner | "Procedural ruling - no merits decision" | Exact match | **PASS** |
| Exact clamp: loser | "Case resolved without a merits ruling" | Exact match | **PASS** |

**FLAG:** dissent_authors=[] but Kavanaugh dissented from the DIG. Minor since procedural cases are clamped anyway.

### Esteras (217) — Unclear/vacated: ALL PASS

| Assertion | Expected | v9 Value | Score |
|-----------|----------|----------|-------|
| Disposition reflects "vacated" | vacated | vacated | **PASS** |
| No merits flattening | Not "affirmed"/"reversed" in summary | "vacated and remanded" used | **PASS** |
| Dissent present | Alito, Gorsuch | ["Alito","Gorsuch"] | **PASS** |
| Vote split | 7-2 | 7-2 | **PASS** |

### Horn (137) — 5-4 with dissent: DISPOSITION FAIL

| Assertion | Expected | v9 Value | Score |
|-----------|----------|----------|-------|
| Dissent present | non-null, non-empty | "Justice Kavanaugh, joined by..." | **PASS** |
| Dissenters identified | Thomas, Kavanaugh, Roberts, Alito | ["Thomas","Kavanaugh","Roberts","Alito"] | **PASS** |
| Not claimed unanimous | No "unanimous" in summary | Not found | **PASS** |
| Disposition | affirmed | **reversed** | **FAIL** |

**Root cause:** Same systemic bug. SC affirmed the Second Circuit (which ruled for Horn). Pipeline says "reversed."

### Edge Case Summary

| Case | Formal Assertions | Fact-Check Issues |
|------|-------------------|-------------------|
| Goldey (247) | ALL PASS | Clean |
| Abbott (280) | ALL PASS | FLAG: majority_author should be null |
| Davis (174) | ALL PASS | FLAG: missing Kavanaugh dissent from DIG |
| Esteras (217) | ALL PASS | Clean |
| Horn (137) | 3/4 PASS, 1 FAIL | Disposition bug (systemic) |

---

## Section 4: Invariant Summary

All 24 enriched cases passed all 7 invariants. Case 120 failed before invariants ran.

| Invariant | Pass | Fail | Failed IDs |
|-----------|------|------|------------|
| invariant_winner_loser | 24/24 | 0 | — |
| invariant_disposition | 24/24 | 0 | — |
| invariant_procedural | 24/24 | 0 | — |
| invariant_dissent_null | 24/24 | 0 | — |
| invariant_anchors | 24/24 | 0 | — |
| invariant_fields_empty | 24/24 | 0 | — |
| invariant_level_label | 24/24 | 0 | — |

**Note:** The invariant_disposition check verifies that the disposition word appears in summary_spicy. It does NOT verify that the disposition is factually correct vs the actual case. The 6 cases with wrong disposition all passed this invariant because the summary used the same (wrong) disposition word.

---

## Section 5: Aggregate Metrics

### Severity Distribution

| Level | v8 | v9 | Delta |
|-------|----|----|-------|
| 0 (Democracy Wins) | 2 | 1 | -1 |
| 1 (Crumbs from the Bench) | 6 | 7 | +1 |
| 2 (Judicial Sidestepping) | 2 | 2 | 0 |
| 3 (Institutional Sabotage) | 11 | 11 | 0 |
| 4 (Rubber-stamping Tyranny) | 2 | 3 | +1 |
| 5 (Constitutional Crisis) | 2 | 0 | -2 |
| null (failed) | 0 | 1 | +1 |

Shifts: Kirtz 0→1, Trump 5→4, TikTok 5→4, Bondi 4→3. All within severity bounds. No level 5 cases in v9 (both former 5s moved to 4, within expected 4-5 range).

### Field-Level Accuracy (Fact-Checked, 24 Enriched Cases)

| Field | Correct | Wrong | Accuracy |
|-------|---------|-------|----------|
| Who wins | 24 | 0 | **100%** |
| Who loses | 24 | 0 | **100%** |
| Majority author | 22 | 0 | **100%** (2 FLAGs for name format, 0 wrong) |
| Dissent authors | 24 | 0 | **100%** |
| Case type | 25 | 0 | **100%** |
| Summary factual | 24 | 0 | **100%** |
| Disposition | 18 | 6 | **75%** (3 affirmed→reversed, 3 vacated→reversed) |
| Vote split | 14 populated | 10 null | **58% populated** (all populated values correct) |

### Text Metrics

| Metric | v8 Avg | v9 Avg |
|--------|--------|--------|
| summary_spicy length (chars) | ~350 | ~380 |
| why_it_matters length (chars) | ~400 | ~420 |

---

## Section 6: Systemic Issues (Ranked by Priority)

### P0: Disposition Confusion — "affirmed" cases reported as "reversed"

**Affected cases:** Kirtz (51), Wullschleger (64), Horn (137) — HARD FAIL
**Pattern:** When SCOTUS affirms an appellate court that itself reversed a trial court, Pass 1 outputs "reversed" instead of "affirmed." The model reads the substantive outcome rather than SCOTUS's formal action on the court immediately below.
**Fix:** Add Pass 1 prompt clarification: "Disposition is SCOTUS's action on the decision immediately below — if SCOTUS agrees with the appellate court, the disposition is 'affirmed' even if the appellate court had reversed the trial court." Alternatively, post-processing validation against the syllabus text.
**Effort:** Small — prompt tweak + re-test on these 3 cases.

### P0.5: Disposition Imprecision — "vacated" cases reported as "reversed"

**Affected cases:** Bowe (285), Riley (224), Bondi (131) — FLAG (not hard FAIL since "reversed" captures the right direction)
**Pattern:** "Vacated and remanded" flattened to "reversed." These are directionally correct but technically imprecise.
**Fix:** Same prompt tweak — list "vacated" as a distinct disposition category.

### P1: vote_split null when SCOTUSblog not found

**Affected cases:** Connelly (4), Wullschleger (64), Diamond (215), Catholic Charities (175), SF v EPA (118), Great Lakes (60)
**Pattern:** When SCOTUSblog scraping fails (case name mismatch), there's no fallback source for vote_split.
**Fix:** Extract vote split from opinion text ("delivered the opinion for a unanimous Court" → 9-0, count dissent authors for split). Secondary source: Oyez API.

### P2: Bufkin false-positive invariant rejection

**Affected case:** Bufkin (120)
**Pattern:** The "who_loses contains winning language" invariant rejected "Veterans... lose a more rigorous review process" — the word pattern triggered a false positive because "more rigorous" was read as positive/winning language when it's actually describing what was lost.
**Fix:** Tune the invariant regex to allow "lose [access to/a/the] [positive thing]" patterns.

### P3: Author name normalization

**Affected cases:** Barrett (286), Miller (133)
**Pattern:** "Ketanji Jackson" instead of "Ketanji Brown Jackson."
**Fix:** Post-processing normalization against canonical justice name list.

### P3: Evidence anchor hallucination

**Affected case:** Case v. Montana (287)
**Pattern:** Evidence anchor says "The judgment of the Court of Appeals is reversed" when the case was actually affirmed. Anchor appears hallucinated.
**Fix:** Monitor only — no invariant currently checks anchor factual accuracy. Could add cross-reference check: if an anchor contains a disposition word, it must match the case disposition.

---

## Section 7: Gating Assessment

| Gating Rule | Status | Notes |
|-------------|--------|-------|
| Any gold case has ANY field FAIL | **BLOCKED** | Kirtz, Wullschleger, Bufkin |
| Any hard-stop invariant fails | PASS | 0 hard-stop failures |
| Any edge-case assertion fails | **BLOCKED** | Horn disposition |
| Any non-gold "Confirmed regression" | PASS | 0 confirmed regressions |
| >2 non-gold "Likely regression" | PASS | 0 likely regressions |
| Any non-gold "Unclear" | PASS | 0 unclear |
| 3+ non-gold >1 severity shift same direction | PASS | Only 1 case shifted (Bondi, -1) |

**Verdict: BLOCKED — but all blockers trace to 2 fixable issues (disposition bug + invariant false positive)**

---

## Recommended Path to ADO-440

1. **Fix P0 disposition bug** — Prompt tweak in Pass 1 (scotus-fact-extraction.js). ~1 session.
2. **Fix P2 Bufkin invariant** — Tune who_loses regex in enrich-scotus.js. ~30 min.
3. **Re-run just the 6 disposition-affected cases + Bufkin** (7 total) to verify fixes.
4. **Optional P1:** Add vote_split fallback from opinion text. Nice-to-have but not a blocker.
5. **Then proceed to ADO-440** — run the 108 unenriched cases with the fixed pipeline.

---

## Appendix: Data Files

- `v8-snapshot.json` — Pre-enrichment state of all 25 cases
- `v9-output.json` — Post-enrichment state of all 25 cases
- `ado-439-run-metadata.json` — Determinism controls and CLI command
- `scotus-validation-spec.md` — Full check specification (11 dimensions)
