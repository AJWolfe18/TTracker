# Front proposal — The Hegseth Pentagon

**Status:** DRAFT FOR REVIEW. Nothing applied to any database. No code changed.
**Author:** Claude Code session (branch `claude/heseth-firing-timeline-srapvg`), 2026-09-02
**Related:** PRD `docs/features/events-tracker/prd.md` · migrations 111/112 · handoff `2026-08-23-ado-554-tracker-main-line.md`
**Blocks:** needs story IDs from the DB before any seed SQL can run (see [§7](#7-what-this-doc-cannot-do-yet))

---

## 1. Why this exists

Josh, 2026-09-02: *"hegseth is the story, ruining the military complex, signals, drinking, etc … yes make it a front, but of all his bad decisions."*

Today there is **no Pentagon front**. The seven published fronts are `epstein-files`, `iran`, `trump-crypto`, `qatar-jet`,
`selling-the-white-house`, `the-courts`, `kushners-deals`. Every Hegseth story is therefore a **loose end**, and under
main-line rule v1.1 a loose end needs effective alarm **5** to reach the line. Result: the arc renders as a handful of
disconnected alarm-5 rows with no through-line, and everything at alarm 3–4 is invisible.

Filing it as a front changes that mechanically — the opening and the escalations reach the main line, the routine
"another general out" rows drop to the front's own page.

---

## 2. Rubric score (PRD §2)

| Test | Threshold | This front | Pass |
|---|---|---|---|
| Sustained | 2+ weeks | Jan 2025 → present (19 months) | ✅ |
| Accumulating | 3+ distinct developments | 17+ distinct beats below | ✅ |
| Stakes | Peak alarm 3+ | Peak 5 | ✅ |
| Unresolved | No terminal event | Still Secretary as of 2026-09-01 | ✅ |
| Nameable | ≤3 words | "The Hegseth Pentagon" | ✅ |

**5/5 — qualifies as a front.** By shape it is closest to Epstein (a chain of distinct beats) rather than ICE
(N variations of the same occurrence), *except* for the general-firings sub-thread, which is ICE-shaped and should be
rolled into periodic `event_updates` ("six more flag officers out this quarter") rather than one update per firing.

---

## 3. Proposed `events` row

| Column | Proposed value | Note |
|---|---|---|
| `slug` | `hegseth-pentagon` | presentation only, never a join key |
| `name` | **The Hegseth Pentagon** | alternates: "The Pentagon Purge" (press framing, but centres the firings not the man); "Hegseth's War Department" (his own branding, arguably too cute) |
| `dek` | *A Fox & Friends host with a drinking problem and no command experience was handed the world's largest military. He has purged two dozen generals, leaked strike plans on Signal, ordered a follow-up strike on shipwreck survivors, expelled the press corps, and lost his own service secretaries — and he still has the job.* | draft; Josh's voice call |
| `alarm_level` | `5` | editorial; this is what displays |
| `tier` | `major` | **Josh's call.** `flagship` is defensible (PRD caps flagships at 3–5); recommending `major` so the flagship slots stay with Epstein/Iran until Josh says otherwise |
| `lifecycle` | `open` | → `resolved` on the terminal event (§6) |
| `publish_state` | `draft` | publish only after Josh reviews the assignments |
| `started_at` | `2025-01-24` | confirmation vote |
| `created_by` | `human` | |

**Scope decision (per Josh):** the front's subject is **Hegseth**, not the Department. Include anything where *his
conduct, judgement, or fitness* is the story. Exclude ordinary DoD news he merely announced.

---

## 4. The timeline

Term-2 scope only (`TERM_START = 2025-01-20`), so the pre-confirmation reporting — the New Yorker and NBC drinking
stories, the ex-sister-in-law affidavit, the veterans-org removals — is **out of scope for the spine** and belongs in
the `dek`/background only. It is why the confirmation vote is the opening, not a footnote.

`ML` = reaches the main line under rule v1.1 (opening · alarm 5 · new front peak at 4+).

| # | Date | Beat | Alarm | ML | Source |
|---|---|---|---|---|---|
| 1 | 2025-01-24 | **Confirmed 51–50**, Vance breaks the tie; three Republicans vote no. Senate dismisses the drinking and misconduct allegations; he pledges not to drink on the job. | 4 | ✅ *opening* | [Yahoo/AP](https://www.yahoo.com/news/hegseth-confirmed-defense-secretary-republicans-025313657.html) |
| 2 | 2025-02-21 | Fires **CJCS Gen. C.Q. Brown** plus five other admirals and generals. Unprecedented peacetime shake-up of military leadership. | 5 | ✅ | [Miller Center](https://millercenter.org/node/100941) |
| 3 | 2025-03-15 | **Signalgate.** The Atlantic's editor-in-chief is in a Signal chat where Hegseth posts Yemen strike timing, aircraft and missiles *hours before launch*. | 5 | ✅ | [PBS](https://www.pbs.org/newshour/nation/pentagon-watchdog-says-hegseths-use-of-signal-app-put-u-s-personnel-at-risk-ap-sources-say) |
| 4 | 2025-04 | **Second Signal chat** — this one includes his wife and brother. | 4 | ❌ | [Times of Israel](https://www.timesofisrael.com/hegseth-under-pressure-as-pentagon-scandals-mount/) |
| 5 | 2025-04 | Senior adviser **Dan Caldwell**, deputy CoS **Darin Selnick**, deputy secretary's CoS **Colin Carroll** fired in a leak hunt that included **polygraph tests**. | 4 | ❌ | [Yahoo](https://www.yahoo.com/news/hegseth-high-profile-staff-departures-161325668.html) |
| 6 | 2025-04-21 | Blames "disgruntled former employees" and the media for Signalgate. | 3 | ❌ | [Times of Israel](https://www.timesofisrael.com/hegseth-under-pressure-as-pentagon-scandals-mount/) |
| 7 | 2025-05 | Memo to senior leadership ordering **cuts to flag and general officer billets**. | 3 | ❌ | [eciks](https://eciks.org/23353-hegseth-generals-fired-purge) |
| 8 | 2025-06 | **DoD Inspector General opens** the Signal investigation; interviews current and former staff. | 4 | ❌ | [Yahoo](https://www.yahoo.com/news/pentagon-watchdog-investigate-hegseth-over-200529141.html) |
| 9 | 2025-09-02 | **The double-tap.** A strike on an alleged drug boat leaves survivors; a follow-up strike kills them. Reporting later attributes a verbal order to "kill everybody." | 5 | ✅ | [CBS](https://www.cbsnews.com/news/trump-hegseth-venezuela-boat-strikes-war-crimes-are-they-legal/) |
| 10 | 2025-09-30 | **Quantico.** ~800 generals and admirals flown in on short notice. "Welcome to the War Department." Beards banned, "fat generals," women held to "the highest male standards," *resign if you don't like it*. | 4 | ❌ | [Army.mil](https://www.army.mil/article/288832/hegseth_announces_series_of_war_department_reforms_in_sweeping_speech_to_top_military_brass) · [CSIS](https://www.csis.org/analysis/takeaways-secretary-hegseths-quantico-meeting) |
| 11 | 2025-10-14 | **The press corps walks.** 30+ outlets including Fox refuse new rules banning reporters from soliciting unclassified information without authorisation; ~40–50 journalists hand in badges and leave the building. | 4 | ❌ | [Wikipedia](https://en.wikipedia.org/wiki/2025_Pentagon_press_pass_forfeiture) · [OPB](https://www.opb.org/article/2025/10/16/journalists-turn-in-access-badges-exit-pentagon-rather-than-agree-to-new-reporting-rules/) |
| 12 | 2025-10-15 | Orders the **entire US military** to watch the Quantico speech. | 3 | ❌ | [NPR](https://www.npr.org/2025/10/15/nx-s1-5575528/hegseth-order-troops-quantico-speech) |
| 13 | 2025-12-04 | **IG report lands**: the Signal chat "put US personnel at risk," potential harm to US pilots, military regulations violated. Pentagon spins it as exoneration. | 5 | ✅ | [NBC](https://www.nbcnews.com/politics/politics-news/pentagons-signalgate-review-finds-pete-hegseth-violated-military-regul-rcna247023) · [Al Jazeera](https://www.aljazeera.com/news/2025/12/4/has-the-pentagon-really-exonerated-pete-hegseth-over-signal-leaks) |
| 14 | 2025-12 | **Bipartisan anger.** Congress opens investigations into the double-tap. Hegseth refuses to release unedited video and limits congressional access. Schumer/Kaine/Paul file a war powers resolution. | 5 | ✅ | [TIME](https://time.com/7337928/boat-strike-congress-hegseth-hearings-video-release/) · [PBS](https://www.pbs.org/newshour/world/hegseth-says-he-wont-publicly-release-video-of-boat-strike-that-killed-survivors-in-the-caribbean) |
| 15 | 2025-12-25 | **Nigeria strikes** against ISWAP, framed publicly as stopping the killing of Christians. | 3 | ❌ | [Wikipedia](https://en.wikipedia.org/wiki/2025_United_States_strikes_in_Nigeria) |
| 16 | ~2026-04 ⚠️ | Fires **Navy Secretary John Phelan**; pushes out **Army Chief of Staff Gen. Randy George**. | 5 | ✅ | [Axios](https://www.axios.com/2026/09/01/trump-hegseth-military-leaders-fired-resigned) |
| 17 | ~2026-05 ⚠️ | Guardian investigation: **24 generals and senior commanders** out. ~60% were Black or female. **None** cited for performance. | 5 | ✅ | [eciks](https://eciks.org/23353-hegseth-generals-fired-purge) |
| 18 | 2026-08-31 | **Army Secretary Dan Driscoll resigns** after months of clashes, alleging Hegseth blocked Army modernisation by firing senior officials. | 5 | ✅ | [CNN](https://www.cnn.com/2026/08/31/politics/army-secretary-dan-driscoll-resigns) · [Political Wire](https://politicalwire.com/2026/08/31/army-secretary-resigns-after-hegseth-feud/) |
| 19 | 2026-09-01 | WaPo and Axios publish full departure trackers; CT delegation and others call for him to resign or be fired. | 4 | ❌ | [WaPo](https://www.washingtonpost.com/national-security/2026/09/01/top-military-officials-who-have-departed-under-hegseth/) · [Axios](https://www.axios.com/2026/09/01/trump-hegseth-military-leaders-fired-resigned) |
| 20 | **TBD** | **Fired or resigns.** | — | ✅ | terminal — see §6 |

⚠️ **Rows 16–17 have uncertain dates.** Several sources conflate 2025 and 2026 on the Phelan/George beats. Verify
against the WaPo and Axios departure trackers before seeding. Every other date is corroborated by two or more sources.

### 4.1 The severity-saturation problem

Nine of nineteen rows above land at alarm 5, so the front's main line barely compresses — which is
[ADO-556](../../handoffs/2026-08-23-ado-554-tracker-main-line.md)'s calibration problem showing up locally
(PROD rates 67% of term-2 stories 4+).

**Recommendation before publishing:** reserve 5 for the four beats where the *harm is concrete and attributable* —
Signalgate (#3), the double-tap (#9), the IG finding (#13), and the mass purge (#17) — and drop #2, #14, #16, #18 to 4.
That yields an opening plus five main-line rows, which reads as a spine rather than a wall. The alarm column above
records what enrichment would likely produce today; the recommended calibration is a separate editorial pass.

---

## 5. Assignment boundaries (needs a ruling)

`story_event` has `story_id` as its **sole primary key** — one front per story, hard constraint. So these overlaps must
be decided, not left to the keyword sweep:

| Contested stories | Candidate fronts | Recommendation |
|---|---|---|
| Yemen / Houthi strike operations | `iran` vs `hegseth-pentagon` | **`iran` owns the operation; Hegseth owns the leak.** "US strikes Houthi targets" → `iran`. "Hegseth texted the strike package to a journalist" → Hegseth. |
| Caribbean / Venezuela boat strikes | new `boat-strikes` front vs `hegseth-pentagon` | **Hegseth, for now.** The strikes qualify as their own front on the rubric, but splitting them now orphans the "kill everybody" order from the fitness narrative. Revisit if the Venezuela campaign escalates. |
| National Guard deployments to US cities | `hegseth-pentagon` vs loose ends | **Loose ends.** Trump drives these; Hegseth executes. Not his conduct. |
| "Department of War" rename | `hegseth-pentagon` | In — he is the one branding it, and it is the frame for Quantico. |
| Nigeria strikes | loose end | Marginal. Include only if the Christian-persecution framing becomes its own controversy. |

---

## 6. The terminal event

When Hegseth is fired or resigns:

1. Set `events.lifecycle = 'resolved'` and `events.resolved_at`. UI label is "Resolved {date}" (PRD §6.6).
2. The firing story gets a `force_show` pin if its alarm lands below the bar — this must not be missed.
3. **Colour treatment is deferred by Josh.** Recorded so it isn't lost: today green is alarm 0, which PRD §6.6 marks
   *"not used"*; blue is already alarm 2 (`#60a5fa` dark-full, `#1d4ed8` light-full); and the default `restrained`
   theme renders alarm 0–3 as the same grey `#a8a29e`, so a win colour cannot be a palette row — it has to be an
   explicit exception to the tone system. The recommendation on record is an `outcome` flag orthogonal to alarm
   (alarm = how bad, outcome = did accountability land), since a firing is simultaneously alarm-5 chaos and a win.
4. **Nothing here is built.** `lifecycle` is not rendered anywhere in `src/` today (verified: zero references), and
   front pages (ADO-548) have not shipped — so a resolved front currently has no visible resolved state.

---

## 7. What this doc cannot do yet

This session had no database access: the egress proxy blocks `*.supabase.co`, and the Supabase MCP connector attached
here authenticates to a different account (it lists only a `WhiskeyPal Test` project). So:

- **No story IDs.** Every beat above is from news research, not from `stories`. Some beats may have no matching story
  in the DB at all; others may map to several.
- **No coverage check.** Unknown how many Hegseth stories exist on TEST/PROD, or what alarms enrichment gave them.
- **No seed SQL that can actually run.** The shape is below, but the assignment step needs real IDs.

### 7.1 Seed shape (do not run as-is)

```sql
-- 1. The front
INSERT INTO public.events (slug, name, dek, alarm_level, tier, lifecycle, publish_state, started_at, created_by)
VALUES ('hegseth-pentagon', 'The Hegseth Pentagon', '<dek from §3>', 5, 'major', 'open', 'draft',
        '2025-01-24', 'human')
ON CONFLICT (slug) DO NOTHING;

-- 2. Candidate stories — REVIEW THIS LIST BY HAND before assigning.
--    Broad on purpose: 'hegseth' alone misses the purge coverage that names only the generals.
SELECT id, primary_headline, first_seen_at::date, alarm_level, severity
FROM public.stories
WHERE status = 'active' AND summary_neutral IS NOT NULL
  AND first_seen_at >= '2025-01-20'
  AND (primary_headline ILIKE '%hegseth%'
       OR primary_headline ILIKE '%pentagon%'
       OR primary_headline ILIKE '%secretary of war%'
       OR primary_headline ILIKE '%department of war%')
ORDER BY first_seen_at;

-- 3. Assign the reviewed set (mirrors the ADO-554 keyword-sweep pattern).
--    story_id is the sole PK, so this is idempotent and race-safe.
INSERT INTO public.story_event (story_id, event_id, assigned_by)
SELECT s.id, e.id, 'human'
FROM public.stories s
CROSS JOIN public.events e
WHERE e.slug = 'hegseth-pentagon'
  AND s.id IN (/* the reviewed IDs from step 2 */)
ON CONFLICT (story_id) DO NOTHING;   -- never steal a story from another front

-- 4. Verify the rule produced a sane line before publishing.
SELECT id, primary_headline, alarm_eff, front_opening, main_line
FROM public.v_tracker_stories
WHERE front_slug = 'hegseth-pentagon'
ORDER BY first_seen_at;

-- 5. Only after Josh eyeballs step 4:
UPDATE public.events SET publish_state = 'published', published_at = NOW()
WHERE slug = 'hegseth-pentagon';
```

**Egress note (CLAUDE.md #11):** step 2 selects five narrow columns and never touches `content` or `embedding`.
Keep it that way — a `SELECT *` over this keyword set would be measured in GB.

---

## 8. Open questions for Josh

1. **Name** — "The Hegseth Pentagon", "The Pentagon Purge", or something else?
2. **Tier** — `major` (recommended) or `flagship`?
3. **Alarm calibration** — apply the §4.1 pass, or seed as-is and let ADO-556 fix it globally?
4. **Boat strikes** — inside this front (recommended), or their own front?
5. **Ordering** — publish this front now with today's spine (front renders as a row tag only, no page to click into),
   or hold until ADO-548 ships the front pages?
