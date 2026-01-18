# Handoff: Labels/Prompts Overhaul (ADO-269, ADO-270)

**Date:** 2026-01-17
**ADO:** 269 (Pardons), 270 (Stories)
**Branch:** test
**Status:** Pardons code complete (uncommitted), Stories needs work

---

## What Was Done

### Pardons New Labels (0-5 Scale)

| Level | Label | Mechanism | Color |
|-------|-------|-----------|-------|
| 5 | Pay 2 Win | 💰 MONEY | Red |
| 4 | Cronies-in-Chief | 👥 DIRECT relationship | Orange |
| 3 | The Party Favor | 🔗 NETWORK (indirect) | Yellow |
| 2 | The PR Stunt | 📺 FAME | Blue |
| 1 | The Ego Discount | 🪞 FLATTERY | Cyan |
| 0 | Actual Mercy | ⚖️ MERIT (rare) | Green |

**Key Distinction (Level 4 vs 3):**
- Level 4: DIRECT Trump relationship (worked for him, family, inner circle)
- Level 3: INDIRECT (MAGA world, GOP allies, "friend of a friend", Alice Johnson advocated)

**Files Modified (UNCOMMITTED):**
- `docs/architecture/business-logic-mapping.md` - full pardons section updated
- `scripts/enrichment/pardons-gpt-prompt.js` - labels, profanity rules, tone calibration
- `scripts/enrichment/perplexity-research.js` - scoring guide updated
- `public/pardons-app.js` - frontend labels and colors
- `migrations/063_corruption_level_zero.sql` - NEW, allows Level 0 in DB

### Stories New Labels (0-5 Scale) - NOT YET IMPLEMENTED

| Level | Label | Differentiator |
|-------|-------|----------------|
| 5 | Constitutional Dumpster Fire | Attacks on core system (elections, courts, law) |
| 4 | Criminal Bullshit | Outright illegal acts or policies causing physical harm |
| 3 | The Deep Swamp | Regulatory capture, billionaire favors, corporate grift |
| 2 | The Great Gaslight | Blatant lying, propaganda, "efficiency" theater |
| 1 | Accidental Sanity | Borderline: Did right thing, likely by mistake |
| 0 | Winning (Wait, Really?) | Sarcastic Good: Real progress for people |

**Files to Update (ADO-270):**
- `docs/architecture/business-logic-mapping.md` - replace old severity section
- `scripts/enrichment/enrich-stories-inline.js`
- `public/app.js`
- Variation pools

### SCOTUS Labels - Added by User

User manually added SCOTUS Ruling Impact System to business-logic-mapping.md with:
- Constitutional Crisis, Rubber-stamping Tyranny, Institutional Sabotage, etc.
- Full variation pools for opening patterns

### Executive Orders

EO feature exists (`eo-app.js`, `enrich-executive-orders.js`) but needs label/prompt review for consistency with new scales.

---

## ADO Cards Created

- **ADO-269:** Pardons - Finalize labels, prompts, tones, FE/BE integration
- **ADO-270:** Stories - Update labels, prompts, tones, variability (0-5 scale)

---

## What's NOT Committed

All pardons changes are in working directory, NOT committed. User requested hold on commit to review everything for consistency first.

```bash
git status
# Modified:
#   docs/architecture/business-logic-mapping.md
#   public/pardons-app.js
#   scripts/enrichment/pardons-gpt-prompt.js
#   scripts/enrichment/perplexity-research.js
# Untracked:
#   migrations/063_corruption_level_zero.sql
```

---

## Next Steps

1. Review ALL prompts for consistency (Pardons, Stories, EOs)
2. Update Stories to new 0-5 scale
3. Update EOs to match pattern
4. Commit all together once consistent
5. Apply migrations to TEST
6. Run pipelines to re-enrich

---

## Key Files Reference

| Content Type | Prompt File | Frontend | Enrichment |
|--------------|-------------|----------|------------|
| Pardons | `pardons-gpt-prompt.js` | `pardons-app.js` | `perplexity-research.js` |
| Stories | `enrich-stories-inline.js` | `app.js` | same file |
| Exec Orders | `enrich-executive-orders.js` | `eo-app.js` | same file |
| Business Logic | `docs/architecture/business-logic-mapping.md` | - | - |

---

## Prompt Feedback to Incorporate

From user's review:
1. **Pardons:** Add vocabulary guidance - "networker" not "insider" for Level 3
2. **Banned Openings:** Add "In the latest move...", "It remains to be seen...", "Crucially..."
3. **EOs:** Add "follow the money" logic for Level 3, "PR stunt" callout for Level 2
4. **Global:** Consider Gemini for schema-mode consistency (future)

---

**Session tokens:** ~85K used
