# Handoff: PROD Pardons Quality Review + Two Accuracy Fixes

**Date:** 2026-05-31
**Type:** QA / editorial quality review of live PROD pardons (no code changes)
**Feature:** pardons-agent (ADO-516, live on PROD)
**Owner:** Josh + Claude

---

## What this session was

Josh asked: *"confirm what we're seeing in PROD for pardons is the correct rating."* No PROD DB access from Claude (prod MCP needs interactive auth), so this was done by Josh running SQL in the PROD SQL Editor and pasting results back for assessment. It grew into a full editorial-quality review of the 25 (later 30) public pardons, two factual-error fixes, and a systemic diagnosis of the enrichment pipeline.

---

## What "rating" means (for future reference)

- The displayed pardon "rating" is a **pure lookup** of the stored `corruption_level` (0–5) → label, via `public/shared/tone-system.json` ("The Transaction" voice). Frontend fallback labels in `public/pardons-app.js` match the JSON exactly, so **a wrong displayed label is impossible** — if a rating looks wrong, it's the stored `corruption_level` (AI judgment), not a display bug.
- Rubric (from `docs/features/pardons-claude-agent/prompt-v1.md`): 5 = Pay 2 Win (MONEY), 4 = Cronies-in-Chief (DIRECT/inner-circle), 3 = The Party Favor (NETWORK/campaign-promise — the default), 2 = PR Stunt (FAME), 1 = Ego Discount (FLATTERY), 0 = Actual Mercy (MERIT, auto-flags `needs_review`).

## Rating assessment: well-calibrated overall

- Distribution was 3× L4 + 22× L3, nothing else. Correct for this set (all inner-circle or campaign-promise pardons). **No L5** because no pardon has a documented dollar trail (`donation_amount_usd` null on all) — "Pay 2 Win" is currently unused, by design.
- **One debatable rating:** the J6 mass pardon (id 3) is **L4**, but by the strict rubric (campaign promise = L3, and L4 requires a documented *personal* relationship) it arguably should be **L3** — same mechanism as the FACE Act batch (L3) and Ulbricht (L3). Defensible as a special case (self-dealing + violence) but inconsistent. Left as-is; Josh's call.

---

## Two factual errors found + FIXED (applied by Josh to PROD via admin dashboard)

1. **Zabavsky summary (id 6)** — `summary_spicy` said the *lieutenant* chased the moped. Verified ([CBS](https://www.cbsnews.com/news/karon-hylton-brown-death-officers-terence-sutton-andrew-zabavsky-found-guilty/), [WUSA9](https://www.wusa9.com/article/news/crime/former-dc-police-officer-sentenced-to-55-years-in-prison-for-police-chase-that-killed-karon-hylton-brown-terence-sutton-andrew-zabavsky/65-d2003ec5-02e8-4275-8aac-3a4763ab356e)): **Sutton** drove the chase (2nd-degree murder); **Zabavsky** was the supervisor convicted of conspiracy + obstruction (the cover-up), NOT murder. Rewrote the summary to lead with his actual role.
2. **Harlow name (id 18)** — `recipient_name` was `Paula Harlow`; correct name is **Paulette Harlow** (of Kingston MA, sister of Jean Marshall id 21) per [WBUR](https://www.wbur.org/news/2025/01/24/trump-anti-abortion-activists-pardons-massachusetts)/[NCR](https://www.ncronline.org/news/trump-pardons-23-pro-life-activists-convicted-face-act-violations). The body already said Paulette; only the title field was wrong. Fixed name (+ slug via SQL — admin UI can't edit `recipient_slug`).

---

## Systemic findings (the real takeaways — NOT yet ticketed)

1. **The `needs_review` flag is non-binding.** Auto-publish-on-enrichment is **intentional** across all three Claude agents (publish-by-default; a 2026-05-27 decision so good content doesn't sit unpublished). The pardons-specific gap is narrower: `needs_review` is **advisory, not blocking**, so even genuinely-flagged rows go live. Both factual errors reached the public site this way. Pardons is the highest accuracy-risk domain (names real people + crimes + roles). Fix = make `needs_review` a real publish gate for the flagged minority *while keeping publish-by-default for everything else* (ADO-527). SCOTUS/EO stay publish-by-default unless separately decided.
2. **Per-row enrichment can't self-regulate** (each card enriched in isolation):
   - Can't reconcile DOJ-ingested `recipient_name` vs the researched name → the Paula/Paulette mismatch.
   - Can't disambiguate co-defendant roles → Zabavsky got Sutton's action; Curry (id 9) & Phillips (id 23) share the identical "Michigan Holiness Revival Tour" opening.
   - Can't vary the corpus-level thesis → every FACE Act card lands on the same "campaign promise = transaction" kicker (reads formulaic in bulk even though openings are well-varied).
   - **Prompt fixes:** add co-defendant role disambiguation + name-reconciliation instructions.
3. **Curation asymmetry = root of the "sameness."** J6's 1,500 people = **1 public group card** (id 3); the FACE Act batch of 23 = **~18 individual person cards**. Pure ingestion artifact (J6 arrived as one proclamation, FACE Act as individual DOJ records), not an editorial choice. Grouping the FACE Act batch like J6 would fix the page feel more than any rewrite. Product decision.

---

## PROD data shape (confirmed this session, will drift — verify before relying)

- 118 pardon rows total; **30 public** (29 person + 1 group). ~88 unpublished = ingested-but-not-yet-enriched backlog (nothing publishes until enriched).
- J6: 1 public group row (id 3, `recipient_count` 1500) + a few **unpublished** individual J6 person rows (Caldwell id 34, Wilson id 88) — likely seeds for the ADO-524 post-pardon watchdog.

---

## Next session should pick up

- **Decide + create ADO tickets** for the 3 systemic items above (review gate; co-defendant/name prompt fixes; FACE Act grouping). May fold into or sit alongside ADO-524 (J6 watchdog) / ADO-523 (retire legacy).
- Optional: the J6 L4-vs-L3 rating consistency call.
- Optional: pull `summary_neutral` for the public set and accuracy-check those too (only `summary_spicy` was reviewed this session).
