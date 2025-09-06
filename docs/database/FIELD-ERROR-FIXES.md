# Quick Reference: Common Database Field Errors

## PGRST204 Error - Field Doesn't Exist

### Error Message
```
PGRST204: Column 'field_name' does not exist
```

### Common Causes & Fixes

#### Political Entries Table
**Wrong Field Names:**
- ❌ `editorial_summary` → ✅ `description` or `editorial_summary` (check which exists)
- ❌ `summary` → ✅ `description`
- ❌ `severity_rating` → ✅ `severity`
- ❌ `federal_register_url` → ✅ `source_url`

#### Executive Orders Table  
**Wrong Field Names:**
- ❌ `editorial_summary` → ✅ `summary` (EOs don't have editorial_summary)
- ❌ `description` → ✅ `summary`
- ❌ `severity` → ✅ `severity_rating`
- ❌ `source_url` → ✅ `federal_register_url` or `source_url` (check which)

## Quick Debug Commands

### Check What Fields Actually Exist
```javascript
// In browser console or script
const result = await supabaseRequest('political_entries?limit=1');
console.log('Available fields:', Object.keys(result[0]));
```

### Common Field Mappings

| Political Entries | Executive Orders | Purpose |
|------------------|------------------|---------|
| severity | severity_rating | Base severity level |
| description | summary | Original content |
| editorial_summary | (doesn't exist) | Original AI summary |
| source_url | source_url or federal_register_url | Link to source |
| actor | (doesn't exist) | Who did it |
| (doesn't exist) | order_number | EO number |

## Before Adding New Fields

1. **Check if field exists:**
```sql
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'political_entries';
```

2. **Add if missing:**
```sql
ALTER TABLE political_entries 
ADD COLUMN new_field_name VARCHAR(255);
```

3. **Never assume fields exist** - always verify first!

## Common Script Errors & Fixes

### Error: "Cannot read property 'text' of undefined"
**Cause:** API response structure different than expected
**Fix:** Check actual response structure:
```javascript
console.log('Full response:', JSON.stringify(data, null, 2));
```

### Error: "severity_check constraint violation"
**Cause:** Trying to insert value not in CHECK constraint
**Fix:** Check current constraint:
```sql
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conname LIKE '%severity%';
```

## Emergency Rollback

If a field update breaks production:

1. **Remove the field reference from script**
2. **Deploy immediately**
3. **Then fix properly in test environment**

Example:
```javascript
// Quick fix - comment out problem field
const entry = {
    title: data.title,
    description: data.description,
    // editorial_summary: data.summary, // COMMENTED - field doesn't exist
    severity: data.severity
};
```