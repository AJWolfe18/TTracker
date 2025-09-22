/**
 * Safe wrapper for Jaro-Winkler distance calculation
 * Returns 0 on error to prevent crashes
 */
function safeJaroWinkler(a, b) {
  try {
    // Ensure strings are valid and not too long
    const str1 = String(a ?? '').substring(0, 5000);
    const str2 = String(b ?? '').substring(0, 5000);
    return natural.JaroWinklerDistance(str1, str2) || 0;
  } catch (e) {
    console.warn('[clustering] Jaro-Winkler error:', e.message);
    return 0;
  }
}

/**
 * TTRC-142: Story Clustering Algorithm (ESM)
 * 
 * Clusters articles into stories based on similarity scoring:
 * - URL match: 30 points (exact), 10 points (same domain)
 * - Title similarity (Jaro-Winkler): 0-45 points  
 * - Date proximity: 0-15 points (24h: 15, 48h: 10, 96h: 5)
 * - Actor match: 10 points
 * - Same source bonus: 5 points (same domain + same day)
 * - Threshold: ≥75% auto-attach, <75% new story
 */

import natural from 'natural';

// Clustering threshold constant
export const CLUSTER_ATTACH_THRESHOLD = 75;

// Common political actors for extraction
export const POLITICAL_ACTORS = {
  // Executive
  'trump': 'Donald Trump',
  'donald trump': 'Donald Trump',
  'president trump': 'Donald Trump',
  'biden': 'Joe Biden',
  'president biden': 'Joe Biden',
  'harris': 'Kamala Harris',
  'vp harris': 'Kamala Harris',
  'vice president harris': 'Kamala Harris',
  
  // Congress
  'mcconnell': 'Mitch McConnell',
  'schumer': 'Chuck Schumer',
  'mccarthy': 'Kevin McCarthy',
  'jeffries': 'Hakeem Jeffries',
  'johnson': 'Mike Johnson',
  'speaker johnson': 'Mike Johnson',
  
  // Governors
  'desantis': 'Ron DeSantis',
  'abbott': 'Greg Abbott',
  'newsom': 'Gavin Newsom',
  
  // Others
  'musk': 'Elon Musk',
  'elon musk': 'Elon Musk',
  'rfk': 'Robert F. Kennedy Jr.',
  'kennedy': 'Robert F. Kennedy Jr.',
  
  // Agencies/Bodies
  'supreme court': 'Supreme Court',
  'scotus': 'Supreme Court',
  'congress': 'Congress',
  'senate': 'Senate',
  'house': 'House',
  'doj': 'DOJ',
  'fbi': 'FBI',
  'cia': 'CIA'
};

/**
 * Check if haystack contains needle as a word boundary match
 */
function containsWord(hay, needle) {
  return new RegExp(`(^|\\b)${needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(\\b|$)`).test(hay);
}

/**
 * Extract primary actor from title using simple heuristics
 */
export function extractPrimaryActor(title) {
  if (!title) return null;
  
  const lowerTitle = title.toLowerCase();
  
  // Check for exact word matches first
  for (const [pattern, actor] of Object.entries(POLITICAL_ACTORS)) {
    if (containsWord(lowerTitle, pattern)) {
      return actor;
    }
  }
  
  // Check for possessive forms (Trump's, Biden's, etc.)
  const possessiveMatch = lowerTitle.match(/(\w+)'s/);
  if (possessiveMatch) {
    const name = possessiveMatch[1];
    for (const [pattern, actor] of Object.entries(POLITICAL_ACTORS)) {
      if (pattern.includes(name)) {
        return actor;
      }
    }
  }
  
  return null;
}

/**
 * Calculate similarity score between article and story
 * Returns score from 0-100
 */
export function calculateSimilarity(article, story) {
  let score = 0;
  
  // 1. URL match (30 points)
  if (article.url_canonical && story.primary_source_url) {
    if (article.url_canonical === story.primary_source_url) {
      score += 30;
    } else if (article.source_domain === story.primary_source_domain) {
      score += 10; // Same domain gets partial credit
    }
  }
  
  // 2. Title similarity using Jaro-Winkler (0-45 points)
  if (article.title && story.primary_headline) {
    // Normalize titles for comparison
    const title1 = normalizeText(article.title);
    const title2 = normalizeText(story.primary_headline);
    
    // Check for exact match first (after normalization)
    if (title1 === title2) {
      score += 45; // Full points for exact match
    } else {
      // Calculate Jaro-Winkler distance with crash protection
      const similarity = safeJaroWinkler(title1, title2);
      
      // Scoring curve:
      // >0.85 = 40-45 points (very similar)
      // 0.70-0.85 = 28-40 points (similar)
      // 0.50-0.70 = 15-28 points (somewhat similar)
      // <0.50 = 0-15 points (different)
      if (similarity > 0.85) {
        score += Math.floor(40 + (similarity - 0.85) * 33); // 40-45 points
      } else if (similarity > 0.70) {
        score += Math.floor(28 + (similarity - 0.70) * 80); // 28-40 points
      } else if (similarity > 0.50) {
        score += Math.floor(15 + (similarity - 0.50) * 65); // 15-28 points
      } else {
        score += Math.floor(similarity * 30); // 0-15 points
      }
    }
  }
  
  // 3. Date proximity (0-15 points)
  if (article.published_at && story.first_seen_at) {
    const articleDate = new Date(article.published_at);
    const storyDate = new Date(story.first_seen_at);
    const hoursDiff = Math.abs(articleDate - storyDate) / (1000 * 60 * 60);
    
    if (hoursDiff <= 24) {
      score += 15; // Same day
    } else if (hoursDiff <= 48) {
      score += 10; // ±1 day
    } else if (hoursDiff <= 96) {
      score += 5;  // ±3 days
    }
    // else 0 points
  }
  
  // 4. Actor match (10 points)
  if (article.primary_actor && story.primary_actor) {
    const actor1 = normalizeActor(article.primary_actor);
    const actor2 = normalizeActor(story.primary_actor);
    
    if (actor1 === actor2) {
      score += 10;
    }
  }
  // 5. Bonus for same source + same day (5 points)
  // This helps cluster updates from the same outlet
  if (article.source_domain && story.primary_source_domain) {
    if (article.source_domain === story.primary_source_domain) {
      // Check if published on same day
      if (article.published_at && story.first_seen_at) {
        const articleDate = new Date(article.published_at);
        const storyDate = new Date(story.first_seen_at);
        const hoursDiff = Math.abs(articleDate - storyDate) / (1000 * 60 * 60);
        
        if (hoursDiff <= 24) {
          score += 5; // Bonus for same source, same day
        }
      }
    }
  }
  
  return score;
}

/**
 * Normalize text for comparison
 */
export function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[\u201C\u201D\u2018\u2019]/g, '') // Remove smart quotes
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ')     // Normalize whitespace
    .trim();
}

/**
 * Normalize actor names for comparison
 */
export function normalizeActor(actor) {
  return actor
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find best matching story for an article from candidates
 * Returns { story_id, score } or null if no good match
 */
export function findBestMatch(article, candidateStories) {
  let bestMatch = null;
  let bestScore = 0;
  
  for (const story of candidateStories) {
    const score = calculateSimilarity(article, story);
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = story;
    }
  }
  
  // Only return match if score meets threshold
  if (bestScore >= CLUSTER_ATTACH_THRESHOLD) {
    return {
      story_id: bestMatch.id,
      story: bestMatch,
      score: bestScore
    };
  }
  
  return null;
}

/**
 * Process a batch of articles for clustering
 * This is useful for bulk operations
 */
export async function clusterBatch(articles, existingStories) {
  const results = [];
  
  for (const article of articles) {
    // Extract actor if not already present
    if (!article.primary_actor) {
      article.primary_actor = extractPrimaryActor(article.title);
    }
    
    // Find best matching story
    const match = findBestMatch(article, existingStories);
    
    if (match) {
      // Article should attach to existing story
      results.push({
        article_id: article.id,
        action: 'attach',
        story_id: match.story_id,
        score: match.score
      });
      
      // Update story metadata if this is a better primary source
      if (match.score >= 90 && !match.story.primary_source_url) {
        match.story.primary_source_url = article.url_canonical;
        match.story.primary_source = article.source_name;
        match.story.primary_source_domain = article.source_domain;
      }
    } else {
      // Create new story
      results.push({
        article_id: article.id,
        action: 'create',
        story_data: {
          primary_headline: article.title,
          primary_source: article.source_name,
          primary_source_url: article.url_canonical,
          primary_source_domain: article.source_domain,
          primary_actor: article.primary_actor,
          first_seen_at: article.published_at,
          last_updated_at: article.published_at,
          source_count: 1,
          topic_tags: article.categories || []
        }
      });
      
      // Add to existing stories for future matches in this batch
      existingStories.push({
        id: `temp_${article.id}`, // Temporary ID for batch processing
        primary_headline: article.title,
        primary_source_url: article.url_canonical,
        primary_source_domain: article.source_domain,
        primary_actor: article.primary_actor,
        first_seen_at: article.published_at
      });
    }
  }
  
  return results;
}
