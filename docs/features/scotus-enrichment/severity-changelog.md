# SCOTUS Severity Calibration Changelog

Tracks all changes to the severity pipeline. Consult before making severity changes.

## Architecture

The severity pipeline flows: **Pass 1 facts → clampAndLabel() → Pass 2 (GPT) → enforceEditorialConstraints() → severity bounds → label derivation → QA → DB write**

Key files:
- `scripts/enrichment/scotus-gpt-prompt.js` — System/user prompts, severity calibration rules
- `scripts/enrichment/scotus-fact-extraction.js` — clampAndLabel(), enforceEditorialConstraints(), severity bounds
- `scripts/scotus/enrich-scotus.js` — Orchestration, level↔label mapping, QA loops

## Change Log

### v8-ado429-severity-bounds (2026-03-07)

**Problem:** 5/10 gold cases wrong. Three systems fighting: prompt rules (ignored by model), label→level mapping (overrides model's level number), clamp system (only handles cert/procedural).

**Root cause:** ADO-302 made label source of truth (`LABEL_TO_LEVEL[label]→level`). GPT's `ruling_impact_level` number was thrown away. GPT picks labels by editorial tone, not severity math, causing mismatches (e.g., Lackey: model gave level 3 but label "Rubber-stamping Tyranny" → overridden to 4).

**Changes:**
1. **Reversed mapping**: Level is now source of truth. Label derived from level via `LEVEL_TO_LABEL[level]→label`.
2. **Added severity bounds** (`computeSeverityBounds()` in scotus-fact-extraction.js):
   - Rule 1: No dissent + people-win + not landmark → max 1
   - Rule 2: No dissent + not landmark → max 3
   - Rule 3: Non-landmark → max 4 (level 5 reserved for constitutional crises)
   - Rule 4: Landmark + no dissent → min 4
   - Rule 5: Landmark + dissent → min 3
   - Rule 6: Has dissent → min 2
3. **Landmark detection via content**: issue_area is non-deterministic across runs, so also checks holding text for constitutional amendment references (14th Amendment, First Amendment, Section 3, etc.)
4. **Fixed `explicitOverrule` regex**: Was matching any mention of "overrule" (including "decline to overrule"). Now requires "we overrule" / "is overruled" and excludes declining language.
5. **Fixed who_wins validation**: Removed "cannot" from losing language regex (too context-dependent — "cannot be convicted twice" is a win).
6. **Strengthened prompt**: Severity calibration rules emphasize level as source of truth, add landmark exceptions.
7. **Prompt constraints**: Replaced `buildLabelConstraintsBlock` with `buildSeverityConstraintsBlock` (tells GPT the allowed level range).

**Result: 10/10 gold cases pass** (up from 5/10).
**What to watch:** issue_area extraction instability (Pass 1 gives different values per run), variation pool misassignment (e.g., "grudging_credit" for non-people-win cases).

---

### v7-ado429-severity-ceiling (2026-03-06) — REVERTED

**Problem:** Attempted dynamic severity ceiling in user prompt.

**What worked:** Hard caps for people-win/procedural cases (Barrett, Kirtz, Soto capped correctly).
**What failed:**
- Soft guidance regressed TikTok (correct 4 → wrong 3)
- Clamp system (LABEL_TO_LEVEL) overrode ceiling on Lackey (model gave 3, label pushed to 4)
- Code reverted but DB still had v7 results (not cleaned up)

**Lesson:** Don't mix soft prompt guidance with hard post-hoc overrides. Pick one system to own severity.

---

### v6-ado429-scotusblog-grounding (2026-03-05)

**Added:** SCOTUSblog grounding agent. Fetches context from SCOTUSblog between Pass 1 and Pass 2.
**Severity impact:** 7/9 gold cases got grounding context. Helped factual accuracy but didn't fix severity calibration (still 5/10).

---

### ADO-302: Label as source of truth (original)

**Decision:** `ruling_label` determines `ruling_impact_level` via fixed mapping. Rationale: labels are editorial decisions that drive tone, so label should be primary.
**Problem discovered later:** GPT picks labels by editorial feel, not severity math. Label "Rubber-stamping Tyranny" sounds right for "state shields officials" but maps to level 4, which is too high for a fee-shifting case.

---

### ADO-300: Clamp system (original)

**Added:** `clampAndLabel()` for cert/procedural detection. Forces "Judicial Sidestepping" label.
**Scope:** Only handles cert_no_merits and procedural_no_merits. Does NOT cap severity for normal merits cases.

## Gold Set Reference

| Case | ID | Expected | Key Signal |
|------|----|----------|------------|
| Barrett | 286 | 0-1 | 9-0, people-win, narrow |
| Kirtz | 51 | 0-1 | 9-0, people-win, narrow |
| Soto | 192 | 0-1 | 9-0, people-win, narrow |
| Connelly | 4 | 2-3 | 9-0, IRS wins, technical |
| Royal Canin | 64 | 1-2 | 9-0, jurisdictional |
| Bufkin | 120 | 3-4 | 7-2, VA wins, dissent |
| Miller | 133 | 3-4 | 8-1, gov wins, dissent |
| TikTok | 68 | 4-5 | Per curiam, 1A, 170M users |
| Trump | 63 | 4-5 | 9-0 divided, 14A, landmark |
| Lackey | 109 | 2-3 | 7-2, fee-shifting, procedural-ish |
