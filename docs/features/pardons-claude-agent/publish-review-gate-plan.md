# Plan: Gate Pardon Auto-Publish on `needs_review`

**Status:** ADO-527 (status lives there) — plan holds implementation detail only
**Created:** 2026-05-31
**Feature:** pardons-agent (ADO-516, live on PROD)
**Origin:** `docs/handoffs/2026-05-31-pardons-prod-quality-review.md` (systemic finding #1)

---

## Problem

Pardons **auto-publish** on enrichment — the agent prompt sets `is_public = true`. The `needs_review` column is **advisory only**: a flagged pardon still goes live immediately. This let two factual errors reach the public site (Zabavsky role id6, Paula/Paulette name id18) before any human saw them. Pardons is the highest accuracy-risk domain (real people + crimes + roles) but currently has the weakest publish gate of the three Claude-agent domains.

## Current state of the three domains (verified 2026-05-31)

| Domain | Publishes on enrich? | Uncertainty handling |
|---|---|---|
| **SCOTUS** | `is_public = true` (since 2026-05-27) | Strong: `needs_manual_review = true` on ANY unexplicit fact (vote split, author, low confidence). "Better to flag than guess." |
| **EO** | `is_public = true` (always) | Has admin tab; a sync trigger sets `is_public = false` when `needs_manual_review` flips true (re-flag auto-unpublishes) — ADO-480 |
| **Pardons** | `is_public = true` (always) | `needs_review` set but **advisory — does not block publish** ← the gap |

**Takeaway:** EO already proves the approach (a trigger that unpublishes when flagged) — see its migration. This plan brings pardons to at least that bar; the Approach below uses a stronger table-level variant of the same idea.

## Goal / definition of done

No pardon with `needs_review = true` is publicly visible until an admin explicitly approves it. Flagging must hold at the **data layer**, not just the prompt (so a bad enrichment can't bypass it). After rollout, **zero rows** may be in the `is_public = true AND needs_review = true` state — that combination is the exact invalid state this story eliminates.

## `needs_review` semantics (resolves an overload)

`needs_review` must mean exactly one thing: **"not yet cleared for public."** It is a pre-publish gate, consumed once an admin approves.

It must NOT double as a watchlist. The "published but keep watching" concern (re-offenders like Goodman/Bell, or the J6 rating debate) belongs in the existing **`post_pardon_status`** column (`quiet` / `under_investigation` / `re_offended`), which does **not** gate publishing. Conflating the two is what makes "leave it public while flagged" tempting — and impossible once the trigger lands.

## Approach (3 layers, defense-in-depth)

1. **Prompt change** (`docs/features/pardons-claude-agent/prompt-v1.md`)
   - Stop unconditionally setting `is_public = true`. Set `is_public = false` whenever `needs_review = true`.
   - Expand what trips `needs_review` (ties into systemic finding #2): `corruption_level = 0`, low confidence, **co-defendant role ambiguity**, or **`recipient_name` disagrees with the researched name**.

2. **DB safety net — trigger (the real gate)**
   - `BEFORE INSERT OR UPDATE` trigger on `pardons`: if `NEW.needs_review = true` then force `NEW.is_public = false`. A table-level `BEFORE` trigger makes the gate impossible to bypass on any write path (stronger than EO's log-based sync, which only fires on enrichment-log completion).
   - **Precedent:** `supabase/migrations/20260418000000_eo_admin_publish_gate.sql` already does the EO version of this — copy its structure (and its exactly-once firing notes if we go log-based instead).
   - **Migration style (repo convention):** triggers are made idempotent with `DROP TRIGGER IF EXISTS <name> ON pardons; CREATE TRIGGER <name> ...;` — NOT `CREATE TRIGGER IF NOT EXISTS` (not supported). See `20260112000000_pardons_table.sql:190` and the EO gate migration. The `CREATE OR REPLACE FUNCTION` for the trigger body is idempotent on its own.

3. **Admin review path — three concrete code changes, NOT "mostly exists"**
   The trigger breaks the current publish flow, so this layer is real work:
   - **a. Publish must clear the flag atomically.** `handleTogglePublish` (`public/admin.html:3116`) currently sends `updates: { is_public: newIsPublic }` only. With the trigger, publishing a flagged pardon is reverted to `false`. The "Approve & Publish" action must send `{ is_public: true, needs_review: false }` in the **same write**. (Recommend a distinct "Approve & Publish" button for flagged rows, separate from the plain toggle, so approval is an explicit act.)
   - **b. Fix the audit log to reflect reality.** `admin-update-pardon` builds its change diffs from the *requested* `sanitizedUpdates`, not the row the DB actually stored (`admin-update-pardon/index.ts:372`). After the trigger, a requested `is_public: false → true` that the trigger reverts would be logged as a change that never happened. Rebuild the diff loop against the returned `data` (post-write/post-trigger row) so the audit log is truthful. (Latent bug the trigger exposes — fix it here.)
   - **c. Review queue (confirmed net-new, both layers).** The admin Pardons filter set does NOT include `needs_review` today — neither the frontend `reqBody` (`public/admin.html:2939`) nor the backend parser (`admin-pardons/index.ts:90`) handles it. Add it end-to-end: UI control → `reqBody.needs_review` → backend parse + query filter, so flagged rows surface.

## Backfill (PROD) — must NOT leave the invalid state

Existing **public + flagged** rows: J6 (id3), Goodman (id15), Bell (id7), Sutton (id5). The trigger only fires on write, so a backfill is required — leaving them as-is would preserve exactly the `is_public=true AND needs_review=true` state the goal forbids. These four were all reviewed during the 2026-05-31 session, so:

1. **Clear `needs_review = false`** on all four → they become consistently public-and-unflagged (satisfies the goal; the gate is "consumed").
2. **Move any ongoing watch concern to `post_pardon_status`**, not `needs_review`: Goodman + Bell (re-offended) → `re_offended`; any J6/Sutton "keep watching" → `under_investigation` as appropriate. This preserves the signal without gating their (legitimate) public visibility.
3. Run as a one-shot backfill UPDATE in the same migration, after the trigger is created, then assert the invalid state is empty: `SELECT count(*) FROM pardons WHERE is_public AND needs_review;` must return **0** (`needs_review` is a `BOOLEAN` — use the bare column or `needs_review = false`/`NOT needs_review`, never `= 0`).

Net result: zero public+flagged rows, no loss of watchlist signal.

## Acceptance criteria

- [ ] Enrichment no longer publishes a pardon when `needs_review = true`.
- [ ] DB trigger forces `is_public = false` whenever `needs_review = true` (verified by direct UPDATE test).
- [ ] A flagged pardon does NOT appear on the public pardons page or public API (`pardons-active`/`pardons-detail`).
- [ ] Admin "Approve & Publish" sets `is_public = true` AND `needs_review = false` in one write (`handleTogglePublish` / new action in `admin.html`), so the trigger doesn't revert it.
- [ ] `admin-update-pardon` audit log is built from the **stored** returned row, not the requested updates — a trigger-reverted field is not falsely logged (`index.ts:372`).
- [ ] Admin Pardons tab can filter to `needs_review = true` (review queue) — net-new on both `admin.html` reqBody and `admin-pardons` backend parser.
- [ ] Backfill leaves **zero** `is_public = true AND needs_review = true` rows; watchlist concerns moved to `post_pardon_status`.
- [ ] Prompt updated; `needs_review` documented as a pre-publish gate only (watchlist = `post_pardon_status`).
- [ ] Shipped to TEST, verified, then PROD migration applied.

## Cost

~$0. Prompt edit + one idempotent migration + admin-tab filter. **No new AI calls** (no per-pardon cost change). Slight reduction in "instantly live" coverage — that's the point.

## Rollout

TEST branch → apply migration on TEST → verify trigger + admin flow → cherry-pick + PR to PROD (migration + prompt). Standard PROD checklist.

## Open questions

*(Resolved during planning: **backfill** → see Backfill section; **admin `needs_review` filter** → confirmed net-new on both layers, see Approach 3c.)*

1. Should we adopt SCOTUS's `fact_extraction_confidence` (high/medium/low) for pardons, or keep the simpler boolean `needs_review`? (Boolean is enough for v1.)
