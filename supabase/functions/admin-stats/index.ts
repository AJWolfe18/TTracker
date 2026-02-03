// Edge Function: admin-stats
// Returns aggregated statistics for the Admin Dashboard home page
// ADO: Feature 327, Story 333

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { checkAdminAuth } from '../_shared/auth.ts'

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Authentication check - require admin API key
    // Note: For Phase 1, we allow unauthenticated access since the dashboard
    // only shows aggregate stats, not sensitive data. Auth will be added in Phase 2
    // when editing capabilities are introduced.
    // TODO: Enable auth when admin features beyond read-only stats are added
    // if (!checkAdminAuth(req)) {
    //   return new Response(
    //     JSON.stringify({ error: 'Unauthorized' }),
    //     { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    //   )
    // }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Timestamps for queries
    const now = new Date()
    const today = now.toISOString().split('T')[0]
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const last72h = new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString()
    const last4h = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString()

    // Run all queries in parallel for performance
    const [
      storiesActiveResult,
      storiesNeedsReviewResult,
      storiesEnrichFailedResult,
      storiesTodayResult,
      articlesTodayResult,
      articlesTotalResult,
      feedsResult,
      pardonsResult,
      scotusResult,
      eosResult,
      budgetResult,
      lastFeedFetchResult
    ] = await Promise.all([
      // Stories: active count (status = 'active')
      supabase
        .from('stories')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active'),

      // Stories: needs review (column may not exist yet - handle gracefully)
      // Supabase returns { data, error, count } - doesn't throw, so we handle error in result processing
      supabase
        .from('stories')
        .select('id', { count: 'exact', head: true })
        .eq('needs_review', true),

      // Stories: enrichment failed
      supabase
        .from('stories')
        .select('id', { count: 'exact', head: true })
        .gt('enrichment_failure_count', 0),

      // Stories: created today
      supabase
        .from('stories')
        .select('id', { count: 'exact', head: true })
        .gte('first_seen_at', last24h),

      // Articles: ingested today
      supabase
        .from('articles')
        .select('id', { count: 'exact', head: true })
        .gte('fetched_at', last24h),

      // Articles: total count
      supabase
        .from('articles')
        .select('id', { count: 'exact', head: true }),

      // Feeds: all stats
      supabase
        .from('feed_registry')
        .select('id,is_active,failure_count'),

      // Pardons: all stats
      supabase
        .from('pardons')
        .select('id,is_public,needs_review'),

      // SCOTUS: all stats
      supabase
        .from('scotus_cases')
        .select('id,is_public'),

      // Executive Orders: total
      supabase
        .from('executive_orders')
        .select('id', { count: 'exact', head: true }),

      // Budget: today
      supabase
        .from('budgets')
        .select('day,spent_usd,cap_usd,openai_calls')
        .eq('day', today)
        .single(),

      // Last feed fetch (for pipeline status)
      supabase
        .from('feed_registry')
        .select('last_fetched_at')
        .not('last_fetched_at', 'is', null)
        .order('last_fetched_at', { ascending: false })
        .limit(1)
        .single()
    ])

    // Process feeds data
    const feeds = feedsResult.data || []
    const feedsTotal = feeds.length
    const feedsActive = feeds.filter(f => f.is_active && f.failure_count < 5).length
    const feedsDegraded = feeds.filter(f => f.is_active && f.failure_count >= 1 && f.failure_count < 5).length
    const feedsFailed = feeds.filter(f => f.failure_count >= 5).length

    // Process pardons data
    const pardons = pardonsResult.data || []
    const pardonsTotal = pardons.length
    const pardonsPublished = pardons.filter(p => p.is_public).length
    const pardonsDraft = pardons.filter(p => !p.is_public).length
    const pardonsNeedsReview = pardons.filter(p => p.needs_review).length

    // Process SCOTUS data
    const scotus = scotusResult.data || []
    const scotusTotal = scotus.length
    const scotusPublished = scotus.filter(s => s.is_public).length
    const scotusDraft = scotus.filter(s => !s.is_public).length

    // Determine pipeline status
    const lastFetchedAt = lastFeedFetchResult.data?.last_fetched_at
    let pipelineStatus = 'unknown'
    let pipelineMessage = 'No recent runs'
    let minutesSinceLastRun = null

    if (lastFetchedAt) {
      const lastRunTime = new Date(lastFetchedAt)
      minutesSinceLastRun = Math.floor((now.getTime() - lastRunTime.getTime()) / 60000)

      if (minutesSinceLastRun < 150) {
        // PROD runs every 2 hours = 120 min, give 30 min buffer
        pipelineStatus = 'ok'
        pipelineMessage = `${minutesSinceLastRun} min ago`
      } else if (minutesSinceLastRun < 240) {
        // Warning: more than 2.5 hours
        pipelineStatus = 'warning'
        pipelineMessage = `${minutesSinceLastRun} min ago (delayed)`
      } else {
        // Error: more than 4 hours
        pipelineStatus = 'error'
        pipelineMessage = `${minutesSinceLastRun} min ago (stale!)`
      }
    }

    // Handle needs_review count - column may not exist yet (returns 0 if error)
    const storiesNeedsReviewCount = storiesNeedsReviewResult.error ? 0 : (storiesNeedsReviewResult.count ?? 0)

    // Build response
    const response = {
      stories: {
        active_count: storiesActiveResult.count ?? 0,
        needs_review: storiesNeedsReviewCount,
        enrichment_failed: storiesEnrichFailedResult.count ?? 0,
        created_today: storiesTodayResult.count ?? 0
      },
      articles: {
        total_count: articlesTotalResult.count ?? 0,
        today_count: articlesTodayResult.count ?? 0
      },
      feeds: {
        total: feedsTotal,
        active: feedsActive,
        degraded: feedsDegraded,
        failed: feedsFailed
      },
      pardons: {
        total: pardonsTotal,
        published: pardonsPublished,
        draft: pardonsDraft,
        needs_review: pardonsNeedsReview
      },
      scotus: {
        total: scotusTotal,
        published: scotusPublished,
        draft: scotusDraft
      },
      executive_orders: {
        total: eosResult.count ?? 0
      },
      budget: budgetResult.data ? {
        day: budgetResult.data.day,
        spent_usd: budgetResult.data.spent_usd,
        cap_usd: budgetResult.data.cap_usd,
        openai_calls: budgetResult.data.openai_calls,
        percent_used: budgetResult.data.cap_usd > 0
          ? Math.round((budgetResult.data.spent_usd / budgetResult.data.cap_usd) * 100)
          : 0
      } : {
        day: today,
        spent_usd: 0,
        cap_usd: 5.00,
        openai_calls: 0,
        percent_used: 0
      },
      pipeline: {
        status: pipelineStatus,
        message: pipelineMessage,
        last_run_at: lastFetchedAt,
        minutes_since_last_run: minutesSinceLastRun
      },
      needs_attention: {
        total: storiesNeedsReviewCount +
               (storiesEnrichFailedResult.count ?? 0) +
               pardonsNeedsReview +
               pardonsDraft +
               scotusDraft +
               feedsFailed,
        breakdown: {
          stories_need_review: storiesNeedsReviewCount,
          stories_enrichment_failed: storiesEnrichFailedResult.count ?? 0,
          pardons_need_review: pardonsNeedsReview,
          pardons_unpublished: pardonsDraft,
          scotus_unpublished: scotusDraft,
          feeds_failed: feedsFailed
        }
      },
      timestamp: now.toISOString()
    }

    return new Response(
      JSON.stringify(response),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'max-age=60' // Cache for 1 minute
        }
      }
    )

  } catch (error) {
    console.error('Error in admin-stats:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }), // Don't expose raw error messages
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
