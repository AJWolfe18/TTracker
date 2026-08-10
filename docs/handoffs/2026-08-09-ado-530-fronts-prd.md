# Handoff: ADO-530 Fronts PRD (design session, part 2)

**Date:** 2026-08-09
**Ticket:** ADO-530 — moved **Active → Review**
**Session type:** Design + product spec. No production code touched.
**Continues:** `2026-08-09-ado-530-events-tracker-design.md` (part 1)

---

## What happened

Part 1 left the UI direction unresolved: Josh liked "concept 2 with some of concept 3's charts"
and separately said he still pictured a **timeline** none of the concepts delivered. This session
built that, iterated it twice on his feedback, settled the naming, and wrote the PRD.

## The UI arc (three attempts, worth knowing why)

1. **Month-bar strip** (`concept-4-hybrid-v1.html`) — aggregate volume per month. Josh: the
   timeline "isn't hitting home." Correct: it showed *how much* happened, never *what*.
2. **Lane timeline** (`concept-4-hybrid-v2.html`) — one row per front, dots on a true date
   axis, sized/coloured by alarm, filter chips, fullscreen overlay with labels. Shows
   eruption-clustering beautifully (the July '26 Epstein pile-up is visible at a glance) but
   nothing is labeled without hovering. Josh then sent two references — the apptio Nintendo
   releases chart and a Guardian live-blog strip — both **evenly spaced with every entry
   labeled**.
3. **Guardian/Nintendo scroller** (`concept-4-hybrid.html`) — **APPROVED**. Evenly spaced
   entries, dot on a dotted line, date + headline + front + alarm printed for every one,
   alternating above/below, arrows at both ends, month/year markers on the line, opens parked
   at today and scrolls left into history. Fullscreen breaks the same strip into stacked rows
   of six so the whole term is on one page.

**The trade, stated plainly:** even spacing throws away the shape of the data (you can no longer
see clustering) and buys readability (you never hover to learn anything). Josh chose readable.
v2 is preserved and is the shape to steal from if clustering ever matters more than labels —
the untried middle path is proportional spacing with labels on alarm 4-5 only.

## Naming

Explored saga → files → fronts. **Fronts** is where Josh landed ("may need a bit more thought").

- **Scandals** was cut: it fails on Iran (a war, not a scandal), the Courts and the debt, and
  it collides with the existing `corruption_scandals` category value.
- **Files** was the runner-up and wins every repeated micro-label ("Open files", "Follow this
  file"); **Fronts** wins the tagline outright ("He floods the zone. We hold nine fronts.").
- Josh's sharp question — *"the site is TrumpyTracker, what do we track?"* — exposed that no
  container word completes that sentence well. Resolution: the site tracks **him**; the
  container word is the filing system, not the subject. Both can be said.
- Schema deliberately stays neutral (`events` / `event_updates` / `story_event`) so a rename
  costs nothing. Josh explicitly agreed schema needn't match the public word.
- Known wrinkle: "Flagship front" reads as two metaphors arguing. Tier labels may need to
  become Primary / Active / Watch. Open question #1.

## The PRD

`docs/features/events-tracker/prd.md` — canonical. Commits 8b1e7c8 → d7465fe → 1489be4.

Structure: problem · what a front is (rubric + reference cases) · scope · **goals & KPIs** ·
experience · data model + **controlled vocabularies** · **measurement** · **copy reference** ·
pipeline · cost · rollout waves · open questions · AC verification.

### Decisions worth not relitigating

- **Fronts aggregate stories.** Articles are never linked to fronts — a front reaches sources
  through its stories. This is what makes the `articles.id` TEXT vs BIGINT mismatch that killed
  Schema v1 structurally impossible rather than merely fixed.
- **Nothing derived is stored.** `v_event_stats` computes counts, last activity, peak alarm.
- **One front per story**, enforced as a PK on `story_event.story_id`, mirroring `article_story`.
  Proposed, not ratified — open question #2, and the one that should be answered first.
- **One-shots are not fronts.** A story with no `story_event` row is a *loose end* and renders
  from `stories`. One representation rule, which is what kills rejected-issue #7.
- **Two front shapes** drive the drafter: chain fronts (Epstein) get one update per distinct
  beat; recurring fronts (ICE raids) need one periodic update aggregating near-identical
  occurrences, or the approval queue floods.

### Two fields exist purely because the KPIs demanded them

Writing the metrics exposed that the model couldn't measure itself. `event_updates.was_edited`
makes draft quality measurable; `story_event.reassigned_from_event_id` makes agent assignment
precision measurable. Free now, a migration later.

## Gotcha discovered (already in memory, repeated here)

`TTShared.trackEvent` in `public/shared.js` enforces a hard `ALLOWED_PARAMS` allowlist — any
param not on the list is **silently dropped**. The event still fires, minus the dimension, and
it looks like it works. Analytics are also disabled on TEST/localhost (console only), so
instrumentation can only be *confirmed* after a PROD deploy. The front events in §7.2 are
deliberately designed to need zero allowlist changes; adding `alarm_level` + `tier` is
recommended in Wave 1 (with a `schema_v` bump) or engagement can never be segmented by severity.

## State

ADO-530 → **Review**. All three AC verified MET with evidence in the ticket comment. ICE was
named in AC1 and was missing from the doc — caught during verification, added in 1489be4.

Mockups remain **uncommitted** — `.superpowers/` is gitignored, as in part 1.

## Next session

1. Josh answers the **6 open questions** in §12. Question 2 (one front per story) gates any
   migration work.
2. Break the three waves into ADO stories under an epic.
3. Wave 1 is the shape: migrations, admin registry, manual assignment, public timeline +
   fullscreen, front pages, GA4 instrumentation + the allowlist change. No agents yet.

Also still open from earlier sessions, unrelated: ADO-539 needs Josh's EXPLAIN ANALYZE + 24h
PROD verify before closing; ADO-531 backfill plan is approved and ready to execute.
