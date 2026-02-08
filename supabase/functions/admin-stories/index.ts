// Edge Function: admin-stories
// Returns paginated stories list with search/filter for Admin Dashboard
// ADO: Feature 328, Story 335

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { checkAdminPassword } from '../_shared/auth.ts'

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Authentication check
    if (!checkAdminPassword(req)) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Only accept POST (and OPTIONS handled above)
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse params from POST body
    let body: any = {}
    try {
      body = await req.json()
    } catch {
      // Empty body defaults to no filters
    }
    const search = String(body.search ?? '').trim()
    const status = String(body.status ?? '')
    const enrichment = String(body.enrichment ?? '')
    const alarmLevel = String(body.alarmLevel ?? '')
    const category = String(body.category ?? '')
    const sortBy = String(body.sortBy ?? 'last_updated_at') // last_updated_at, id, alarm_level, first_seen_at
    const sortDir = String(body.sortDir ?? 'desc') // asc, desc
    const cursor = String(body.cursor ?? '')
    const offsetParam = parseInt(String(body.offset ?? '0'), 10)
    const offset = Math.max(isNaN(offsetParam) ? 0 : offsetParam, 0)
    const limitParam = parseInt(String(body.limit ?? '25'), 10)
    const limit = Math.min(Math.max(limitParam, 1), 100) // Clamp 1-100

    // Build query - select specific fields (no content/embeddings)
    let query = supabase
      .from('stories')
      .select(`
        id,
        primary_headline,
        primary_source,
        primary_source_url,
        summary_neutral,
        summary_spicy,
        primary_actor,
        lifecycle_state,
        confidence_score,
        status,
        category,
        alarm_level,
        first_seen_at,
        last_updated_at,
        last_enriched_at,
        enrichment_status,
        enrichment_failure_count,
        source_count,
        article_story(count)
      `)

    // Sorting - validate allowed columns
    const allowedSortCols = ['id', 'alarm_level', 'first_seen_at', 'last_updated_at']
    const sortCol = allowedSortCols.includes(sortBy) ? sortBy : 'id'
    const ascending = sortDir === 'asc'
    query = query.order(sortCol, { ascending })

    // Add secondary sort by id for stable ordering (when not already sorting by id)
    if (sortCol !== 'id') {
      query = query.order('id', { ascending: false })
    }

    // Pagination strategy depends on sort column
    if (sortCol === 'id') {
      // Cursor-based pagination for ID sort (efficient)
      query = query.limit(limit)
      if (cursor) {
        const cursorId = parseInt(cursor, 10)
        if (!isNaN(cursorId) && cursorId > 0) {
          if (ascending) {
            query = query.gt('id', cursorId)
          } else {
            query = query.lt('id', cursorId)
          }
        }
      }
    } else {
      // Offset-based pagination for non-ID sorts (correct ordering)
      query = query.range(offset, offset + limit - 1)
    }

    // Filter: status
    if (status === 'active' || status === 'closed' || status === 'archived') {
      query = query.eq('status', status)
    }

    // Filter: enrichment status
    if (enrichment === 'enriched') {
      query = query.not('last_enriched_at', 'is', null)
        .eq('enrichment_failure_count', 0)
        .or('enrichment_status.is.null,enrichment_status.neq.pending')
    } else if (enrichment === 'failed') {
      query = query.gt('enrichment_failure_count', 0)
    } else if (enrichment === 'pending') {
      query = query.or('last_enriched_at.is.null,enrichment_status.eq.pending')
        .eq('enrichment_failure_count', 0)
    }

    // Filter: alarm level (0-5)
    const alarmLevelNum = parseInt(alarmLevel, 10)
    if (!isNaN(alarmLevelNum) && alarmLevelNum >= 0 && alarmLevelNum <= 5) {
      query = query.eq('alarm_level', alarmLevelNum)
    }

    // Filter: category
    const validCategories = [
      'corruption_scandals', 'democracy_elections', 'policy_legislation',
      'justice_legal', 'executive_actions', 'foreign_policy',
      'corporate_financial', 'civil_liberties', 'media_disinformation',
      'epstein_associates', 'other'
    ]
    if (validCategories.includes(category)) {
      query = query.eq('category', category)
    }

    // Filter: search by headline or ID
    if (search.length > 0) {
      const searchAsId = parseInt(search, 10)
      if (!isNaN(searchAsId) && String(searchAsId) === search) {
        // Pure number — match by ID or headline containing that number
        const escaped = search.replace(/[%_\\]/g, '\\$&')
        query = query.or(`id.eq.${searchAsId},primary_headline.ilike.%${escaped}%`)
      } else {
        // Text — headline search only
        const escaped = search.replace(/[%_\\]/g, '\\$&')
        query = query.ilike('primary_headline', `%${escaped}%`)
      }
    }

    const { data, error } = await query

    if (error) {
      console.error('Query error:', error)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch stories' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Transform data: flatten article count
    const stories = (data || []).map((s: any) => ({
      id: s.id,
      primary_headline: s.primary_headline,
      primary_source: s.primary_source,
      primary_source_url: s.primary_source_url,
      summary_neutral: s.summary_neutral,
      summary_spicy: s.summary_spicy,
      primary_actor: s.primary_actor,
      lifecycle_state: s.lifecycle_state,
      confidence_score: s.confidence_score,
      status: s.status,
      category: s.category,
      alarm_level: s.alarm_level,
      first_seen_at: s.first_seen_at,
      last_updated_at: s.last_updated_at,
      last_enriched_at: s.last_enriched_at,
      enrichment_status: s.enrichment_status,
      enrichment_failure_count: s.enrichment_failure_count,
      source_count: s.source_count,
      article_count: s.article_story?.[0]?.count ?? 0
    }))

    // Determine pagination tokens
    const hasMore = stories.length === limit
    let nextCursor = null
    let nextOffset = null

    if (hasMore) {
      if (sortCol === 'id') {
        nextCursor = String(stories[stories.length - 1].id)
      } else {
        nextOffset = offset + stories.length
      }
    }

    return new Response(
      JSON.stringify({
        stories,
        pagination: {
          next_cursor: nextCursor,
          next_offset: nextOffset,
          has_more: hasMore,
          count: stories.length
        }
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'max-age=30'
        }
      }
    )

  } catch (error) {
    console.error('Error in admin-stories:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
