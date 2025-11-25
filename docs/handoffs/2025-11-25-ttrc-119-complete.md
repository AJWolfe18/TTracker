# Handoff: TTRC-119 Complete - Prompt Improvements + Product Vision

**Date:** 2025-11-25
**Status:** Complete
**Commits:** `858e2f0` (EO prompt update)
**AI Code Review:** Passed

---

## Summary

Completed TTRC-119 prompt improvements and documented product vision from strategic discussion.

---

## What Was Done

### 1. EO Prompt Update (`scripts/enrichment/prompts.js`)

Added to `EO_ENRICHMENT_PROMPT`:
- **PERSPECTIVE section** - Progressive viewpoint, no "both sides"
- **BANNED OPENINGS** - Same 10 cliché openers banned as story prompt

Now both story and EO prompts have consistent voice.

### 2. Product Vision Doc (`docs/PRODUCT_VISION.md`)

Created new product direction document capturing:
- **Core value prop:** "Win the Argument Arsenal"
- **Target user:** Progressives who need quick receipts for political arguments
- **Product pillars:** Spicy voice, searchability, shareability, accountability
- **Roadmap ideas:** Timeline view, wins tracking, email, merch (all unscheduled)
- **Brand voice guidelines:** DO/DON'T list for content

### 3. JIRA Ticket for Future Feature

Created **TTRC-293**: Add "quotable line" to AI enrichment prompts
- Punchy one-liner (<20 words) optimized for copy/paste in arguments
- Supports the "Win the Argument" value prop
- Priority: Low (future enhancement)

---

## Quality Verification

Checked 3 recently enriched stories - all show:
- Progressive framing ("blatant power grab", "classic fascism")
- Personal stakes ("YOUR rights", "YOUR healthcare")
- Action items at end
- No banned openings used

---

## Files Changed/Created

| File | Change |
|------|--------|
| `scripts/enrichment/prompts.js` | Added PERSPECTIVE + BANNED OPENINGS to EO prompt |
| `docs/PRODUCT_VISION.md` | NEW - Product direction document |

---

## JIRA Updates

- **TTRC-119:** Transitioned to Done, comment added with session summary
- **TTRC-293:** Created for quotable line feature (future)

---

## Strategic Insights (From Discussion)

**Key reframe:** TrumpyTracker isn't a news aggregator - it's an **"argument arsenal"** for progressives who need receipts during political discussions.

**What this means for product:**
1. Search is critical (find specific topics fast)
2. Shareability matters (easy to use in arguments)
3. Spicy voice is the brand (keep it, don't water down)
4. Future timeline view would be killer feature

**Potential concerns addressed:**
- Angry content burnout: Keep spicy, but consider adding "wins/progress" tracking for balance
- Retention: Future email capture would help bring people back

---

## Next Actions (Future)

- [ ] TTRC-293: Implement quotable lines
- [ ] Consider timeline view as major feature
- [ ] Add wins/progress tracking for positive stories

---

*Session complete. TTRC-119 is Done.*
