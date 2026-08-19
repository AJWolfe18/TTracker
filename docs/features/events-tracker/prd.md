# Fronts — Product Requirements

**ADO:** 530 (design) · Epic 541 (auto-proposal, deferred)
**Status:** Draft for approval
**Created:** 2026-08-09
**Supersedes:** `design.md` (Apr 2026) **entirely** (clarified 2026-08-17). What survives from it is the mission — "when someone says 'he wasn't that bad,' you point them here" — and the term-2-only scope. What does **not** survive: its vision of events *replacing* stories as the user-facing product. This PRD builds fronts as an **aggregation layer**; stories stay visible (the running log renders them directly). Its Schema v1 was rejected and is replaced by §6.
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

**Tier** is separate and purely editorial — it controls display weight, not qualification. The tiers named in the reference-case verdicts below are illustrations of likely editorial calls, not outputs of the rubric: the rubric decides front-or-not; Josh decides tier.

A story that belongs to no front is a **loose end**. Loose ends are not a second content type; they render directly from the `stories` table in the running log. This is the single-representation rule that kills rejected-schema issue #7.

**Reference cases**

| Case | Rubric | Verdict |
|---|---|---|
| **The Epstein Files** | 5/5 — 18 months, 38 developments, escalating, unresolved | Flagship front. The canonical shape: a chain of *distinct* beats. |
| **ICE raids** | 5/5 — sustained since 2025, high stakes, unresolved, nameable | Front, but a **different shape**: dozens of near-identical recurring occurrences rather than a chain of distinct beats. See below. |
| **Iran** | 5/5 — strikes, escalation, no congressional vote | Flagship front |
| **The Qatar Jet** | 4/5 — slow but unresolved, only misses "accumulating" some months | Major front |
| **"Fired the BLS commissioner"** | 1/5 — one occurrence, no accumulation | Loose end, not a front |

**ICE is the case that stresses update granularity.** Epstein produces distinct beats that each deserve their own update. ICE produces forty variations of "another raid happened," and one update per raid would bury the front in noise and burn the approval queue. The drafter must therefore be able to roll similar recurring occurrences into one periodic update ("Nine raids in three states this month, two deaths") rather than emitting one per story. That is a requirement on the drafter prompt (§9), not a schema change — `event_updates` already models one update covering N stories.

---

## 3. Scope

**Content scope: term 2 only** — everything from inauguration (Jan 20, 2025) forward. Term-1 backfill stays out (below).

**In (MVP):** ~10–20 hand-curated fronts. Public homepage timeline, public front pages, admin registry, AI assignment of incoming stories, AI-drafted updates with human approval, Discord alerts to admin.

**Out (explicitly):** new-front auto-proposal (Epic 541), a true per-front subscribe/notify system, term-1 backfill, replacing stories as the internal engine, any change to clustering.

**Deferred within this design:** loose-end surfacing beyond the running log; the interactive full-screen timeline (Wave 3, but the data model must not preclude it).

---

## 4. Goals and success metrics

### 4.1 What success means

The product bet is that **a small number of followable fronts beats an infinite scroll of equal stories.** Fronts succeed if readers open them, come back to them, and if the editorial machine runs on a few minutes of Josh's day rather than an hour.

**North-star metric: front open rate** — the share of sessions that open at least one front detail page. It is the most direct test of the bet: if people scroll the timeline and never open a front, the containment layer isn't earning its place.

### 4.2 KPI tree

Absolute thresholds are marked **(baseline)** where the site has no prior comparable number. Those get measured through Wave 1 and turned into real targets before Wave 2 ships — inventing a number now would just be a number.

**A. Reader value**

| Metric | Definition | Target |
|---|---|---|
| Front open rate ★ | Sessions opening ≥1 front detail / all sessions | ≥ 25% (baseline) |
| Timeline engagement | Sessions with any timeline interaction (scroll, arrow, filter, expand) | ≥ 40% (baseline) |
| Front depth | Median updates viewed per front-page session | ≥ 3 (baseline) |
| Return rate | Front viewers returning within 14 days | ≥ 20% (baseline) |
| Newsletter conversion | Signups attributed `signup_page='fronts'` / front sessions | ≥ existing stories page rate |

**B. Editorial machine**

| Metric | Definition | Target |
|---|---|---|
| Assignment precision | Agent assignments never reassigned by a human | ≥ 90% |
| Assignment coverage | New stories that get a front or are deliberately left loose | ≥ 95% |
| Draft acceptance | Updates approved (with or without light edit) / all drafted | ≥ 60% |
| Queue latency | Median draft → decision time | < 24h |
| Admin load | Drafts awaiting decision per day | 2–5; alert above 8 |

**C. Content health**

| Metric | Definition | Target |
|---|---|---|
| Live fronts | Published, lifecycle `open` | 10–20 in MVP |
| Stale front rate | Published fronts with no approved update in 30 days | < 20% |
| Loose-end ratio | Stories never assigned to a front | Informational — a rising number means fronts are missing, not that the metric is bad |

**D. Guardrails — must not regress**

| Guardrail | Limit |
|---|---|
| New AI spend | ≤ $5/month (see §10) |
| Homepage LCP | < 2.5s — the timeline is the heaviest thing on the page |
| `error_logged` rate | No increase vs. pre-launch baseline |
| Supabase egress | No measurable increase; views only, never fetch `content` or `embedding` |

### 4.3 Anti-metrics

Not optimizing for pageviews, session duration, or clicks-per-visit. A reader who lands, reads one front, understands the arc and leaves has been served. Time-on-site as a goal would push toward exactly the fragmentation this feature exists to fix.

---

## 5. Experience

### 5.1 The timeline (signature element)

A horizontal, evenly spaced, scrolling timeline on the homepage. Every entry is labeled — date, headline, front, alarm — alternating above and below a dotted line. Month and year markers on the line. Loads parked at today; you scroll left into history.

**The inline strip shows a recent window, not the full term** (2026-08-17). Fetching every development since inauguration inline (~12K stories) would blow the egress and LCP guardrails in §4.2. The inline strip fetches the most recent ~100–150 developments with tight selects; **the full term belongs to the expand view**, which loads history incrementally (cursor pages) as you go back — never one bulk fetch. The inline caption must be honest about this ("Recent developments…"); the full-screen view owns "the whole term, all of it."

Evenly spaced, not date-proportional. This is a deliberate trade: proportional spacing shows clustering but requires hover to read anything. Even spacing shows the words. Readability wins for a product whose job is "here's what he did."

Fronts toggle on and off (once fronts exist — Wave 1 ships with source toggles only, and per-front chips + front attribution on entries arrive with the front layer). SCOTUS, executive orders and pardons appear as filterable sources with hollow markers, so the timeline is the one place the whole operation converges.

**Expansion is required, not optional.** A control expands the timeline to full screen. MVP full-screen = the same strip broken into stacked rows covering the entire term (loaded incrementally). Wave 3 makes it interactive: zoom to a month, filter combinations, and an alternate lane view (one row per front on a true date axis) for seeing where activity erupted.

**Mobile:** below 720px the strip becomes a single-column vertical timeline — same entries, **newest first so today stays at the top**, alternation dropped, line on the left (decided 2026-08-17: preserving ascending order on a vertical list would bury today at the bottom). Horizontal scrolling of dense cards on a phone is not acceptable. Must be usable on a Galaxy S9+ (360px); that is the floor.

### 5.2 Homepage

Above the fold: the timeline. Below it: open fronts ranked with headline size carrying alarm level, each with a compact activity sparkline and last-activity time. Below that: the running log — developments in reverse chronological order, fronts and loose ends together.

**The running log paginates** (cursor-based, per house rules — never OFFSET): an initial window renders, "Keep going" loads more. It is the record, but it is not one unbounded query.

**Loose-end labeling:** entries on a front use the fronts voice (§6.6). Loose ends are stories and keep the existing story label scale (where 0 = "Win"). The two coexist in the log; a loose end never borrows front labels.

### 5.3 Front page

Header (name, alarm, tier, lifecycle, counts, follow CTA), an activity sparkline for that front (the same element as the homepage cards, larger), then a vertical timeline of updates newest-first, with quiet-period gaps marked, ending at a "where it started" anchor.

**The follow CTA is not a subscribe system in MVP.** It opens the existing newsletter signup with `signup_page='fronts'` and the front's id as campaign attribution. This gives a real conversion metric on day one without building per-front notification infrastructure, and the real thing can replace it later without moving the button.

### 5.4 Admin

Front registry (create, edit, retire, set tier). Update approval queue — approve / edit / reject, expected 2–5 per day. Unassigned-stories pool, which is where Josh spots forming storylines and creates fronts by hand. Reassignment of a story to a different front, which is also how assignment precision gets measured.

### 5.5 Does the timeline go on other screens?

**Recommendation: no, not in MVP.** Its value is cross-front synthesis, which only the homepage needs. SCOTUS, EO and Pardons pages keep their own voices and layouts. Revisit after launch with real engagement data. Building it three more times before knowing it works is how this gets expensive.

---

## 6. Data model

**Architecture: fronts are an aggregation layer above stories.** Stories remain the clustering engine and keep owning article membership. Articles are never linked to fronts — a front derives its sources through its stories. Fronts own editorial content only.

Schema keeps the neutral name `events` (public copy says "fronts"), so a naming change costs nothing.

```
events            -- one row per front
event_updates     -- one row per editorial update
story_event       -- which story belongs to which front
```

### 6.1 `events`

| Column | Type | Notes |
|---|---|---|
| id | BIGINT PK | identity, never presentation |
| slug | TEXT UNIQUE | presentation only; never a join key |
| name | TEXT | "The Epstein Files" |
| dek | TEXT | one-paragraph standing summary |
| alarm_level | SMALLINT | 0–5, same scale as stories |
| tier | TEXT | see §6.6 |
| lifecycle | TEXT | see §6.6 |
| publish_state | TEXT | see §6.6 |
| published_at | TIMESTAMPTZ | null until published |
| started_at | TIMESTAMPTZ | editorial start of the arc |
| resolved_at | TIMESTAMPTZ | set when lifecycle → `resolved` |
| created_by | TEXT | `human` in MVP |
| enrichment_meta | JSONB | AI provenance |
| created_at / updated_at | TIMESTAMPTZ | |

No `source_count`, no `update_count`, no `last_activity_at`, no `category`. All derived (§6.5).

### 6.2 `event_updates`

| Column | Type | Notes |
|---|---|---|
| id | BIGINT PK | |
| event_id | BIGINT FK → events(id) ON DELETE CASCADE | |
| headline / body | TEXT | editorial |
| happened_at | TIMESTAMPTZ | when the development occurred |
| sort_key | BIGINT | explicit ordering; breaks `happened_at` ties |
| significance | TEXT | see §6.6 — drives display weight |
| approval_state | TEXT | see §6.6 |
| decided_at / decided_by | TIMESTAMPTZ / TEXT | the human gate |
| was_edited | BOOLEAN | true if the human changed the draft before approving — **this is what makes draft quality measurable** |
| created_by | TEXT | `agent` / `human` |
| enrichment_meta | JSONB | model, prompt version, source story ids — **provenance only, never queried**; canonical update↔story membership lives in `story_event.event_update_id` |
| created_at / updated_at | TIMESTAMPTZ | |

### 6.3 `story_event`

| Column | Type | Notes |
|---|---|---|
| story_id | BIGINT **PK**, FK → stories(id) ON DELETE CASCADE | one front per story |
| event_id | BIGINT FK → events(id) ON DELETE CASCADE | |
| event_update_id | BIGINT FK → event_updates(id) ON DELETE SET NULL | nullable — set when folded into an update |
| assigned_by | TEXT | `agent` / `human` |
| confidence | NUMERIC | agent confidence |
| assigned_at | TIMESTAMPTZ | |
| reassigned_at | TIMESTAMPTZ | null unless a human moved it |
| reassigned_from_event_id | BIGINT | the front the agent originally chose — **this is what makes assignment precision measurable** |

`story_id` as sole primary key mirrors `article_story` (whose PK is `article_id` alone) and makes assignment idempotent and race-safe by construction. It also means **a story belongs to exactly one front**. **Decided 2026-08-17 (Josh): confirmed as a hard constraint.** When a story plausibly fits two fronts, the agent/human picks one; relaxing later is a migration.

### 6.4 Skip logging

Every path where the assignment agent or drafter declines to act writes a `pipeline_skips` row via `recordSkip()` per ADO-466 — new pipeline constants `FRONT_ASSIGNMENT` and `FRONT_UPDATE_DRAFT`. Silent skips are how a pipeline dies quietly.

### 6.5 Derived values

View `v_event_stats(event_id, story_count, source_count, update_count, last_activity_at, peak_alarm, days_since_update)` computes everything from `story_event` → `stories` → `article_story`. Nothing derived is ever stored.

**Alarm precedence** (2026-08-17): a front has two alarm values and they have different jobs. `events.alarm_level` (editorial, set by Josh) is what **displays** everywhere. `v_event_stats.peak_alarm` (derived from member stories) serves the **rubric** ("Stakes: peak alarm 3+") and admin QA — e.g. flagging a front whose editorial alarm has drifted far from its derived peak. Derived peak never renders publicly.

### 6.6 Controlled vocabularies

Every enum, its stored values, and its user-facing label. Values are `snake_case`; labels are what ships in the UI.

**`events.tier`** — editorial display weight

| Value | UI label | Meaning |
|---|---|---|
| `flagship` | Flagship | Top of the homepage, biggest type. 3–5 of these, maximum. |
| `major` | Major | Full card treatment |
| `standard` | Standard | Compact row |

**`events.lifecycle`** — is it still going

| Value | UI label | Rule |
|---|---|---|
| `open` | Still open | Default. Unresolved. |
| `dormant` | Quiet since {date} | No approved update in 90 days. Set by job, not by hand. Still public. |
| `resolved` | Resolved {date} | A terminal event closed it. Set by hand only. |

**`events.publish_state`** — editorial gate

| Value | UI label | Visible publicly |
|---|---|---|
| `draft` | Draft | No |
| `review` | In review | No |
| `published` | Live | Yes |

**`event_updates.approval_state`**

| Value | UI label |
|---|---|
| `pending` | Awaiting review |
| `approved` | Approved |
| `rejected` | Rejected |

**`event_updates.significance`**

| Value | UI label | Display |
|---|---|---|
| `major` | — | Large headline, full body, prominent on the timeline |
| `minor` | — | Compact line, small dot |

**`alarm_level`** — 0–5, unchanged scale, one unified front voice on top. Wording is draft, not final-approved.

| Level | Label | Colour token |
|---|---|---|
| 5 | Holy Fucking Shit | `--a5` red |
| 4 | Serious Fucking Problem | `--a4` orange |
| 3 | Genuine Damage | `--a3` yellow |
| 2 | Standard Sleaze | `--a2` grey |
| 1 | Noise | `--a2` grey |
| 0 | — | not used |

Profanity at 4–5 only, per existing tone rules. **Fronts are always 3–5 in practice** — the rubric requires peak alarm 3+, so 0–2 exists only on individual developments and loose ends. Ships as a new voice in `public/shared/tone-system.json` alongside The Betrayal / The Chaos / The Power Grab / The Transaction.

**`category`** — no new taxonomy. Display category is derived from member stories using the existing 11 values (`corruption_scandals`, `democracy_elections`, `policy_legislation`, `justice_legal`, `executive_actions`, `foreign_policy`, `corporate_financial`, `civil_liberties`, `media_disinformation`, `epstein_associates`, `other`). Never stored on a front.

**`created_by` / `assigned_by` / `decided_by`** — `agent` | `human`.

---

## 7. Measurement and instrumentation

### 7.1 What already exists

GA4 property `G-5MDT4HFMNB`, fired through `window.TTShared.trackEvent(name, params, opts)` in `public/shared.js`. Looker Studio is the reporting layer (`docs/guides/looker-studio-setup.md`). Supabase holds the editorial-side truth. There is also a `search_gaps` table capturing zero-result searches.

**Three constraints that will bite if missed:**

1. **`trackEvent` enforces a hard param allowlist** (`ALLOWED_PARAMS` in `shared.js`). Any param not on the list is dropped with a console warning — the event still fires, minus the dimension, and nobody notices for a month.
2. **Analytics are disabled on TEST and localhost** *in the `TTShared` layer* — they log to console instead. Instrumentation is verified on TEST by reading the console, and only confirmed in GA4 after a PROD deploy.
3. **The homepage does not load `shared.js`** (found in QA, 2026-08-17). The fronts surfaces live in the React app (`src/`), which never includes `public/shared.js` — it calls raw `gtag()` (`index.html`, `App.tsx`), with **no TEST/localhost guard**. So the §7.2 events cannot be fired through `TTShared.trackEvent` as originally written. **W1.6 must first port an equivalent tracking utility into `src/`** (param allowlist, `schema_v`, TEST/localhost disable, `trackOncePerSession`) — either a thin module that mirrors `shared.js` semantics or a shared import — and put the TEST guard on the React gtag bootstrap while at it. The param names below stay valid: they were chosen to match the existing allowlist (verified — every param in §7.2 is already on it).

### 7.2 Front events

Designed to reuse allowlisted params wherever possible. The events below need **no changes to `ALLOWED_PARAMS`**:

| Event | Params | Fires when |
|---|---|---|
| `front_view` | `content_id` (front id), `content_type='front'`, `location` (`homepage`/`timeline`/`direct`/`log`) | Front detail page opens |
| `timeline_interact` | `action` (`scroll`/`arrow`/`filter`/`expand`/`entry_click`), `object_type='timeline'`, `page`, `content_id` (front id, on filter and entry_click) | Any timeline interaction |
| `front_update_view` | `content_id` (update id), `object_type='front_update'` | An update scrolls into view on a front page |
| `outbound_click` | existing params | Source link clicked — already implemented, reused as-is |
| `newsletter_signup` | `signup_page='fronts'`, `signup_source`, `result` | Follow CTA converts |

Use `trackOncePerSession` for `timeline_interact` with `action='scroll'` so ambient scrolling doesn't drown the funnel.

**One allowlist change is recommended, not required:** adding `alarm_level` and `tier` as permitted params, and bumping `schema_v` to 2. Without it, engagement cannot be segmented by severity or tier — which is precisely the question ("do people actually open the alarm-5 stuff?") the feature exists to answer. Do it in Wave 1; retrofitting means a gap in the series.

### 7.3 Editorial metrics — SQL, not GA

These come from Supabase and belong on the admin dashboard next to the existing Skips tab:

- **Assignment precision** — `story_event` rows where `reassigned_at IS NULL` over rows where `assigned_by='agent'`.
- **Draft acceptance** — `event_updates` grouped by `approval_state`, split by `was_edited`.
- **Queue latency** — `decided_at - created_at` for approved/rejected updates, median.
- **Admin load** — count of `approval_state='pending'`, alerted to Discord above 8.
- **Stale fronts** — `v_event_stats.days_since_update > 30` where `publish_state='published'`.
- **Loose-end ratio** — stories with no `story_event` row over all stories in the window.

### 7.4 Reporting cadence

Wave 1 establishes baselines for every **(baseline)** metric in §4.2 and does nothing else with them. Wave 2 sets real thresholds and wires the two operational alerts (admin load, stale fronts) into the existing Discord webhook. A monthly Looker page covering the KPI tree is a Wave 2 deliverable, not a Wave 1 one.

---

## 8. Copy and naming reference

Every user-facing string in one place, so the vocabulary stays consistent across homepage, front page, admin and alerts.

| Surface | String |
|---|---|
| Timeline section heading | The whole term |
| Timeline sub-caption (inline strip) | Recent developments across every tracker, in order |
| Expand control | Expand full timeline |
| Full-screen heading | The whole term, all of it |
| Full-screen sub-caption | Every development since inauguration, in order |
| Front list heading | Open fronts |
| Running log heading | Everything, in order |
| Running log sub-caption | Newest first · fronts and loose ends together · this is the record |
| Unassigned story badge | Loose end |
| Front page eyebrow | {Tier} front · Alarm {n} — {label} · {lifecycle label} |
| Front page CTA | Follow this front |
| Back link | ← All fronts |
| Tally: fronts | Fronts at alarm 4+ |
| Empty timeline state | Nothing logged in this range. Widen the filter. |
| Empty front state | This front has no approved updates yet. |
| Admin queue heading | Awaiting review |
| Discord alert | New update drafted for {front} — {headline} |

**Terminology rules:** a *front* is the container. A *development* is one logged thing that happened (never "story" in public copy — that's internal). An *update* is the editorial write-up covering one or more developments. A *loose end* is a development on no front.

---

## 9. Pipeline

Two Claude cloud agents, both following the established SCOTUS/EO/Pardons/Stories skeleton (bootstrap hard-reset, PostgREST via curl, gold set, optimistic-PATCH concurrency, heartbeat rows on empty cycles).

**Assignment agent** — runs after each clustering cycle. Input: stories with no `story_event` row from the last N days, plus the front registry **including drafts** — a front Josh is still curating should accumulate stories before it goes public (2026-08-17; assignment to a draft front has no public effect since `publish_state` gates visibility). Output: a `story_event` row, or nothing. No approval gate; assignment is reversible in admin, and a wrong assignment is cheap. Every decline writes a skip row.

**Update drafter** — runs on a slower cadence. When a front accumulates unfolded stories, or a high-alarm story lands, it drafts one update covering N stories, writes it `pending`, and fires a Discord alert. Josh approves, edits or rejects. Nothing reaches the public timeline without that approval.

The drafter must distinguish the two front shapes from §2. A **chain front** (Epstein) gets one update per distinct beat. A **recurring front** (ICE raids) gets one periodic update aggregating similar occurrences, because one update per raid would bury the front and flood the approval queue. Getting this wrong is the most likely way admin load blows past its 8/day alert threshold.

**Deploy-order rule applies:** migrations land before any prompt referencing new columns merges to main, since bootstrap hard-resets to origin/main.

---

## 10. Cost

| Item | Estimate |
|---|---|
| Assignment agent (~19 stories/day, Sonnet) | $1–3 / month |
| Update drafter (~2–5 drafts/day, Sonnet) | $1–2 / month |
| Discord alerts | $0 (existing webhook) |
| GA4 + Looker | $0 (existing) |
| Storage / egress | negligible — three small tables, computed views, no embeddings fetched |
| **Total new spend** | **~$2–5 / month** |

Against the $50/month hard limit. Auto-proposal (Epic 541) adds ~$1–2/month when built. Check the `budgets` table for current spend before go-live rather than assuming headroom.

---

## 11. Rollout

**Wave 1 — the shape.** **Resequenced 2026-08-17 (Josh): rap sheet first.** The timeline and running log render straight from `stories` (plus SCOTUS/EO/pardons sources) and work with zero fronts existing — every entry is a loose end until fronts are curated on top. So Wave 1 builds in this order:

1. **Rap sheet surfaces** — public homepage timeline (with full-screen expand) + running log, rendering from existing tables. No migrations required. This is the "easy to see list of all of it" and ships first.
2. **Front layer** — migrations, admin front registry, manual assignment, front detail pages.
3. **Measurement** — GA4 instrumentation and the allowlist change.

No agents. Proves the UI and the model against real data, and establishes every baseline in §4.2.

**Wave 2 — the automation.** Assignment agent, update drafter, Discord alerts, approval queue, unassigned-stories pool, editorial metrics on the admin dashboard, KPI thresholds set from Wave 1 baselines.

**Wave 3 — the depth.** Interactive full-screen timeline (zoom, filter combinations, lane view), loose-end surfacing, then Epic 541.

Each wave ships behind a feature flag, off in PROD until verified, per `docs/guides/feature-flags.md`.

---

## 12. Open questions

1. **Fronts vs Files.** ✅ **RESOLVED 2026-08-18 (Josh): Fronts.** Tier labels become **Primary / Active / Watch** (avoids the "Flagship front" two-metaphor clash).
2. **One front per story?** ✅ **RESOLVED 2026-08-17 (Josh): yes — hard constraint, PK on `story_id`.** Relaxing later is a migration; that trade was accepted explicitly.
3. **Timeline on domain pages?** ✅ **RESOLVED 2026-08-18 (Josh): no for MVP.** Homepage rap sheet only; revisit after Wave 1 baselines.
4. **How interactive does the expanded view get?** ✅ **RESOLVED 2026-08-18 (Josh): MVP full-screen = stacked rows is enough**, zoom-to-month and lane view stay Wave 3 — conditional on Josh approving a mockup of the stacked-rows expand before/with ADO-545 build.
5. **Label wording** at each alarm level not final-approved.
6. **Front open rate target of 25%?** ✅ **RESOLVED 2026-08-18 (Josh): Wave 1 is pure baselining.** No committed targets; Wave 2 sets thresholds from measured data.
7. **Does the rap sheet become the homepage, with stories moved to their own tab?** (Raised by Josh 2026-08-18: "the rap sheet is the actual tracker portion.") Recommendation: **keep the blend for Wave 1** — strip + tally on top, stories feed, running log — and let W1.6's GA4 baselines (timeline engagement vs. story-card engagement) decide the promotion in Wave 2. Restructuring nav now would add scope to W1.2 and invalidate the verified W1.1 build; promoting later is a cheap routing change, not a rebuild. Josh's own read supports waiting: "stories is a nice blend right now with that timeline view."

**Product framing note (2026-08-17):** Josh's gut-check — "I want a rap sheet of all the crazy shit, not just the fronts" — confirmed the timeline + running log ARE the primary product surface, with fronts as the containment layer on top. Wave 1 is resequenced accordingly (§11). One-off outrages (task force disbanded, bank account closures, ship morale stories, stock dealings) surface as loose ends on the rap sheet without needing a front.

**Anchor principle (2026-08-18, Josh — locked "regardless of main visual"):** The main rap sheet shows **major items, not every development**. Front openings ("Qatar offers a $400M jet"), major escalations within a front ("the East Wing is demolished", "the Epstein files are partially released"), and significant loose ends (BLS commissioner fired) make the main line; routine developments — "third carrier group deployed", "ballroom construction proceeds" — live inside their front, reached by expanding it (front detail = the complete record). The main surface needs search + filter.

**Refined after rev 4/5 mockup review (2026-08-18, Josh):** the inclusion mechanism is an **alarm-level filter (default alarm ≥ 4), not an editorial anchors/everything toggle** — "All" recovers the complete record, "Only 5" is the worst-of reel. Approved visual: **vertical center-spine timeline** (bar = the timeline, dates alternating left/right, newest first, type size = alarm level). Josh: the spine is "1000% better" and should likely be **"The Tracker"** — the primary homepage surface (feeds §12 Q7).

**Rev 6 refinements (2026-08-18, Josh):**
- **Front click = navigation, not inline expansion.** Clicking a front opens a dedicated front page — the same spine visual filtered to that front's developments, complete record by default, own URL (this IS the front detail page, ADO-548).
- **"Anchor" is not a public concept.** Nothing in the public UI is labeled anchor — main-line inclusion is alarm + curation; anchor/significance flags live in the admin layer only (rename internally if it confuses).
- **Manual curation is required (admin):** the ability to add items to the main Tracker line (promote a below-threshold story, a major EO, a SCOTUS ruling) and remove items from it, per-item, regardless of alarm auto-filter. Lands with the admin registry work (ADO-547); needs a per-entry override field (e.g., `tracker_pin: force_show | force_hide | null`) across all four sources.

---

## 13. Acceptance (ADO-530)

- **AC1 — discovery doc defining a narrative thread:** §2, with the rubric and Epstein/Iran/Qatar/loose-end reference cases.
- **AC2 — data model proposal with rationale:** §6, including all 9 rejected-schema issues resolved below.
- **AC3 — cost/effort estimate:** §10 (spend) and §11 (effort shape by wave).

### Rejected-schema issues, resolved

| # | Issue | Resolution |
|---|---|---|
| 1 | Dual source of truth | Fronts aggregate; they own editorial fields only. Stories keep clustering, membership, factual summaries. No field is canonical in both places. |
| 2 | Slug doing identity work | BIGINT `id` is identity. `slug` is presentation, never a join key. |
| 3 | Category regression | Fronts get **no category column**. Display category derived from member stories using the existing 11-value enum. No new taxonomy. |
| 4 | Stale counters | No stored counters. `v_event_stats` computes all of them. |
| 5 | Article junction problems | No article junction exists. Fronts reach articles through stories, so the `articles.id` TEXT vs BIGINT mismatch cannot occur. `story_event` has a real PK. |
| 6 | Alarm drift | No new axis. `alarm_level` is the existing 0–5 scale; mapping from `stories.severity` lives in `tone-system.json` as the single source. |
| 7 | One-shot ambiguity | One-shots are not fronts. A story with no `story_event` row is a loose end and renders from `stories`. One representation, one rule. |
| 8 | Thin publishing gate | `publish_state` + `published_at` + `created_by` + `enrichment_meta` provenance. Updates carry their own `approval_state`. |
| 9 | `event_updates` too light | Adds `sort_key`, `updated_at`, `approval_state`, `was_edited`, and `significance` as a constrained enum. |
