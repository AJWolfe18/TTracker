# Fronts — Product Requirements

**ADO:** 530 (design) · Epic 541 (auto-proposal, deferred) · 594 (action tracker design, §14)
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
7. **Does the rap sheet become the homepage, with stories moved to their own tab?** ✅ **RESOLVED 2026-08-19 (Josh): yes.** The Tracker spine (tally + timeline, mockup rev 6) IS the homepage when `rap_sheet` is on; the story feed (hero/cards/filters) moves to its own **News** nav tab (`/news`; label renamed from Stories during live review - public copy avoids "story"). Flag off (PROD today) keeps the classic story-feed homepage and hides the News nav item. Shipped with ADO-545 (spine PR + homepage-promotion PR). The earlier keep-the-blend recommendation was superseded by Josh's confirmation that the rev-6 spine-only page was the agreed homepage.

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

---

## 14. Action tracker (ADO-594)

**Status:** design draft, October 1, 2026. Nothing here is built. Josh decides the items in 14.0, then the build stories in 14.10 get carded.

**Why.** Josh, September 30, 2026: the Tracker should be an action tracker, a record of every concrete thing he did (orders, tariffs, cancelled deals, taking a case to the Supreme Court and losing it) and what he said or promised (the $5,000 promise, threats). Fronts hold the big sagas. The gap is the single actions in between. Today the main line cannot tell an action from a column about it: the bar is alarm level only, so a fiery opinion piece and a signed order look the same to the rule.

**The idea in one line.** The Stories agent, which already reads every story, adds two small labels: what kind of news it is (**did**, **said** or **coverage**) and whose action it is (**actor**). The main line then becomes "actions above a bar", with fronts on top exactly as today.

### 14.0 Open Decisions (Josh)

Each item names the build story (14.10) it blocks. The recommendation is what the draft assumes; change any of them and the matching section changes with it.

- [ ] **D1. Approve the label set and the 40 hand labels.** Labels did / said / coverage plus actor trump / administration / ally / other, with the definitions and edge cases in 14.2. The 40 hand labels in 14.3 become the gold set the agents are tested against. Includes two rules worth a look: court rulings in his cases count as his record whichever way they go (edge case 5), and when unsure the agent picks an action label over coverage, so doubtful stories stay visible rather than silently dropping (edge case 12). *Recommended: approve as written.* **Blocks S1, S2, S3.**
- [ ] **D2. Do "ally" actions count as his?** (Republicans in Congress, Trump family and businesses, allied governors, MAGA groups.) *Recommended: no on their own. An ally's action reaches the main line through a front or a pin, not by default.* **Blocks S4.**
- [ ] **D3. The bars for loose-end stories.** *Recommended: did by trump or administration at alarm 3 or higher; said by trump or administration at alarm 4 or higher; coverage never, unless pinned.* In the sample, a said bar of 3 instead of 4 adds one story (17216, the Bombardier threat). **This drops today's "any loose end at alarm 5" bar for ally and other actors** (for example a court ruling in a case he is not part of, rated 5). *Recommended: drop it, consistent with D2; such a story reaches the main line through a front or a pin.* The alternative is to keep alarm 5 by anyone as an explicit exception to D2. None of the 40 sample stories is at alarm 5, so the sample does not move either way. **Blocks S4.**
- [ ] **D4. Inside a front, does a big action skip the anchor principle?** Today a front member reaches the main line only as the front's opening, a new front peak, alarm 5, or the front's alarm floor. Example: 17234 (US destroys Iranian tankers, alarm 4) is on the Iran front but not a new peak, so it stays off. *Recommended: keep the anchor principle (locked August 18, 2026); the only change inside fronts is that coverage never counts.* **Blocks S4.**
- [ ] **D5. Lower bar for EOs, SCOTUS rulings and pardons.** *Recommended: level 4 or higher (today: 5 only).* On TEST this takes these three sources from 13 main-line entries to 64 (14.4). **Blocks S5.**
- [ ] **D6. How "said" looks next to "did".** *Recommended: same line, same date order, a speech-bubble marker and a small "Said" tag, plus Did, Said and Analysis chips (all on by default). Unlabeled stories and EO/SCOTUS/pardon rows count as Did. Public word for coverage: "Analysis".* Details and the full chip table in 14.5. **Blocks S6.**
- [ ] **D7. How the all-fronts agent (ADO-592) uses the label.** *Recommended: coverage stories are not candidates for the agent; unlabeled stories still are (so nothing is lost while the backfill runs); the regex sweep is unchanged.* **Blocks S7 (and the matching part of ADO-592).**
- [ ] **D8. Backfill scope and pace.** *Recommended: label every active enriched story (about 15,000 on PROD), headline and summary only, at about 3 runs a day, before the ADO-592 PROD backfill.* About 38 runs, roughly two weeks, $0 cash (14.8). **Blocks S3 (PROD part).**

### 14.1 What does not change

- Fronts, front pages, the rubric in §2 and one-front-per-story.
- Pins (`tracker_pin`) still force any single row on or off the main line.
- The "All" alarm filter still shows everything, labels or not. Labels only decide the default main line and the new Did and Said chips.
- `stories.primary_actor` (free text such as "ICE") stays. The new actor label is a four-value field with a different job: "is this his side?"

### 14.2 The label set

**`action_label`** answers: what is the news in this story?

| Value | Means | Typical verbs |
|---|---|---|
| `did` | Something concrete happened: an order, a firing, a filing, a strike, a ruling, a raid, a tariff taking effect, an arrest, an accident. | signed, ordered, fired, sued, filed, cancelled, struck, ruled, charged, deployed |
| `said` | Words are the news: a threat, a promise, a claim, a post, a statement, with no action taken yet. | threatened, promised, posted, claimed, suggested, vowed |
| `coverage` | The reporting itself is the news: analysis, opinion, explainers, fact-checks, polls, live streams, retrospectives, and the campaign trail (primaries, ads, PACs, conventions, candidate profiles). | argues, examines, explains, analyzes, "what to know" |

**`action_actor`** answers: whose action or words is it?

| Value | Means |
|---|---|
| `trump` | Trump personally: his signature, his posts, his own words. |
| `administration` | The government he runs: White House staff, cabinet, agencies (DOJ, DHS, ICE, Pentagon), the US military, and the government's own lawyers in court. |
| `ally` | Not the government but on his side: Republicans in Congress, allied governors and attorneys general, his family and businesses, MAGA groups, his campaign. |
| `other` | Everyone else: courts acting in cases he is not part of, foreign governments, Democrats, states, companies, private people. |

For coverage, the actor is whoever the piece is about (a column on his record is `coverage` / `trump`). It does not matter for the main line, because coverage never counts.

**Edge cases (the rule for each):**

1. **A threat and an action in one story:** `did`. The action wins.
2. **A promise later kept or broken:** each story is labeled on its own news. The promise was `said` when made; the fact-check months later is `coverage`.
3. **A record roundup or fact-check** that lists many actions: `coverage`. The actions in it were news on their own days (17248, 17250).
4. **Reactions to his actions by people outside the courts** (Canada retaliates, groups file suit, a governor refuses): `did` or `said` with actor `other`. They can still join a front. Court rulings are not reactions for this purpose; they follow rule 5.
5. **Court rulings, one rule:** if the administration is a party to the case (it brought the case or defends it), the ruling is `did` / `administration`, **whichever way it goes**. A court blocking his order, upholding it, or the Supreme Court ruling against him are all his record (Josh, September 30, 2026: "taking a case to the Supreme Court and losing it"). A ruling in a case without the administration is `did` / `other` (17230). Filing the lawsuit against him is still rule 4 (`other`, as 17245); the ruling in that suit is rule 5 (`administration`).
6. **His rallies and speeches:** a new threat or promise in the speech is `said` / `trump`. A live stream or recap with nothing new is `coverage` (17239).
7. **His social media posts:** `said`, unless the post announces something that has taken effect (then `did`).
8. **Reported plans and leaks:** `said` / `administration` when officials confirm it or a document exists (a draft order, a memo). Anonymous "he is weighing" reporting is `coverage` until something happens.
9. **Accidents and incidents nobody decided:** `did` / `other` (17246, a worker hurt at the White House renovation).
10. **Off-topic stories** that slipped past the feeds: label them honestly (usually `did` / `other` or `coverage`). They never reach the main line (17241).
11. **A story that merged two events:** label the event in the headline.
12. **Unsure:** err toward keeping the story visible. Between `coverage` and an action label, pick the action label (`did` or `said`): a wrong `coverage` silently drops a story off the main line and out of ADO-592's pool, while a wrong `did` only adds an entry that a `force_hide` pin removes. Between `did` and `said`, pick `said` (it has the higher bar, so a doubtful story needs alarm 4 to show). Between `trump` / `administration` and `ally` / `other`, pick by who signed, ordered or spoke; if that is unclear, pick `other`. The agent notes `label_uncertain` in its run log row so Josh can review those first. This is deliberately not the "under-commit" rule used for alarm levels (D1).

### 14.3 Evidence: 40 hand-labeled stories

The 40 newest enriched TEST stories (ids 17215 to 17254, first seen September 6 to 8, 2026), read from `id, primary_headline, summary_neutral, alarm_level, main_line, primary_actor` plus their `story_event` rows. Labeled by hand from the headline and the neutral summary, the same input the backfill will use. "Now" is today's `main_line`; "v2" is the main line under the recommended rule in 14.4.

| id | Headline (shortened) | Alarm | Front | Label | Actor | Now | v2 | Why |
|---|---|---|---|---|---|---|---|---|
| 17254 | Midterms kick into high gear | 2 | | coverage | other | no | no | Horse race overview |
| 17253 | Can Democrats flip Florida? | 2 | | coverage | other | no | no | Race analysis |
| 17252 | Trump suggests renaming New Mexico | 2 | | said | trump | no | no | A post he has no power to act on |
| 17251 | Keith and Walter on GOP midterm challenges | 2 | | coverage | other | no | no | TV analysis segment |
| 17250 | Trump pledged lower prices: risen or fallen? | 2 | | coverage | trump | no | no | Fact-check of old promises (edge case 2) |
| 17249 | Data centers are bringing Americans together | 2 | | coverage | other | no | no | Trend piece |
| 17248 | "The most anti-union president" | 3 | | coverage | trump | no | no | Record roundup (edge case 3) |
| 17247 | Democrats try moving to the left | 2 | | coverage | other | no | no | Campaign strategy |
| 17246 | Worker injured in White House construction | 2 | | did | other | no | no | An accident, not a decision (edge case 9) |
| 17245 | Legal veterans fight his election orders | 4 | Election | did | other | yes | yes | Groups widened lawsuits; the front's floor of 3 keeps it |
| 17244 | The DSA's problem isn't media training | 2 | | coverage | other | no | no | Opinion |
| 17243 | Charges dropped, damage done (Huerta) | 3 | | coverage | administration | no | no | Feature revisiting an older arrest |
| 17242 | GOP convention will be "Trumpist pageantry" | 2 | | coverage | trump | no | no | Column |
| 17241 | AI hacking tool breaches phones | 3 | | did | other | no | no | Off-topic tech news (edge case 10) |
| 17240 | Rare charges against ICE agent; DOJ retreats from shooting probes | 4 | | did | administration | no | **yes** | DOJ charging decision and pattern; his side, above the did bar |
| 17239 | Watch live: GOP convention night 1 | 2 | | coverage | trump | no | no | Live stream, nothing new (edge case 6) |
| 17238 | Prediction markets and the 2026 races | 2 | | coverage | other | no | no | Trend piece |
| 17237 | How Christians can fight Christian nationalism | 3 | | coverage | other | no | no | Book argument |
| 17236 | 9/11 memories at Guantanamo | 2 | | coverage | other | no | no | Anniversary feature |
| 17235 | Why Iowa is a state to watch | 2 | | coverage | other | no | no | Horse race |
| 17234 | US destroys Iranian tankers after missile attacks | 4 | Iran | did | administration | no | no | Military strike; inside a front, not a new peak (D4) |
| 17233 | Carney: retaliation was unavoidable | 3 | | said | other | no | no | Foreign leader's statement |
| 17232 | The mystery at the heart of the trade war | 2 | | coverage | trump | no | no | Analysis |
| 17231 | DHS asks Supreme Court for Social Security data on voters | 3 | Election | did | administration | yes | yes | Court filing; meets the front's floor |
| 17230 | Court: no constitutional right to clean water | 4 | | did | other | no | no | Ruling in a case without the administration (edge case 5) |
| 17229 | How Canada decided to hurt its own economy | 3 | | coverage | other | no | no | Analysis of Canada's tariffs |
| 17228 | Senate candidates skipping his convention | 2 | | coverage | ally | no | no | Campaign trail |
| 17227 | Attorney faces discipline over 2020 Fulton suit | 2 | | did | other | no | no | Bar proceeding by a third party |
| 17226 | Paxton whistle-blower in rival's ad | 3 | | coverage | other | no | no | Campaign ad |
| 17225 | Space Force uniform makeover | 2 | | said | trump | no | no | Posted images, no order (edge case 7) |
| 17224 | Renames places, poses as superhero | 2 | | said | trump | no | no | Posts, no power used |
| 17223 | Last test of dynastic politics | 2 | | coverage | other | no | no | Horse race |
| 17222 | Marshall's challenger criticizes him | 2 | | coverage | other | no | no | Campaign attack line |
| 17221 | House candidate helped imprison a Democrat | 2 | | coverage | other | no | no | Candidate profile |
| 17220 | No charges for false report on Buttigieg | 2 | | did | other | no | no | Local prosecutor's decision |
| 17219 | Live results: Rhode Island primaries | 1 | | coverage | other | no | no | Results page |
| 17218 | Ohio governor's race turns violent | 4 | | did | other | no | no | Attack by a private person |
| 17217 | Approval falls as his fortune grows | 3 | | coverage | trump | no | no | Column |
| 17216 | Trump threatens to bar Bombardier | 3 | | said | trump | no | no (yes if said bar is 3) | A threat, no order yet |
| 17215 | Democratic PAC wants to catch up on AI | 1 | | coverage | other | no | no | Campaign money |

**Shares in the sample:**

| Label | Stories | Share | Of these, his side (trump or administration) |
|---|---|---|---|
| did | 10 | 25% | 3 (17240, 17234, 17231) |
| said | 5 | 12.5% | 4 (17252, 17225, 17224, 17216) |
| coverage | 25 | 62.5% | not counted |

Actors across all 40: trump 10, administration 4, ally 1, other 25.

**Caveats.** This is TEST, three days in early September 2026, in the middle of the midterm season, so it leans hard on horse-race coverage. PROD reads more feeds and will likely show a higher did share. The labels are one person's reading of a summary; D1 asks Josh to confirm them before they become the gold set.

### 14.4 Main-line rule v2

Rule v1.2 lives in `v_tracker_main_line_rule` (migrations 113 and 115) for stories. EOs, SCOTUS rulings and pardons get their bar in the frontend (`src/lib/timeline.ts`, alarm 5 only today). v2 keeps that split.

**Stories, checked in this order (recommended values from D2 to D4):**

1. **Pin:** `force_show` is on, `force_hide` is off. Unchanged.
2. **No label yet:** judged by the v1.2 clauses (a loose end needs alarm 5; a front member uses the four front clauses in step 4), with one difference: a front's opening and running peak come from the step 4 member set, which skips members labeled coverage. Until some member of that front is labeled coverage, the result is identical to v1.2. This is what lets v2 ship before the backfill finishes; the main line changes story by story as labels arrive.
3. **Coverage:** off.
4. **Member of a published front:** the v1.2 front clauses, unchanged (front opening, alarm 5, a new front peak at 4 or higher, or at or above the front's alarm floor). The opening and the running peak are now worked out over every member **not labeled coverage**: did, said and unlabeled members all count, coverage members are skipped. Because there is one member set per front at any moment, a front always has exactly one opening, whatever order the labels arrive in. During the backfill an unlabeled first member is the opening (as in v1.2); if it is later labeled coverage, the opening moves to the next non-coverage member at the next refresh. It never produces two openings. Step 2 uses this same member set, so labeled and unlabeled members of one front are always judged against one opening and one peak.
5. **Loose end (no front):** on when either of these is true:
   - `did` by trump or administration at alarm 3 or higher;
   - `said` by trump or administration at alarm 4 or higher.

   Ally and other actors never reach the main line as loose ends, at any alarm level, unless pinned (D2 and D3). This replaces today's "any loose end at alarm 5" bar for them; it is listed in D3 so Josh can keep alarm 5 as an exception instead.

**EOs, SCOTUS rulings, pardons:** all three are actions by definition, so they need no label. Their main-line bar drops from 5 to 4 (D5). Pins still apply.

**Size of the main line:**

| Scope | Today (v1.2) | Under v2 | Notes |
|---|---|---|---|
| The 40-story sample | 2 (17245, 17231) | 3 (adds 17240) | 4 if the said bar is 3 (adds 17216). 4 if D4 goes the other way (adds 17234). |
| Executive orders, TEST, term 2 (217 public) | 7 | 44 | Level 3 or higher would be 47 |
| SCOTUS rulings, TEST, term 2 (30 public) | 0 | 6 | Level 3 or higher would be 21 |
| Pardons, TEST, term 2 (90 public) | 6 | 14 | Level 3 or higher would be 46 |
| All TEST stories (750 active, enriched) | 223 | measured by S4 | 207 of the 223 are alarm 5 and 212 were written by the old GPT pipeline. If the sample's coverage share held for them, well over a hundred would leave the line; the real number comes from the TEST backfill. |

For recent, calibrated stories the line grows a little (2 to 3 in three days, about 7.5% of stories). For the old GPT-era stories it shrinks, because their inflated alarm 5s stop counting once they are labeled coverage. Both moves are the point: actions in, commentary out.

### 14.5 How "said" shows next to "did"

- **One line, one order.** Said entries sit on the same spine as did entries, in date order. No second lane: a threat and the action that follows it should be next to each other.
- **A different marker.** Did keeps today's solid marker. Said gets a speech-bubble marker and a small "Said" tag before the headline. Not a hollow dot: hollow markers already mean EO, SCOTUS and pardons (§5.1).
- **Chips.** "Did", "Said" and "Analysis" chips sit next to the source chips, all on by default. Turning Said off leaves a pure record of actions. They follow the same rules as the source chips after bug ADO-593 is fixed (a switched-off chip is not fetched and does not hold back the date frontier). What each chip covers:

  | Row | Chip that controls it | Marker / tag |
  |---|---|---|
  | Story labeled `did` | Did | solid marker, no tag |
  | Story labeled `said` | Said | speech bubble, "Said" tag |
  | Story labeled `coverage` | Analysis | muted, "Analysis" tag |
  | Story not labeled yet (every story until the backfill reaches it) | Did | solid marker, no tag, so the Tracker looks exactly like today while the backfill runs |
  | EO, SCOTUS ruling, pardon | Did (as well as its own source chip; the row shows only when both are on) | today's hollow source marker |

  On the main line, coverage stories only ever appear when pinned (14.4 step 3), so the Analysis chip matters there only for pinned rows. In the alarm views ("All", "3+" and so on) coverage stories appear as today, and the Analysis chip lets a reader hide them. On the server the chips become a filter on the stories query (Did off: no `did` and no unlabeled stories, and the EO, SCOTUS and pardon sources are not fetched at all).
- **Mobile.** The same marker and tag in the single-column list.
- **Front pages.** A front page is the complete record, so it shows every member. Coverage members get a muted "Analysis" tag (public copy avoids "coverage", the same way it avoids "story").
- **Copy for §8 (draft):** chip labels "Did", "Said" and "Analysis"; tag "Said"; tag "Analysis"; empty state with only Said on: "Nothing said in this range. Turn Did back on to see what he did."
- **Later, not now:** linking a said entry to the did entry that kept or broke it ("promised in March, signed in June"). Worth it once both labels exist, but it needs its own design.

### 14.6 How ADO-592 (the all-fronts agent) uses the label

- **Smaller pool.** Coverage stories are not candidates. In the sample this removes 25 of 40 stories (62.5%) before the agent reads anything, on top of the regex patterns.
- **Nothing lost.** All three stories the agent has assigned in the sample (17231, 17234, 17245) are `did`, so the filter would not have dropped any of them.
- **Fail open.** Unlabeled stories stay candidates, so 592 does not have to wait for the backfill to finish.
- **A hint, not a gate, for the rest.** The agent sees `action_label` and `action_actor` next to the headline and summary. Actor `other` is still a valid front member (Iran's missiles belong on the Iran front).
- **The regex sweep is unchanged.** Its matches are cheap and Josh can review them; filtering them is a later call.
- **Order.** The label backfill (S3) runs before the 592 PROD backfill, so that backfill reads the smaller pool.

### 14.7 The Stories agent prompt change

In `docs/features/stories-claude-agent/prompt-v1.md`:

- **Step 4:** two new fields in the output table, `action_label` (`did` / `said` / `coverage`) and `action_actor` (`trump` / `administration` / `ally` / `other`), with the definitions and edge cases from 14.2.
- **Step 5:** two new checklist lines: both values are from the allowed set, and the label was chosen from what the story reports, not from how angry the headline sounds.
- **Step 6:** both fields go in the success PATCH. They are not written on the failure path, the same as `alarm_level`.
- **Gold examples:** six short calibration cases from 14.3: 17240 (did, administration), 17216 (said, trump), 17248 (coverage despite listing actions), 17233 (said, other), 17231 (did, administration, a court filing), 17246 (did, other, an accident).
- **Gold check (how S2 is tested).** The 40 gold stories are already enriched and unchanged, so the normal queue (migration 117) will never hand them to the agent. S2 therefore adds a **gold-check mode** to the prompt, used on TEST only: given a fixed list of story ids instead of the Step 2 RPC, the agent runs Steps 3 to 5 (reads the articles, produces the fields) and writes **only** a results file with `id, action_label, action_actor` per story. No PATCH, no log rows, no watermark change. A small script compares the file to the 14.3 table; S2 passes at 90% agreement or better (the same gate as the backfill). One gold check costs about the plan usage of 40 normal enrichments, once. The mode refuses to run without an explicit id list, so it cannot touch the live queue.
- **Version:** `prompt_version` becomes `claude-v1.1`, so labels written by the old prompt (none) and the new one can be told apart.
- **Deploy order:** the migration adding the columns lands on TEST and PROD before the prompt change merges to main (§9: the routine resets to `origin/main`).
- **Re-enrichment** keeps its current rules: a story only comes back when it gains articles. A re-enriched story gets fresh labels; an unchanged story keeps the label from the backfill.
- **A human label is locked.** When Josh corrects a label in admin, `action_label_source` becomes `human`. From then on no agent may change `action_label`, `action_actor` or `action_label_source` on that story: not the Stories agent on re-enrichment, not the backfill. Admin and the agents both write with the service key, so the key cannot tell them apart. The mechanism instead (shipped with S1):
  - **One door for human labels:** an RPC, `set_story_action_label(p_story_id, p_label, p_actor, p_unlock)`. It is the only code that sets `action_label_source = human` or unlocks a label (`p_unlock = true` sets the source back to `agent`, after which the next re-enrichment relabels the story). Inside its own transaction it sets a local flag (`set_config('app.label_admin', 'on', true)`) before its UPDATE.
  - **A trigger that checks the flag:** on any UPDATE of `stories`, if the old `action_label_source` is `human`, or the new one is `human`, and the flag is not on, the trigger puts back the old `action_label`, `action_actor` and `action_label_source` and lets the rest of the write through. So an agent's enrichment PATCH still saves its summary and alarm level; only the label part is ignored. It neither fails the write nor raises an error.
  - **Who calls the door:** only the admin label edit (S8, from `admin-update-story` or a small new admin function). No agent prompt names the RPC, and a `qa:agent-prompts` test asserts that. This protects against accidental overwrites; it is not a security boundary against code that holds the service key, which is the same trust level every admin write has today.
  - The Stories prompt also leaves the two fields out of its PATCH when Step 2 shows `action_label_source = human`, so its run log stays honest, but the trigger is what makes it safe.

### 14.8 Backfill of active stories

The Stories agent will label new and changed stories from S2 onwards. Every story already on the site needs a one-time label pass. The normal enrichment queue will not pick them up (migration 117 never rewrites an unchanged story), so the backfill is its own small job:

- **Input:** headline, neutral summary and `primary_actor` only. No articles, no `content`, no embeddings. That keeps egress tiny (about 0.5 MB per 1,000 stories, so under 10 MB for all of PROD) and makes each label cheap.
- **Pool:** active enriched stories with no label yet, newest first (an RPC like the fronts agent's candidate RPC).
- **Writes:** one checked file per page of 50 stories, recorded in one call (the fronts agent's `record` pattern from ADO-582). Only the two label columns and a source marker (`backfill`) are written. Summaries, alarm levels and enrichment watermarks are never touched.
- **Quality gate:** the TEST run must agree with the 40 gold labels on at least 90% of stories before any PROD run.

**Cost (Claude plan usage, $0 cash).** Estimates, to be replaced by the TEST run's real numbers:

| Item | Estimate |
|---|---|
| Per story | about 170 tokens in (headline and summary), about 40 tokens out |
| Per run | about 400 stories (8 pages of 50); about 1.2M tokens processed, of which about 100K are new input, 20K output, and the rest cached re-reads of the conversation |
| TEST (750 stories) | 2 runs, about 2.5M tokens processed |
| PROD (about 15,000 active stories, per migration 117's notes) | about 38 runs, about 45M tokens processed, about 4M new input and 0.8M output |
| Pace | about 3 runs a day so the Stories and Judge routines are never starved: roughly two weeks |
| For scale | labeling one story costs roughly 1/30 of enriching one (enrichment reads up to 6 full articles). The whole PROD backfill is about the plan usage of 5 to 6 days of the normal Stories routine. |

**Ongoing cost:** the label adds about 40 output tokens per story and about 2K tokens of prompt per Stories run. Under 2% of a normal run. Rule v2 and the display add no AI calls. ADO-592 gets cheaper, because its pool shrinks.

### 14.9 Risks

- **Old GPT-era summaries can be spun.** A label from a slanted summary can be wrong. The 90% gate catches a systematic problem; pins and a later admin override (S8) fix single rows.
- **The main line moves while the backfill runs.** Unlabeled stories keep rule v1.2, so the line shifts gradually rather than all at once. S4 reports the TEST before/after count; PROD runs can be paused at any time.
- **Front opening shifts.** If a front's first member is labeled coverage, the opening moves to its first member not labeled coverage (did, said or still unlabeled). Intended, but worth a look on the front pages after the TEST backfill.
- **The sample is small and election-heavy.** Treat the shares in 14.3 as a direction, not a forecast.

### 14.10 Proposed build stories (not carded yet)

In build order. Each is one session.

| # | Title | Scope in one line | Blocked by |
|---|---|---|---|
| S1 | Action label columns on stories | Migration (next free number): `stories.action_label`, `stories.action_actor`, `stories.action_label_source` (agent / backfill / human), all nullable with CHECK constraints; the `set_story_action_label` RPC (the only way to set or unlock a `human` label) plus the trigger that restores the label fields on any other write to a human-labeled row (14.7); expose the two labels through `v_tracker_stories` (tight select kept). | D1 |
| S2 | Stories agent labels every story | Prompt change in 14.7, `claude-v1.1`, prompt tests (`qa:agent-prompts`), plus a TEST-only gold check (14.7). | D1, S1 |
| S3 | One-time label backfill | Label-only candidate RPC, a `record`-style writer script, a short backfill routine prompt; TEST run with the 90% gate, then PROD runs at the agreed pace. | D1, D8, S1 |
| S4 | Main-line rule v2 | New `v_tracker_main_line_rule` (14.4), unlabeled rows keep v1.2, opening and peak over every non-coverage member (unlabeled included), loose ends by ally and other actors off at every alarm level; TEST before/after count in the PR. | D2, D3, D4, S1 |
| S5 | Lower main-line bar for EOs, SCOTUS and pardons | One per-source main-line bar constant in `src/lib/timeline.ts` (5 to 4), used in **both** places that apply it: `buildSourcePath` (the main-view fetch, `s.alarm(5)` today) and the pinned-row injection (`filter(e => e.alarm < 5)` today), so a pinned alarm-4 entry is not shown twice; tests for both; after ADO-593 merges (same file). | D5, ADO-593 |
| S6 | Did and Said on the Tracker | Speech-bubble marker, "Said" tag, Did/Said/Analysis chips per the 14.5 table (unlabeled and EO/SCOTUS/pardon rows under Did), "Analysis" tag on front pages, §8 copy; behind a feature flag. | D6, S1, ADO-593 |
| S7 | Label-aware all-fronts candidates | Inside ADO-592: candidate RPC skips coverage (unlabeled stays in), the agent sees the labels. Folded into 592's own scope rather than a separate card. | D7, S1 |
| S8 (later) | Admin label override | Edit or unlock a story's label in admin, always through the S1 `set_story_action_label` RPC (never a plain PATCH, which the trigger would undo). Locked against both the Stories agent's re-enrichment and the backfill by the S1 trigger; S2's prompt skips locked labels. | S1 |

**Suggested order:** S1, then S2 and S3 on TEST, then S4, then S5 and S6, then ADO-592 with S7, then the S3 PROD runs, then the 592 PROD backfill.
