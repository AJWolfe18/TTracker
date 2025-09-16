// Edge Function: GET /api/v1/stories/active
// Returns active stories with pagination
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, handleCors } from '../_shared/cors.ts'
import { getSupabaseClient } from '../_shared/auth.ts'
import { getPaginationParams, parseCursor, createCursor } from '../_shared/pagination.ts'

serve(async (req: Request) => {
  // Handle CORS
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const url = new URL(req.url)
    const { limit, cursor } = getPaginationParams(url)
    const cursorData = parseCursor(cursor)
    
    const supabase = getSupabaseClient(req)
    
    // Build query
    let query = supabase
      .from('stories')
      .select(`
        id,
        story_hash,
        primary_headline,
        primary_source,
        primary_source_url,
        primary_source_domain,
        primary_actor,
        last_updated_at,
        first_seen_at,
        status,
        severity,
        topic_tags,
        source_count,
        has_opinion,
        summary_neutral,
        summary_spicy
      `)
      .eq('status', 'active')
      .order('last_updated_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1) // Get one extra to check if there's a next page
    
    // Apply cursor if provided
    if (cursorData) {
      query = query.or(`last_updated_at.lt.${cursorData.ts},and(last_updated_at.eq.${cursorData.ts},id.lt.${cursorData.id})`)
    }
    
    const { data, error } = await query
    
    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }
    
    // Check if there's a next page
    const hasMore = data && data.length > limit
    const items = hasMore ? data.slice(0, -1) : data || []
    
    // Create next cursor if there are more items
    const nextCursor = hasMore && items.length > 0
      ? createCursor(
          items[items.length - 1].last_updated_at,
          items[items.length - 1].id
        )
      : null
    
    return new Response(
      JSON.stringify({
        items,
        next_cursor: nextCursor,
        has_more: hasMore,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})