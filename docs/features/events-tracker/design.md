# Events Tracker — Design Document

**Status:** In Progress — Schema v1 rejected, rework needed  
**Created:** 2026-04-01  
**Owner:** Josh  
**Replaces:** `docs/research/event-based-architecture-sketch.md` (commit 3b88965, deleted)

---

## Product Vision

Replace stories as the user-facing product. Stories remain the internal clustering engine (RSS → articles → stories), but **events** become what users see, browse, and share.

The core purpose: when someone says "Trump wasn't that bad," you point them here. A comprehensive, visual, categorized record of everything he's done — term 2 (2025+) only.

---

## Key Decisions (Locked)

### What is an event?
An event is a concrete thing Trump or his administration did. Signed an EO, pardoned criminals, gutted the EPA, raided a school. Some are one-time actions, some are ongoing sagas. Same data model for both.

### Two flavors, one model
- **Sagas** — Long-running, multiple updates over time (Epstein files, ICE raids, Jan 6 pardons). Accumulate updates.
- **One-shots** — Happened, done, here's the proof (signed an EO, said something insane). Date + summary + sources.

Both are rows in the same `events` table. Sagas just have more `event_updates`.

### Scope
- Trump term 2 only (2025 forward)
- Term 1 backfill is a future maybe, not a concern now
- Existing ~2700 stories are the right dataset to seed initial events

### Event creation
- **Primary:** AI-driven from RSS pipeline. Articles come in, AI identifies "this is a new event" or "this updates an existing event." Auto-suggests, human approves.
- **Secondary:** Manual creation for things RSS feeds miss.

### Event updates (within sagas)
- AI clusters incoming articles into **meaningful updates**, not one article per update
- "Epstein docs released" = ONE update backed by 50 articles as sources
- Same hybrid: AI suggests, human approves, manual override available

### Categories
- Categories describe the **type of damage**, not the topic
- Epstein is an EVENT, not a category. "Criminal Activity" and "Corruption" are categories tagged to it.
- Events can have **multiple category tags**
- Final category list TBD — needs to avoid sprawl regression (see schema feedback below)

### Alarm levels
- Same 0-5 system as current stories
- Carries over as-is, including tone labels ("Constitutional Dumpster Fire" etc.)
- Must define canonical mapping — not add another severity axis

### What happens to stories?
- Stories stay as the internal engine: RSS → articles → clustering → stories
- Stories become plumbing, events become the product
- Stories feed events (exact relationship TBD — see schema issues below)
- Enrichment on stories may be reduced/removed once events are the product layer

---

## Approved Visual Direction

### Homepage (main event list)
**Mockup:** `.superpowers/brainstorm/850-1775103266/content/homepage-events-v1.html`

- **Stat bar** at top — total events count, ongoing sagas, alarm 4-5 count
- **Tagline:** "He wasn't that bad — Yes, he was."
- **Horizontal timeline strip** (Guardian-inspired) — recent activity dots for scanning
- **Filterable event list** below:
  - Sagas: full card with ongoing tag, update count, excerpt, alarm badge
  - One-shots: compact row with title, category, alarm, date, source count
- **Filter bar:** search, category dropdown, alarm level pills, event type filter
- **Alarm badges** as visual anchor on left column (0-5, color-coded)

**Note:** Colors in mockup are placeholder — will use TrumpyTracker's actual color system.

### Event detail page (per-event timeline for sagas)
**Mockup:** `.superpowers/brainstorm/850-1775103266/content/event-timeline-v2.html`

- **Editorial design** — Playfair Display serif headlines, dark theme, grain texture
- **Vertical timeline** — newest at top, "where it started" anchor at bottom
- **Visual weight scales with significance** — major developments get emphasis, minor updates are compact
- **Each update** shows: date, headline, description, source count, linked documents
- **One-shots** get a simpler detail view — just summary + sources, no timeline needed

**Design direction:** Editorial/investigative journalism feel (ProPublica-inspired), NOT dashboard/SharePoint. Typography and space do the heavy lifting, not colored badges and boxes.

---

## Schema v1 — REJECTED

The initial schema proposal was reviewed and rejected. Below are the issues that must be fixed.

### Schema v1 that was proposed (for reference)
- `events` table with: id, title, slug, description, summary_spicy, summary_neutral, event_type, alarm_level, categories (TEXT[]), status, started_at, resolved_at, last_activity_at, source_count, update_count, is_public
- `event_updates` table with: id, event_id, title, description, significance, happened_at, source_count
- `event_articles` junction with: event_id, article_id, event_update_id (nullable)

### Issues to fix

**1. Dual source of truth with stories**
Events table overlaps heavily with stories (status, severity, source counts, summaries, category, lifecycle timestamps). Creates a second mutable truth alongside stories. Need an explicit ownership model: is events a projection of stories, a replacement, or an aggregation layer? Define which fields are canonical where.

**2. Slug doing identity work**
`slug TEXT UNIQUE` makes presentation text do identity work. Clustering already showed slug fragmentation is unreliable for stable attachment. Needs stable identity separate from the human-readable slug.

**3. Category regression**
The existing category system was consolidated to avoid sprawl and misclassification. The proposed list (12 categories) expands back into a broader, overlapping set. `corruption`, `criminal_activity`, `constitutional_violations`, and `institutional_damage` will collide constantly. `deaths_human_cost` reads more like an impact attribute than a category. Need a disciplined decision tree, not an expanded fuzzy list.

**4. Denormalized counters without sync rules**
`source_count` and `update_count` on events (and `source_count` on updates) are derived values stored as primary data. Will silently go stale when links are added, deleted, merged, or restored. Should be computed views or have explicit recomputation rules.

**5. Article junction problems**
- **Type mismatch:** Proposed `article_id` is BIGINT FK, but existing `articles.id` is TEXT. Doesn't line up.
- **Ambiguous ownership:** A row can point to event_id and optionally event_update_id, but no rules on whether article→update also implies article→event, whether both are allowed, or uniqueness constraints.
- **No PK or uniqueness constraints.** The RSS pipeline emphasizes idempotency and race safety — this junction lacks that rigor.

**6. Alarm level on top of existing drift**
Project already has drift between legacy severity labels (critical/high/medium/low), RSS story labels (critical/severe/moderate/minor), and numeric severity_level. Adding another 0-5 alarm score without canonical mapping creates permanent inconsistency.

**7. One-shot representation ambiguity**
"A one-shot might have zero or one update" means two valid ways to represent the same content (on the event row or as a single update). Queries, rendering, and content tools need one representation rule, not two.

**8. Publishing gate too thin**
`is_public BOOLEAN` is underspecified for an editorial product. Needs at least draft/review/published semantics, publish timestamp, and provenance about AI-generated content.

**9. event_updates too light**
No explicit ordering field beyond `happened_at`, no `updated_at`, no status. Ties, corrections, retroactive edits, and backfills will be awkward. `significance` is a free-text pseudo-enum without operational meaning.

---

## Next Steps

1. **Rework schema** — Fix all 9 issues above. Define canonical stories→events ownership model.
2. **Write formal spec** — Save to `docs/superpowers/specs/` and commit.
3. **Implementation plan** — Migration path, pipeline changes, edge functions, frontend.
4. **MVP build** — Homepage event list (Phase A), then per-event detail pages (Phase B).

---

## Reference

- **Old architecture sketch:** `git show 3b88965:docs/research/event-based-architecture-sketch.md`
- **Current database schema:** `docs/database/database-schema.md`
- **Visual mockups:** `.superpowers/brainstorm/850-1775103266/content/`
- **Memory entity:** `events-feature-design` in memory-project MCP
