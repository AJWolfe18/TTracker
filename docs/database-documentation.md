# TrumpyTracker Database Documentation
*Last Updated: September 3, 2025*

## Overview

TrumpyTracker uses Supabase (PostgreSQL) to store all political tracking data. This document provides a complete reference for the database schema, common issues, and best practices.

## Database Tables

### 1. `political_entries`
Stores political news articles and events from daily tracking.
- **Schema**: [political-entries-schema.md](./database/political-entries-schema.md)
- **Primary Key**: `id` (SERIAL - auto-incrementing integer)
- **Collection**: Daily automated via RSS feeds and manual submission

### 2. `executive_orders`  
Stores all Executive Orders from the Federal Register API.
- **Schema**: [executive-orders-schema.md](./database/executive-orders-schema.md)
- **Primary Key**: `id` (TEXT - generated as `eo_timestamp_random`)
- **Collection**: Daily automated at 11am EST via GitHub Actions

### 3. `dashboard_stats` (View)
Aggregated statistics view for the dashboard.
- Combines counts from both tables
- Used by stats display component

## Field Naming Conventions

### Use These Field Names:
- `source_url` - Full URL to source (NOT `source`)
- `summary` - AI-generated summary (NOT `editorial_summary`)
- `description` - Article description/summary
- `spicy_summary` - GPT-5 angry translation

### Deprecated/Removed Fields:
- ❌ `source` - Use `source_url` instead
- ❌ `editorial_summary` - Use `summary` or `description`
- ❌ Manual ID generation - Let database handle it

## Common Integration Issues

### 1. Missing Column Errors (PGRST204)

**Error**: `"Could not find the 'X' column of 'table_name' in the schema cache"`

**Common Causes**:
- Field doesn't exist in database
- Using old field name
- Typo in field name

**Solution**: Check schema documentation, use correct field names

### 2. ID Generation Issues

**Political Entries**: 
- Uses SERIAL (auto-incrementing integer)
- Never manually set the ID
- Let database generate it

**Executive Orders**:
- Uses TEXT with format `eo_timestamp_random`
- Generated in JavaScript before insert
- Must be unique

### 3. Data Type Mismatches

**Arrays**: Use PostgreSQL array notation
```javascript
impact_areas: ['area1', 'area2'] // Correct
impact_areas: 'area1, area2'     // Wrong
```

**Booleans**: Use actual booleans
```javascript
verified: true   // Correct
verified: 'true' // Wrong
```

## Environment Configuration

### Production
```javascript
SUPABASE_URL=https://osjbulmltfpcoldydexg.supabase.co
SUPABASE_ANON_KEY=eyJhbGci...
```

### Test Environment
```javascript
SUPABASE_TEST_URL=https://[test-instance].supabase.co
SUPABASE_TEST_ANON_KEY=eyJhbGci...
```

## API Integration Points

### Daily Tracker
- **Script**: `/scripts/daily-tracker-supabase.js`
- **Table**: `political_entries`
- **Frequency**: Daily at 9am & 10am EST

### Executive Orders Tracker
- **Script**: `/scripts/executive-orders-tracker-supabase.js`
- **Table**: `executive_orders`
- **Frequency**: Daily at 11am EST

### Manual Article Processor
- **Script**: `/scripts/manual-article-processor.js`
- **Table**: `political_entries`
- **Trigger**: Manual via admin panel

## Dashboard Data Flow

```
Supabase Tables
    ↓
Dashboard API Calls (24hr cache)
    ↓
React Components
    ├── PoliticalEntryCard
    └── ExecutiveOrderCard
```

### Key Display Fields

**Political Entries**:
- Primary: `spicy_summary || description`
- Metadata: `title`, `date`, `actor`, `severity`

**Executive Orders**:
- Primary: `spicy_summary || summary`
- Metadata: `order_number`, `date`, `category`

## Spicy Summary System

### GPT-5 Integration
- **Models**: gpt-5-mini (default), gpt-5 (critical)
- **Cost**: $0.00054-0.00255 per item
- **Fields Generated**:
  - `spicy_summary` - Main angry translation
  - `shareable_hook` - Social media text
  - `severity_label_inapp` - In-app display
  - `severity_label_share` - Clean social label

### Impact Categories (EOs)
- `fascist_power_grab` - Democracy threats
- `authoritarian_overreach` - Control/surveillance
- `corrupt_grift` - Self-dealing
- `performative_bullshit` - Theater/distraction

## Best Practices

### 1. Always Check Schema First
Before adding new fields, verify they exist in the database schema.

### 2. Use Fallbacks
```javascript
const displayText = entry.spicy_summary || entry.summary || entry.description;
```

### 3. Handle Null Values
```javascript
if (order.agencies_affected && order.agencies_affected.length > 0) {
  // Process agencies
}
```

### 4. Test on Test Branch First
All database changes should be tested on the test environment before production.

## Troubleshooting Checklist

- [ ] Check field exists in schema documentation
- [ ] Verify correct field name (no typos)
- [ ] Confirm data type matches schema
- [ ] Test with minimal data first
- [ ] Check Supabase logs for detailed errors
- [ ] Verify environment variables are set

## Related Documentation

- [Executive Orders Collection](./executive-orders-collection.md)
- [Daily Tracker Implementation](./daily-tracker-implementation.md)  
- [Spicy Summaries Implementation](./spicy-summaries-implementation.md)
- [Admin Panel Guide](./admin-panel-guide.md)

## Support

For database issues:
1. Check this documentation first
2. Review schema files in `/docs/database/`
3. Check Supabase dashboard for table structure
4. Create JIRA ticket if issue persists
