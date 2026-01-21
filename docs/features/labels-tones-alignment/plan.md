# Labels/Tones Alignment Plan

## ADO Stories
- **ADO-269**: Pardons (includes shared module creation)
- **ADO-270**: Stories
- **ADO-271**: EOs
- **ADO-272**: SCOTUS Alignment

---

## Executive Summary

Four content types need consistent scales AND distinct editorial voices:
- **Pardons** - "The Transaction"
- **Stories** - "The Chaos"
- **EOs** - "The Power Grab"
- **SCOTUS** - "The Betrayal"

All use 0-5 numeric scale with DIFFERENT labels per content type.

---

## The Four Editorial Voices

Each content type has a distinct persona. This prevents "Generic Angry News" and gives each section its own flavor.

| Content | Voice | The Framing |
|---------|-------|-------------|
| **Pardons** | The Transaction | "This isn't mercy; it's a receipt for a donation." |
| **Stories** | The Chaos | "Look at this specific dumpster fire inside the larger dumpster fire." |
| **EOs** | The Power Grab | "The King's pen is moving. Here's who gets hurt and who gets rich." |
| **SCOTUS** | The Betrayal | "The people supposed to protect the law are lighting it on fire." |

---

## Labels by Content Type (ALL DIFFERENT)

| Level | Pardons | Stories | EOs | SCOTUS |
|-------|---------|---------|-----|--------|
| 5 | Pay 2 Win | Constitutional Dumpster Fire | Authoritarian Power Grab | Constitutional Crisis |
| 4 | Cronies-in-Chief | Criminal Bullshit | Weaponized Executive | Rubber-stamping Tyranny |
| 3 | The Party Favor | The Deep Swamp | Corporate Giveaway | Institutional Sabotage |
| 2 | The PR Stunt | The Great Gaslight | Smoke and Mirrors | Judicial Sidestepping |
| 1 | The Ego Discount | Accidental Sanity | Surprisingly Not Terrible | Crumbs from the Bench |
| 0 | Actual Mercy | A Broken Clock Moment | Actually Helpful | Democracy Wins |

---

## Shared Infrastructure

**Architecture:** JSON single source of truth + Node.js wrappers

```
public/shared/
└── tone-system.json      → Single source of truth (browser fetch + Node read)

scripts/shared/
├── severity-config.js    → Node wrapper with helper functions
├── banned-openings.js    → Node wrapper with checker function
└── profanity-rules.js    → Node wrapper with tone calibration
```

**How consumers use it:**
- **Browser (frontend):** `fetch('/shared/tone-system.json')` then use data directly
- **Node (backend scripts):** `import { getSeverityDisplay } from './scripts/shared/severity-config.js'`

### Color Scheme (Unified)
```javascript
const SEVERITY_COLORS = {
  5: { bg: "#fee2e2", text: "#7f1d1d", border: "#dc2626", emoji: "🔴" }, // red
  4: { bg: "#fed7aa", text: "#7c2d12", border: "#ea580c", emoji: "🟠" }, // orange
  3: { bg: "#fef3c7", text: "#713f12", border: "#f59e0b", emoji: "🟡" }, // yellow
  2: { bg: "#dbeafe", text: "#1e3a8a", border: "#3b82f6", emoji: "🔵" }, // blue
  1: { bg: "#cffafe", text: "#155e75", border: "#06b6d4", emoji: "⚪" }, // cyan
  0: { bg: "#d1fae5", text: "#064e3b", border: "#10b981", emoji: "🟢" }  // green
};
```

### Profanity Rules (Unified)
```javascript
const PROFANITY_ALLOWED = {
  5: true,   // Full spice - constitutional crisis / corruption
  4: true,   // Allowed - criminal / crony / tyranny
  3: false,  // Sardonic, no swearing
  2: false,  // Measured critique
  1: false,  // Cautious/surprised
  0: false   // Positive acknowledgment
};
```

**Note:** SCOTUS now included in profanity rules. A SCOTUS ruling affects 330M people permanently - deserves same intensity as other content types.

### Banned Openings (Master List)
```javascript
const BANNED_OPENINGS = [
  "This is outrageous...",
  "In a shocking move...",
  "Once again...",
  "It's no surprise...",
  "Make no mistake...",
  "Let that sink in...",
  "Guess what?",
  "So, ",  // as opener
  "Well, ", // as opener
  "Look, ", // as opener
  "In a stunning...",
  "In a brazen...",
  "Shocking absolutely no one...",
  "In the latest move...",
  "It remains to be seen...",
  "Crucially...",
];
```

---

## Tone Calibration by Level

### Level 5: Alarm Bells
- Profanity: YES
- Energy: Cold fury, prosecutorial
- Profanity style: Use for INCREDULITY not just anger
- Example: "They actually fucking did it. They ended [X] rights."

### Level 4: Angry Accountability
- Profanity: YES
- Energy: Suspicious, pointed, name names
- Focus on victims and who benefits

### Level 3: Sardonic Critique
- Profanity: NO
- Energy: Weary, "seen this before"
- Dark humor, let absurdity speak

### Level 2: Eye-Roll
- Profanity: NO
- Energy: "Lazy employees energy"
- Measured critique of system

### Level 1: Cautious Skepticism
- Profanity: NO
- Energy: Credit where due, but flag the asterisk
- "You won. Now read the limiting language."

### Level 0: Suspicious Celebration
- Profanity: NO
- Energy: Disbelief that system worked
- Examples for variation pools:
  - "Don't get used to it, but the system actually worked."
  - "The swamp accidentally drained an inch today."
  - "We checked the math twice—this is actually... good news?"

---

## Variability Status & Requirements

| Content | Has Variation Pools? | Status |
|---------|---------------------|--------|
| **Pardons** | ✅ Yes | `pardons-variation-pools.js` - 6 pools |
| **SCOTUS** | ✅ Yes | `scotus-variation-pools.js` - 8 pools |
| **Stories** | ❌ NO | NEEDS: `stories-variation-pools.js` |
| **EOs** | ❌ NO | NEEDS: `eo-variation-pools.js` |

### Required Variation Pools for Stories
- Level-based pools (0-5) with "chaos" framing
- "Donor" pool for billionaire-backed stories
- Structure variability (Big Reveal vs Sarcastic Lead)

### Required Variation Pools for EOs
- Level-based pools (0-5) with "king's pen" framing
- "Miller" pool for nationalist/authoritarian orders
- "Donor" pool for corporate giveaway orders
- Structure variability

---

## Implementation Order

### ADO-269: Pardons (FIRST - includes shared module)

**Phase 1: Create Shared Module**
- `scripts/shared/severity-config.js`
- `scripts/shared/banned-openings.js`
- `scripts/shared/profanity-rules.js`

**Phase 2: Wire Up Pardons**
- Import shared config into `pardons-gpt-prompt.js`
- Import shared colors into `public/pardons-app.js`
- Update prompt with "The Transaction" voice framing
- Verify variation pools have Level 0 "suspicious celebration" tone
- Files already modified (uncommitted)

### ADO-270: Stories

**Phase 1: Create Variation Pools**
- Create `scripts/enrichment/stories-variation-pools.js`
- Level-based pools with "chaos" framing
- Add "Donor" pool for billionaire stories
- Add Level 0 "suspicious celebration" variations

**Phase 2: Update Stories Prompt**
- Add level-based tone calibration to `prompts.js` SYSTEM_PROMPT
- Add "The Chaos" voice framing
- Import banned openings from shared module

**Phase 3: Wire to Shared Module**
- Import severity config
- Update `public/app.js` with new labels/colors
- Update `enrich-stories-inline.js` to accept 0-5 numeric

### ADO-271: EOs

**Phase 1: Create Variation Pools**
- Create `scripts/enrichment/eo-variation-pools.js`
- Level-based pools with "king's pen" framing
- Add "Miller" pool for authoritarian orders
- Add "Donor" pool for corporate orders

**Phase 2: Update EO Prompt**
- Update `prompts.js` EO_ENRICHMENT_PROMPT with level-based tone
- Add "The Power Grab" voice framing
- Ensure variation injection in prompt builder

**Phase 3: Wire to Shared Module**
- Import severity config
- Update `public/eo-app.js` with new labels/colors
- Add severity field if not present

### ADO-272: SCOTUS Alignment

**Phase 1: Enable Profanity**
- Update `scotus-gpt-prompt.js` to allow profanity at Levels 4-5
- Already uses 0-5 scale ✓
- Already has variation pools ✓

**Phase 2: Add Betrayal Framing**
- Update SYSTEM_PROMPT with "The Betrayal" voice
- Strengthen "guardians becoming arsonists" framing
- Add Level 0 "suspicious celebration" to variation pools

**Phase 3: Wire to Shared Module**
- Import profanity rules from shared
- Import banned openings from shared
- Verify color scheme matches

---

## Verification Checklist

After all 4 stories complete:

- [ ] All 4 content types use 0-5 numeric scale
- [ ] All 4 have DIFFERENT labels
- [ ] All 4 have variation pools
- [ ] All 4 import from shared module
- [ ] Profanity only at Levels 4-5 (all types)
- [ ] Banned openings enforced (all types)
- [ ] Color scheme consistent (all types)
- [ ] Level 0 has "suspicious celebration" tone (all types)
- [ ] Each has distinct voice framing

---

## STATUS

- **ADO-269 (Pardons)**: ✅ COMPLETE - perplexity-research.js v1.5 supports 0-5 scale + string coercion
- **ADO-270 (Stories)**: ✅ COMPLETE - Pipeline wired, needs end-to-end test
- **ADO-271 (EOs)**: ⚠️ BLOCKED - Pipeline broken, see `eo-pipeline-fix-plan.md`
- **ADO-272 (SCOTUS)**: ✅ CLOSED - Phases 1-2 complete (profanity + betrayal voice). Phase 3 (shared module wiring) deferred to ADO-275
- **ADO-274 (Stories Variation Fix)**: ✅ COMPLETE - Frame-based deterministic variation system

### ADO-271 Pipeline Issue (Discovered 2026-01-18)

The EO enrichment code exists but **never runs**:
1. `executive-orders-tracker-supabase.js` has OLD inline AI that generates `summary` with old prompt
2. `enrich-executive-orders.js` has new tone system but NO workflow triggers it
3. New enrichment doesn't generate `summary` field (old tracker does)

**Fix Required:** See `eo-pipeline-fix-plan.md`
- Move `summary` generation from tracker to enrichment script
- Strip old AI from tracker (just import raw data)
- Add enrichment step to workflow OR create separate workflow

**Completed (Phase 1 - Revised):**
- `public/shared/tone-system.json` - Single source of truth for all content types
  - Colors (0-5), profanity rules, tone calibration, banned openings
  - Labels per content type (pardons/stories/eos/scotus) with voice + framing
- `scripts/shared/severity-config.js` - Node wrapper with getSeverityDisplay(), getEditorialVoice()
- `scripts/shared/banned-openings.js` - Node wrapper with checkForBannedOpening()
- `scripts/shared/profanity-rules.js` - Node wrapper with isProfanityAllowed(), getToneCalibration()

**Completed (Phase 2 - Pardons Wiring):**
- `scripts/enrichment/pardons-gpt-prompt.js` - Now imports from shared module
  - "The Transaction" voice framing added to SYSTEM_PROMPT
  - Banned openings injected from shared
  - Tone calibration per level injected from shared
- `scripts/enrichment/pardons-variation-pools.js` - Added Level 0 "mercy" pool (suspicious celebration)
- `public/pardons-app.js` - Now fetches labels from tone-system.json

**Completed (ADO-270 - Stories):**
- `migrations/064_add_alarm_level_to_stories.sql` - Numeric 0-5 field with backfill from legacy severity
- `scripts/enrichment/stories-variation-pools.js` - 4 pools (donor, state_power, democracy, default)
  - Category-based pool selection via getPoolKey()
  - Level-based opening patterns (0-5) in each pool
  - "The Chaos" voice framing
- `scripts/enrichment/prompts.js` SYSTEM_PROMPT - Tone calibration, variation injection, alarm_level output
- `scripts/enrichment/enrich-stories-inline.js` - Imports pools, builds injection, extracts alarm_level
- `public/app.js` - Fetches from tone-system.json, uses ALARM_LABELS/COLORS
- `public/themes.css` - CSS variables and rules for levels 0-1 (low, positive)

**Completed (ADO-271 - EOs):**
- `migrations/065_add_alarm_level_to_executive_orders.sql` - Numeric 0-5 field with backfill from legacy severity_rating
- `scripts/enrichment/eo-variation-pools.js` - 3 pools (miller, donor, default)
  - Category/impact_type-based pool selection via getPoolKey()
  - Level-based opening patterns (0-5) in each pool
  - "The Power Grab" voice framing
- `scripts/enrichment/prompts.js` EO_ENRICHMENT_PROMPT - Tone calibration, variation injection, alarm_level output
- `scripts/enrichment/enrich-executive-orders.js` - Imports pools, builds injection, writes alarm_level, derives severity_rating
- `public/eo-app.js` - Fetches from tone-system.json, uses getAlarmLevel() with legacy fallback

**Completed (ADO-272 - SCOTUS):**
- `scripts/enrichment/scotus-gpt-prompt.js` - "THE BETRAYAL" voice, profanity enabled at levels 4-5
- `scripts/enrichment/scotus-variation-pools.js` - Level 0 "suspicious celebration" variations added
- Note: scotus-app.js doesn't exist yet (tab shows "coming soon"), tone-system.json has SCOTUS labels ready

**Completed (ADO-274 - Stories Tone Variation Fix):**
- `scripts/enrichment/stories-style-patterns.js` - NEW: Frame-based variation system
  - 3 frame buckets: alarmed | critical | grudging_credit
  - 3 topic pools: investigations | policy | general (from feed_registry.topics)
  - 9 total pools (topic × frame)
  - 14 Stories-specific patterns + 21 core patterns = 35 total
  - Deterministic selection via FNV-1a hash (separate hashes for bias/index)
  - Negative context guard for "blocked aid" false positives
  - Post-gen banned-starter repair with fail-closed safety
  - Exported tuning knob: STORIES_SPECIFIC_BIAS_THRESHOLD
- `scripts/enrichment/enrich-stories-inline.js` - Updated for frame-based system
  - Feed registry cache with race-condition prevention
  - String-normalized Map keys for Supabase bigint compatibility
  - Frame estimation from headline + feed tier (pre-enrichment signals)
  - Deterministic variation selection with PROMPT_VERSION
  - Post-gen validation for banned starters in summary_spicy
- Old `stories-variation-pools.js` retained for reference (no longer imported)
- **Code review fixes (423fad6):**
  - Negative context patterns now allow 0-3 bridge words ("Trump blocked DOJ investigation" → critical)
  - `repairBannedStarter()` returns `reason` field for debugging
  - Improved logging with story_id, pattern_id, failure reason

**Next Action**: Fix ADO-271 EO pipeline per `eo-pipeline-fix-plan.md`, then test all pipelines end-to-end
