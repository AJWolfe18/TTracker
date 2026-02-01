# 2026-01-25: ADO-275 SCOTUS Tone Variation Implementation

**ADO-275** in Testing. 25-case batch running - needs result validation.

## Commits
```
88c4248 feat(ado-275): implement SCOTUS tone variation system
```

## What Was Implemented

Replaced `scotus-variation-pools.js` (Math.random + literal openers) with frame-based system:

- **NEW:** `scripts/enrichment/scotus-style-patterns.js` (829 lines)
  - 6 pools: procedural, alarmed, critical, grudging_credit, voting_rights_override, agency_power_override
  - Deterministic selection via FNV-1a hash
  - Frame selection priority: clamp_reason → inferIssueOverride → Pass1 facts → estimateFrameFromMetadata
  - Post-gen validation (regex-based banned starters + duplicate signature detection)
  - REQUIRED VARIATION block builder

- **UPDATE:** `scripts/enrichment/scotus-gpt-prompt.js`
  - Added REQUIRED VARIATION section to PASS2_SYSTEM_PROMPT
  - Mismatch fuse instructions (disabled for clamped cases)

- **UPDATE:** `scripts/scotus/enrich-scotus.js`
  - Wired new variation system
  - Added post-gen validation + repair
  - Removed old estimateImpactLevel (replaced by selectFrame)

- **DEPRECATE:** `scripts/enrichment/scotus-variation-pools.js`
  - Added deprecation header

## Next Steps

Run 25-case validation batch:
```bash
node scripts/scotus/enrich-scotus.js --limit=25
```

Then run duplicate check SQL:
```sql
with s as (
  select id, lower(regexp_replace(split_part(summary_spicy, '.', 1), '[^a-z0-9 ]', '', 'g')) as first_sentence_norm
  from scotus_cases where enrichment_status = 'enriched' order by updated_at desc limit 25
)
select first_sentence_norm, count(*) as ct from s group by first_sentence_norm having count(*) > 1 order by ct desc;
```

Acceptance criteria:
1. 0 exact duplicate normalized signature sentences
2. No pattern ID used >2x
3. 0 banned template starters in published items
4. Clamped cases use procedural frame
5. Frame distribution aligns with case characteristics

If validation passes → Ready for Prod.

## Export Query for Review

Run this to export enriched cases for manual review:

```sql
SELECT
  id,
  case_name,
  ruling_impact_level,
  ruling_label,
  who_wins,
  who_loses,
  LEFT(summary_spicy, 200) as summary_preview,
  clamp_reason,
  is_public,
  needs_manual_review,
  updated_at
FROM scotus_cases
WHERE enrichment_status = 'enriched'
ORDER BY updated_at DESC
LIMIT 25;
```

**Review checklist:**
1. Variability - are summary_spicy openings diverse (not repetitive)?
2. Labels - do ruling_impact_level and ruling_label match case content?
3. Who wins/loses - accurate and specific?
4. Clamped cases - procedural framing (not merits language)?
5. No banned template phrases in summaries?
