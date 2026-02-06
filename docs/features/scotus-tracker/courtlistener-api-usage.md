# CourtListener API Usage & Optimization

**Created:** 2026-02-02
**Purpose:** Track current API usage, potential optimizations, and feature requests for Free Law Project discussion

---

## Current API Usage

### Endpoints We Hit

| Endpoint | What We Get | Calls Per Case |
|----------|-------------|----------------|
| `/clusters/?docket__court=scotus` | Case metadata (name, date_filed, citations) | 1 (paginated) |
| `/dockets/{id}/` | Docket number, argued_at | 1 |
| `/opinions/?cluster={id}` | Opinion text (plain_text), author, opinion type | 1 |
| `/people/{id}/` | Justice names (when author_str is empty) | Cached |

**Total:** ~3 API calls per case + occasional `/people/` lookups (cached)

### Fetch Frequency

- **Current:** Manual runs only, not scheduled
- **Volume:** ~300 SCOTUS cases fetched total
- **Rate limit:** 5,000 requests/hour (we use <500 per run)

### Data We Extract

| Field | Source | Notes |
|-------|--------|-------|
| case_name, case_name_short | cluster | Direct |
| decided_at | cluster.date_filed | Direct |
| argued_at | docket.date_argued | Requires docket fetch |
| docket_number | docket | Requires docket fetch |
| citation | cluster.citations[] | First U.S. Reports or S.Ct. |
| majority_author | opinion.author_str or /people/ | Resolved via API if needed |
| dissent_authors | opinions where type contains 'dissent' | Aggregated |
| syllabus | opinion.plain_text | Regex extracted |
| opinion_excerpt | opinion.plain_text | Fallback (15K chars) |
| full opinion | opinion.plain_text | Stored in separate table with hash |

---

## What We Store Locally

### Raw Source Data (Permanent)

| Table | Fields | Purpose |
|-------|--------|---------|
| `scotus_cases` | syllabus, opinion_excerpt, source_url, pdf_url | Facts from CourtListener |
| `scotus_opinions` | content, content_hash | Full opinion text with dedup |

### AI-Generated Data (Regenerable)

| Field | Source | Can Clear & Regenerate? |
|-------|--------|------------------------|
| summary_spicy | GPT from syllabus/opinion | YES - no API re-fetch needed |
| why_it_matters | GPT from syllabus/opinion | YES |
| who_wins, who_loses | GPT | YES |
| ruling_label, ruling_impact_level | GPT | YES |
| holding, disposition | GPT | YES |

**Key Insight:** We can re-run enrichment without re-hitting CourtListener. Raw facts are stored permanently.

---

## Optimization Opportunities

### Already Implemented

1. **Content hashing** - Only update opinions if content changed
2. **Author caching** - Justice names cached to avoid repeat lookups
3. **Sync state tracking** - Resume from last position, don't re-fetch processed cases
4. **Upsert on docket_number** - Handles case revisions without duplicates

### Potential Future Optimizations

| Optimization | Benefit | Effort |
|--------------|---------|--------|
| Store raw cluster/docket JSON | Never re-fetch unchanged cases | Low |
| Batch opinion fetches | Fewer round trips | Medium |
| Webhook on new opinions | Push vs pull | Requires CL support |

---

## Feature Requests / Questions for Free Law Project

### Data Quality Issues

| Issue | Current Field | Problem |
|-------|---------------|---------|
| **Vote split** | `scdb_votes_majority` | Almost always NULL, even for older cases |
| **Disposition** | None structured | We extract "affirmed/reversed" via AI |
| **Issue area** | SCDB codes | Not reliably populated |

### Structured Data We'd Love

| Feature | Why We Want It | Current Workaround |
|---------|----------------|-------------------|
| **Vote split (5-4, 9-0)** | Display on case cards | Regex from opinion text |
| **Disposition/outcome** | Know if affirmed/reversed/vacated | AI extraction |
| **Dissent text separated** | Analyze dissents specifically | Parse from full opinion |
| **Concurrence attribution** | Who wrote concurrences | Buried in opinion types |
| **Case topic/issue tags** | Categorization | AI-generated categories |

### Questions to Ask

1. Is vote split data available in a structured field we're missing?
2. Is disposition (affirmed/reversed/vacated) available as structured data?
3. Any plans to separate dissent/concurrence text from majority?
4. Is there a changelog or webhook for when opinions are updated?

---

## For the API Access Form

### "What are you working on?"

> TrumpyTracker is a political accountability tracker. We track:
> - RSS news feeds about US politics
> - Executive orders and pardons
> - SCOTUS cases and their impact on people
>
> For SCOTUS, we fetch case data from CourtListener, then use AI to generate plain-language summaries explaining who wins, who loses, and why it matters.

### "What API access do you need?"

> **Current usage:** SCOTUS cases only via `/clusters/`, `/dockets/`, `/opinions/`, `/people/` endpoints. ~300 cases fetched total, manual runs (not automated). ~3 requests per case.
>
> **Data we store locally:** Raw opinion text with content hashing, so we don't re-fetch unchanged data.
>
> **Questions:**
> 1. Is vote split (5-4, 9-0) available in a structured field? (`scdb_votes_majority` is usually null for us)
> 2. Is disposition/outcome (affirmed/reversed) available as structured data?
> 3. Any structured separation of dissent/concurrence text?
>
> **Optimization we can do:** We already store raw data locally and only regenerate our AI summaries. Happy to reduce API calls further if needed.

---

## Related Files

- `scripts/scotus/fetch-cases.js` - Main fetch script
- `scripts/scotus/opinion-utils.js` - Opinion text handling
- `docs/features/scotus-tracker/field-mapping.md` - Field mapping reference
- `migrations/066_scotus_sync_state.sql` - Sync state table

---

**Last Updated:** 2026-02-02
