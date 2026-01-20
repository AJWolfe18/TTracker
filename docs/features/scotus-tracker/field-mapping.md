# CourtListener API Field Mapping - SCOTUS Tracker

**Date:** 2026-01-19
**Status:** VERIFIED - API Tested with Live Token
**Blocking:** Migration 066 (ADO-87)

---

## API Verification Summary

**Verified with token:** `c9c7c...894` (2026-01-19)
**Rate Limits:** 5,000 queries/hour (authenticated)

### Verified Field Mapping

| Our Field | CL Source | Endpoint | Status |
|-----------|-----------|----------|--------|
| `courtlistener_cluster_id` | `id` | cluster | **CONFIRMED** |
| `courtlistener_docket_id` | `docket_id` | cluster | **CONFIRMED** |
| `case_name` | `case_name` | cluster | **CONFIRMED** |
| `case_name_short` | `case_name_short` | cluster | **CONFIRMED** |
| `decided_at` | `date_filed` | cluster | **CONFIRMED** |
| `argued_at` | `date_argued` | **docket** | Requires docket fetch |
| `docket_number` | `docket_number` | docket | **CONFIRMED** |
| `citation` | `citations[]` | cluster | **CONFIRMED** |
| `majority_author` | `author` | opinion | **CONFIRMED** |
| `dissent_authors` | opinions where type='dissent' | opinions | Aggregate |
| `syllabus` | **`plain_text`** | opinion | In opinion text, NOT cluster field |
| `vote_split` | `scdb_votes_majority` | cluster | **MOSTLY NULL** - unreliable |

---

## Critical Findings

### 1. Syllabus Location

**Finding:** Syllabus is in **opinion `plain_text`**, not the cluster `syllabus` field (which is always empty).

**Implementation:** Extract from opinion text using regex pattern:
```javascript
const syllabusMatch = plainText.match(/Syllabus\n([\s\S]{100,2000}?)(?=\nOpinion|\nORDER|$)/i);
```

### 2. Vote Split Data

**Finding:** SCDB `scdb_votes_majority` is **NULL even on older cases** - unreliable for MVP.

**Implementation:** Make `vote_split` nullable. Options for future:
- Extract from opinion text (regex: "X-X" or "X to X")
- Count majority vs dissent opinions
- Manual enrichment

### 3. Argued Date Location

**Finding:** `argued_at` is on the **docket**, not the cluster.

**Implementation:** Requires 3-endpoint fetch pattern:
1. Cluster endpoint (main case data)
2. Docket endpoint (argued_at, docket_number)
3. Opinions endpoint (syllabus, author, dissents)

### 4. Opinion Type Matching

**Finding:** Opinion types are strings like `020majority`, `015lead`, `025plurality`, not exact enum values.

**Implementation:** Use regex matching, not exact equality:
```javascript
// Preference order for majority author
const preference = [
  /majority/i,     // 020majority, MAJORITY, etc.
  /per.?curiam/i,  // per_curiam, per curiam
  /lead/i,         // 015lead
  /plurality/i,    // 025plurality
  /combined/i      // 010combined
];
```

---

## 3-Endpoint Fetch Pattern

```javascript
// 1. Fetch SCOTUS clusters (paginated via `next` URL)
GET /clusters/?docket__court=scotus&date_filed__gte={last_date_filed}&page_size=50

// 2. For each cluster, fetch docket for argued_at + docket_number
GET /dockets/{docket_id}/

// 3. Fetch opinions for syllabus + author + dissents
GET /opinions/?cluster={cluster_id}
```

### Pagination Strategy

CourtListener uses `next` URL pagination (not cursor tokens):
```javascript
async function fetchAllClusters(startUrl) {
  let url = startUrl;
  while (url) {
    const response = await fetch(url, { headers: authHeader });
    const data = await response.json();

    for (const cluster of data.results) {
      await processCluster(cluster);
    }

    url = data.next;  // null when done
  }
}
```

---

## Text Field Priority

Per verification, use this fallback order for opinion text:

1. `plain_text` - Extracted from PDF/Word (most common for SCOTUS)
2. `html_with_citations` - Generated HTML with citation links
3. `xml_harvard` - Harvard Caselaw Access Project

**Note:** For syllabus extraction, `plain_text` is preferred as regex patterns work best.

---

## Justice Name Format

**Finding:** Names come as full strings like "John G. Roberts, Jr." or linked Judge IDs.

**Implementation:** Store as-is initially. Normalization can be added later if needed.

---

## Schema Decisions Based on Verification

| Field | Decision | Rationale |
|-------|----------|-----------|
| `vote_split` | **Nullable** | SCDB data unreliable |
| `syllabus` | **Nullable** | Extract from text, may fail |
| `opinion_excerpt` | **Added** | Fallback if syllabus not found |
| `argued_at` | **Nullable** | Requires extra API call |
| `dissent_authors` | **Array** | Aggregated from opinions |

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `COURTLISTENER_API_TOKEN` | API authentication |
| `SUPABASE_TEST_URL` | TEST database URL |
| `SUPABASE_TEST_SERVICE_KEY` | Database write access |

---

## Sources

- [REST API v4.3 Documentation](https://www.courtlistener.com/help/api/rest/)
- [Case Law APIs](https://www.courtlistener.com/help/api/rest/case-law/)
- Live API verification (2026-01-19)
