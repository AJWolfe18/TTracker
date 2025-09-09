# Database ID Quick Reference

## Current State (September 2025)
- **Database accepts BOTH string and integer IDs** in the `id` column
- 91% of entries (511/564) use string IDs successfully
- 9% of entries (53/564) use integer IDs
- The column is defined as INTEGER but PostgreSQL coerces strings

## ID Strategy
We use **string IDs** for all new entries because:
1. Most existing entries already use them
2. Avoids conflicts with SERIAL sequence issues
3. Guarantees uniqueness without querying database
4. Works reliably with Supabase API

## ID Format
```javascript
// Format: entry_[timestamp]_[random]
// Example: entry_lzk4m5n6_a1b2c3
function generateStringId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `entry_${timestamp}_${random}`;
}
```

## Common Issues & Solutions

### Issue: "null value in column 'id'" error
**Cause**: Supabase JS client v2 converts `undefined` to `null`
**Solution**: Always provide an explicit string ID

### Issue: Mixed ID types in database
**Reality**: This is fine! PostgreSQL coerces strings to the integer column
**Solution**: Just use string IDs consistently going forward

### Issue: Can't get "next ID" 
**Cause**: Mixing strings and integers makes MAX(id) unreliable
**Solution**: Use timestamp-based string IDs that don't need sequence

## Historical Context
- **Aug 25 - Sep 6, 2025**: Daily tracker generated "meocji..." pattern string IDs (working)
- **Sep 7-9, 2025**: Attempted to switch to integers (failed due to Supabase API issues)
- **Sep 9, 2025**: Switched to clean string ID format (working)

## Never Do This Again
❌ Don't try to make Supabase respect PostgreSQL DEFAULT/SERIAL
❌ Don't mix ID strategies between scripts
❌ Don't assume the database auto-increments (it doesn't via API)

## Always Do This
✅ Use string IDs for all new entries
✅ Test ID generation before deploying
✅ Check existing ID formats before changing strategy