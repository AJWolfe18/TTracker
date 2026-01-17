# SCOTUS Rulings & Opinions PRD

**Created:** 2025-12-30
**Updated:** 2026-01-16
**Status:** Ready for Development
**ADO Epic:** [ADO-106](https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/106)

---

## Overview

Track Supreme Court rulings with AI-powered editorial analysis from a pro-people, anti-corporate perspective. Surface who wins, who loses, and why it matters.

---

## Ruling Impact Scale (Final)

| Level | Color | Label | Editorial Logic | Profanity |
|-------|-------|-------|-----------------|-----------|
| **5** | 🔴 | Constitutional Crisis | Precedent is dead. Raw power/money has replaced the law. | Yes |
| **4** | 🟠 | Rubber-stamping Tyranny | Court green-lights police/state/executive overreach. | Yes |
| **3** | 🟡 | Institutional Sabotage | Technical moves that make rights impossible to use. | No |
| **2** | 🔵 | Judicial Sidestepping | Kick the can. Avoiding merits to let bad status quo continue. | No |
| **1** | ⚪ | Crumbs from the Bench | Win for people, but narrow/fragile/temporary. | No |
| **0** | 🟢 | Democracy Wins | Rare win where system protects the vulnerable. | No |

---

## Tone & Style Rules

1. **Follow the Money** - Name Federalist Society, Leonard Leo, Koch, Harlan Crow when relevant
2. **Human Cost** - Always explain impact on wallet, body, or freedom (YOUR rights, not abstract)
3. **No Legalese** - Translate: "Standing" = "technical excuse to avoid ruling"
4. **No Both-Sides** - Pro-people, anti-fascist editorial perspective
5. **Evidence Anchored** - Cite [syllabus], [majority], [dissent]

---

## Technical Architecture

### Data Source
- **Primary:** CourtListener API (free with token, 5K req/hour)
- **Backup:** SCOTUS slip opinions, Oyez

### Schema (see `migrations/050-scotus-cases.sql`)
```sql
scotus_cases (
  courtlistener_cluster_id BIGINT UNIQUE NOT NULL,  -- canonical key
  case_name, term, decided_at, argued_at,
  vote_split, majority_author, dissent_authors,
  ruling_impact_level SMALLINT,  -- 0-5
  ruling_label TEXT,
  who_wins TEXT,
  who_loses TEXT,
  summary_spicy TEXT,
  why_it_matters TEXT,
  dissent_highlights TEXT,
  evidence_anchors TEXT[],
  ...
)
```

### Enrichment Pipeline
- Reuse existing `job_queue` with `scotus.fetch` and `scotus.enrich` job types
- Cost tracking via `budgets` table
- ~$0.01/case (GPT-4o-mini)

---

## Files

| File | Purpose |
|------|---------|
| `scripts/enrichment/scotus-gpt-prompt.js` | System prompt, tone calibration, validation |
| `scripts/enrichment/scotus-variation-pools.js` | Anti-repetition variation pools |
| `docs/features/scotus-tracker/field-mapping.md` | CourtListener API field mapping |
| `migrations/050-scotus-cases.sql` | Database schema (TBD) |

---

## MVP Phasing

### Phase 1: Decisions/Opinions (MVP) - ADO-106
- Ingest decided cases from CourtListener
- Generate: who_wins, who_loses, summary_spicy, why_it_matters, dissent_highlights
- Display in UI with existing theme patterns

### Phase 2: Shadow Docket
- Emergency applications, stays
- Different ingestion cadence

### Phase 3: Calendar/Previews
- Upcoming oral arguments
- Case tracking before decision

---

## Critical Design Decisions

### 1. Identity: CourtListener IDs, NOT docket numbers
- Docket numbers aren't unique (consolidated cases, format variations)
- `courtlistener_cluster_id` is the canonical key

### 2. Taxonomy: Reuse existing category system
- `category` = existing 7 categories (justice_legal, etc.)
- `scotus_issue_tags[]` = fine-grained SCOTUS labels

### 3. Severity: Ruling Impact Level (0-5)
- NOT based on vote split (5-4 doesn't mean worse than 9-0)
- Based on WHO WINS and WHO LOSES
- See scale above

---

## Cost Estimates

| Operation | Cost | Notes |
|-----------|------|-------|
| CourtListener fetch | Free | Rate limited, cache aggressively |
| Case enrichment | ~$0.01/case | GPT-4o-mini |
| Ongoing (50 cases/term) | ~$0.50/term | Negligible vs $20/mo budget |

---

## Blockers

1. ~~Define severity labels~~ ✅ Done (see scale above)
2. ~~Create prompt files~~ ✅ Done
3. [ ] CourtListener API token - need to register
4. [ ] Live field verification with token
5. [ ] Migration 050 (schema)

---

## PROD Deployment Checklist

Track all files/migrations needed to deploy SCOTUS feature to production.

### Files Ready (created in TEST)
- [x] `scripts/enrichment/scotus-gpt-prompt.js` - System prompt, validation
- [x] `scripts/enrichment/scotus-variation-pools.js` - Anti-repetition pools
- [x] `docs/features/scotus-tracker/prd.md` - This PRD
- [x] `docs/features/scotus-tracker/field-mapping.md` - CourtListener field mapping

### Files To Create
- [ ] `migrations/050-scotus-cases.sql` - Database schema
- [ ] `scripts/scotus/fetch-cases.js` - CourtListener fetch worker (or edge function)
- [ ] `scripts/scotus/enrich-cases.js` - GPT enrichment worker
- [ ] UI components (TBD - may reuse existing story card pattern)

### Secrets/Config
- [ ] `COURTLISTENER_API_TOKEN` - GitHub secret (TEST + PROD)
- [ ] Budget table entry for SCOTUS enrichment spending

### Edge Functions (if applicable)
- [ ] TBD based on architecture decision (inline script vs edge function)

### Migration Order
1. Apply migration 050 first (creates table)
2. Deploy enrichment scripts
3. Trigger initial fetch
4. Verify data in TEST
5. Cherry-pick to PROD branch
6. Create PR, run AI review
7. Merge and deploy

---

## References

- CourtListener API: https://www.courtlistener.com/api/
- SCOTUS slip opinions: https://www.supremecourt.gov/opinions/slipopinion/
- Oyez: https://www.oyez.org/
- Existing severity system: `docs/database/severity-system.md`
