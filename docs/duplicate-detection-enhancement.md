# Duplicate Detection Enhancement - Technical Design Document

## Overview
This document describes the enhanced duplicate detection system for TrumpyTracker's daily automation, addressing false positives while maintaining effective deduplication of same-story-different-source articles.

## Current Problem
The existing duplicate detection is marking unique articles as duplicates due to:
- Too short comparison length (50 characters)
- Overly broad word matching (75% threshold on common words)
- No distinction between similar stories vs. same story from different sources

## Solution Architecture

### 1. Database Schema Enhancement
```sql
-- Add duplicate tracking field
ALTER TABLE political_entries 
ADD COLUMN duplicate_of_id INTEGER REFERENCES political_entries(id),
ADD COLUMN similarity_score DECIMAL(3,2),
ADD COLUMN duplicate_reason VARCHAR(100);

-- Index for efficient duplicate queries
CREATE INDEX idx_duplicate_of ON political_entries(duplicate_of_id);
```

### 2. Enhanced Duplicate Detection Algorithm

#### Phase 1: Exact Matching
- **URL Check**: Exact URL match = definite duplicate
- **Title Check**: Exact title match (normalized) = definite duplicate

#### Phase 2: Smart Similarity Matching
```javascript
// Configuration (via environment variables)
const DUPLICATE_CONFIG = {
  COMPARISON_LENGTH: process.env.DUPLICATE_COMPARISON_LENGTH || 200,
  SIMILARITY_THRESHOLD: process.env.DUPLICATE_SIMILARITY_THRESHOLD || 0.85,
  WORD_OVERLAP_THRESHOLD: process.env.DUPLICATE_WORD_THRESHOLD || 0.60,
  STOP_WORDS: ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'with', 'of', 'from', 'by', 'as', 'is', 'was', 'are', 'were'],
  COMMON_POLITICAL_TERMS: ['federal', 'court', 'supreme', 'investigation', 'report', 'announces', 'new', 'rules', 'case']
};
```

#### Phase 3: Entity-Based Matching
For same-date entries:
1. Extract entities (actor, action, target)
2. Compare significant words only (exclude stop words and common terms)
3. Calculate overlap percentage
4. If actor matches AND word overlap > 60% = likely duplicate

### 3. Similarity Scoring System

```javascript
function calculateSimilarityScore(entry1, entry2) {
  let score = 0;
  let reasons = [];
  
  // URL similarity (0-30 points)
  if (entry1.source_url === entry2.source_url) {
    score += 30;
    reasons.push('exact_url');
  } else if (sameDomain(entry1.source_url, entry2.source_url)) {
    score += 10;
    reasons.push('same_domain');
  }
  
  // Title similarity (0-40 points)
  const titleSim = compareStrings(
    normalizeText(entry1.title).substring(0, 200),
    normalizeText(entry2.title).substring(0, 200)
  );
  score += titleSim * 40;
  if (titleSim > 0.85) reasons.push('similar_title');
  
  // Date proximity (0-15 points)
  const daysDiff = Math.abs(dateDiff(entry1.date, entry2.date));
  score += Math.max(0, 15 - (daysDiff * 5));
  if (daysDiff === 0) reasons.push('same_date');
  
  // Actor match (0-15 points)
  if (entry1.actor && entry2.actor) {
    const actorSim = compareStrings(
      normalizeText(entry1.actor),
      normalizeText(entry2.actor)
    );
    score += actorSim * 15;
    if (actorSim > 0.8) reasons.push('same_actor');
  }
  
  return {
    score: Math.min(100, score),
    reasons: reasons.join(','),
    isDuplicate: score >= 80
  };
}
```

### 4. Text Normalization

```javascript
function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')  // Remove punctuation
    .replace(/\s+/g, ' ')           // Normalize whitespace
    .split(' ')
    .filter(word => 
      word.length > 2 && 
      !STOP_WORDS.includes(word)
    )
    .join(' ')
    .trim();
}
```

### 5. Duplicate Handling Flow

```
New Article Arrives
    ↓
[Check Exact URL Match] → If match: Mark as duplicate of original
    ↓ If no match
[Check Recent Entries (7 days)]
    ↓
[Calculate Similarity Scores]
    ↓
[Score >= 80?] → Yes: Mark as duplicate, link to original
    ↓ No
[Save as New Entry]
```

### 6. Debug Logging

```javascript
console.log(`🔍 Duplicate Check for: "${entry.title.substring(0, 50)}..."`);
console.log(`   Comparing against ${recentEntries.length} recent entries`);

recentEntries.forEach(existing => {
  const similarity = calculateSimilarityScore(entry, existing);
  if (similarity.score > 60) {  // Only log potential matches
    console.log(`   📊 Score: ${similarity.score}/100 with ID:${existing.id}`);
    console.log(`      Reasons: ${similarity.reasons}`);
    console.log(`      Title: "${existing.title.substring(0, 50)}..."`);
  }
});
```

## Benefits

1. **Reduced False Positives**: 200-character comparison with 85% threshold is more accurate
2. **Better Same-Story Detection**: Catches same story from different sources
3. **Data Preservation**: Duplicates linked, not lost
4. **Tunability**: Thresholds adjustable via environment variables
5. **Debugging**: Clear logging shows why items marked as duplicates
6. **Future Features**: Duplicate analysis, manual review, similarity reports

## Migration Plan

1. **Phase 1**: Add database fields (non-breaking)
2. **Phase 2**: Deploy new detection logic to test environment
3. **Phase 3**: Monitor for 24-48 hours, tune thresholds
4. **Phase 4**: Deploy to production with feature flag
5. **Phase 5**: Remove old logic after verification

## Configuration

Environment variables for fine-tuning:
```bash
# Duplicate detection thresholds
DUPLICATE_COMPARISON_LENGTH=200        # Characters to compare
DUPLICATE_SIMILARITY_THRESHOLD=0.85    # Required similarity (0-1)
DUPLICATE_WORD_THRESHOLD=0.60         # Word overlap threshold
DUPLICATE_SCORE_THRESHOLD=80          # Overall score (0-100)
DUPLICATE_DEBUG_LOG=true              # Enable detailed logging
```

## Success Metrics

- False positive rate < 5% (currently ~20%)
- True positive rate > 95% (maintain current)
- Processing time < 500ms per entry
- No increase in duplicate stories on dashboard

## Testing Plan

Test with known problematic headlines:
1. "Federal Court Rules on Redistricting Controversy"
2. "Supreme Court Accepts Case on Voting Rights" 
3. "FEC Investigates Possible Campaign Finance Violation"

Each should NOT match unrelated articles but SHOULD match:
- Same story with slight title variations
- Same story from different news sources
- Same story published within 1-2 days
