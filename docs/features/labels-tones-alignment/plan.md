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

- **ADO-269 (Pardons)**: ✅ COMPLETE (Phase 1 + Phase 2)
- **ADO-270 (Stories)**: Not started. Shared module now available.
- **ADO-271 (EOs)**: Not started. Shared module now available.
- **ADO-272 (SCOTUS)**: Not started. Shared module now available.

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

**Next Action**: Execute ADO-270 (Stories) - create variation pools, wire to shared module
