# SCOTUS Frontend Specification

**Created:** 2026-01-23
**Status:** Ready for Development
**ADO Items:** #83 (page), #82 (CSS)

---

## Overview

Display SCOTUS cases with ruling impact ratings, editorial summaries, and case metadata. Follows existing TrumpyTracker UI patterns.

---

## Database Fields → UI Mapping

### List View (Card)

| UI Element | DB Field | Notes |
|------------|----------|-------|
| **Title** | `case_name_short` or `case_name` | Short preferred, fallback to full |
| **Impact Badge** | `ruling_impact_level` (0-5) + `ruling_label` | Color-coded badge |
| **Date** | `decided_at` | Format: "Jun 6, 2024" |
| **One-liner** | `who_wins` | Truncated to ~100 chars |
| **Vote** | `vote_split` | Often null - hide if missing |
| **Author** | `majority_author` | "Thomas, J." style |

### Detail Modal

| UI Element | DB Field | Notes |
|------------|----------|-------|
| **Title** | `case_name` | Full name |
| **Citation** | `citation` | e.g., "602 U.S. 257" |
| **Docket** | `docket_number` | e.g., "23-146" |
| **Dates** | `argued_at`, `decided_at` | Both if available |
| **Term** | `term` | e.g., "2024" |
| **Impact Badge** | `ruling_impact_level` + `ruling_label` | Large, prominent |
| **Disposition** | `disposition` | "Affirmed", "Reversed", etc. |
| **Case Type** | `case_type` | "Merits", "Procedural", etc. |
| **Majority Author** | `majority_author` | Full name |
| **Dissenting** | `dissent_authors[]` | Comma-separated list |
| **Who Wins** | `who_wins` | Full text |
| **Who Loses** | `who_loses` | Full text |
| **Summary** | `summary_spicy` | Main editorial content |
| **Why It Matters** | `why_it_matters` | Impact explanation |
| **Dissent Highlights** | `dissent_highlights` | If present and not "null" |
| **Evidence** | `evidence_anchors[]` | Cited sources |
| **Links** | `source_url`, `pdf_url` | External links |

---

## Ruling Impact Scale (CSS)

| Level | Color | Label | CSS Class |
|-------|-------|-------|-----------|
| **5** | 🔴 Red | Constitutional Crisis | `.impact-5`, `.impact-crisis` |
| **4** | 🟠 Orange | Rubber-stamping Tyranny | `.impact-4`, `.impact-tyranny` |
| **3** | 🟡 Yellow | Institutional Sabotage | `.impact-3`, `.impact-sabotage` |
| **2** | 🔵 Blue | Judicial Sidestepping | `.impact-2`, `.impact-sidestepping` |
| **1** | ⚪ Gray | Crumbs from the Bench | `.impact-1`, `.impact-crumbs` |
| **0** | 🟢 Green | Democracy Wins | `.impact-0`, `.impact-win` |

---

## Query Requirements

### List Endpoint (scotus-active or inline)

```sql
SELECT
  id, case_name, case_name_short, decided_at, term,
  ruling_impact_level, ruling_label, who_wins,
  majority_author, vote_split, disposition
FROM scotus_cases
WHERE is_public = true
ORDER BY decided_at DESC
LIMIT 50
```

### Detail Endpoint (scotus-detail or inline)

```sql
SELECT *
FROM scotus_cases
WHERE id = $1 AND is_public = true
```

**Note:** Do NOT select from `scotus_opinions` for frontend - that table is for enrichment input only (huge text fields).

---

## Page Structure

```
/scotus.html (or section in index.html)
├── Header: "Supreme Court Rulings"
├── Filter bar (optional): By term, by impact level
├── Card grid/list
│   └── Each card: title, impact badge, date, who_wins preview
└── Detail modal (on card click)
    └── Full case details as above
```

---

## Existing Patterns to Reuse

From `public/index.html` and existing story cards:
- Card layout structure
- Modal pattern (stories-detail)
- Date formatting utilities
- Badge/tag styling

---

## Edge Functions vs Inline

**Decision:** Start with inline JavaScript (like current stories implementation), add edge functions later if needed for:
- Complex filtering
- Pagination
- Search

---

## Known Data Issues

1. **`dissent_highlights`** - Sometimes stores string `"null"` instead of actual null
2. **`vote_split`** - Mostly null (unreliable source data)
3. **`dissent_authors`** - Empty array `[]` when no dissents

---

## Files to Create

| File | Purpose |
|------|---------|
| `public/scotus.html` | Main SCOTUS page (or add section to index.html) |
| `public/js/scotus.js` | SCOTUS-specific JavaScript |
| `public/css/scotus.css` | SCOTUS-specific styles (impact colors, etc.) |

---

## Acceptance Criteria

- [ ] List view shows all public SCOTUS cases
- [ ] Cards display: title, impact badge, date, who_wins preview, author
- [ ] Clicking card opens detail modal with all fields
- [ ] Impact badges color-coded per scale
- [ ] Empty/null fields gracefully hidden
- [ ] Mobile responsive
- [ ] Links to source_url and pdf_url work
