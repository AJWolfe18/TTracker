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

**Status:** ✅ CODE COMPLETE | ⛔ VALIDATION BLOCKED (schema cache)

**Blocker (2026-01-20):**
- Supabase JS client can't find `alarm_level` column (schema cache stale)
- Column exists in DB (verified via SQL and MCP PATCH)
- Tried `NOTIFY pgrst, 'reload schema';` - didn't help
- **Fix:** Pause/resume TEST project in Supabase dashboard to restart PostgREST

**Files created/modified:**

| File | Changes | Status |
|------|---------|--------|
| `scripts/shared/style-patterns-core.js` | NEW: 21 universal patterns + FNV-1a hash | ✅ Done |
| `scripts/shared/style-patterns-lint.js` | NEW: Instructional pattern checker | ✅ Done |
| `scripts/enrichment/eo-style-patterns.js` | NEW: Frame estimation + deterministic selection | ✅ Done |
| `scripts/executive-orders-tracker-supabase.js` | Store FR abstract in `description` field | ✅ Done |
| `scripts/enrichment/prompts.js` | Fix `buildEOPayload()`, add section bans | ✅ Done |
| `scripts/enrichment/enrich-executive-orders.js` | Wire frame-based variation system | ✅ Done |

**Files to promote to main (after validation):**
```
scripts/shared/style-patterns-core.js      (NEW)
scripts/shared/style-patterns-lint.js      (NEW)
scripts/enrichment/eo-style-patterns.js    (NEW)
scripts/executive-orders-tracker-supabase.js
scripts/enrichment/prompts.js
scripts/enrichment/enrich-executive-orders.js
```

**Commits:**
- `0bdc462` - feat(ado-273): implement frame-based EO tone variation system
- `764434e` - fix(ado-273): address code review findings

**Code Review Findings (2026-01-19):**
| Issue | Severity | Status |
|-------|----------|--------|
| FNV-1a hash bit-width handling | Critical | ✅ Fixed |
| Input validation in selectVariation | Important | ✅ Fixed |
| Empty input warning in estimateFrame | Important | ✅ Fixed |
| Repair logic checking all sections | Important | ✅ Fixed |
| Pattern linter false positives | Low | WAI (different regex) |
| Pool size imbalance for grudging_credit | Low | WAI (rare frame) |
| Description field migration | Low | WAI (field exists) |

**Prompt version:** `v4-ado273`

**Acceptance criteria:**
- [x] Style pattern lint passes (no instructional patterns) - Verified
- [x] Same EO + prompt_version = same variation (deterministic) - Verified via hash
- [ ] No repeated `variation.id` within batch - **Needs validation test**
- [ ] 0 banned phrase starts in specified sections (sample of 30) - **Needs validation test**
- [ ] Top summary opener < 25% of sample - **Needs validation test**
- [ ] Frame distribution: mostly `critical`, some `alarmed`, rare `grudging_credit` - **Needs validation test**
- [ ] Post-gen validation catches and repairs any banned starters - **Needs validation test**

**Remaining work for this card:**
1. Re-enrich 30-50 EOs with v4-ado273: `node scripts/enrichment/enrich-executive-orders.js 30`
2. Review output for variety (check openers, frames, banned phrases)
3. If validation passes → ready for PROD promotion

**Estimated effort:** 1 session (code) + 0.5 session (validation)

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

### Phase 3: SCOTUS Tone + Variation System (ADO-275)

**Updated:** 2026-01-25 (ADO-300 integration added)

#### Goal

Replace `scotus-variation-pools.js` (literal text + Math.random) with the Stories-style pattern system:
- **Approach-only** style patterns (no literal "say this line" openers)
- **Deterministic** pattern selection (FNV-1a hashing)
- **REQUIRED VARIATION** prompt block (must-follow)
- **Post-gen validation + repair/reroll** to prevent opener repetition within a run

**Reference implementation:** Stories (ADO-274) - `scripts/enrichment/stories-style-patterns.js`

---

#### Files to Modify / Add

| File | Action | Notes |
|------|--------|-------|
| `scripts/enrichment/scotus-style-patterns.js` | **NEW** | Main implementation |
| `scripts/enrichment/scotus-gpt-prompt.js` | Update | Add REQUIRED VARIATION block, mismatch fuse |
| `scripts/enrichment/scotus-variation-pools.js` | Deprecate | Leave for history, no longer imported |

**References:**
- `scripts/enrichment/stories-style-patterns.js` (primary scaffold)
- `scripts/enrichment/eo-style-patterns.js` (secondary reference)
- `scripts/shared/style-patterns-core.js` (shared patterns + FNV-1a hash)

---

#### Integration with ADO-300 (Clamp + Constraints)

ADO-275 must **read** ADO-300 runtime fields but must not alter clamp/drift logic.

**Relevant ADO-300 fields:**
| Field | Type | Purpose |
|-------|------|---------|
| `clamp_reason` | DB | `cert_no_merits`, `procedural_no_merits`, `missing_text` |
| `_sidestepping_forbidden` | Runtime | Prevents forbidden label selection |
| `label_policy` / constraint block | Runtime | Editorial constraints |
| `publish_override` | DB | Manual override for publishing |

**Procedural Frame Bucket (NEW):**
- Frame name: `procedural`
- Used ONLY when `clamp_reason in ('cert_no_merits', 'procedural_no_merits')`
- Voice: "no merits decision, procedural posture, lower court stands / no ruling on substance"
- Clamped cases must NOT sound like substantive wins/losses

---

#### Frame Selection Priority Order

Frame selection must be deterministic and follow this priority:

```
1. CLAMP REASON OVERRIDE (highest priority)
   If clamp_reason in ('cert_no_merits', 'procedural_no_merits') → frame = 'procedural'

2. SPECIAL ISSUE POOLS
   If issue_area in ('voting_rights', 'agency_power') → use dedicated issue pool
   (unless clamped procedural, which always wins)

3. LEVEL → FRAME MAPPING (default)
   ruling_impact_level 4-5 → 'alarmed'
   ruling_impact_level 2-3 → 'critical'
   ruling_impact_level 0-1 → 'grudging_credit'
```

---

#### Pool Structure (Updated)

~7 pools × ~8 patterns = ~56 total

```
Frame-based (default):
  alarmed
  critical
  grudging_credit
  procedural          (NEW - for clamped cases)

Issue-based (override, unless clamped):
  voting_rights       (no grudging_credit - VRA cases are never good news)
  agency_power        (no grudging_credit - Chevron gutting is never good)
```

Each pattern MUST be **approach-only**. No quoted openers. No "Lead with: 'exact sentence'".

---

#### Deterministic Pattern Selection

SCOTUS must stop using `Math.random()`. Use Stories' deterministic selection approach:

**Seed inputs:** `case_id:prompt_version:poolKey`
- `case_id` = stable database ID
- `prompt_version` = e.g., `v4-ado275`
- `poolKey` = frame bucket (encodes frame already)

**Algorithm:**
```javascript
const seed = `${caseId}:${promptVersion}:${poolKey}`;
const hashIdx = fnv1a32(seed);
const idx = hashIdx % pool.length;

// Collision step: walk through pool to find unused pattern
for (let step = 0; step < pool.length; step++) {
  if (!recentIds.includes(pool[idx].id)) return pool[idx];
  idx = (idx + 1) % pool.length;
}
```

**Goal:** Same case + same prompt version = same pattern. Small batches avoid collisions.

---

#### REQUIRED VARIATION Block (Prompt Update)

Replace current "suggestions" language with strict MUST/DO NOT block:

```
REQUIRED VARIATION (do not ignore)

FRAME: [frame_name] - [stance description]

STYLE PATTERN: [pattern_id]
- Opening approach: [approach description]
- Rhetorical device: [device description]
- Structure: [structure description]
- Closing approach: [closing description]

MUST follow this pattern's APPROACH and SPIRIT.
DO NOT copy any literal example lines or template phrases.
DO NOT reuse opener structures recently used in this batch.
MUST create a fresh opener unique to this case.

MISMATCH FUSE: If your determined ruling_impact_level conflicts with this frame,
keep the style pattern structure but adjust stance to match your actual assessment.
```

---

#### Post-Gen Validation Spec (NEW)

Add post-gen validation + repair for `summary_spicy` (mirror Stories approach).

**What to detect:**

A) **Banned "literal template" starters** - SCOTUS-specific `SECTION_BANS`:
```javascript
const SCOTUS_SECTION_BANS = {
  summary_spicy: [
    /^.{0,5}years? of precedent\.? gone/i,
    /^the game was rigged/i,
    /^this ruling sounds boring/i,
    /^history will remember this as/i,
    /^this is how the system is designed/i,
    /^leonard leo.?s wishlist/i,
    /^they.?re not even pretending/i
  ]
};
```

B) **Near-duplicate signature sentences** within batch:
- Extract first 2-3 sentences, normalize (lowercase, strip punctuation, `\d+` → `X`)
- Compare against recent batch outputs

**Repair strategy:**
- Attempt 1: Single reroll of Pass 2 with:
  - "Your opener was rejected for repetition. Write a new opener with a different structure."
  - Include rejected opener + avoid list for this batch
- Max rerolls: **1** (cost control)
- If repair fails: mark `needs_review=true`

---

#### SCOTUS-Specific Patterns (~15 patterns)

Add SCOTUS-specific patterns beyond core patterns. Examples (approach-only):

1. **Legitimacy framing** - Open with Court's credibility/legitimacy angle without stock catchphrases
2. **Downstream effect** - Lead with concrete downstream effect (rights, enforcement, access), pivot to who benefits
3. **What changed + who pays** - Short "what changed" statement, then one-sentence "who pays" sting
4. **Power center naming** - Name the power center (state, agency, corporate actor) and what Court just enabled
5. **Technical-but-not-boring** - Open with "this looks technical" framing without using "boring" template
6. **Dissent as prophecy** - Frame around what the dissent warned
7. **Precedent erosion** - Lead with specific precedent being weakened/overturned
8. **Vote fracture** - Open with the vote split and what it signals
9. **Emergency docket** - For shadow docket: emphasize procedural irregularity
10. **Standing dodge** - For dismissals: frame the avoidance itself as the story
11. **Cert denial impact** - For cert denials: what lower court ruling now stands
12. **Unanimous surprise** - For rare unanimous rulings: suspicious optimism framing
13. **Concurrence warning** - Flag concerning concurrence language
14. **Remedies gutted** - Focus on what remedies/recourse are now unavailable
15. **Agency handcuffs** - For admin law: what agencies can no longer do

Ensure patterns vary **structure**, not just adjectives.

---

#### Acceptance Criteria

1. **No literal-text patterns** in `scotus-style-patterns.js` (passes `style-patterns-lint.js`)
2. **Deterministic selection** replaces `Math.random()`
3. Within a 25-case run, **no exact duplicate signature sentence** across summaries
4. **Significant drop** in repeated openers like:
   - "This ruling sounds boring. That's the point."
   - "The game was rigged. Now it's official."
   - "X years of precedent. Gone."
5. **Clamped cases** use procedural frame bucket and do not sound like merits wins/losses
6. **Frame distribution** matches case characteristics (not uniform random)

---

#### Implementation Order

1. Create `scotus-style-patterns.js` using Stories as scaffold
2. Update `scotus-gpt-prompt.js` to:
   - Select frame via priority order (clamp → issue → level)
   - Inject REQUIRED VARIATION block (strict language)
3. Wire deterministic selection + pattern injection in `enrich-scotus.js`
4. Add post-gen validation + single reroll
5. Run validation batch (25 cases) and measure:
   - Duplicate signatures (target: 0)
   - Opener variety (target: >80% unique first sentences)
   - Frame distribution alignment

**Estimated effort:** 1 session (increased from 0.5 due to ADO-300 integration + post-gen validation)

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
| 2026-01-25 | **Phase 3 (SCOTUS) major update:** |
| | - Added ADO-300 integration spec (clamp_reason, procedural frame bucket) |
| | - Added frame selection priority order (clamp → issue → level) |
| | - Added post-gen validation spec with SCOTUS-specific banned patterns |
| | - Added 15 SCOTUS-specific pattern descriptions |
| | - Added deterministic selection requirements |
| | - Updated estimated effort: 0.5 → 1 session |
| | - Stories (ADO-274) designated as reference implementation |
