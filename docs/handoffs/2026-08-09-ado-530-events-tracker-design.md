# Handoff: ADO-530 Events Tracker Design Session (Part 1)

**Date:** 2026-08-09
**Ticket:** ADO-530 (Design narrative/thread tracking layer) — moved to **Active**
**Also created:** Epic **ADO-541** (Saga auto-proposal — deferred future wave, linked to 530)
**Session type:** Design/brainstorming — no production code touched
**Status:** MID-DESIGN. UI direction narrowed but NOT final. Pick up from "Next session" below.

---

## What this session was

Josh kicked off the ADO-530 design session — the narrative/events layer that turns clustered
stories into long-running, followable sagas ("the foundation of what TTracker should be").
This is Layer 3 of the clustering v2 architecture (see
`docs/features/clustering-quality/plan.md` Part 2) and the same feature as
`docs/features/events-tracker/design.md` (April doc, schema v1 rejected with 9 issues).

## Decisions made (all Josh-approved)

1. **MVP scope: flagship sagas first.** ~10-20 hand-curated big-ticket sagas (Epstein, Trump
   crypto, Qatar jet, Kushner, selling the White House/ballroom, Israel, Iran, the courts,
   the debt). One-shot events = later wave. The PLAN must still cover admin UI, public UI,
   and admin alerts as one cohesive design, launched in waves.
2. **Curation model (hybrid):** Josh owns the saga registry (creation is 100% manual in MVP).
   AI auto-assigns incoming stories to sagas (no approval — reversible link). AI drafts
   "meaningful updates" (N stories → one update) → **Discord alert → admin approval queue**
   (~2-5/day). Approvals are the only mandatory human step.
3. **New-saga auto-proposal: deferred → Epic ADO-541.** MVP shows unassigned stories in an
   admin pool; Josh spots forming storylines himself. The saga rubric (below) becomes the
   future auto-proposal prompt criteria; Josh's manual decisions during MVP are its gold set.
4. **Saga rubric (qualification):** sustained 2+ weeks · 3+ accumulating beats · alarm 3+
   stakes · unresolved arc · nameable in 3 words. Score 4-5 = saga; 2-3 = watchlist.
   **Tier** (Flagship/Major/Standard) is separate and purely editorial = display weight.
5. **Architecture A:** events = aggregation layer ABOVE stories. New `events` +
   `event_updates` tables; story→event junction; **articles stay attached to stories**
   (events derive sources through them); counters computed, never stored; events own only
   editorial content. This resolves rejected-schema issue #1 (ownership model) and #4
   (stale counters). Full 9-issue reconciliation still to be written into the spec.
6. **Alarm/labels: ONE saga voice on top.** No new numeric axis — alarm stays 0-5. Saga UI
   always displays one new unified label set regardless of which domain a beat came from;
   existing trackers keep their voices on their own pages. Draft labels (Josh has NOT
   final-approved wording): 5 = "Holy Fucking Shit", 4 = "Serious Fucking Problem",
   3 = "Genuine Damage", 2 = "Standard Sleaze", 1 = "Noise". Profanity 4-5 only per
   tone-system rules. Will become a new voice in `public/shared/tone-system.json`.
7. **Alerts scope: admin only** (Discord). End-user follow/email is future — but every saga
   gets a stable ID + its own updates feed from day one so email/RSS-per-saga bolts on later.
8. **Fresh homepage exploration** (approved April homepage mockup superseded; April detail-page
   editorial direction influenced concept 1 but detail page is also part of fresh exploration).

## UI exploration — where it landed (NOT final)

Six mockups built, all in `.superpowers/brainstorm/events-homepage-v2/`:
- `compare.html` — **START HERE**: single gallery page, live scaled previews, click to open
- Concept 1 "The Record" (case-file editorial) — homepage + Epstein detail
- Concept 2 "Sirens" (headline size = severity) — homepage + Epstein detail
- Concept 3 "Fault Lines" (seismograph monitoring) — homepage + Epstein detail

All use identical content (same sagas; Epstein detail with same 7 beats) for like-for-like
comparison. **Josh's read: "somewhere between 2 and 3 — the idea of 2 with sommme charts
of 3, but we'll see."** AND (late addition): **he still pictures a TIMELINE element** — a
chronological "here's the dumb shit he's done so far" view, which none of the current
concepts fully deliver.

## Next session — pick up here (don't re-plan)

1. Build ONE hybrid homepage mockup: **Sirens' typographic hierarchy as the base + Fault
   Lines' seismograph/activity charts + a chronological timeline element**. Same content as
   existing mockups. Add to compare.html for side-by-side with the originals.
2. Get Josh's approval on the hybrid (iterate live — he reacts fast).
3. Then: present full design in sections (product def, UI, data model resolving all 9
   rejected-schema issues, pipeline/agent design, admin flows, rollout waves), write the
   PRD/spec to `docs/features/events-tracker/`, commit, and break into ADO stories under an
   epic. ADO-530 AC = discovery doc + data model proposal + cost estimate — none written yet.

## Cost notes (stated to Josh)

- Saga-assignment agent: ~$1-3/month Sonnet at ~19 stories/day (piggybacks existing pattern)
- Auto-proposal epic (541): ~$1-2/month additional when built
- Discord alerts: free (existing webhook pattern)

## Gotchas / context for the next session

- Task/Agent subagent tools are DENIED in this repo — ADO writes go via REST + curl
  (see `.claude/skills/ado/SKILL.md` detail-mode shortcut; epic 541 was created that way).
  The PAT cannot create new ADO tags (TF401289) — omit tags on create.
- `events-feature-design` entity in memory-deep is the OLD parked state; the live entity is
  `events-tracker` in memory-project HOT.
- Superpowers brainstorming checklist is mid-flight: tasks 4-6 (present design sections,
  write spec, review gate → writing-plans) are pending for next session.
