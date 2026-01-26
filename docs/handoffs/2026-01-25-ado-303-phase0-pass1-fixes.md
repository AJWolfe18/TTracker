# 2026-01-25: ADO-303 Phase 0 Pass 1 Fixes

**ADO-303** Ready for Prod. All Phase 0.1 fixes implemented and validated.

## Commits
```
08e34ca feat(ado-303): implement Phase 0 Pass 1 fixes
871b91f feat(ado-303): cert skip + quote truncation
a794cf1 feat(ado-303): add party repair + opener fixer post-gen
7e14bc3 fix(ado-303): expand opener fixer to detect more legal subjects
7f16072 fix(ado-303): add explicit opener rules to prevent boring "The Court" starts
```

## What Was Implemented

### Phase 0 (Original)
| Feature | Description |
|---------|-------------|
| Model config | gpt-4o-mini only (removed gpt-5-mini fallback) |
| Generic party lint | Bans standalone "petitioner"/"respondent" |
| Publish gate | Rule-based checks before publishing |
| Retry logic | Up to 2 retries on empty/issues |

### Phase 0.1 (This Session)
| # | Feature | Description |
|---|---------|-------------|
| 1 | **Cert skip** | Skip cert grants/denials BEFORE Pass 1 (saves cost) |
| 2 | **Quote truncation** | Truncate+telemetry instead of hard fail |
| 3 | **Party repair** | Expands "petitioner" → "the petitioner (Smith)" from case caption |
| 4 | **Opener fixer** | Deterministic rewrite of "In a..." → varied openers (no LLM call) |
| 5 | **Opener prompt rules** | Explicit ban on "The Court..." openers, require impact-first writing |

## Validation Results

### 10-Case Batch
- Pass rate: **100%** (10/10)
- Quote truncation: 3 cases truncated successfully
- Opener repair: 5 cases rewritten
- Auto-published: 7 cases
- Needs review: 3 cases (soft drift)

### Opener Quality (After Prompt Fix)
| Case | Opener |
|------|--------|
| Barrett v. US | "A defendant can no longer be convicted under two separate statutes..." ✅ |
| Case v. Montana | "Millions of homeowners now face the potential for unwarranted police entries..." ✅ |
| Bost v. Illinois | "With the ruling reversed and remanded, the authority..." ⚠️ (improved but not perfect) |

## Known Issues (Not Fixed - Different Cards)

1. **Label-to-outcome mismatch** - Some cases where defendants/immigrants WIN are labeled "Institutional Sabotage" instead of positive labels. Publish gate doesn't catch semantic mismatches. (Separate card needed)

2. **Opener variation** - ~70% still follow "The Court" patterns before prompt fix. After fix, 2/3 lead with impact. More template diversity may help.

## Files Changed

- `scripts/scotus/enrich-scotus.js` - Cert detection, party repair, opener fixer
- `scripts/enrichment/scotus-fact-extraction.js` - Quote truncation
- `scripts/enrichment/scotus-gpt-prompt.js` - Opener rules in both prompts

## Next Steps

1. Cherry-pick commits to main for PROD deployment
2. Create card for label-to-outcome validation in publish gate
