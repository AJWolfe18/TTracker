# Quick Fix Reference - Database Field Errors
*Last Updated: September 3, 2025*

## ❌ Common Field Errors & Fixes

### Executive Orders Table

#### Error: "Could not find 'editorial_summary' column"
```javascript
// ❌ WRONG - Field doesn't exist
editorial_summary: aiAnalysis.summary

// ✅ CORRECT - Use summary field
summary: aiAnalysis.summary
```

#### Error: "Could not find 'source' column"  
```javascript
// ❌ WRONG - Field removed
source: 'Federal Register'

// ✅ CORRECT - Use source field with default
source: 'Federal Register API'  // This field exists in executive_orders
```

### Political Entries Table

#### Error: "Could not find 'source' column"
```javascript
// ❌ WRONG - Field doesn't exist
source: new URL(url).hostname

// ✅ CORRECT - Just use source_url
source_url: normalizedUrl
// Extract hostname in display logic if needed
```

#### Error: "value out of range for type integer" (ID field)
```javascript
// ❌ WRONG - Don't set ID for political_entries
id: generateUniqueId(),

// ✅ CORRECT - Let database auto-generate
// Simply omit the id field from insert
const entry = {
  title: data.title,
  source_url: url,
  // ... other fields, NO id field
};
```

#### Error: "null value in column 'id' violates not-null constraint"
**NOTE**: This error is often misleading! It usually means you're trying to insert fields that don't exist in the table.
```javascript
// ❌ This error often appears when using non-existent fields
const entry = {
  title: "Test",
  status: "published",  // ❌ Field doesn't exist!
  manual_submission: false  // ❌ Field doesn't exist!
};

// ✅ CORRECT - Only use fields that exist in the schema
const entry = {
  title: "Test",
  description: "Test description",
  source_url: "https://example.com",
  // Only fields from the schema
};
```

## 📋 Field Quick Reference

### Fields That ACTUALLY Exist

**Political Entries**:
- ✅ `source_url` (NOT `source`)
- ✅ `description` (NOT `editorial_summary`)
- ✅ `spicy_summary`
- ✅ `id` (SERIAL - don't set manually)

**Executive Orders**:
- ✅ `summary` (NOT `editorial_summary`)
- ✅ `source` (default: "Federal Register API")
- ✅ `spicy_summary`
- ✅ `id` (TEXT - must generate)

### Fields That DON'T Exist (Common Mistakes)

**Both Tables**:
- ❌ `editorial_summary` - Never implemented
- ❌ JSONB fields - Not using JSON columns

**Political Entries Only**:
- ❌ `source` - Use `source_url`
- ❌ `status` - Never existed in table
- ❌ `manual_submission` - Never existed in table

## 🔧 Quick Debugging

```javascript
// Before insert, log the object to check fields
console.log('Inserting:', JSON.stringify(dataObject, null, 2));

// Check for non-existent fields
const invalidFields = ['editorial_summary', 'source'];
invalidFields.forEach(field => {
  if (dataObject[field]) {
    console.warn(`WARNING: ${field} doesn't exist in database!`);
    delete dataObject[field];
  }
});
```

## 💡 Pro Tips

1. **When in doubt, check the schema**:
   - `/docs/database/executive-orders-schema.md`
   - `/docs/database/political-entries-schema.md`

2. **Use the dashboard as reference**:
   - Check `dashboard-components.js` to see what fields are actually used
   - If dashboard doesn't use it, you probably don't need it

3. **Test with minimal data first**:
   ```javascript
   // Test with just required fields
   const testOrder = {
     title: "Test Order",
     order_number: "99999",
     date: new Date().toISOString(),
     summary: "Test summary"
   };
   ```

4. **Check Supabase logs**:
   - Go to Supabase dashboard → Logs → API
   - Look for the exact error message
   - Check the request body to see what was sent

## 🚨 If All Else Fails

1. Export current table structure from Supabase
2. Compare with documentation
3. Update documentation if schema changed
4. Create JIRA ticket for schema updates needed
