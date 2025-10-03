# TrumpyTracker Database Schema Documentation (ARCHIVED)
*Last Updated: September 5, 2025*
*Archived: October 2, 2025*
*Superseded By: `/docs/database/database-schema.md` (RSS system schema)*

---

**ARCHIVE NOTE:** This document represented the database schema during the legacy article-only system. It has been superseded by a comprehensive schema document that includes both the new RSS system (TEST) and legacy system (PROD).

---

## Overview
TrumpyTracker uses Supabase (PostgreSQL) with two main tables for tracking political entries and executive orders. As of September 2025, the database supports a 4-tier severity system.

## Political Entries Table (`political_entries`)

### Core Fields
| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY, SERIAL | Auto-incrementing ID |
| date | DATE | NOT NULL | Date of the political event |
| actor | VARCHAR(255) | NOT NULL | Person or organization involved |
| category | VARCHAR(100) | | Category of political entry |
| title | VARCHAR(500) | NOT NULL | Headline/title of the entry |
| description | TEXT | | Original description of the event |
| source_url | TEXT | | URL to original article/source |
| source | VARCHAR(255) | | Source domain/publication name |
| verified | BOOLEAN | DEFAULT false | Whether source is verified |
| severity | VARCHAR(50) | CHECK IN ('critical', 'high', 'medium', 'low') | 4-tier severity level |
| status | VARCHAR(50) | DEFAULT 'published' | Entry status |
| archived | BOOLEAN | DEFAULT false | Archive status |
| manual_submission | BOOLEAN | DEFAULT false | Whether manually submitted |
| added_at | TIMESTAMP | DEFAULT NOW() | When entry was added |
| created_at | TIMESTAMP | DEFAULT NOW() | Creation timestamp |
| updated_at | TIMESTAMP | | Last update timestamp |

### Spicy Summary Fields (Added Aug 2025)
| Field | Type | Description |
|-------|------|-------------|
| editorial_summary | TEXT | Original AI-generated summary |
| spicy_summary | TEXT | Angry, truthful summary for display |
| shareable_hook | VARCHAR(280) | One-liner for social media |
| severity_label_inapp | VARCHAR(50) | Display label (e.g., "Criminal Bullshit 🟠") |
| severity_label_share | VARCHAR(50) | Clean label for sharing |

### Severity Mapping
- `critical` → "Fucking Treason 🔴" (Democracy threats)
- `high` → "Criminal Bullshit 🟠" (Criminal activity)
- `medium` → "Swamp Shit 🟡" (Standard corruption)
- `low` → "Clown Show 🟢" (Incompetence)

## Executive Orders Table (`executive_orders`)

### Core Fields
| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | VARCHAR | PRIMARY KEY | Unique ID (eo_timestamp_random) |
| title | VARCHAR(500) | NOT NULL | Executive order title |
| order_number | VARCHAR(50) | UNIQUE | EO number (e.g., "14343") |
| date | DATE | NOT NULL | Publication date |
| summary | TEXT | | AI-generated summary |
| category | VARCHAR(100) | | Category (immigration, defense, etc.) |
| agencies_affected | TEXT[] | | Array of affected agencies |
| source_url | TEXT | | Federal Register URL |
| pdf_url | TEXT | | PDF document URL |
| citation | VARCHAR(255) | | Official citation |
| publication_date | DATE | | Federal Register publication date |
| document_number | VARCHAR(100) | | Federal Register document number |
| source | VARCHAR(255) | DEFAULT 'Federal Register API' | Data source |
| verified | BOOLEAN | DEFAULT true | Verification status |
| added_at | TIMESTAMP | DEFAULT NOW() | When added to database |
| impact_score | INTEGER | DEFAULT 50 | Impact assessment (0-100) |
| implementation_status | VARCHAR(50) | DEFAULT 'issued' | Implementation status |
| severity_rating | VARCHAR(50) | CHECK IN ('critical', 'high', 'medium', 'low') | 4-tier severity |
| policy_direction | VARCHAR(50) | | expand/restrict/modify/create/eliminate |
| implementation_timeline | VARCHAR(50) | | immediate/30_days/90_days/ongoing |
| impact_areas | TEXT[] | | Array of policy areas affected |
| full_text_available | BOOLEAN | DEFAULT true | Whether full text is available |
| type | VARCHAR(50) | DEFAULT 'executive_order' | Document type |
| legal_challenges | TEXT[] | | Array of legal challenges |
| related_orders | TEXT[] | | Array of related order numbers |
| archived | BOOLEAN | DEFAULT false | Archive status |
| created_at | TIMESTAMP | DEFAULT NOW() | Creation timestamp |
| updated_at | TIMESTAMP | | Last update timestamp |

### EO-Specific Spicy Fields (Added Sept 2025)
| Field | Type | Description |
|-------|------|-------------|
| eo_impact_type | VARCHAR(50) | EO-specific categorization |
| spicy_summary | TEXT | Angry translation of EO intent |
| shareable_hook | VARCHAR(280) | Social media hook |
| severity_label_inapp | VARCHAR(50) | Display label |
| severity_label_share | VARCHAR(50) | Clean share label |

### EO Impact Type Mapping
- `fascist_power_grab` → "Fascist Power Grab 🔴"
- `authoritarian_overreach` → "Authoritarian Overreach 🟠"
- `corrupt_grift` → "Corrupt Grift 🟡"
- `performative_bullshit` → "Performative Bullshit 🟢"

## Database Constraints

### Political Entries
```sql
ALTER TABLE political_entries 
ADD CONSTRAINT political_entries_severity_check 
CHECK (severity IN ('critical', 'high', 'medium', 'low'));
```

### Executive Orders
```sql
ALTER TABLE executive_orders 
ADD CONSTRAINT executive_orders_severity_rating_check 
CHECK (severity_rating IN ('critical', 'high', 'medium', 'low'));
```

## Migration History

### September 5, 2025
- Added 'critical' tier to both severity constraints
- Enabled 4-tier severity system (critical/high/medium/low)

### August 2025
- Added spicy summary fields to both tables
- Added eo_impact_type to executive_orders

### Original Schema
- 3-tier severity system (high/medium/low)
- Basic tracking fields only

## Usage Notes

1. **ID Generation**: 
   - Political entries use auto-incrementing integers
   - Executive orders use string IDs (eo_timestamp_random)

2. **Severity Assignment**:
   - Initial severity assigned by keyword matching
   - Re-evaluated by AI during spicy summary generation
   - 'critical' reserved for democracy-threatening content

3. **Source Verification**:
   - Automatic for 15+ reputable news domains
   - Manual verification option via admin panel

4. **Archive vs Delete**:
   - Use archive flag instead of deleting entries
   - Preserves data integrity and audit trail

---

*Archived: October 2, 2025*  
*Original Last Updated: September 5, 2025*
