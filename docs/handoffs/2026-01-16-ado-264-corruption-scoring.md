# Handoff: Pardons Corruption Scoring Overhaul (ADO-264)

**Date:** 2026-01-16
**ADO:** Bug 264 (linked to Epic 109)
**Branch:** test
**Status:** Code complete, pending TEST validation

---

## For UX/Design: Pardons Display Logic

### Corruption Level Labels (What Users See)

| Level | Spicy Label | Neutral Label | Color | When It's Used |
|-------|-------------|---------------|-------|----------------|
| 5 | Paid-to-Play | Direct Financial Connection | Red | Documented donations, business deals, paid access |
| 4 | Loyalty Reward | Service to Trump | Orange | Jan 6 defendants, fake electors, refused to flip |
| 3 | Swamp Royalty | Swamp Access | Yellow | Rich unknowns, "weaponized DOJ" claims, lobbyists |
| 2 | Celebrity Request | Public Campaign | Indigo | Famous person advocated, no deeper connection |
| 1 | Broken Clock | Legitimate Clemency | Green | RARE - bipartisan support, reform cases |

### Connection Type Badges

| Type | Display Label | Color |
|------|---------------|-------|
| major_donor | Major Donor | Green |
| political_ally | Political Ally | Blue |
| family | Family | Purple |
| business_associate | Business Associate | Cyan |
| celebrity | Celebrity | Orange |
| jan6_defendant | Jan 6 Defendant | Rose |
| fake_electors | Fake Elector | Fuchsia |
| mar_a_lago_vip | Mar-a-Lago VIP | Red |
| cabinet_connection | Cabinet Connection | Violet |
| lobbyist | Lobbyist | Emerald |
| campaign_staff | Campaign Staff | Amber |
| wealthy_unknown | Wealthy Unknown | Stone |
| no_connection | No Known Connection | Gray |

### Profanity Rules by Level

- **Levels 5 & 4:** Profanity allowed in summaries (anger justified)
- **Level 3:** Sardonic/skeptical, no swearing
- **Level 2:** Measured critique of system, not individual
- **Level 1:** Respectful acknowledgment, can express approval

---

## For Engineers: Prompt Logic

### Perplexity Research Prompt (Sets corruption_level)

**File:** `scripts/enrichment/perplexity-research.js` (v1.4)

The prompt asks Perplexity: "WHY did Trump pardon this person?"

**Scoring Rules:**
```
5 = "Paid-to-Play" - Documented $$$ (donations, business deals, paid access)
4 = "Loyalty Reward" - Did something FOR Trump (Jan 6, fake electors, refused to flip)
3 = "Swamp Royalty" - Benefited from swamp (rich unknowns, "weaponized DOJ" claims)
2 = "Celebrity Request" - Famous person advocated, no deeper connection
1 = "Broken Clock" - Actually legitimate (RARE - requires positive evidence)
```

**Critical Scoring Rules:**
- Jan 6 / fake electors / election crimes = **MINIMUM Level 4**
- Unknown wealthy person = **Level 3** + `connection_type = "wealthy_unknown"`
- "Weaponized DOJ" claims = **Level 3** (swamp excuse, not legitimacy)
- Default when unclear = **Level 3** (NOT Level 1)
- Level 1 requires POSITIVE evidence (bipartisan support, reform advocacy)

**Outputs:** `corruption_level`, `primary_connection_type`, `trump_connection_detail`, `receipts_timeline`, `pardon_advocates`, `sources`

### GPT Enrichment Prompt (Sets tone based on level)

**File:** `scripts/enrichment/pardons-gpt-prompt.js`

Receives corruption_level as INPUT and generates:
- `summary_spicy` - 2-4 sentences, sharp hook
- `why_it_matters` - 1-2 sentences, broader implications
- `pattern_analysis` - 1 sentence, how it fits the pattern

**Tone Calibration:**
- Levels 5 & 4: Be angry. Profanity allowed.
- Level 3: Sardonic and pointed, no swearing.
- Level 2: Measured critique of the system.
- Level 1: Acknowledge legitimacy, cautious approval.

---

## What Was Done

### Code Changes (Committed to test branch)
- [x] `perplexity-research.js` - Prompt v1.4 with new labels + scoring logic
- [x] `pardons-gpt-prompt.js` - Updated CORRUPTION_LABELS and CONNECTION_TYPE_LABELS
- [x] `pardons-app.js` - Frontend display labels and colors
- [x] `business-logic-mapping.md` - Full documentation
- [x] `migrations/062_add_wealthy_unknown_connection.sql` - CHECK constraint update

**Commit:** `86afd0a feat(pardons): ADO-264 corruption scoring overhaul`

### ADO Items
- **ADO-264:** Corruption scoring overhaul (Active)
- **ADO-263:** Data quality bug (New) - orgs as person, district formatting
- **ADO-265:** Admin Dashboard - Pardons (New)
- **ADO-266:** Ongoing monitoring (New)

---

## What's Left (TEST First)

### TEST Environment
1. [ ] **Apply migration 062** via Supabase SQL Editor:
   ```sql
   ALTER TABLE public.pardons DROP CONSTRAINT IF EXISTS pardons_primary_connection_type_check;

   ALTER TABLE public.pardons ADD CONSTRAINT pardons_primary_connection_type_check
     CHECK (primary_connection_type IS NULL OR primary_connection_type IN (
       'mar_a_lago_vip', 'major_donor', 'family', 'political_ally',
       'campaign_staff', 'business_associate', 'jan6_defendant',
       'fake_electors', 'celebrity', 'cabinet_connection', 'lobbyist',
       'wealthy_unknown', 'no_connection'
     ));
   ```
2. [ ] **Run research pipeline** with `--force` to re-score all pardons:
   ```bash
   gh workflow run "Research Pardons (Perplexity)" --ref test -f limit=100 -f force=true
   ```
3. [ ] **Run enrichment pipeline** to regenerate summaries:
   ```bash
   gh workflow run "Enrich Pardons (GPT)" --ref test -f limit=100 -f force=true
   ```
4. [ ] **Spot-check scoring** - verify Jan 6 = Level 4, rich unknowns = Level 3

### PROD Environment (After TEST Validated)
1. [ ] Apply migration 062 to PROD
2. [ ] Fix PROD data gap (only 33 of 94 pardons imported)
3. [ ] Run research pipeline on PROD with `--force`
4. [ ] Run enrichment pipeline on PROD
5. [ ] Verify PROD site displays correctly

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `scripts/enrichment/perplexity-research.js` | Research prompt (sets corruption_level) |
| `scripts/enrichment/pardons-gpt-prompt.js` | GPT prompt (generates summaries) |
| `public/pardons-app.js` | Frontend display logic |
| `docs/architecture/business-logic-mapping.md` | Business logic documentation |
| `docs/features/pardons-tracker/ado-264-corruption-scoring-plan.md` | Implementation plan |
| `migrations/062_add_wealthy_unknown_connection.sql` | DB migration |

---

## Cost Estimate

- Perplexity re-research (~100 pardons): ~$1.25
- GPT enrichment (~100 pardons): ~$0.03
- **Total:** ~$1.30 per environment

---

**Session tokens:** ~50K used
