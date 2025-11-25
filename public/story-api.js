// Story API - Thin wrapper around DashboardUtils.supabaseRequest
// Handles all story data fetching with consistent error handling

window.StoryAPI = (function() {
  'use strict';
  
  // Get supabaseRequest from DashboardUtils
  const { supabaseRequest } = window.DashboardUtils || {};
  
  if (!supabaseRequest) {
    console.error('StoryAPI: DashboardUtils.supabaseRequest not found. Make sure dashboard-utils.js loads first.');
  }

  /**
   * Fetch active stories with pagination
   * @param {Object} options - Fetch options
   * @param {number} options.offset - Pagination offset (default: 0)
   * @param {number} options.limit - Number of stories to fetch (default: 30)
   * @returns {Promise<Array>} Array of story objects
   * 
   * CRITICAL: Sort order is deterministic and stable
   * ORDER BY last_updated_at DESC, id DESC ensures:
   * - Newest stories first (by update time)
   * - Tie-breaker on ID prevents re-shuffling during pagination
   * - Matches TTRC-145 requirement for stable, predictable ordering
   */
  async function fetchStories({ offset = 0, limit = 30 } = {}) {
    const params = new URLSearchParams({
      status: 'eq.active',
      summary_neutral: 'not.is.null', // TTRC-119: Hide un-enriched stories
      select: [
        'id',
        'primary_headline',
        'summary_spicy',
        'severity',
        'category',
        'source_count',
        'primary_actor',
        'status',
        'last_updated_at',
        'first_seen_at'
      ].join(','),
      // IMPORTANT: Deterministic ordering (newest first, ID as tie-breaker)
      order: 'last_updated_at.desc,id.desc',
      limit: String(limit),
      offset: String(offset)
    });
    
    try {
      const response = await supabaseRequest(`stories?${params.toString()}`);
      return response || [];
    } catch (error) {
      console.error('StoryAPI.fetchStories error:', error);
      throw error;
    }
  }

  /**
   * Fetch a single story with all its articles
   * @param {number} id - Story ID
   * @returns {Promise<Object|null>} Story object with articles array, or null if not found
   */
  async function fetchStoryWithArticles(id) {
    const params = new URLSearchParams({
      id: `eq.${id}`,
      select: '*,articles:article_story(*)'
    });
    
    try {
      const response = await supabaseRequest(`stories?${params.toString()}`);
      return response?.[0] || null;
    } catch (error) {
      console.error('StoryAPI.fetchStoryWithArticles error:', error);
      throw error;
    }
  }

  /**
   * Fetch articles for a story via article_story join table
   * @param {number} storyId - Story ID
   * @returns {Promise<Array>} Array of article objects with metadata
   */
  async function fetchStoryArticles(storyId) {
    const params = new URLSearchParams({
      story_id: `eq.${storyId}`,
      select: 'article_id,is_primary_source,similarity_score,articles(*)'
    });
    
    try {
      const response = await supabaseRequest(`article_story?${params.toString()}`);
      // Transform to flat article objects with metadata
      return (response || [])
        .filter(row => row && row.articles)
        .map(row => ({
          ...row.articles,
          is_primary_source: row.is_primary_source,
          similarity_score: row.similarity_score,
        }));
    } catch (error) {
      console.error('StoryAPI.fetchStoryArticles error:', error);
      throw error;
    }
  }

  // Public API
  return {
    fetchStories,
    fetchStoryWithArticles,
    fetchStoryArticles
  };
})();
