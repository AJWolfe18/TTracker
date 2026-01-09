# TTRC-302: Topic Slug Extraction - Plan Ready for Implementation

**Date:** 2025-12-14
**Status:** Plan Complete, Ready for Execution
**Plan File:** `C:\Users\Josh\.claude\plans\inherited-wobbling-mountain.md`

---

## Quick Summary

TTRC-302 (topic slug extraction) is ready to implement. Expert review identified 2 bugs that must be fixed before backfill.

## Two Fixes Required Before Backfill

### Fix 1: Backfill Content Consistency
**File:** `scripts/backfill-topic-slugs.mjs`
- Line 44: Change `.select('id, title, excerpt')` → `.select('id, title, content, excerpt')`
- Line 78: Change `''` → `article.content || ''`

### Fix 2: Slug Canonicalization (Drift Mitigation)
**File:** `scripts/rss/topic-extraction.js`
- Add Porter stemming to reduce variants like `CONFIRMATION` vs `CONFIRMED`
- See plan file for full code

## Execution Sequence

1. Move JIRA TTRC-302 → In Progress
2. Apply Fix 1 (backfill content field)
3. Apply Fix 2 (slug canonicalization)
4. Clear existing slugs: `UPDATE articles SET topic_slug = NULL WHERE topic_slug IS NOT NULL`
5. Run backfill: `node scripts/backfill-topic-slugs.mjs`
6. Run recluster: `node scripts/recluster-all.mjs --full`
7. Validate with SQL checks
8. Update JIRA → Done, create handoff

## Cost

- Backfill: ~$0.60 (1,188 articles)
- Egress: ~5-7MB

## Next Session Start

1. Read full plan: `C:\Users\Josh\.claude\plans\inherited-wobbling-mountain.md`
2. Move JIRA to In Progress
3. Begin implementation

---

**Full plan location:** `C:\Users\Josh\.claude\plans\inherited-wobbling-mountain.md`
