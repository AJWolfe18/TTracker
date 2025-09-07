# Category System Documentation

## Overview
The TrumpyTracker system uses content-based categorization for all political entries and executive orders. Categories are determined by the actual content of the article, NOT by which search query found them.

## Valid Categories

The system uses these 7 consolidated categories (stored with underscores in database, displayed with ampersands):

### Database Format → Display Format

1. **corruption_scandals** → "Corruption & Scandals"
   - Scandals, ethics violations, grift, self-dealing, investigations into corruption
   
2. **democracy_elections** → "Democracy & Elections"
   - Elections, voting rights, democratic norms, voter suppression, ballot issues
   
3. **policy_legislation** → "Policy & Legislation"
   - Legislation, regulations, policy changes, government programs, regulatory actions
   
4. **justice_legal** → "Justice & Legal"
   - DOJ actions, prosecutions, FBI matters, court rulings, judicial appointments
   
5. **executive_actions** → "Executive Actions"
   - Presidential actions, executive orders, appointments, White House decisions
   
6. **foreign_policy** → "Foreign Policy"
   - International relations, foreign policy, trade, diplomacy, treaties
   
7. **other** → "Other"
   - Edge cases that don't fit clearly in above categories

## How Categorization Works

### 1. Search Phase
The daily tracker searches for news using broad topic prompts:
- "Trump & Family" 
- "DOGE & Government Efficiency"
- "DOJ & Law Enforcement"
- etc.

**IMPORTANT**: These search prompts are NOT categories! They're just search topics.

### 2. AI Categorization
When articles are found, the AI analyzes the content and assigns the appropriate category based on what the article is actually about.

Example:
- Search prompt: "Trump & Family"
- Article found: "Trump indicted on fraud charges"
- Assigned category: "justice_legal" (because it's about prosecution)

### 3. Validation
The `normalizeCategory()` function ensures categories are valid and cleans up any formatting issues.

## Common Pitfalls to Avoid

### ❌ DON'T: Use Search Category
```javascript
// WRONG - This uses the search prompt as category
category: category,  // Would store "Trump & Family"
```

### ✅ DO: Use Content-Based Category
```javascript
// CORRECT - Uses category from AI analysis
category: normalizeCategory(entry.category),  // Stores "justice_legal"
```

## Display Formatting

Categories are stored with underscores but displayed with ampersands:
- Database: `corruption_scandals`
- Display: `Corruption & Scandals`

Use the `formatCategoryDisplay()` function for UI display.

## Migration for Categories

### Consolidation Migration (Sept 2025)
To migrate from 8 categories to 7 consolidated categories:

```bash
# Preview changes
node scripts/migrate-categories-to-consolidated.js --dry-run

# Apply migration
node scripts/migrate-categories-to-consolidated.js

# Limit to subset for testing
node scripts/migrate-categories-to-consolidated.js --limit 100 --dry-run
```

### Fix Incorrect Categories
If articles have incorrect categories (like search prompt names):

```bash
node scripts/fix-article-categories.js
```

## Category Mapping Guide

When manually categorizing or reviewing AI decisions:

| If article is about... | Use category |
|------------------------|--------------|
| Scandals, grift, ethics violations, corruption probes | corruption_scandals |
| Elections, voting, ballots, democracy threats | democracy_elections |
| New laws, regulations, policy changes | policy_legislation |
| DOJ, FBI, prosecutions, courts, judges | justice_legal |
| Executive orders, presidential actions, appointments | executive_actions |
| International relations, foreign leaders, trade | foreign_policy |
| Doesn't fit other categories | other |

## Testing Categorization

To verify categories are working correctly:

1. Run the daily tracker
2. Check that categories are from the valid 7-category list
3. Verify categories match article content
4. No search prompt names should appear as categories

```bash
# Test script
test-category-fix.bat
```

## Troubleshooting

### Problem: Articles showing "Trump & Family" as category
**Cause**: Using search prompt instead of content category
**Fix**: Update to use `entry.category` not loop `category` variable

### Problem: Categories not validating
**Cause**: AI returning formatted strings with brackets
**Fix**: `normalizeCategory()` function cleans these

### Problem: Old articles have wrong categories
**Cause**: Bug was in production before fix or using old 8-category system
**Fix**: Run migration scripts

## Code References

- **Category assignment**: `scripts/daily-tracker-supabase.js` line 777
- **Normalization function**: `scripts/daily-tracker-supabase.js` line 460
- **Display formatting**: `scripts/daily-tracker-supabase.js` line 450
- **Migration script**: `scripts/migrate-categories-to-consolidated.js`
- **Fix script**: `scripts/fix-article-categories.js`

## Version History

- **Sept 6, 2025**: Consolidated from 8 categories to 7 categories (TTRC-115)
- **Sept 5, 2025**: Fixed critical bug where search categories were used instead of content categories (TTRC-120)
- **Original**: Categories were incorrectly using search prompt names
