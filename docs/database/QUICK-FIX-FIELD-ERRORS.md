## Database Field Errors (Updated September 9, 2025)

### The ID Column Reality
**IMPORTANT**: The `id` column accepts BOTH strings and integers!
- 91% of production entries use string IDs (511 out of 564)
- Database column is INTEGER but PostgreSQL coerces strings
- Use string IDs for all new entries - they work reliably

### Current ID Generation Strategy
```javascript
function generateStringId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `entry_${timestamp}_${random}`;
}
```

### Error: "null value in column 'id' violates not-null constraint"

**Misleading Error Message!** This error often means you're trying to insert fields that don't exist or have issues, not necessarily an ID problem.

**Common Causes:**
1. Including a `source` field when it shouldn't be used
2. Trying to manually set an ID when database uses SERIAL
3. Including fields that don't exist in the table

**Solution:**
```javascript
// ❌ WRONG - Including problematic fields
const entry = {
    id: 'some-id',  // Don't set this!
    source: 'website.com',  // This field causes issues!
    status: 'active',  // Doesn't exist!
    // ... other fields
};

// ✅ CORRECT - Only include valid fields
const entry = {
    // NO id field - let database auto-generate
    date: '2025-09-09',
    actor: 'Political Actor',
    category: 'corruption_scandals',
    title: 'Article Title',
    description: 'Summary here',
    source_url: 'https://example.com/article',
    verified: true,
    severity: 'high',
    added_at: new Date().toISOString(),
    // Spicy summary fields (optional)
    spicy_summary: 'Generated summary',
    shareable_hook: 'Tweet-sized hook',
    severity_label_inapp: 'Swamp Alert 🔴',
    severity_label_share: 'Critical Issue'
};
```

### Fields That Should NOT Be Included in Inserts

| Field | Why Not | Notes |
|-------|---------|-------|
| `id` | Auto-generated | Database uses SERIAL PRIMARY KEY |
| `source` | Problematic | Use `source_url` instead, extract domain if needed |
| `status` | Doesn't exist | Never existed in political_entries table |
| `manual_submission` | Doesn't exist | Never existed in political_entries table |
| `editorial_summary` | Doesn't exist | Use `description` field instead |
| `impact_type` | Wrong table | That's for executive_orders, not political_entries |

### Valid Fields for political_entries Table

```javascript
// Complete list of valid fields for inserts:
{
    date: 'YYYY-MM-DD',  // Required
    actor: 'Actor Name',  // Optional (defaults to 'Unknown')
    category: 'category_name',  // Required (use normalized values)
    title: 'Title',  // Required
    description: 'Description',  // Required
    source_url: 'https://...',  // Required
    verified: true/false,  // Optional
    severity: 'low/medium/high/critical',  // Required
    added_at: 'ISO timestamp',  // Required
    archived: false,  // Optional (defaults to false)
    // Spicy summary fields (all optional)
    spicy_summary: 'text',
    shareable_hook: 'text',
    severity_label_inapp: 'text',
    severity_label_share: 'text'
}
```

### Debug Tip: Log Your Data Before Insert

Always log the exact data being sent to Supabase:

```javascript
console.log('Data being sent:', JSON.stringify(entry, null, 2));
console.log('Keys being sent:', Object.keys(entry).join(', '));
```

### The 11 Valid Categories

Always use these exact database values:
- `corruption_scandals`
- `democracy_elections`
- `policy_legislation`
- `justice_legal`
- `executive_actions`
- `foreign_policy`
- `corporate_financial`
- `civil_liberties`
- `media_disinformation`
- `epstein_associates`
- `other`

## Error History

### September 9, 2025
- **Issue:** Daily tracker failing with "null value in column 'id'" error
- **Cause:** Including `source` field in insert (field exists but causes issues)
- **Fix:** Removed `source` field from processedEntry object

### September 7, 2025
- **Issue:** Same error message
- **Cause:** Trying to manually set ID field
- **Fix:** Removed ID generation, let database auto-generate

### August 2025
- **Issue:** "Could not find 'source' column"
- **Cause:** Field was removed from schema
- **Fix:** Removed from all insert operations
