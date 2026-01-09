# Duplicate Detection Enhancement Documentation

## Overview

The duplicate detection system prevents the same news story from appearing multiple times in the tracker. It uses intelligent text comparison to identify similar articles while allowing legitimate updates through.

## How It Works

### 1. Similarity Checking
- Compares article descriptions using Levenshtein distance algorithm
- Calculates similarity percentage (0-100%)
- Default threshold: 85% similarity = duplicate

### 2. Batch Processing
- Groups articles into batches of 20 for efficiency
- Reduces API calls by 50%
- Processes all categories in parallel

### 3. Smart Filtering
- Only checks articles from last 7 days (configurable)
- Ignores short descriptions under 200 characters
- Preserves original article if duplicate found

## Configuration

### Environment Variables

```bash
# How many days back to check for duplicates
DUPLICATE_LOOKBACK_DAYS=7  # Default: 7

# Minimum description length to check
DUPLICATE_MIN_LENGTH=200  # Default: 200 characters

# Similarity threshold (0-100)
DUPLICATE_THRESHOLD=85  # Default: 85%

# Batch size for processing
DUPLICATE_CHECK_BATCH_SIZE=20  # Default: 20

# Skip duplicate checking entirely
DUPLICATE_SKIP_CHECK=false  # Default: false

# Enable debug logging
DUPLICATE_DEBUG_LOG=false  # Default: false
```

### Configuration Examples

#### Aggressive Duplicate Filtering
```bash
# Catches more duplicates, may filter legitimate updates
DUPLICATE_THRESHOLD=75
DUPLICATE_LOOKBACK_DAYS=14
DUPLICATE_MIN_LENGTH=150
```

#### Permissive Configuration
```bash
# Only catches exact duplicates
DUPLICATE_THRESHOLD=95
DUPLICATE_LOOKBACK_DAYS=3
DUPLICATE_MIN_LENGTH=300
```

#### Debug Mode
```bash
# See detailed duplicate detection logs
DUPLICATE_DEBUG_LOG=true
DUPLICATE_CHECK_BATCH_SIZE=5  # Smaller batches for debugging
```

## Implementation Details

### Similarity Algorithm

The system uses normalized Levenshtein distance:

```javascript
function calculateSimilarity(text1, text2) {
  const distance = levenshteinDistance(text1, text2);
  const maxLength = Math.max(text1.length, text2.length);
  return ((maxLength - distance) / maxLength) * 100;
}
```

### Batch Processing Logic

1. **Collect all articles** from API responses
2. **Filter by length** (must be > MIN_LENGTH)
3. **Group into batches** of BATCH_SIZE
4. **Query database** for recent articles
5. **Compare each new article** against existing ones
6. **Filter out duplicates** above threshold
7. **Insert unique articles** to database

### Performance Optimizations

- **Database Indexing:** Uses indexed date column for fast lookups
- **Text Comparison:** Only compares first 500 characters for speed
- **Parallel Processing:** Checks all categories simultaneously
- **Smart Caching:** Reuses database connection across batches

## Monitoring & Tuning

### Debug Output

With `DUPLICATE_DEBUG_LOG=true`:

```
[DUPLICATE CHECK] Checking 15 articles in 1 batches
[DUPLICATE CHECK] Batch 1/1: Checking 15 articles
[DUPLICATE CHECK] Found 127 existing articles from last 7 days
[DUPLICATE CHECK] Article: "Biden announces..." - Similar to existing (87.5%)
[DUPLICATE CHECK] Filtered out 3 duplicates from 15 articles
```

### Metrics to Monitor

1. **Duplicate Rate:** If >20%, lower threshold
2. **False Positives:** If filtering updates, raise threshold
3. **Processing Time:** If >30s, reduce batch size
4. **API Costs:** Track tokens saved by filtering

### Tuning Guidelines

| Scenario | Adjustment | Reason |
|----------|------------|---------|
| Too many duplicates | Lower THRESHOLD to 75-80 | Catch more similar articles |
| Missing updates | Raise THRESHOLD to 90-95 | Allow through more variations |
| Slow processing | Lower BATCH_SIZE to 10-15 | Reduce memory usage |
| High API costs | Increase LOOKBACK_DAYS | Check more history |
| Breaking news cycles | Lower LOOKBACK_DAYS to 3-5 | Focus on recent content |

## Testing

### Unit Test
```javascript
// Test similarity calculation
const similarity = calculateSimilarity(
  "Trump announces new policy on immigration",
  "Trump unveils new immigration policy"
);
console.log(similarity); // Should be ~75%
```

### Integration Test
```bash
# Test with debug logging
set DUPLICATE_DEBUG_LOG=true
set DUPLICATE_THRESHOLD=70
node scripts/daily-tracker-supabase.js --test
```

### Production Monitoring
```sql
-- Check for duplicates in database
SELECT 
  DATE(created_at) as day,
  title,
  COUNT(*) as count
FROM political_entries
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at), title
HAVING COUNT(*) > 1
ORDER BY count DESC;
```

## Troubleshooting

### Issue: Not catching obvious duplicates
**Solution:** Lower DUPLICATE_THRESHOLD to 75-80

### Issue: Filtering out legitimate updates
**Solution:** Raise DUPLICATE_THRESHOLD to 90-95

### Issue: Performance degradation
**Solution:** Reduce DUPLICATE_CHECK_BATCH_SIZE to 10

### Issue: Missing configuration
**Solution:** Check for typos in environment variable names

## Cost Savings

### Before Enhancement
- 6 categories × 15 articles = 90 potential entries/run
- Many duplicates = wasted API tokens and storage

### After Enhancement
- Filters ~20-30% duplicates on average
- Saves 18-27 API calls per run
- Monthly savings: ~$5-10

## Future Improvements

### Planned Features
1. **Semantic Similarity:** Use embeddings for better comparison
2. **Source Weighting:** Prioritize original sources over aggregators
3. **Update Detection:** Identify when story has significant updates
4. **Duplicate Linking:** Track relationship between similar articles

### Database Schema Addition (Future)
```sql
-- Track duplicate relationships
ALTER TABLE political_entries
ADD COLUMN duplicate_of_id TEXT REFERENCES political_entries(id),
ADD COLUMN similarity_score DECIMAL(5,2);
```

## Version History

- **v2.0** (Sept 2025) - Batch processing, configurable thresholds
- **v1.5** (Aug 2025) - Added debug logging
- **v1.0** (July 2025) - Initial implementation
