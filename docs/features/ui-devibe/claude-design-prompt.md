# Claude Design — Tone-Down Prompt

**Purpose:** Iteration prompt for Claude Design when reviewing generated TrumpyTracker frontend variants that drift toward "vibe coded" alarm-tape colors and multi-color severity systems. Pulls the design back toward restraint, editorial voice, and no AI-aesthetic tells.

> **Note:** `plan.md` in this folder is from a prior iteration and is no longer authoritative. The new redesign direction supersedes it.

**When to use:** Paste into Claude Design after receiving a variant that leans too hard into red+black or multi-color severity badges. Adjust the "Keep" / "Change" sections per iteration.

**Last reviewed:** 2026-04-27

---

## Prompt (paste into Claude Design)

Add a toned-down theme variant for review.

The current Midnight/Riot direction leans too hard into red+black "alarm" aesthetic, and the multi-color severity system (red / yellow / orange / blue / green badges + colored card border-strips) reads as chaotic rather than urgent. The editorial typography and layout are working — leave those alone.

### Keep
- Dark/black background as a valid mode (Midnight structurally fine)
- Editorial serif headlines, all-caps section labels, the "VOL/ISSUE" newspaper voice
- Severity levels L0–L5 must remain visually distinguishable

### Change
- Dominant red → a more restrained accent (muted brick, oxblood, terracotta, desaturated rust — not hazard-tape red)
- Multi-color severity → **one accent hue family with intensity variation**, OR grayscale + single accent. Five saturated colors competing for attention is the issue.
- "LIVE FROM THE DUMPSTER FIRE" banner: keep the wit, drop the bright red
- Card left-border strips: same hue family across all categories, varying saturation/weight (not five different colors)

### Deliverables
1. **Two new theme variants** alongside the existing options:
   - "Muted Editorial" — think *NYT* / *The Atlantic* dark mode. Restrained, confident, dry.
   - "Restrained Alarm" — still conveys urgency but without screaming red. One muted accent doing all the work.
2. Render the homepage at **all five severity levels (L0–L5)** in each new variant so I can compare against Midnight side-by-side.
3. **Color/intensity pass only.** Don't change typography, layout, hierarchy, or copy.

### Anti-patterns — do NOT do these
- **No gradients.** Especially not blue-to-purple, teal-to-cyan, or any "tech sunset" gradient. Solid colors only.
- **No glow / neon / outer shadows on text or borders.** No CRT scanlines, no synthwave. Editorial, not arcade.
- **No glassmorphism** (translucent blurred panels). This is a newspaper, not a SaaS dashboard.
- **No generic dark-mode SaaS palette** — slate-900 background + cyan/violet accent is every Linear/Vercel clone on the internet. We're not that.
- **No pastels.** Toning down ≠ pastel. Muted and restrained ≠ soft and friendly. The tone is still adversarial, just dry instead of shouting.
- **No rounding things that are currently sharp.** Editorial cards stay rectangular. Don't go bubbly.
- **No replacing serif headlines with system sans** to feel "cleaner." The serif is doing essential work.
- **No emoji, no icons replacing text labels** — the all-caps text labels (LEVEL 5 · CRISIS, etc.) are deliberate.
- **No huge centered whitespace hero sections** ("modern minimal"). Density is part of the voice — this is a daily log, not a marketing page.
- **No accent color spam on hover/active states.** Whatever the new accent is, use it sparingly. Most hover states should be subtle (background tint, underline, weight shift).
- **Don't flatten hierarchy in the name of restraint.** L5 still needs to feel heavier than L0. Restraint means *fewer colors doing more work*, not *equal weight everywhere*.

**One-line gut check:** if it starts looking like a default Tailwind UI template, a Linear clone, or a crypto landing page, you've gone wrong.

---

## Context for Claude Code (not part of the prompt)

### What Josh is reviewing in Claude Design
Frontend variants for trumpytracker.com (homepage + story pages). Active design work is happening in Claude Design — Claude Code is not generating the visual designs. This prompt is a tool for steering those reviews when variants drift.

### Drift pattern observed (2026-04-27 screenshot)
- Bright red "LIVE FROM THE DUMPSTER FIRE" banner across the top
- Red ALARM 5 indicator with glow
- Multi-color severity badges (L0 green, L1 gray, L2 light, L3 yellow, L4 orange, L5 red)
- Multi-color card left-border strips (red, yellow, blue, gray) creating a screen-of-flags feel
- "Riot" theme option pushing the alarm aesthetic further

### Why this prompt exists
Claude Design tends to add intensity when given creative latitude — gradients, glows, multiple saturated accents. This prompt forces restraint without losing the editorial voice or severity differentiation that makes the product readable.
