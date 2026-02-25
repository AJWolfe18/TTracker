# ADO-354: SCOTUS Enrichment — Concrete Facts

**State:** Testing | **Commit:** 983799a | **Branch:** test

## What shipped

Prompt rewrite: `why_it_matters` now requires a concrete fact in the first sentence (statute, party name, date, dollar amount). Three new validators enforce this: `hasConcreteFactMarker`, `checkNoAbstractOpener`, `validateFactGrounding` (best-effort logging). `media_says`/`actually_means` removed from prompt schema and DB write path (columns remain nullable). Source text injected into Pass 2 prompt so GPT can pull specific details from the opinion.

Frontend: Summary moved above Why It Matters in modal. Case Type removed from modal metadata. Non-merits cases (`procedural`, `cert_stage`, `unclear`) auto-hidden via `is_public=false` in enrichment pipeline. 9 existing non-merits cases patched to `is_public=false` in TEST DB.

## Test results (3/5 enriched)

- **Riley v. Bondi (224):** Before "clarifies procedural nuances" → After cites `8 U.S.C. § 1252(b)(1)`, names Riley, references Convention Against Torture
- **Abbott v. LULAC (280):** Correctly clamped as cert_stage, now hidden (`is_public=false`)
- **Bowe v. United States (285):** Before "glimmer of hope for some prisoners" → After cites `§2244(b)(3)(E)` and `§924(c)`, names Bowe
- Mahmoud (237) + Free Speech Coalition (238): Flagged at Pass 0 (source quality) — pre-existing issue, not related to changes

## Verify on test site

1. Open SCOTUS tab — confirm procedural cases (Abbott v. LULAC, NRC v. Texas, Lab Corp v. Davis, FDA v. Alliance) are gone
2. Open Riley v. Bondi modal — Summary should appear above Why It Matters, no Case Type in metadata
3. Open Bowe v. United States modal — Why It Matters should have statute citations
4. Confirm no "media_says" or "actually_means" sections visible anywhere

## Follow-up items

- **Grounding retry wiring:** `validateFactGrounding` logs warnings but doesn't feed into QA retry loop. Follow-up ticket needed if we want self-corrective retries.
- **Unclear case triage:** 5 cases with `case_type=unclear` are hidden. Need admin review via ADO-340 (comment added).
- **Editorial voice in why_it_matters:** Output is fact-grounded but reads more legal-summary than editorial. May need prompt tweak to reinforce voice while keeping concrete facts.
