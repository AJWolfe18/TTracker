# Fronts — Product Requirements

**ADO:** 530 (design) · Epic 541 (auto-proposal, deferred)
**Status:** Draft for approval
**Created:** 2026-08-09
**Supersedes:** the schema half of `design.md` (Apr 2026). That doc's product vision still holds; its Schema v1 was rejected and is replaced here.
**Mockups:** `.superpowers/brainstorm/events-homepage-v2/compare.html` (concept 4 = approved direction)

---

## 1. The problem

Clustering joins articles into stories on a rolling 72-hour window. That window is correct and deliberate — it stops unrelated events months apart from merging because they share generic phrasing. But it also means **nothing in the product can represent one ongoing storyline**. Epstein is thirty-eight separate stories that no query can tie together.

The consequence is that the site reproduces the flood instead of countering it. Every story is equal, everything scrolls away in 72 hours, and a reader who wants to know "what is actually happening with X" has nowhere to go.

**Fronts are the containment layer.** A small number of durable, named, unresolved storylines that accumulate developments over months, sitting above stories.

---

## 2. What a front is

> A **front** is a named, ongoing line of damage that keeps producing new developments and has not resolved.

**Qualification rubric** — a candidate needs 4 of 5:

| Test | Threshold |
|---|---|
| Sustained | Activity spanning 2+ weeks |
| Accumulating | 3+ distinct developments |
| Stakes | Peak alarm 3 or higher |
| Unresolved | No terminal event has closed it |
| Nameable | Describable in 3 words or fewer |

Score 4–5 = front. Score 2–3 = watchlist (visible in admin, not public). Below 2 = it stays a story.

**Tier** is separate and purely editorial — it controls display weight, not qualification. Flagship / Major / Standard.

A story that belongs to no front is a **loose end**. Loose ends are not a second content type; they render directly from the `stories` table in the running log. This is the single-representation rule that kills rejected-schema issue #7.

**Reference cases:** The Epstein Files (flagship — 18 months, 38 developments, unresolved). Iran (flagship). The Qatar Jet (major — slow but unresolved). "Fired the BLS commissioner" (loose end — one occurrence, no accumulation).

---

## 3. Scope

**In (MVP):** ~10–20 hand-curated fronts. Public homepage timeline, public front pages, admin registry, AI assignment of incoming stories, AI-drafted updates with human approval, Discord alerts to admin.

**Out (explicitly):** new-front auto-proposal (Epic 541), end-user follow/email, term-1 backfill, replacing stories as the internal engine, any change to clustering.

**Deferred within this design:** one-shot/loose-end surfacing beyond the running log; the fullscreen interactive timeline (wave 3, but the data model must not preclude it).

---

## 4. Experience

### 4.1 The timeline (signature element)

A horizontal, evenly spaced, scrolling timeline on the homepage. Every entry is labeled — date, headline, front, alarm — alternating above and below a dotted line. Month and year markers on the line. Loads parked at today; you scroll left into history.

Evenly spaced, not date-proportional. This is a deliberate trade: proportional spacing shows clustering but requires hover to read anything. Even spacing shows the words. Readability wins for a product whose job is "here's what he did."

Fronts toggle on and off. SCOTUS, executive orders and pardons appear as filterable sources with hollow markers, so the timeline is the one place the whole operation converges.

**Expansion is required, not optional.** A control expands the timeline to full screen. MVP full-screen = the same strip broken into stacked rows so the entire term is on one page. Wave 3 makes it interactive: zoom to a month, filter combinations, and an alternate lane view (one row per front on a true date axis) for seeing where activity erupted.

**Mobile:** below 720px the strip becomes a single-column vertical timeline — same entries, same order, alternation dropped, line on the left. Horizontal scrolling of dense cards on a phone is not acceptable. Josh tests on a Galaxy S9+ (360px); that is the floor.

### 4.2 Homepage

Above the fold: the timeline. Below it: open fronts ranked with headline size carrying alarm level, each with a compact activity sparkline and last-activity time. Below that: the running log — every development in reverse chronological order, fronts and loose ends together.

### 4.3 Front page

Header (name, alarm, tier, status, counts, follow), an activity arc for that front, then a vertical timeline of updates newest-first, with quiet-period gaps marked, ending at a "where it started" anchor.

### 4.4 Admin

Front registry (create, edit, retire, set tier). Update approval queue — approve / edit / reject, expected 2–5 per day. Unassigned-stories pool, which is where Josh spots forming storylines and creates fronts by hand. Reassignment of a story to a different front.

### 4.5 Does the timeline go on other screens?

**Recommendation: no, not in MVP.** Its value is cross-front synthesis, which only the homepage needs. SCOTUS, EO and Pardons pages keep their own voices and their own layouts. Revisit after launch with real engagement data. Building it three more times before knowing it works is how this gets expensive.

---

## 5. Data model

**Architecture: fronts are an aggregation layer above stories.** Stories remain the clustering engine and keep owning article membership. Articles are never linked to fronts — a front derives its sources through its stories. Fronts own editorial content only.

Schema keeps the neutral name `events` (public copy says "fronts"), so a naming change costs nothing.

```
events            -- one row per front
event_updates     -- one row per approved editorial update
story_event       -- which story belongs to which front
```

### 5.1 `events`

| Column | Type | Notes |
|---|---|---|
| id | BIGINT PK | identity, never presentation |
| slug | TEXT UNIQUE | presentation only; never a join key |
| name | TEXT | "The Epstein Files" |
| dek | TEXT | one-paragraph standing summary |
| alarm_level | SMALLINT | 0–5, same scale as stories |
| tier | TEXT | flagship / major / standard |
| lifecycle | TEXT | open / resolved / dormant |
| publish_state | TEXT | draft / review / published |
| published_at | TIMESTAMPTZ | null until published |
| started_at | TIMESTAMPTZ | editorial start of the arc |
| created_by | TEXT | 'human' in MVP |
| enrichment_meta | JSONB | AI provenance |
| created_at / updated_at | TIMESTAMPTZ | |

No `source_count`, no `update_count`, no `last_activity_at`, no `category`. All derived.

### 5.2 `event_updates`

| Column | Type | Notes |
|---|---|---|
| id | BIGINT PK | |
| event_id | BIGINT FK → events(id) ON DELETE CASCADE | |
| headline / body | TEXT | editorial |
| happened_at | TIMESTAMPTZ | when the development occurred |
| sort_key | BIGINT | explicit ordering; breaks `happened_at` ties |
| significance | TEXT | 'major' / 'minor' — real enum, drives display weight |
| approval_state | TEXT | pending / approved / rejected |
| approved_at / approved_by | | the human gate |
| created_by | TEXT | 'agent' / 'human' |
| enrichment_meta | JSONB | model, prompt version, source story ids |
| created_at / updated_at | TIMESTAMPTZ | |

### 5.3 `story_event`

| Column | Type | Notes |
|---|---|---|
| story_id | BIGINT **PK**, FK → stories(id) ON DELETE CASCADE | one front per story |
| event_id | BIGINT FK → events(id) ON DELETE CASCADE | |
| event_update_id | BIGINT FK → event_updates(id) ON DELETE SET NULL | nullable — set when folded into an update |
| assigned_by | TEXT | 'agent' / 'human' |
| confidence | NUMERIC | agent confidence |
| assigned_at | TIMESTAMPTZ | |

`story_id` as sole primary key mirrors `article_story` (whose PK is `article_id` alone) and makes assignment idempotent and race-safe by construction. It also means **a story belongs to exactly one front** — an Epstein court filing goes to Epstein, not to Epstein *and* The Courts. That is a real product constraint and is listed as an open question.

### 5.4 Derived values

A view `v_event_stats(event_id, story_count, source_count, update_count, last_activity_at, peak_alarm)` computes everything from `story_event` → `stories` → `article_story`. Nothing derived is ever stored.

### 5.5 Rejected-schema issues, resolved

| # | Issue | Resolution |
|---|---|---|
| 1 | Dual source of truth | Fronts aggregate; they own editorial fields only. Stories keep clustering, membership, factual summaries. No field is canonical in both places. |
| 2 | Slug doing identity work | BIGINT `id` is identity. `slug` is presentation, never a join key. |
| 3 | Category regression | Fronts get **no category column**. Display category is derived from member stories using the existing 11-value enum. No new taxonomy. |
| 4 | Stale counters | No stored counters. `v_event_stats` computes all of them. |
| 5 | Article junction problems | No article junction exists. Fronts reach articles through stories, so the `articles.id` TEXT vs BIGINT mismatch cannot occur. `story_event` has a real PK. |
| 6 | Alarm drift | No new axis. `alarm_level` is the existing 0–5 scale; the mapping from `stories.severity` lives in `public/shared/tone-system.json` as the single source. |
| 7 | One-shot ambiguity | One-shots are not fronts. A story with no `story_event` row is a loose end and renders from `stories`. One representation, one rule. |
| 8 | Thin publishing gate | `publish_state` (draft/review/published) + `published_at` + `created_by` + `enrichment_meta` provenance. Updates carry their own `approval_state`. |
| 9 | `event_updates` too light | Adds `sort_key`, `updated_at`, `approval_state`, and `significance` as a constrained enum. |

### 5.6 Voice

Fronts display one unified label set regardless of which tracker a development came from; domain pages keep their own voices. Draft wording (not final): 5 "Holy Fucking Shit", 4 "Serious Fucking Problem", 3 "Genuine Damage", 2 "Standard Sleaze", 1 "Noise". Profanity at 4–5 only, per existing tone rules. Ships as a new voice in `tone-system.json`.

---

## 6. Pipeline

Two Claude cloud agents, both following the established SCOTUS/EO/Pardons/Stories skeleton (bootstrap hard-reset, PostgREST via curl, gold set, optimistic-PATCH concurrency, heartbeat rows on empty cycles).

**Assignment agent** — runs after each clustering cycle. Input: stories with no `story_event` row from the last N days, plus the published front registry. Output: a `story_event` row, or nothing. No approval gate; assignment is reversible in admin, and a wrong assignment is cheap. Records skips via `recordSkip()` per ADO-466.

**Update drafter** — runs on a slower cadence. When a front accumulates unfolded stories, or a high-alarm story lands, it drafts one update covering N stories, writes it `pending`, and fires a Discord alert. Josh approves, edits or rejects. Nothing reaches the public timeline without that approval.

**Deploy-order rule applies:** migrations land before any prompt referencing new columns merges to main, since bootstrap hard-resets to origin/main.

---

## 7. Cost

| Item | Estimate |
|---|---|
| Assignment agent (~19 stories/day, Sonnet) | $1–3 / month |
| Update drafter (~2–5 drafts/day, Sonnet) | $1–2 / month |
| Discord alerts | $0 (existing webhook) |
| Storage / egress | negligible — three small tables, computed views, no embeddings fetched |
| **Total new spend** | **~$2–5 / month** |

Against the $50/month hard limit. Auto-proposal (Epic 541) adds ~$1–2/month when built. Check the `budgets` table for current spend before go-live rather than assuming headroom.

---

## 8. Rollout

**Wave 1 — the shape.** Migrations, admin front registry, manual assignment, public homepage timeline (with full-screen expand), front detail pages. No agents. Proves the UI and the model against real data.

**Wave 2 — the automation.** Assignment agent, update drafter, Discord alerts, approval queue, unassigned-stories pool.

**Wave 3 — the depth.** Interactive full-screen timeline (zoom, filter combinations, lane view), loose-end surfacing, then Epic 541.

Each wave ships behind a feature flag, off in PROD until verified, per `docs/guides/feature-flags.md`.

---

## 9. Open questions

1. **Fronts vs Files.** Leaning Fronts. If it sticks, "Flagship front" reads as two metaphors arguing — tier words may need to become Primary / Active / Watch.
2. **One front per story?** Proposed as a hard constraint (PK on `story_id`). Relaxing it later is a migration; tightening it later is a data cleanup. Confirm before Wave 1.
3. **Timeline on domain pages?** Recommended no for MVP. Confirm.
4. **How interactive does the expanded view get?** Zoom-to-month and the lane view are Wave 3 scope as written. Confirm that MVP full-screen = stacked rows is enough to launch.
5. **Label wording** at each alarm level not final-approved.

---

## 10. Acceptance (ADO-530)

- **AC1 — discovery doc defining a narrative thread:** §2, with the rubric and Epstein/Iran/Qatar/loose-end reference cases.
- **AC2 — data model proposal with rationale:** §5, including all 9 rejected-schema issues resolved in §5.5.
- **AC3 — cost/effort estimate:** §7 (spend) and §8 (effort shape by wave).
