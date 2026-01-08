# Handoff: TTRC-333 Title Token Margin Bypass

**Date:** 2025-12-27
**Ticket:** TTRC-333
**Branch:** test
**Commit:** 6cf2fb7

---

## What Was Done

Added `title_token` as a valid corroboration signal for Tier B margin bypass. Previously only `slug` and `entity>=2` could bypass the margin gate - now `titleTokenOverlap>=1` can too.

### Changes
- `scripts/rss/hybrid-clustering.js` - 3 edits:
  - Line 709-711: Added title_token to wouldBypassVia
  - Lines 729-731: Added title_token bypass block
  - Line 933-934: Updated shadow policy threshold 0.90 → 0.88

### Key Decisions
- Threshold: 0.88 (same as slug/entity)
- Token overlap: >=1 (meaningful tokens only - 5+ chars, stopwords filtered)
- Feature flag: Uses existing `ENABLE_TIERB_MARGIN_BYPASS`

---

## Validation Results

### RSS Run (25 articles)
- 17 new stories created
- 1 attached via Tier A (Zelensky/Trump - correct)
- 0 Tier B overrides (no candidates within 48h window)

### Would-Have-Merged Analysis
Checked 3 NEAR_MISS cases blocked by time:

| Case | Embed | Time | Verdict |
|------|-------|------|---------|
| Epstein files / Trump taunt → Epstein doc release | 0.893 | 61h | Correct |
| Trump pricing → Economy poll | 0.881 | 379h | Questionable |
| GOP midterm trouncing → GOP midterm slump | 0.891 | 921h | Correct |

**Result:** 2/3 correct. Time gate (48h) appropriately blocked questionable case.

---

## Current State

- Feature flag: `ENABLE_TIERB_MARGIN_BYPASS=true` in TEST workflow
- Code: Working correctly, pushed to test
- AI Code Review: Passed (optional suggestions skipped)
- JIRA: Updated with implementation + validation comments

---

## Next Steps

1. Monitor next few RSS runs for actual Tier B title_token merges
2. Spot-check any merges that use `tierb_margin_bypass: 'title_token'`
3. When confident, deploy to production via PR to main

---

## Rollback

```bash
# Immediate - disable bypass
ENABLE_TIERB_MARGIN_BYPASS=false

# Hard rollback - revert commit
git revert 6cf2fb7
```

---

## Files Changed
- `scripts/rss/hybrid-clustering.js`
- `docs/plans/ttrc-333-title-token-bypass.md`
