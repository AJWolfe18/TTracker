# ADO-524: post-pardon recheck (plan)

Status lives on ADO-524. This file holds the build details only.

## Why

The pardons agent checks for re-offending once, when it first enriches a pardon (Step 3D). Nothing
checks again, so a recipient arrested months later still reads "quiet" on the site. We cannot
research every pardon every day, so the fix is a small rotation inside the existing daily routine.

## Decisions already made (ADO-524 comments)

- **Step in the existing pardons agent, not a new routine** (October 10, 2026): $0 extra. Most days
  the enrichment queue is empty and the run takes about a minute.
- **Rotation:** up to 10 rechecks per run, oldest check first. Pardoned within 180 days: due every
  14 days. Older: every 60 days.
- **Cheap first pass:** two searches per pardon (plain name, then name plus a distinguishing term; the TEST gold run showed one is not enough for a common name). Identity check and full research only on a
  hit. No hit = stamp `post_pardon_checked_at` only. Editorial fields are never touched by a recheck.
- **A hit on a public pardon publishes the note directly** (Josh, October 11, 2026): no
  `needs_review`, no unpublish. The change is reported on Discord. This replaces AC 5.
- **The Jan 6 group card (id 3) stays manual.** Group cards (`recipient_type = 'group'`) are never
  rechecked by name.

## Build

1. **Migration 132** `pardons.post_pardon_checked_at TIMESTAMPTZ`, backfilled from `enriched_at`,
   plus RPC `pardons_due_for_recheck(p_limit INT DEFAULT 10)`:
   - pool: `enriched_at IS NOT NULL`, `is_public`, `recipient_type = 'person'`, `id <> 3`, and due:
     `post_pardon_checked_at IS NULL` OR older than 14 days (pardon within 180 days) or 60 days
   - order: `post_pardon_checked_at ASC NULLS FIRST, id`; returns the identity columns the check
     needs (name, pardon date, district, case number, offense, current status and notes)
   - EXECUTE revoked from PUBLIC/anon/authenticated, granted to service_role (Codex P1 on 120)
   - PGlite test: tiers, ordering, protected/group exclusion, unpublished excluded, grants
2. **Prompt v1.4** (`prompt-v1.md`):
   - Step 2 with 0 pardons no longer stops: it goes to the new Step 6.5
   - Step 6 also writes `post_pardon_checked_at` (the first check)
   - **Step 6.5 Post-pardon recheck**: due pardons from the RPC; one WebSearch per pardon (name +
     arrested/charged/indicted + years since the pardon); on a hit, confirm identity (district,
     case, age, home state) and that the new conduct is AFTER `pardon_date`; then PATCH only
     `post_pardon_status` (escalate only: quiet -> under_investigation -> re_offended, never back),
     `post_pardon_notes` (append a dated sentence with source URL), `source_urls` (append),
     `post_pardon_checked_at`. Identity doubt or pre-pardon conduct = no status change, stamp only,
     note it in the run log
   - Discord: one post per run that changed a status, if `DISCORD_WEBHOOK_URL` is set (same PROD
     environment as the fronts agent, which already uses it); never fails the run
   - run log `pardon_details` gets one `{"id", "status": "rechecked", "result": "quiet|hit|identity_unclear"}` per recheck
   - **Gold mode** (TEST only): `PARDONS_RECHECK_IDS=11,19,...` rechecks exactly those ids,
     ignoring due-ness and `is_public`, and refuses on a PROD URL
3. **Prompt tests** (`qa:agent-prompts`): Step 6.5 present, never writes needs_review/is_public or
   editorial fields, escalate-only, gold mode refuses PROD
4. **Gold set on TEST** (AC 6 and Josh's October 10 testing rule):

   | id | Person | Expected | Why |
   |---|---|---|---|
   | 11 | Joan Bell | re_offended | Pardoned January 23, 2025 (FACE Act). Charged by Pennsylvania over the July 31, 2025 Red Rose Rescue in Upland; pleaded no contest |
   | 19 | William Goodman | re_offended | Same pardon, same Upland case |
   | new | Zachary Alam (TEST row) | re_offended | Jan 6 pardon (January 20, 2025); arrested months later for a home invasion, later convicted |
   | new | Ryan Nichols (TEST row) | re_offended or under_investigation | Jan 6 pardon; May 2026 deadly conduct and harassment charge |
   | 8, 35, 44 | Ulbricht, Blagojevich, Milton | unchanged, stamped | No reported new arrest |
   | 155 | Molly Ann Bloom | unchanged, stamped | Same-name trap: the "Poker Princess" Molly Bloom's case is a different person, and pre-pardon |

   The two Jan 6 rows are TEST-only fixtures (real recipients, public facts), verified by search
   before insert. Pass = every positive found with a dated source, every negative unchanged, and the
   trap not attached.

## Cost

$0 cash. Up to 20 extra searches per daily run (two per due pardon) on the subscription. No new routine.

## PROD order

Migration 132 before the v1.4 prompt reaches main (the prompt calls the RPC). Josh's local Codex
review before both.
