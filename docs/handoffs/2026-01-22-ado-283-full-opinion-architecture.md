# Handoff: ADO-283 Full Opinion Architecture

**Date:** 2026-01-22
**Branch:** test
**Status:** Code complete, migration applied, ready for testing

---

## What Was Done

### ADO-283: Full Opinion Architecture Implementation

**Goal:** Switch from extracted syllabus to full opinion text for SCOTUS enrichment.

**Files Created:**
- `migrations/069_scotus_full_opinion.sql` - New `scotus_opinions` table with RLS
- `scripts/scotus/opinion-utils.js` - Shared utilities (sha256Hex, upsertOpinionIfChanged, buildCanonicalOpinionText)
- `scripts/scotus/backfill-opinions.js` - Script to migrate v1 cases to v2

**Files Modified:**
- `scripts/scotus/fetch-cases.js` - Stores canonical text in scotus_opinions, tracks source_data_version
- `scripts/enrichment/scotus-fact-extraction.js` - LEFT JOIN for opinions, token windowing, structural markers

**Code Review Fixes (feature-dev:code-reviewer):**
- Fixed critical type mismatch: `case_id UUID` → `case_id BIGINT` (commit `6cc37a0`)
- Added missing error handling in backfill-opinions.js (commit `65d45f4`)

**Migration Applied:** Yes - `scotus_opinions` table and `chk_source_data_version` constraint verified in TEST DB.

---

## What's Next

### Immediate (Next Session)

1. **Test full flow with CourtListener API:**
   ```bash
   COURTLISTENER_API_TOKEN=xxx node scripts/scotus/fetch-cases.js --limit=3
   ```

2. **Verify opinions stored:**
   ```sql
   SELECT sc.case_name, sc.source_data_version, so.char_count
   FROM scotus_cases sc
   LEFT JOIN scotus_opinions so ON so.case_id = sc.id
   ORDER BY sc.decided_at DESC LIMIT 5;
   ```

3. **Test enrichment with full opinions:**
   ```bash
   node scripts/scotus/enrich-scotus.js --limit=3
   ```

4. **Backfill existing cases (if fetch works):**
   ```bash
   COURTLISTENER_API_TOKEN=xxx node scripts/scotus/backfill-opinions.js --limit=50
   ```

### Required Secret
- `COURTLISTENER_API_TOKEN` - Not in .env, needs to be added or passed via CLI

---

## Commits

| SHA | Description |
|-----|-------------|
| `d974139` | feat(ado-283): implement full opinion architecture |
| `6cc37a0` | fix(ado-283): correct case_id type from UUID to BIGINT |
| `65d45f4` | fix(ado-283): add missing error handling in backfill-opinions.js |

---

## ADO Status

- **ADO-283:** Active - Implementation complete, testing pending
- **ADO-85 Plan:** Updated with ADO-283 status

---

## Key Architecture Decisions

1. **Separate table (`scotus_opinions`)** - Prevents accidental egress from SELECT * on scotus_cases
2. **Content hashing** - SHA-256 hash enables skip-if-unchanged during backfill/retry
3. **Token windowing** - First 40K + last 30K chars for opinions >100K chars
4. **Canonical text with section headers** - `=== MAJORITY OPINION ===`, `=== DISSENT ===` for GPT parsing
5. **Version tracking** - `source_data_version` column: 'v1-syllabus' or 'v2-full-opinion'

---

## Session Stats

- **Token usage:** ~100K input, ~18K output
- **Code review agents used:** `/code-review` skill + `feature-dev:code-reviewer`
