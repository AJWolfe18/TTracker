# SCOTUS Reconciliation Rules (ADO-446)

Reference doc for the reconciliation step that cross-checks GPT Pass 1 output
against SCOTUSblog grounding data. Lives in `scripts/scotus/enrich-scotus.js`
as `reconcileWithScotusblog()`.

**When**: Runs between SCOTUSblog fetch and Pass 2 editorial framing.
**Why**: GPT-4o-mini misses dissenters, misclassifies V&R merits cases, and
the scraper previously accepted wrong-docket data silently.

---

## Source Precedence

| Field | Winner | Rationale |
|-------|--------|-----------|
| `vote_split` | SCOTUSblog > DB > GPT | Structured table data from external source |
| `dissent_authors` | DB backfill > GPT | DB parses full opinion text; GPT uses windowed text |
| `case_type` | SCOTUSblog-guided override (bounded) | Only `unclear -> merits` under strict conditions |
| `disposition` | SCOTUSblog > GPT (when unambiguous) | SCOTUSblog curated by legal experts; GPT confuses lower court action with SCOTUS action |
| `majority_author` | Out of scope | Not a pilot bug |

---

## Mutable Fields

Reconciliation may auto-correct these fields:
- `vote_split` — SCOTUSblog preferred
- `dissent_authors` (+ `dissent_exists`) — DB backfill preferred
- `case_type` (only `unclear -> merits`, never any other transition)
- `disposition` — SCOTUSblog preferred when unambiguous signal (affirmed/reversed/vacated)

Reconciliation must NEVER auto-correct:
- `holding`, `who_wins` / `who_loses`
- `summary_spicy` / `why_it_matters`
- `majority_author` reasoning text
- `ruling_impact_level`

---

## Auto-Correct Conditions

### Vote Split
- If SCOTUSblog and GPT both present and disagree → prefer SCOTUSblog
- If only SCOTUSblog has data → use it
- If only GPT has data → keep it (no cross-check possible)

### Dissent Authors
ALL conditions must be met for auto-correct:
1. Vote split verified by SCOTUSblog (not GPT-only)
2. SCOTUSblog vote shows minority count > 0 (e.g., "6-3")
3. GPT `dissent_authors` is empty (`[]`)
4. DB `scotus_cases.dissent_authors` has non-empty array (from backfill)

If conditions 1-3 met but DB also empty → FLAG (`needs_manual_review = true`)

### Case Type
ALL conditions must be met for `unclear -> merits`:
1. `case_type = 'unclear'` (never override 'merits' or 'procedural')
2. `disposition` contains 'vacated' or 'remanded'
3. Disposition does NOT contain 'dismissed' or 'moot'
4. SCOTUSblog text has 2+ merits signals from: ["held", "ruled", "struck down", "upheld", "invalidated", "overruled"]

If < 2 signals → FLAG, do not auto-correct.

### Disposition
Auto-corrected when SCOTUSblog holding has an unambiguous disposition signal
(affirmed/reversed/vacated/remanded/dismissed) and GPT disagrees.
Vacate+remand are treated as compatible (no correction needed).
Maps SCOTUSblog signal to canonical form: affirm→"affirmed", reverse→"reversed", etc.

---

## Reconciliation Outcomes

Stored as `reconciliation_corrections` JSONB array on `scotus_cases`.
Each entry: `{ field, outcome, reason, old?, new? }`.
A single case can have multiple outcomes (e.g., auto-corrected dissent + flagged disposition).

| Outcome | Meaning |
|---------|---------|
| `no_change` | Consistent, nothing to do |
| `no_scotusblog` | No SCOTUSblog data, can't cross-check |
| `auto_corrected_vote_split` | vote_split updated from SCOTUSblog |
| `auto_corrected_dissent` | dissent_authors filled from DB backfill |
| `auto_corrected_case_type` | case_type overridden unclear -> merits |
| `flagged_dissent` | Split vote but no source has dissenter names |
| `flagged_case_type` | Possible merits but insufficient signals |
| `auto_corrected_disposition` | disposition updated from SCOTUSblog holding |
| `rejected_docket_mismatch` | SCOTUSblog data rejected (wrong docket) |

---

## Post-Reconciliation

If `dissent_authors` or `case_type` changed, `computeSeverityBounds()` is re-run
to update severity caps (exported from `scotus-fact-extraction.js`).

Any `flagged_*` outcome sets `needs_manual_review = true` on the case.

---

## Files

| File | What |
|------|------|
| `scripts/scotus/enrich-scotus.js` | `reconcileWithScotusblog()` function + call site (~line 733-876, 1098-1140) |
| `scripts/scotus/scotusblog-scraper.js` | Docket mismatch rejection (~line 358-364) |
| `scripts/enrichment/scotus-gpt-prompt.js` | Name-matching regex fix (~line 655) |
| `scripts/enrichment/scotus-fact-extraction.js` | `computeSeverityBounds` export, `reconciliation_corrections` in DB_COLUMNS |
| `migrations/086_scotus_reconciliation_corrections.sql` | JSONB column on scotus_cases |

---

## Known Bug Patterns (from pilot batch, Mar 9)

1. **Missing dissenters**: GPT-4o-mini misses dissent_authors on 6-3/5-4 cases when opinion text is windowed (30K first + 25K last). DB backfill parses full text and is more reliable.
2. **Procedural misclassification**: "Vacated and remanded" auto-classified as procedural even on merits rulings (e.g., Ames v. Ohio). Need compound merits signals to override.
3. **Docket mismatch accepted**: SCOTUSblog scraper logged mismatch but kept wrong data (FCC case got wrong vote split). Now rejects when docket doesn't match or is null.
4. **Name-matching false positive**: Regex captured first name ("Ketanji") instead of last name ("Jackson") after "Justice". Now captures all words and extracts last.
