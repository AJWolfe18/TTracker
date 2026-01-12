// Edge Function: GET /pardons-active
// Returns active (public) pardons with pagination, search, and filters
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, handleCors } from '../_shared/cors.ts'
import { getSupabaseClient } from '../_shared/auth.ts'

interface CursorData {
  d: string  // pardon_date
  id: string // record id
}

function parseCursor(cursor?: string): CursorData | null {
  if (!cursor) return null
  try {
    const decoded = atob(cursor)
    return JSON.parse(decoded)
  } catch {
    return null
  }
}

function createCursor(pardonDate: string, id: string): string {
  return btoa(JSON.stringify({ d: pardonDate, id }))
}

serve(async (req: Request) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const url = new URL(req.url)

    // Pagination params
    const limit = Math.min(
      parseInt(url.searchParams.get('limit') || '20'),
      100
    )
    const cursor = url.searchParams.get('cursor') || undefined
    const cursorData = parseCursor(cursor)

    // Search param (full-text via TSVECTOR)
    const q = url.searchParams.get('q')

    // Filter params
    const connectionType = url.searchParams.get('connection_type')
    const crimeCategory = url.searchParams.get('crime_category')
    const corruptionLevel = url.searchParams.get('corruption_level')
    const recipientType = url.searchParams.get('recipient_type')
    const researchStatus = url.searchParams.get('research_status')
    const postPardonStatus = url.searchParams.get('post_pardon_status')

    const supabase = getSupabaseClient(req)

    // Build query - select only needed fields for list view
    let query = supabase
      .from('pardons')
      .select(`
        id,
        recipient_name,
        recipient_slug,
        nickname,
        photo_url,
        recipient_type,
        recipient_count,
        recipient_criteria,
        pardon_date,
        clemency_type,
        status,
        crime_description,
        crime_category,
        primary_connection_type,
        corruption_level,
        research_status,
        post_pardon_status,
        summary_spicy,
        is_public
      `)
      .eq('is_public', true) // RLS backup - only public pardons
      .order('pardon_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1) // Get one extra to check for next page

    // Apply cursor pagination
    if (cursorData) {
      // (pardon_date, id) < (cursor_date, cursor_id)
      query = query.or(
        `pardon_date.lt.${cursorData.d},and(pardon_date.eq.${cursorData.d},id.lt.${cursorData.id})`
      )
    }

    // Full-text search
    if (q && q.trim()) {
      query = query.textSearch('search_vector', q.trim(), {
        type: 'websearch',
        config: 'english'
      })
    }

    // Apply filters
    if (connectionType) {
      query = query.eq('primary_connection_type', connectionType)
    }
    if (crimeCategory) {
      query = query.eq('crime_category', crimeCategory)
    }
    if (corruptionLevel) {
      const level = parseInt(corruptionLevel)
      if (level >= 1 && level <= 5) {
        query = query.eq('corruption_level', level)
      }
    }
    if (recipientType && ['person', 'group'].includes(recipientType)) {
      query = query.eq('recipient_type', recipientType)
    }
    if (researchStatus) {
      query = query.eq('research_status', researchStatus)
    }
    if (postPardonStatus) {
      query = query.eq('post_pardon_status', postPardonStatus)
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

    // Create next cursor from last item
    const nextCursor = hasMore && items.length > 0
      ? createCursor(
          items[items.length - 1].pardon_date,
          String(items[items.length - 1].id)
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
