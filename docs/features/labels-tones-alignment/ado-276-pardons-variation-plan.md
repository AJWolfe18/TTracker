# ADO-276: Pardons Variation Implementation Plan

**Created:** 2026-01-24
**Status:** Ready for Implementation
**Estimated Effort:** 0.5-1 session
**Depends on:** ADO-273 (EOs) ✅, ADO-274 (Stories) ✅

---

## Summary

Apply the frame bucket variation architecture (from ADO-273/274) to Pardons enrichment. This aligns the third content type with the deterministic, collision-aware variation system.

---

## Spec Decisions (Confirmed)

### 1. Three Frames (Not Two)

**Decision:** Keep `grudging_credit` for legitimate/mercy cases.

**Rationale:** Without a low-end stance, level 0-1 pardons would get "critical" framing, which is dishonest for cases that are genuinely defensible.

| Frame | When to Use |
|-------|-------------|
| `alarmed` | corruption_level 4-5 OR connection_type in (donor, inner_circle, insurrection) |
| `critical` | corruption_level 2-3 OR connection_type in (political, celebrity) |
| `grudging_credit` | corruption_level 0-1 AND connection_type in (legitimate, mercy) |

**Special case:** `insurrection` is ALWAYS `alarmed` regardless of level.

### 2. Pool Structure (8 Pools)

```
donor_alarmed
donor_critical
inner_circle_alarmed
inner_circle_critical
insurrection_alarmed          (no critical - always alarmed)
political_critical            (no alarmed - mid-tier)
celebrity_critical            (no alarmed - mid-tier)
legitimate_grudging_credit    (level 0-1 only)
mercy_grudging_credit         (level 0 only)
```

~8 pools × ~4-6 patterns = ~40 patterns total

### 3. Deterministic Selection

Use FNV-1a hash (same as 273/274):
```javascript
const seed = `pardon:${pardonId}:${poolKey}:${promptVersion}`;
const idx = fnv1a32(seed) % pool.length;
```

With collision detection when all patterns in pool are in `recentPatternIds`.

---

## Blockers (Must Fix Before Implementation)

### Blocker 1: Migration Required

**File:** `migrations/071_pardons_enrichment_meta.sql`

```sql
-- Migration 071: Add enrichment provenance to pardons
ALTER TABLE pardons
  ADD COLUMN IF NOT EXISTS enrichment_meta JSONB,
  ADD COLUMN IF NOT EXISTS prompt_version TEXT;

-- Optional index for prompt_version queries
-- CREATE INDEX IF NOT EXISTS idx_pardons_prompt_version ON pardons(prompt_version);
```

**Apply to TEST before implementation.**

### Blocker 2: Hard-Fail on Missing Inputs

If `corruption_level` or `connection_type` (now `primary_connection_type`) is NULL:
- Skip the record with loud log
- Do NOT silently default to "critical"
- In TEST mode, this should fail the run if it happens

### Blocker 3: Connection Type Normalization

Historical data may have variants:
- `inner-circle` → `inner_circle`
- `innercircle` → `inner_circle`
- etc.

Need `normalizeConnectionType()` function with explicit fallback logging.

---

## Files to Modify

### 1. `scripts/enrichment/pardons-variation-pools.js` (REWRITE)

**Current:** 226 lines, random selection, 7 type-based pools

**Changes:**
- Add `PARDON_FRAMES` enum
- Add `fnv1a32()` hash function
- Add `normalizeConnectionType()`
- Add `estimatePardonFrame({ corruption_level, connection_type })`
- Add `resolvePardonPool({ corruption_level, connection_type })`
- Replace `OPENING_PATTERNS` with `PARDON_POOLS` (8 frame+type pools)
- Replace `selectVariation()` with `selectPardonPattern({ pardonId, poolKey, promptVersion, recentPatternIds })`
- Return `{ pattern, meta: { collision, seed, idx } }`

**Pattern Structure:**
```javascript
{
  id: 'pardon-donor-alarmed-01',
  frame: 'alarmed',
  pool: 'donor_alarmed',
  device: 'receipt-first → who-paid → what-they-got',
  starter_options: ['The receipt is the point—', 'This one reads like a payment stub—', ...]
}
```

### 2. `scripts/enrichment/pardons-gpt-prompt.js` (MODIFY)

**Current:** 258 lines, uses shared tone system

**Changes:**
- Add `PARDONS_PROMPT_VERSION = 'v1-ado276'`
- Add `buildPardonMessages({ pardon, frame, pattern })` that includes:
  - REQUIRED VARIATION block (non-negotiable)
  - Starter options from pattern
  - BANNED STARTERS list
  - MISMATCH FUSE instruction
- Keep existing `validateEnrichmentResponse()`

**REQUIRED VARIATION block format:**
```
=== REQUIRED VARIATION (NON-NEGOTIABLE) ===
STYLE_PATTERN_ID: {pattern.id}
FRAME: {frame}
DEVICE: {pattern.device}

Start the FIRST sentence with EXACTLY one of these starters:
- {starter_option_1}
- {starter_option_2}
- {starter_option_3}

BANNED STARTERS (do not begin with these):
- Here's the thing
- Let's be clear
- Make no mistake
- The bottom line
- Beneath the surface

If you cannot comply, return JSON with {"summary_spicy":"ERROR: variation noncompliance"}.
```

**MISMATCH FUSE:**
```
=== MISMATCH FUSE ===
- Do NOT invent facts. Use ONLY the provided fields. If missing, say "unknown".
- Keep the tone implied by FRAME, but do not escalate beyond evidence.
- If the provided facts are mild, express criticism as institutional/ethical risk, not new allegations.
```

### 3. `scripts/enrichment/enrich-pardons.js` (MODIFY)

**Current:** 487 lines, class-based worker

**Changes:**
- Import new functions from updated variation pools
- Add TEST environment assertion (URL contains `wnrjrywpcadwutfykflu`)
- Add Supabase API ping preflight (URL+KEY mismatch = 401)
- In `enrichPardon()`:
  - Call `estimatePardonFrame()` - **hard-fail if returns null**
  - Call `resolvePardonPool()` - **hard-fail if returns null**
  - Call `selectPardonPattern()` with deterministic params
  - Log frame, pool, pattern.id, collision flag
  - Build messages with `buildPardonMessages()`
  - After GPT call, sanitize summary (ensure starts with allowed starter)
- In DB update, add:
  ```javascript
  enrichment_meta: {
    prompt_version: PARDONS_PROMPT_VERSION,
    frame,
    style_pattern_id: pattern.id,
    pool: poolKey,
    collision: meta.collision,
    model: 'gpt-4o-mini',
    seed: meta.seed,
    enriched_at: new Date().toISOString(),
    frame_reason: frameResult.reason,
    pool_reason: poolResult.reason,
  },
  prompt_version: PARDONS_PROMPT_VERSION,
  ```
- Add hard-fail gate at end: `if (ok !== limit) process.exit(1);`

---

## Implementation Sequence

1. **Create migration 071** → Apply to TEST
2. **Verify pardons table** has `enrichment_meta` and `prompt_version` columns
3. **Rewrite `pardons-variation-pools.js`** with new architecture
4. **Modify `pardons-gpt-prompt.js`** with REQUIRED VARIATION + mismatch fuse
5. **Modify `enrich-pardons.js`** with new wiring + provenance
6. **Test with 5 pardons** that have `corruption_level` and `primary_connection_type`
7. **Verify enrichment_meta** populated correctly
8. **Check pattern variation** across batch (no repeats unless collision flagged)

---

## Testing Checklist

### Preflight
- [ ] Migration 071 applied to TEST
- [ ] `enrichment_meta` column exists on pardons
- [ ] `prompt_version` column exists on pardons
- [ ] At least 5 pardons have non-NULL `corruption_level` and `primary_connection_type`

### Execution (5-item batch)
- [ ] Script logs `RUN_START` timestamp
- [ ] Each pardon logs: frame, pool, pattern.id, collision status
- [ ] No crashes on missing inputs (should skip with loud log)
- [ ] `Successful: 5` at end (or hard-fail if not)

### Verification
- [ ] All 5 pardons have `enrichment_meta` populated
- [ ] `prompt_version` = 'v1-ado276' for all 5
- [ ] No repeated pattern IDs unless collision flagged
- [ ] Summary openers match allowed starters from pattern
- [ ] Frame matches expected based on level + connection_type

### Quality
- [ ] Tone appropriate for frame (grudging_credit reads differently than alarmed)
- [ ] No banned starters in output
- [ ] Facts grounded in input data (no hallucinations)

---

## Rollout

1. **TEST validation** → Run 5-10 pardons, verify output quality
2. **Larger batch** → Run 20-30 pardons, check for repetition patterns
3. **Mark Ready for Prod** → After validation passes
4. **PROD deployment** → With ADO-273 and ADO-274 (all three together)

---

## Reference Code

Expert-provided implementation snippets are available in the session transcript from 2026-01-24. Key components:

- `fnv1a32()` - 32-bit FNV-1a hash
- `normalizeConnectionType()` - Handle variants
- `estimatePardonFrame()` - Frame selection logic
- `resolvePardonPool()` - Pool resolution logic
- `selectPardonPattern()` - Deterministic selection with collision detection
- `buildPardonMessages()` - REQUIRED VARIATION + mismatch fuse
- Full `PARDON_POOLS` object with 8 pools and ~30 patterns

---

## Related Documents

- Parent plan: `docs/features/labels-tones-alignment/tone-variation-fix-plan.md`
- EO implementation: ADO-273 (Ready for Prod)
- Stories implementation: ADO-274 (Ready for Prod)
- Expert feedback: Session transcript 2026-01-24

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-24 | Initial plan created from expert review session |
