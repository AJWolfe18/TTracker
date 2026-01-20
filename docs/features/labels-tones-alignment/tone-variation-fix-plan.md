# Tone Variation Fix Plan (ADO-273)

**Created:** 2026-01-19
**Status:** Planning Complete → Ready for Implementation

**ADO Work Items:**
- **ADO-273:** EOs (Phase 1) - validates architecture
- **ADO-274:** Stories (Phase 2) - highest volume
- **ADO-275:** SCOTUS (Phase 3) - frontend pending
- **ADO-276:** Pardons (Phase 4) - inherently negative, 2 frames only

---

## Problem Statement

The tone variation system exists but **doesn't produce varied output**. Testing 20 enriched EOs revealed:

| Pattern | Occurrences |
|---------|-------------|
| "Beneath the surface..." opener | 5/20 |
| "What they don't say is..." opener | 4/20 |
| "Executive Order X, signed on..." summary start | 20/20 |
| Alarm levels 4-5 only | 20/20 |

**Root causes identified:**
1. Hardcoded alarm level 3 in variation selection
2. No tracking of recently used variations
3. "Suggestions" language too weak (GPT ignores)
4. Summary has no variation instruction
5. Section openers not in banned list

---

## Solution Architecture

### Key Insight: Frame ≠ Intensity

| Concern | What it controls | Who controls it |
|---------|------------------|-----------------|
| **Device** | Structural pattern (contrast, timeline, metaphor) | Variation system |
| **Frame** | Directional stance (alarmed vs cautious positive) | Variation system |
| **Intensity** | Emotional temperature (cold fury vs measured) | Tone calibration in prompt |

### The Frame Bucket Approach

Instead of predicting 0-5 alarm level (brittle), predict 3 directional frames (robust):

| Frame | Stance | When to use | Maps to levels |
|-------|--------|-------------|----------------|
| `alarmed` | Crisis mode, this is an attack | Strong negative signals | 4-5 |
| `critical` | Standard sardonic voice | **Default** (angry-leaning site) | 2-3 |
| `cautious_positive` | Broken clock moment | Explicit positive signals | 0-1 |

**Why this works:**
- 3 buckets is easier to classify accurately than 6 levels
- Default is `critical` (the baseline TrumpyTracker voice)
- Mismatch fuse in prompt lets GPT correct if estimate is wrong

### Pool Structure (Per Content Type)

```
{category}_{frame}
├── miller_alarmed      (~6 device cards)
├── miller_critical     (~6 device cards)
├── miller_positive     (~4 device cards)
├── donor_alarmed
├── donor_critical
├── donor_positive
├── default_alarmed
├── default_critical
└── default_positive
```

9 pools × ~5-6 cards = ~50 device-only variations per content type.

### Device-Only Variation Cards

Variations describe STRUCTURE, not intensity:

```javascript
// ✅ Device-only (correct)
{
  id: "contrast-01",
  opening_approach: "Lead with contrast between stated intent and practical effect.",
  rhetorical_device: "Use a tight contrast pair (claim vs reality).",
  structure: "Claim → reality → who's affected → implications.",
  closing_approach: "End with what this enables going forward."
}

// ❌ Intensity-coded (wrong - fights tone calibration)
{
  id: "fury-01",
  opening_approach: "Cold fury: 'This is what fascism looks like.'"
}
```

### Frame Estimation Function

```javascript
function estimateFrame(title, description, category) {
  const text = `${title} ${description || ''}`.toLowerCase();

  // ALARMED: Require verb + target OR verb + sensitive category
  const alarmedVerbs = ['terminate', 'deport', 'detain', 'seize', 'abolish', 'ban', 'suspend', 'revoke'];
  const alarmedTargets = ['program', 'rights', 'protection', 'immigrants', 'refugees', 'benefits'];
  const sensitiveCats = ['immigration_border', 'justice_civil_rights_voting'];

  const hasAlarmedVerb = alarmedVerbs.some(v => text.includes(v));
  const hasAlarmedTarget = alarmedTargets.some(t => text.includes(t));
  const isSensitiveCat = sensitiveCats.includes(category);

  if (hasAlarmedVerb && (hasAlarmedTarget || isSensitiveCat)) {
    return 'alarmed';
  }

  // CAUTIOUS_POSITIVE: Explicit positive signals only
  const positiveSignals = ['restore', 'protect', 'preserve', 'bipartisan', 'extend benefits', 'reinstate'];
  if (positiveSignals.some(s => text.includes(s))) {
    return 'cautious_positive';
  }

  // DEFAULT: Critical (standard angry voice)
  return 'critical';
}
```

### Deterministic Selection

```javascript
function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function selectVariation(poolKey, seedKey, recentIds = []) {
  const pool = VARIATION_POOLS[poolKey] || VARIATION_POOLS.default_critical;

  let idx = fnv1a32(seedKey) % pool.length;

  // Collision stepping within batch
  for (let step = 0; step < pool.length; step++) {
    if (!recentIds.includes(pool[idx].id)) return pool[idx];
    idx = (idx + 1) % pool.length;
  }

  return pool[fnv1a32(seedKey) % pool.length];
}
```

**Seed construction:** `${content_id}:${PROMPT_VERSION}:${poolKey}`

Benefits:
- Same content + same version = same variation (reproducible)
- Version bump = all content gets new variations
- No state persistence needed

### Mismatch Fuse (Prompt Addition)

```
NOTE: The REQUIRED VARIATION provides a frame direction based on initial assessment.
If your determined alarm_level conflicts with this frame (e.g., you determine level 0-1
but received an "alarmed" frame), keep the device/structure guidance but adjust
the directional stance to match your actual alarm_level assessment.
```

This makes frame selection a "strong default" not a hard lock.

### Summary Variation (Neutral Structural)

```
**Summary** (2-3 sentences):
Neutral, factual summary. Vary the opening structure.

DO NOT always start with "Executive Order X, signed on..."

Rotate between openers like:
- "This executive order directs [agency] to..."
- "Under this directive, the administration..."
- "The order establishes/requires/changes..."
- "This action requires federal agencies to..."
```

### Section-Specific Banned Openers

```
SECTION-SPECIFIC BANNED PHRASE STARTS:
- section_what_it_means: "Beneath the surface", "What they don't say", "The real story is", "Here's what's really going on", "Dig deeper and"
- section_reality_check: "The truth is", "Let's be clear", "Here's the reality"
- section_why_it_matters: "The stakes couldn't be higher", "This sets the stage"
```

---

## Implementation Phases

### Phase 1: Executive Orders (ADO-273)

**Files to modify:**

| File | Changes |
|------|---------|
| `scripts/executive-orders-tracker-supabase.js` | Store FR abstract in `description` field |
| `scripts/enrichment/eo-variation-pools.js` | Rewrite to frame buckets + device-only cards + deterministic selection |
| `scripts/enrichment/prompts.js` | Fix `buildEOPayload()`, add REQUIRED VARIATION block, summary openers, section bans, mismatch fuse |
| `scripts/enrichment/enrich-executive-orders.js` | Pass seed to selection, track recent IDs in batch |

**New exports from eo-variation-pools.js:**
```javascript
export function estimateFrame(title, description, category)
export function selectVariation(poolKey, seedKey, recentIds)
export function buildVariationInjection(variation)
export const EO_VARIATION_POOLS = { ... }
```

**Prompt version:** `v4-ado273`

**Acceptance criteria:**
- [ ] No repeated `variation.id` within batch
- [ ] Same EO + prompt_version = same variation (deterministic)
- [ ] 0 banned phrase starts in specified sections (sample of 30)
- [ ] Top summary opener < 25% of sample
- [ ] Frame distribution: mostly `critical`, some `alarmed`, rare `cautious_positive`

**Estimated effort:** 1 session

---

### Phase 2: Stories

**Files to modify:**

| File | Changes |
|------|---------|
| `scripts/enrichment/stories-variation-pools.js` | Rewrite to frame buckets + device-only cards |
| `scripts/enrichment/prompts.js` | Update SYSTEM_PROMPT with frame system |
| `scripts/enrichment/enrich-stories-inline.js` | Add frame estimation, deterministic selection |

**Story-specific considerations:**
- Stories come from RSS, no FR abstract - use `primary_headline` + article excerpts
- Category already exists from clustering
- Higher volume than EOs - variation diversity more visible

**Prompt version:** Update SYSTEM_PROMPT version marker

**Estimated effort:** 1 session

---

### Phase 3: SCOTUS

**Files to modify:**

| File | Changes |
|------|---------|
| `scripts/enrichment/scotus-variation-pools.js` | Rewrite to frame buckets |
| `scripts/enrichment/scotus-gpt-prompt.js` | Add frame system |

**SCOTUS-specific considerations:**
- Rulings CAN be positive (ruling against Trump) - `cautious_positive` frame matters here
- "The Betrayal" voice when court fails, but need "System Worked" voice when it doesn't
- Frontend doesn't exist yet - lower priority

**Estimated effort:** 0.5 session

---

### Phase 4: Pardons

**Files to modify:**

| File | Changes |
|------|---------|
| `scripts/enrichment/pardons-variation-pools.js` | Simplify to 2 frames (alarmed/critical only) |
| `scripts/enrichment/pardons-gpt-prompt.js` | Add frame system |

**Pardons-specific considerations:**
- Pardons are inherently negative (corrupt pardons)
- Less need for `cautious_positive` frame - pardons are rarely "good"
- Could simplify to just `alarmed` (Pay 2 Win) and `critical` (standard corruption)

**Estimated effort:** 0.5 session

---

## Shared Infrastructure

### Consider: Shared Frame Estimation Module

After Phase 1-2, consider extracting common logic:

```
scripts/shared/
├── frame-estimation.js    # estimateFrame() with content-type adapters
├── variation-selection.js # selectVariation(), fnv1a32(), buildVariationInjection()
└── ... existing files
```

This prevents drift between content types.

---

## Testing Strategy

### Per-Phase Testing

1. **Unit test frame estimation** - Known titles → expected frames
2. **Unit test deterministic selection** - Same seed → same variation
3. **Integration test** - Enrich 10 items, verify no repeated variation IDs
4. **Output sampling** - Enrich 30 items, manually review for:
   - Opener variety
   - No banned phrase starts
   - Frame-appropriate stance

### Regression Testing

After each phase:
- Run `npm run qa:smoke`
- Verify other content types still work
- Check no new console errors

---

## Rollout Strategy

### Phase 1 (EOs)

1. Implement changes on `test` branch
2. Re-enrich 50 EOs with `v4-ado273`
3. Manual review of output quality
4. If good → enrich remaining ~170 EOs
5. Push to test, verify on test site
6. Create PR to main when ready

### Subsequent Phases

Same pattern: implement → test sample → full run → verify → promote

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Frame estimation wrong | Mismatch fuse lets GPT correct |
| Deterministic selection too predictable | Seed includes prompt_version - bump to rotate |
| Device cards still too similar | Review output, add more diverse devices |
| Breaks existing enriched content | Prompt version change only affects new enrichment |

---

## Success Metrics

After full rollout:

| Metric | Target |
|--------|--------|
| Opener variety (unique first 50 chars) | >70% unique across 30 samples |
| Summary opener variety | Top opener < 25% |
| Banned phrase violations | 0 |
| Frame distribution | ~60% critical, ~30% alarmed, ~10% positive |
| User feedback on "sameness" | Reduced complaints |

---

---

## Content-Type Specifications

### Executive Orders (Phase 1)

**Current state:**
- 3 category pools: `miller`, `donor`, `default`
- 6 level sub-pools each (0-5)
- ~52 opening patterns total
- Hardcoded `alarmLevel = 3` (broken)

**Input data for frame estimation:**
- `title` (from Federal Register)
- `description` (FR abstract - need to store it!)
- `category` (from tracker's `determineCategory()`)

**Frame buckets:**

| Frame | Signals | Maps to levels |
|-------|---------|----------------|
| `alarmed` | terminate, deport, detain, ban + target (rights, immigrants, program) | 4-5 |
| `critical` | **Default** - standard angry voice | 2-3 |
| `cautious_positive` | restore, protect, bipartisan, extend benefits | 0-1 |

**New pool structure:**
```
miller_alarmed, miller_critical, miller_positive
donor_alarmed, donor_critical, donor_positive
default_alarmed, default_critical, default_positive
```

9 pools × ~5-6 device cards = ~50 total

**Files:**
- `executive-orders-tracker-supabase.js` - Store FR abstract
- `eo-variation-pools.js` - Rewrite pools + selection
- `prompts.js` - Update EO prompt
- `enrich-executive-orders.js` - Wire up

---

### Stories (Phase 2)

**Current state:**
- 4 category pools: `donor`, `state_power`, `democracy`, `default`
- 6 level sub-pools each (0-5)
- ~66 opening patterns total
- Same hardcoded level issue as EOs

**Input data for frame estimation:**
- `primary_headline` (from clustering)
- Article excerpts/descriptions (from RSS)
- `category` (from GPT during enrichment - chicken/egg!)

**Challenge:** Stories don't have category until AFTER enrichment. Options:
1. Pre-estimate category from headline keywords (like EOs)
2. Use article source tier as proxy
3. Default to `critical` more aggressively

**Recommended approach:** Pre-estimate from headline + source:
```javascript
function estimateStoryFrame(headline, sourceTier) {
  const text = headline.toLowerCase();

  // ALARMED: Strong crisis signals
  if (/insurrection|coup|fascis|authoritarian|martial law/.test(text)) {
    return 'alarmed';
  }

  // POSITIVE: Explicit good news (rare)
  if (/victory|win|court rules against|blocked|stopped|defeated/.test(text)) {
    return 'cautious_positive';
  }

  // Tier 1 sources (breaking news) bias toward alarmed
  if (sourceTier === 1 && /breaking|urgent|emergency/.test(text)) {
    return 'alarmed';
  }

  return 'critical'; // Default
}
```

**Frame buckets:**

| Frame | Voice |
|-------|-------|
| `alarmed` | "Constitutional dumpster fire" - crisis mode |
| `critical` | "The Deep Swamp" - standard sardonic |
| `cautious_positive` | "Broken clock moment" - rare good news |

**New pool structure:**
```
donor_alarmed, donor_critical, donor_positive
state_power_alarmed, state_power_critical, state_power_positive
democracy_alarmed, democracy_critical, democracy_positive
default_alarmed, default_critical, default_positive
```

12 pools × ~5 device cards = ~60 total

**Files:**
- `stories-variation-pools.js` - Rewrite pools + selection
- `prompts.js` - Update SYSTEM_PROMPT
- `enrich-stories-inline.js` - Wire up

---

### SCOTUS (Phase 3)

**Current state:**
- 6 level-based pools + 2 special issue pools (`voting_rights`, `agency_power`)
- ~76 opening patterns total
- Uses `ruling_impact_level` for selection (not hardcoded!)

**Key difference:** SCOTUS already uses level-based selection correctly because `ruling_impact_level` is known BEFORE enrichment (from case metadata).

**However:** Still has intensity-coded language + "suggestions" weakness.

**Input data for frame estimation:**
- `ruling_impact_level` (from case import - AVAILABLE!)
- `issue_area` (from case metadata)
- Case outcome (petitioner won/lost)

**Frame approach:** SCOTUS can use actual level since it's known pre-enrichment!

| Frame | Levels | Special override |
|-------|--------|------------------|
| `alarmed` | 4-5 | voting_rights always |
| `critical` | 2-3 | agency_power default |
| `cautious_positive` | 0-1 | When petitioner is people/unions |

**Keep special pools:** `voting_rights` and `agency_power` are good - they capture issue-specific framing that transcends level.

**New pool structure:**
```
Level-based:
  scotus_alarmed, scotus_critical, scotus_positive

Issue-based (override):
  voting_rights_alarmed, voting_rights_critical  (no positive - VRA cases are never good news)
  agency_power_alarmed, agency_power_critical    (no positive - Chevron gutting is never good)
```

~7 pools × ~8 device cards = ~56 total

**Files:**
- `scotus-variation-pools.js` - Rewrite pools + selection
- `scotus-gpt-prompt.js` - Update prompt
- (enrichment script - TBD, may not exist yet)

---

### Pardons (Phase 4)

**Current state:**
- 7 type-based pools: `donor`, `inner_circle`, `political`, `insurrection`, `celebrity`, `legitimate`, `mercy`
- NOT level-based - **already closer to our approach!**
- ~50 opening patterns total
- Uses `corruption_level` + `connection_type` for pool selection

**Key insight:** Pardons pool selection already works like frame buckets:
- `mercy` (level 0) = cautious_positive frame
- `legitimate` (level 1) = cautious_positive frame
- `celebrity` (level 2) = critical frame
- `political`, `inner_circle`, `donor`, `insurrection` (levels 3-5) = alarmed frame

**Simplification opportunity:** Collapse to 3 frames:

| Frame | Current pools | Rationale |
|-------|--------------|-----------|
| `alarmed` | donor, inner_circle, insurrection | Blatant corruption/danger |
| `critical` | political, celebrity | Standard corruption |
| `cautious_positive` | legitimate, mercy | Rare defensible pardons |

**But:** The type-specific framing is valuable. "Insurrection" framing is different from "donor" framing.

**Recommended approach:** Keep type-based pools but add frame layer:
```javascript
function getPardonFrame(corruption_level, connection_type) {
  if (corruption_level <= 1) return 'cautious_positive';
  if (['insurrection', 'donor', 'inner_circle'].includes(getPoolType(...))) {
    return 'alarmed';
  }
  return 'critical';
}
```

Then select from `{poolType}_{frame}`:
- `donor_alarmed` (most donor pardons)
- `donor_critical` (if somehow less corrupt donor)
- `insurrection_alarmed` (all Jan 6 pardons)

**Simpler alternative:** Since pardons are inherently negative, just keep 2 frames:
- `alarmed` (levels 3-5, insurrection, donor)
- `critical` (levels 1-2, celebrity, political)
- Drop `cautious_positive` - pardons are rarely "good news"

**Files:**
- `pardons-variation-pools.js` - Rewrite pools + selection
- `pardons-gpt-prompt.js` - Update prompt
- `enrich-pardons.js` - Wire up

---

## Shared Module Extraction (Post Phase 2)

After EOs and Stories are done, extract common patterns:

```
scripts/shared/
├── frame-estimation.js      # estimateFrame() with content-type adapters
├── variation-selection.js   # selectVariation(), fnv1a32(), buildVariationInjection()
├── severity-config.js       # (existing)
├── banned-openings.js       # (existing)
└── profanity-rules.js       # (existing)
```

**Shared functions:**
```javascript
// frame-estimation.js
export function estimateFrame(contentType, inputData) {
  switch(contentType) {
    case 'eo': return estimateEOFrame(inputData);
    case 'story': return estimateStoryFrame(inputData);
    case 'scotus': return estimateSCOTUSFrame(inputData);
    case 'pardon': return estimatePardonFrame(inputData);
  }
}

// variation-selection.js
export function fnv1a32(str) { ... }
export function selectVariation(pool, seedKey, recentIds) { ... }
export function buildVariationInjection(variation, contentType) { ... }
```

---

## Device Card Template

All content types use the same card structure:

```javascript
{
  id: "unique-id",
  opening_approach: "Lead with [structural pattern], not [intensity].",
  rhetorical_device: "Use [device type]: [brief example structure].",
  structure: "[Element] → [Element] → [Element] → [Element].",
  closing_approach: "End with [type of ending]."
}
```

**Good (device-only):**
```javascript
{
  id: "contrast-claim-reality",
  opening_approach: "Lead with contrast between official framing and practical effect.",
  rhetorical_device: "Use tight A/B contrast structure.",
  structure: "Official claim → actual effect → who's affected → implication.",
  closing_approach: "End with what this enables going forward."
}
```

**Bad (intensity-coded):**
```javascript
{
  id: "cold-fury",
  opening_approach: "Cold fury: 'This is what fascism looks like with paperwork.'"
  // GPT will copy "fascism" even for low-alarm content
}
```

---

## Migration Strategy

For each content type:

1. **Create new pools file** alongside existing (e.g., `eo-variation-pools-v2.js`)
2. **Test with sample** - enrich 10 items with new system
3. **Compare outputs** - verify variety improved, frames appropriate
4. **Replace original** - swap imports in enrichment script
5. **Bump prompt version** - triggers re-enrichment
6. **Full run** - enrich all content with new system

This allows rollback if issues discovered.

---

## Summary: Content Type Comparison

| Aspect | EOs | Stories | SCOTUS | Pardons |
|--------|-----|---------|--------|---------|
| **Category pools** | 3 (miller/donor/default) | 4 (donor/state/democracy/default) | 2 special + level-based | 7 type-based |
| **Frame buckets** | 3 | 3 | 3 + special overrides | 2 (no positive) |
| **Input for frame** | title + abstract + category | headline + source tier | level (known!) + issue_area | corruption_level + connection_type |
| **Total pools** | 9 | 12 | ~7 | ~6 |
| **Cards per pool** | ~5-6 | ~5 | ~8 | ~6-8 |
| **Priority** | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
| **Effort** | 1 session | 1 session | 0.5 session | 0.5 session |

---

## References

- ADO-273: https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/273
- Investigation handoff: `docs/handoffs/2026-01-19-ado-273-tone-variation-investigation.md`
- Parent plan: `docs/features/labels-tones-alignment/plan.md`
- EO pipeline fix (ADO-271): `docs/features/labels-tones-alignment/eo-pipeline-fix-plan.md`

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-19 | Initial plan created from investigation + design discussion |
| 2026-01-19 | Added detailed content-type specifications for all 4 types |
