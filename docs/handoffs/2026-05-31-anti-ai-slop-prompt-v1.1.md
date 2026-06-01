# Handoff: Anti-AI Slop + Pardons Prompt v1.1

**Date:** 2026-05-31
**Commits:** 5865910, e8e580d (test branch)
**ADO:** 526 closed, 522 still active (re-enrichment in progress)

## What Was Done

### Pardons Prompt v1 -> v1.1
- Connection Investigation Protocol (4 mandatory layers: attorney/advocate, strategic legal value, financial backing, co-defendant test)
- `review_reason` required in `enrichment_meta` when `needs_review=true`
- Unexplained serious criminals default to L3 `wealthy_unknown` (not L1 `no_connection`)
- Jan 6 mass pardon (id=3) protected from overwrite (`prompt_version='locked'`)
- Gold set Example 5 (Garnett Smith) updated from L1 to L3 to teach new calibration
- Research budget bumped from 2-3 to 5-8 WebFetch calls per pardon
- Trivial discrepancies (date mismatches) excluded from needs_review triggers

### Anti-AI Slop Rules (All 3 Agents)
- All em dashes removed from all 3 prompts (pardons, EO, SCOTUS) including gold set examples
- tone-system.json v2.0: added bannedPhrases (19), bannedPatterns (5), writingRules (10), extra bannedOpenings (4)
- All 3 agents now have Step 0/A.2: "Read tone-system.json, follow all rules as binding"
- Inversion pattern banned ("It's not X, it's Y")
- Rhetorical question stacking banned
- Hedging banned
- Pardons voice framing rewritten to not teach the inversion pattern

### PROD Database Changes (manual SQL)
- Jan 6 mass pardon (id=3): manually written flagship card, locked
- All 118 pardons: enriched_at = NULL (reset for v1.1 re-enrichment)
- Giuliani (id=1): needs_review cleared, published
- ADO-526 closed

## What Still Needs Doing

### Priority 1: Validate v1.1 Output (run after 3-4 agent batches)

```sql
-- Test 1: Corruption distribution
SELECT corruption_level, count(*) as total,
  round(count(*)::numeric / sum(count(*)) OVER () * 100, 1) as pct
FROM pardons WHERE prompt_version = 'v1.1'
GROUP BY corruption_level ORDER BY corruption_level;

-- Test 2: Review reason quality
SELECT id, recipient_name, enrichment_meta->>'review_reason' as review_reason, corruption_level
FROM pardons WHERE prompt_version = 'v1.1' AND needs_review = true;

-- Test 3: Connection types
SELECT primary_connection_type, count(*) as total
FROM pardons WHERE prompt_version = 'v1.1'
GROUP BY primary_connection_type ORDER BY total DESC;

-- Test 4: AI slop check (read these out loud)
SELECT id, recipient_name, summary_spicy
FROM pardons WHERE prompt_version = 'v1.1' AND is_public = true
ORDER BY enriched_at DESC LIMIT 5;

-- Test 5: Run duration
SELECT id, ran_at, duration_seconds, pardons_found, pardons_enriched, pardons_failed
FROM pardons_enrichment_log WHERE prompt_version = 'v1.1'
ORDER BY ran_at DESC LIMIT 5;

-- Test 6: Post-pardon tracking
SELECT id, recipient_name, post_pardon_status, post_pardon_notes
FROM pardons WHERE prompt_version = 'v1.1' AND post_pardon_status != 'quiet';
```

**Pass criteria:**
- L1 < 10%, L3 largest bucket, spread across levels
- review_reasons are specific and varied (not all "limited research")
- Mix of connection types (not 90% no_connection)
- summary_spicy has no em dashes, no inversions, varied openers
- Duration < 900s, 0 failures
- Post-pardon findings have dates and sources

### Priority 2: Anti-AI Slop Remaining Work
- Add Tier 1 banned words to tone-system.json (delve, tapestry, robust, leverage, pivotal, underscores, comprehensive, seamless, meticulous, utilize, landscape, realm, paradigm, embark, beacon, cutting-edge, game-changer, watershed, nestled, vibrant, thriving, showcasing, holistic, actionable, impactful, synergy, interplay)
- Install avoid-ai-writing skill for audit capability
- Read through EO + SCOTUS gold set example PROSE for inversions, hedging, synonym cycling (em dashes already gone)

### Priority 3: ADO Housekeeping
- Parent orphan tickets: 512->12, 513->12, 514->123, 525->12
- Approve Sotelos (72, 73) - clean mercy cases, publish
- Sittenfeld (65) + Smith (67) - check if v1.1 re-enrichment fixes classification, then approve

## Key Decisions Made

- "It's not X, it's Y" inversion = AI slop, banned globally
- Em dashes = AI tell, banned globally (replaced with hyphens)
- tone-system.json = enforcement mechanism, not just docs (agents read it)
- Unexplained serious criminals = suspicious (L3), not innocent (L1)
- Jan 6 card = manually curated, never auto-overwritten
- avoid-ai-writing skill (conorbronsdon/avoid-ai-writing, 1.6k stars) identified as the reference resource for anti-AI patterns

## Research Sources
- https://github.com/conorbronsdon/avoid-ai-writing (42 pattern categories, 109-word replacement table)
- https://arxiv.org/pdf/2510.15061 (Antislop framework, ICLR 2026)
- Words 5-48x more common in AI: delve(48x), tapestry(35x), "it's worth noting"(31x), multifaceted(28x), nuanced(24x)
