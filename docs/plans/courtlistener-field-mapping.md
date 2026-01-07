# CourtListener API Field Mapping - SCOTUS Tracker

**Date:** 2025-12-31
**Status:** Draft - Needs Live API Verification
**Blocking:** Migration 050 (TTRC-XXX-1)

---

## API Shape Spike Summary

### What We Know (from documentation)

| Our Field | CourtListener Field | Source | Confidence |
|-----------|---------------------|--------|------------|
| `courtlistener_cluster_id` | `id` (cluster) | Cluster endpoint | ✅ High |
| `courtlistener_docket_id` | `docket_id` (added v3.15) | Cluster endpoint | ✅ High |
| `case_name` | `case_name` | Cluster endpoint | ✅ High |
| `docket_numbers` | `docket.docket_number` | Docket endpoint | ✅ High |
| `decided_at` | `date_filed` | Cluster endpoint | ✅ High |
| `argued_at` | Unknown - may need Docket | TBD | ⚠️ Verify |
| `citation` | `citations[]` | Cluster endpoint | ✅ High |

### Opinion Text Fields

| Our Field | CourtListener Field | Notes | Confidence |
|-----------|---------------------|-------|------------|
| `syllabus` | `sub_opinions[type='syllabus']` | May be separate opinion | ⚠️ Verify |
| `majority_excerpt` | `xml_harvard` or `plain_text` | Prefer `html_with_citations` | ✅ High |
| `dissent_excerpt` | `sub_opinions[type='dissent']` | Linked via `joined_by` | ⚠️ Verify |

### Text Field Priority (3-tier fallback)

Per CourtListener docs, opinion text fields by source:
1. `plain_text` - From PDF/Word extraction (preferred if clean)
2. `html_with_citations` - Generated from source HTML (most reliable)
3. `xml_harvard` - Harvard Caselaw Access Project (may have OCR issues)

Fallback fields (if above are empty):
- `html_columbia` - Columbia collaboration
- `html_lawbox` - Lawbox donation
- `html_anon_2020` - Anonymous 2020 source
- `html` - Court website (Word Perfect/HTML)

### Vote Data (SCDB Integration)

| Our Field | CourtListener Field | Notes | Confidence |
|-----------|---------------------|-------|------------|
| `vote_split` | Derived from `scdb_votes_majority` | "6-3" format | ⚠️ Verify |
| `vote_fracture` | `scdb_votes_majority` | 1-5 scale | ⚠️ Verify |
| `majority_author` | `panel[]` + `author` on Opinion | Need cross-reference | ⚠️ Verify |
| `dissenting_justices` | `sub_opinions` where type='dissent' | Via `author` field | ⚠️ Verify |
| `justice_votes` | Not available directly | May need SCDB join | 🔴 Missing |

**Critical Note:** SCDB data covers 1946-2013. Recent cases (2014+) may have limited vote metadata. Plan to use `oyez_url` for future Oyez integration as backup.

### Judge/Justice Data

| Our Field | CourtListener Field | Notes | Confidence |
|-----------|---------------------|-------|------------|
| `majority_author` | `opinion.author` or `opinion.author_str` | On majority opinion | ⚠️ Verify |
| `dissenting_justices` | `opinion.author` where type='dissent' | Array of justices | ⚠️ Verify |
| `panel` | `cluster.panel[]` | All participating justices | ✅ High |

### Opinion Type Detection

CourtListener `Opinion.type` values:
- `COMBINED` - Single combined opinion
- `LEAD` - Lead opinion
- `MAJORITY` - Majority opinion (expected for SCOTUS)
- `CONCURRENCE` - Concurrence
- `DISSENT` - Dissent
- `SYLLABUS` - Syllabus (official summary)

### SCOTUS Filtering

```
GET /api/rest/v4/clusters/?docket__court=scotus&page_size=50
```

Additional filters available:
- `date_filed__gte=2024-01-01` - Filter by date
- `precedential_status=Published` - Only published opinions
- `scdb_votes_majority__gt=5` - Filter by vote margin (SCDB cases only)

---

## What Needs Live Verification

### Before Migration 050

**Must Verify (blocks schema):**
1. [ ] Syllabus location - Is it a separate `sub_opinion` or a field on cluster?
2. [ ] Vote split format - Exact format of `scdb_votes_majority` field
3. [ ] Recent cases (2024+) - Do they have vote data at all?
4. [ ] `argued_at` field - Where is oral argument date stored?

**Should Verify (affects worker logic):**
5. [ ] Opinion text field priority - Which field is most consistently populated?
6. [ ] Justice name format - "Roberts" vs "John G. Roberts, Jr." vs normalization needed
7. [ ] Related/consolidated cases - How to detect via API?

### Verification Script

Once you have a token, run:

```bash
# Get one SCOTUS cluster
curl -sS -H "Authorization: Token $COURTLISTENER_TOKEN" \
  "https://www.courtlistener.com/api/rest/v4/clusters/?docket__court=scotus&page_size=1" \
  | jq '.'

# Get opinions for that cluster
curl -sS -H "Authorization: Token $COURTLISTENER_TOKEN" \
  "https://www.courtlistener.com/api/rest/v4/opinions/?cluster=<CLUSTER_ID>" \
  | jq '.'
```

---

## Registration Required

1. Go to https://www.courtlistener.com/register/
2. Create account
3. Generate API token at https://www.courtlistener.com/api/rest-info/
4. Store as `COURTLISTENER_TOKEN` GitHub secret

**Rate Limits:** 5,000 queries/hour (authenticated)

---

## Field Mapping Confidence Summary

| Confidence | Count | Notes |
|------------|-------|-------|
| ✅ High | 8 | Can proceed with schema |
| ⚠️ Verify | 9 | Need live API check |
| 🔴 Missing | 1 | `justice_votes` needs SCDB join or Oyez |

**Recommendation:** Schema can proceed with nullable fields for unverified items. Live verification can adjust during implementation.

---

## Sources

- [REST API v4.3 Documentation](https://www.courtlistener.com/help/api/rest/)
- [Case Law APIs](https://www.courtlistener.com/help/api/rest/case-law/)
- [SCDB Integration Announcement](https://free.law/2014/12/21/scdb)
- [GitHub Discussion: Complete Case Text](https://github.com/freelawproject/courtlistener/discussions/4950)
- [Bulk Data Documentation](https://www.courtlistener.com/help/api/bulk-data/)
