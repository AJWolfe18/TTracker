# Tone Variation Fix Plan (ADO-273)

**Created:** 2026-01-19
**Updated:** 2026-01-20
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

### The Smoking Gun (Stories)

```javascript
// enrich-stories-inline.js lines 175-179 - THE BROKEN CODE
const existingCategory = story.category || 'other';  // Always 'other' on first enrich!
const poolKey = getPoolKey(existingCategory);
const variation = selectVariation(poolKey, 3, []);   // Hardcoded alarm level 3!
```

This is why every story sounds the same: hardcoded inputs → same pool → same patterns.

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
| **Style Pattern** | Structural approach (contrast, timeline, metaphor) | Variation system |
| **Frame** | Directional stance (alarmed vs grudging credit) | Variation system |
| **Intensity** | Emotional temperature (cold fury vs measured) | Tone calibration in prompt |

### The Frame Bucket Approach

Instead of predicting 0-5 alarm level (brittle), predict 3 directional frames (robust):

| Frame | Stance | When to use | Maps to levels |
|-------|--------|-------------|----------------|
| `alarmed` | Crisis mode, this is an attack | Strong negative signals | 4-5 |
| `critical` | Standard sardonic voice | **Default** (angry-leaning site) | 2-3 |
| `grudging_credit` | Credit where due, don't get used to it | Explicit positive signals | 0-1 |

**Why this works:**
- 3 buckets is easier to classify accurately than 6 levels
- Default is `critical` (the baseline TrumpyTracker voice)
- Mismatch fuse in prompt lets GPT correct if estimate is wrong

**Frame vocabulary is consistent across ALL content types.** Even level-0 EOs aren't "positive" - they're "fine, credit where due, don't get used to it."

### Style Pattern Structure

**20 shared core patterns + 10-15 per content type**

This prevents:
- Fragmentation (each pool too small → repetition)
- Duplication (same patterns copy-pasted across types)
- Day-one overwhelm (don't need 50 perfect patterns per type)

```
scripts/shared/
├── style-patterns-core.js      # ~20 universal patterns (contrast, mechanism, scope, etc.)
├── style-patterns-lint.js      # Instructional pattern checker

scripts/enrichment/
├── eo-style-patterns.js        # 10-15 EO-specific + imports core
├── stories-style-patterns.js   # 10-15 Stories-specific + imports core
├── scotus-style-patterns.js    # 10-15 SCOTUS-specific + imports core
├── pardons-style-patterns.js   # 10-15 Pardons-specific + imports core
```

### Style Pattern Template

All content types use the same structure:

```javascript
// ✅ CORRECT - approach description only
{
  id: "contrast-claim-reality",
  opening_approach: "Lead with contrast between official framing and practical effect.",
  rhetorical_device: "Use tight A/B contrast structure.",
  structure: "Official claim → actual effect → who's affected → implication.",
  closing_approach: "End with what this enables going forward."
}

// ❌ WRONG - literal starter text (GPT will copy verbatim)
{
  id: "contrast-bad",
  opening_approach: "Start with: 'They said X. The reality is Y.'"
}
```

---

## Must-Have Guardrails

### Guardrail 1: Deterministic Seed Recipe

```javascript
const seed = `${content_id}:${PROMPT_VERSION}:${poolKey}:${frameBucket}`;
const idx = fnv1a32(seed) % pool.length;

// Collision-step within batch
for (let step = 0; step < pool.length; step++) {
  if (!recentIds.includes(pool[idx].id)) return pool[idx];
  idx = (idx + 1) % pool.length;
}
```

**Why frameBucket is explicit:** Even though poolKey contains the frame, being explicit guards against future refactoring.

**Reject naive approaches:** If anyone suggests `content_id % poolSize` → reject. Pool size changes remap everything, and numeric IDs have predictable distribution patterns.

### Guardrail 2: Style Pattern Lint (No Literal Text)

Lint for instructional quoting patterns, not all quotes:

```javascript
const INSTRUCTIONAL_PATTERNS = [
  /start with:/i,
  /open with:/i,
  /say:/i,
  /use exactly/i,
  /verbatim/i,
  /first line:/i,
  /begin with:/i
];

function lintStylePattern(pattern) {
  const text = JSON.stringify(pattern);
  for (const regex of INSTRUCTIONAL_PATTERNS) {
    if (regex.test(text)) {
      return { valid: false, reason: `Contains instructional pattern: ${regex}` };
    }
  }
  return { valid: true };
}
```

**Not flagged (legitimate):** `"avoid phrases like 'shocking'"` - quoting what to avoid
**Flagged (problematic):** `"Start with: 'The real story is...'"` - literal starter

### Guardrail 3: Stable content_id Per Pipeline

| Pipeline | Primary ID | Composite Fallback |
|----------|-----------|-------------------|
| **EOs** | `id` (DB primary key) | `eo_number:signing_date` |
| **Stories** | `id` (DB primary key) | `hash(sorted article_ids)` → `cluster_id` → `hash(headline)` (last resort) |
| **SCOTUS** | `id` (DB primary key) | `docket_number:term` |
| **Pardons** | `id` (DB primary key) | `pardonee_name:pardon_date` |

**Stories-specific:** `hash(primary_headline)` is unstable (clustering can tweak wording). Use `hash(sorted article_ids)` as fallback - articles in a cluster don't change.

```javascript
function getStoryContentId(story) {
  if (story.id) return `story:${story.id}`;
  if (story.article_ids?.length) {
    const sorted = [...story.article_ids].sort((a, b) => a - b);
    return `story:articles:${fnv1a32(sorted.join(','))}`;
  }
  if (story.cluster_id) return `story:cluster:${story.cluster_id}`;
  console.warn('Using unstable headline hash for story content_id');
  return `story:headline:${fnv1a32(story.primary_headline)}`;
}
```

### Guardrail 4: Post-Gen Validation + Surgical Repair

Prompt-only bans won't hold forever. Enforce post-generation:

```javascript
const SECTION_BANS = {
  section_what_it_means: ['Beneath the surface', "What they don't say", 'The real story is'],
  section_reality_check: ['The truth is', "Let's be clear", "Here's the reality"],
  section_why_it_matters: ["The stakes couldn't be higher", 'This sets the stage']
};

const REPAIR_TEMPLATES = [
  'In practice,',
  'Put plainly,',
  'Net effect:',
  'Bottom line:',
  'Practically speaking,',
  'The upshot:'
];

function repairBannedStarter(section, content, bannedPhrase) {
  const phraseEnd = content.toLowerCase().indexOf(bannedPhrase.toLowerCase()) + bannedPhrase.length;
  let remainder = content.slice(phraseEnd).replace(/^[,\s]+/, '');

  const templateIdx = fnv1a32(section) % REPAIR_TEMPLATES.length;
  const template = REPAIR_TEMPLATES[templateIdx];

  const repaired = `${template} ${remainder.charAt(0).toLowerCase()}${remainder.slice(1)}`;

  if (repaired.length < 20 || startsWithBanned(repaired)) {
    return { success: false, content: null };
  }
  return { success: true, content: repaired };
}
```

**Flow:**
1. Detect banned starter
2. Attempt surgical repair with template rotation
3. If repair fails → micro-regenerate first sentence only (~$0.001)
4. Log violation for frequency tracking

### Guardrail 5: No N+1 on Feed Registry (Stories)

For Phase 2 Stories, fetch `feed_registry.topics` and `feed_registry.tier` without N+1:

```javascript
// At batch start, load all feed metadata once
const feedMap = await loadFeedRegistry(); // { feed_id: { topics, tier } }

// In enrichment loop - O(1) lookup
const feedMeta = feedMap[article.feed_id] || { topics: ['general'], tier: 2 };
```

**Constraint:** Only fetch `topics` and `tier` (and maybe `feed_id`). Don't expand into a giant payload.

---

## Intensity Word Blacklist

Apply to style pattern strings only (not full prompts):

```javascript
const INTENSITY_WORDS = [
  'fury', 'furious', 'outrage', 'outrageous',
  'disaster', 'catastrophe', 'horrifying',
  'appalling', 'disgusting', 'terrifying'
];
```

These belong in tone calibration, not style patterns. Keep list short + obvious to avoid false positives.

---

## Frame Mismatch Fuse (All Pipelines)

Add to ALL content type prompts:

```
NOTE: The REQUIRED VARIATION provides a frame direction based on initial assessment.
If your determined alarm_level conflicts with this frame (e.g., you determine level 0-1
but received an "alarmed" frame), keep the style pattern structure but adjust
stance to match your actual alarm_level assessment.
```

This makes frame selection a "strong default" not a hard lock.

---

## Section-Specific Banned Openers

```
SECTION-SPECIFIC BANNED PHRASE STARTS:
- section_what_it_means: "Beneath the surface", "What they don't say", "The real story is", "Here's what's really going on", "Dig deeper and"
- section_reality_check: "The truth is", "Let's be clear", "Here's the reality"
- section_why_it_matters: "The stakes couldn't be higher", "This sets the stage"
```

**Enforcement:**
- Normalize quotes/punctuation/case before checking
- Log counts to detect new repeated starters over time
- Post-gen validation + repair (Guardrail 4)

---

## Implementation Phases

### Phase 1: Executive Orders (ADO-273)

**Files to modify:**

| File | Changes |
|------|---------|
| `scripts/executive-orders-tracker-supabase.js` | Store FR abstract in `description` field |
| `scripts/enrichment/eo-style-patterns.js` | NEW: frame buckets + approach-only patterns + deterministic selection |
| `scripts/enrichment/prompts.js` | Fix `buildEOPayload()`, add REQUIRED VARIATION block, summary openers, section bans, mismatch fuse |
| `scripts/enrichment/enrich-executive-orders.js` | Wire seed construction, track recent IDs in batch, add post-gen validation |

**New exports from eo-style-patterns.js:**
```javascript
export function estimateFrame(title, description, category)
export function selectVariation(poolKey, seed, recentIds)
export function buildVariationInjection(variation)
export const EO_STYLE_PATTERNS = { ... }
```

**Prompt version:** `v4-ado273`

**Acceptance criteria:**
- [ ] No repeated `variation.id` within batch
- [ ] Same EO + prompt_version = same variation (deterministic)
- [ ] 0 banned phrase starts in specified sections (sample of 30)
- [ ] Top summary opener < 25% of sample
- [ ] Frame distribution: mostly `critical`, some `alarmed`, rare `grudging_credit`
- [ ] Style pattern lint passes (no instructional patterns)
- [ ] Post-gen validation catches and repairs any banned starters

**Estimated effort:** 1 session

---

### Phase 2: Stories (ADO-274)

**Files to modify:**

| File | Changes |
|------|---------|
| `scripts/enrichment/stories-style-patterns.js` | NEW: frame buckets + approach-only patterns |
| `scripts/enrichment/prompts.js` | Update SYSTEM_PROMPT with frame system |
| `scripts/enrichment/enrich-stories-inline.js` | Fix broken code, add frame estimation, deterministic selection, feed prefetch |

**Story-specific approach:**

**poolKey = `feedTopic_frame`** (9 pools only)
- Tier influences `estimateStoryFrame()` as a nudge, NOT as a pool dimension
- This prevents pool fragmentation (27 pools would be too many)

**Pre-enrich signals (no dependency on post-enrich category):**
- `primary_headline` (from clustering)
- `feed_registry.topics` (via article → feed_id join)
- `feed_registry.tier` (via same join)

**Feed topic mapping (coarse):**

| feed_registry.topics includes | Maps to |
|------------------------------|---------|
| `investigations` | `investigations` (higher scrutiny) |
| `policy` | `policy` (analysis-focused) |
| anything else | `general` (standard coverage) |

**Pool structure:**
```
investigations_alarmed, investigations_critical, investigations_grudging_credit
policy_alarmed, policy_critical, policy_grudging_credit
general_alarmed, general_critical, general_grudging_credit
```

9 pools × ~5 patterns (from shared core + Stories-specific) = ~45 total

**Frame estimation:**
```javascript
function estimateStoryFrame(headline, tier) {
  const text = headline.toLowerCase();

  // ALARMED: Strong crisis signals
  if (/insurrection|coup|fascis|authoritarian|martial law/.test(text)) {
    return 'alarmed';
  }

  // GRUDGING_CREDIT: Explicit good news (rare)
  if (/victory|win|court rules against|blocked|stopped|defeated/.test(text)) {
    return 'grudging_credit';
  }

  // Tier 1 sources (breaking news) + crisis language bias toward alarmed
  if (tier === 1 && /breaking|urgent|emergency/.test(text)) {
    return 'alarmed';
  }

  // Tier 3 sources bias toward critical (less reliable = more skeptical)
  // But don't override explicit signals above

  return 'critical'; // Default
}
```

**Prompt version:** Update SYSTEM_PROMPT version marker

**Estimated effort:** 1 session

---

### Phase 3: SCOTUS (ADO-275)

**Files to modify:**

| File | Changes |
|------|---------|
| `scripts/enrichment/scotus-style-patterns.js` | NEW: frame buckets (can use actual level since known pre-enrich) |
| `scripts/enrichment/scotus-gpt-prompt.js` | Add frame system, mismatch fuse |

**SCOTUS-specific considerations:**
- `ruling_impact_level` is known BEFORE enrichment (from case metadata)
- Can map level directly to frame: 4-5 → alarmed, 2-3 → critical, 0-1 → grudging_credit
- Keep special issue pools (`voting_rights`, `agency_power`) as overrides
- Frontend doesn't exist yet - lower priority

**Pool structure:**
```
Level-based:
  scotus_alarmed, scotus_critical, scotus_grudging_credit

Issue-based (override):
  voting_rights_alarmed, voting_rights_critical  (no grudging_credit - VRA cases are never good news)
  agency_power_alarmed, agency_power_critical    (no grudging_credit - Chevron gutting is never good)
```

~7 pools × ~8 patterns = ~56 total

**Estimated effort:** 0.5 session

---

### Phase 4: Pardons (ADO-276)

**Files to modify:**

| File | Changes |
|------|---------|
| `scripts/enrichment/pardons-style-patterns.js` | Simplify to 2 frames (alarmed/critical only) + grudging_credit for low-end |
| `scripts/enrichment/pardons-gpt-prompt.js` | Add frame system |

**Pardons-specific considerations:**
- Pardons are inherently negative (tracking corrupt pardons)
- Use `grudging_credit` (not "positive") for level 0-1 cases
- Without low-end stance, level 0-1 cases get framed like level-3 grift (dishonest)

**Frame mapping:**
| Frame | Corruption Levels | Connection Types |
|-------|------------------|------------------|
| `alarmed` | 4-5 | donor, inner_circle, insurrection |
| `critical` | 2-3 | political, celebrity |
| `grudging_credit` | 0-1 | legitimate, mercy |

**Pool structure:**
```
donor_alarmed, donor_critical
inner_circle_alarmed, inner_circle_critical
insurrection_alarmed
political_critical
celebrity_critical
legitimate_grudging_credit
mercy_grudging_credit
```

~8 pools × ~6 patterns = ~48 total

**Estimated effort:** 0.5 session

---

## Testing Strategy

### Per-Phase Testing

1. **Unit test frame estimation** - Known titles → expected frames
2. **Unit test deterministic selection** - Same seed → same variation
3. **Unit test style pattern lint** - Flag instructional patterns, pass legitimate ones
4. **Integration test** - Enrich 10 items, verify no repeated variation IDs
5. **Post-gen validation test** - Verify banned starters caught and repaired
6. **Output sampling** - Enrich 30 items, manually review for:
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
| Style patterns still too similar | Review output, add more diverse patterns from shared core |
| Breaks existing enriched content | Prompt version change only affects new enrichment |
| Banned starters slip through | Post-gen validation catches and repairs |
| Pool fragmentation | Tier as nudge not dimension; shared core prevents duplication |

---

## Success Metrics

After full rollout:

| Metric | Target |
|--------|--------|
| Opener variety (unique first 50 chars) | >70% unique across 30 samples |
| Summary opener variety | Top opener < 25% |
| Banned phrase violations (post-repair) | 0 |
| Frame distribution | ~60% critical, ~30% alarmed, ~10% grudging_credit |
| Style pattern lint | 100% pass |
| User feedback on "sameness" | Reduced complaints |

---

## Summary: Content Type Comparison

| Aspect | EOs | Stories | SCOTUS | Pardons |
|--------|-----|---------|--------|---------|
| **Category pools** | 3 (miller/donor/default) | 3 (investigations/policy/general) | 2 special + level-based | type-based |
| **Frame buckets** | 3 | 3 | 3 + special overrides | 3 |
| **Input for frame** | title + abstract + category | headline + tier (nudge) | level (known!) + issue_area | corruption_level + connection_type |
| **Total pools** | 9 | 9 | ~7 | ~8 |
| **Patterns per pool** | ~5-6 | ~5 | ~8 | ~6 |
| **Priority** | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
| **Effort** | 1 session | 1 session | 0.5 session | 0.5 session |

---

## References

- ADO-273: https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/273
- ADO-274: https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/274
- ADO-275: https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/275
- ADO-276: https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/276
- Investigation handoff: `docs/handoffs/2026-01-19-ado-273-tone-variation-investigation.md`
- Parent plan: `docs/features/labels-tones-alignment/plan.md`
- EO pipeline fix (ADO-271): `docs/features/labels-tones-alignment/eo-pipeline-fix-plan.md`

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-19 | Initial plan created from investigation + design discussion |
| 2026-01-19 | Added detailed content-type specifications for all 4 types |
| 2026-01-20 | **Major revision:** Incorporated team feedback |
| | - Renamed "device cards" to "style patterns" |
| | - Changed frame vocabulary: `cautious_positive` → `grudging_credit` (all types) |
| | - Added 5 must-have guardrails section |
| | - Stories: pre-enrich signals only, tier as nudge not dimension |
| | - Style patterns: 20 shared core + 10-15/type (not 50/type) |
| | - Added style pattern lint for instructional patterns |
| | - Added post-gen validation with surgical repair |
| | - Added stable content_id ladder per pipeline |
| | - Called out broken Stories code as smoking gun |
