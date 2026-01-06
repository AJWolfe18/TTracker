/**
 * Story Lifecycle Management (TTRC-231)
 *
 * Manages automatic lifecycle state transitions for stories:
 * - emerging (0-6 hours since last activity)
 * - growing (6-48 hours)
 * - stable (48-120 hours / 5 days)
 * - stale (>5 days)
 *
 * Uses SQL function update_story_lifecycle_states() defined in migration 022
 * for atomic, efficient batch updates.
 */

import { createClient } from '@supabase/supabase-js';

// Lazy-initialize Supabase client
let supabase = null;

function getSupabaseClient() {
  if (!supabase) {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return supabase;
}

// ============================================================================
// Lifecycle State Update
// ============================================================================

/**
 * Update all story lifecycle states based on age
 * Calls SQL function update_story_lifecycle_states() which uses:
 * - upper(time_range) if available
 * - max(published_at) from linked articles
 * - last_updated_at as fallback
 * - first_seen_at as final fallback
 *
 * @returns {Promise<{success: boolean, updatedCount?: number, stateDistribution?: object, error?: string}>}
 */
export async function updateLifecycleStates() {
  try {
    console.log('[lifecycle] Starting lifecycle state update...');

    // Call SQL function that handles batch update
    const { error: rpcError } = await getSupabaseClient()
      .rpc('update_story_lifecycle_states');

    if (rpcError) {
      console.error('[lifecycle] Failed to update lifecycle states:', rpcError.message);
      return {
        success: false,
        error: rpcError.message,
      };
    }

    // Query current state distribution for logging
    const { data: stateCounts, error: countError } = await getSupabaseClient()
      .from('stories')
      .select('lifecycle_state')
      .neq('status', 'archived');

    if (countError) {
      console.warn('[lifecycle] Could not fetch state distribution:', countError.message);
    }

    // Calculate state distribution
    const stateDistribution = {};
    if (stateCounts) {
      for (const row of stateCounts) {
        const state = row.lifecycle_state || 'unknown';
        stateDistribution[state] = (stateDistribution[state] || 0) + 1;
      }
    }

    console.log('[lifecycle] Lifecycle update complete');
    console.log('[lifecycle] State distribution:', JSON.stringify(stateDistribution, null, 2));

    return {
      success: true,
      updatedCount: stateCounts?.length || 0,
      stateDistribution,
    };

  } catch (error) {
    console.error('[lifecycle] Unexpected error:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get current lifecycle state distribution
 * Useful for monitoring and dashboards
 *
 * @returns {Promise<{success: boolean, distribution?: object, error?: string}>}
 */
export async function getLifecycleDistribution() {
  try {
    const { data, error } = await getSupabaseClient()
      .from('stories')
      .select('lifecycle_state')
      .neq('status', 'archived');

    if (error) {
      console.error('[lifecycle] Failed to get distribution:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }

    const distribution = {};
    for (const row of data) {
      const state = row.lifecycle_state || 'unknown';
      distribution[state] = (distribution[state] || 0) + 1;
    }

    return {
      success: true,
      distribution,
    };

  } catch (error) {
    console.error('[lifecycle] Unexpected error:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get stories by lifecycle state
 * @param {string} state - Lifecycle state to filter by (emerging, growing, stable, stale)
 * @param {number} limit - Maximum number of stories to return
 * @returns {Promise<{success: boolean, stories?: array, error?: string}>}
 */
export async function getStoriesByState(state, limit = 50) {
  try {
    const { data, error } = await getSupabaseClient()
      .from('stories')
      .select('id, primary_headline, lifecycle_state, last_updated_at, first_seen_at')
      .eq('lifecycle_state', state)
      .neq('status', 'archived')
      .order('last_updated_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error(`[lifecycle] Failed to get ${state} stories:`, error.message);
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: true,
      stories: data,
    };

  } catch (error) {
    console.error('[lifecycle] Unexpected error:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

// ============================================================================
// Export
// ============================================================================

export default {
  updateLifecycleStates,
  getLifecycleDistribution,
  getStoriesByState,
};
