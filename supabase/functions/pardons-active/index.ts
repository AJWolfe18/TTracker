// Edge Function: GET /pardons-active
// Returns active (public) pardons with pagination, search, and filters
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { getSupabaseClient } from '../_shared/auth.ts'

interface CursorData {
  d?: string  // pardon_date (for date sort)
  c?: number  // corruption_level (for corruption sort)
  n?: string  // recipient_name (for name sort)
  id: string  // record id
  s: string   // sort type indicator
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

function createCursor(item: any, sort: string): string {
  const base: CursorData = { id: String(item.id), s: sort }
  if (sort === 'corruption') {
    base.c = item.corruption_level
  } else if (sort === 'name') {
    base.n = item.recipient_name
  } else {
    base.d = item.pardon_date
  }
  return btoa(JSON.stringify(base))
}

// Cursor validation helpers
function isValidCursorDate(d: unknown): d is string {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
}

function isValidCursorId(id: unknown): id is number | string {
  if (typeof id === 'number') return Number.isInteger(id) && id > 0
  return typeof id === 'string' && /^\d+$/.test(id)
}

// Enum validation sets
const VALID_CONNECTION_TYPES = new Set([
  'mar_a_lago_vip', 'major_donor', 'family', 'political_ally',
  'campaign_staff', 'business_associate', 'jan6_defendant',
  'fake_electors', 'celebrity', 'no_connection',
])

const VALID_CRIME_CATEGORIES = new Set([
  'white_collar', 'obstruction', 'political_corruption', 'violent',
  'drug', 'election', 'jan6', 'other',
])

const VALID_RESEARCH_STATUSES = new Set(['complete', 'in_progress', 'pending'])

const VALID_POST_PARDON_STATUSES = new Set(['quiet', 'under_investigation', 're_offended'])

const VALID_RECIPIENT_TYPES = new Set(['person', 'group'])

const VALID_SORT_OPTIONS = new Set(['date', 'corruption', 'name'])

function badParam(name: string, value: string) {
  return new Response(
    JSON.stringify({ error: `Invalid ${name}: ${value}` }),
    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Only allow GET
  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const url = new URL(req.url)

    // Pagination params
    const limit = Math.min(
      parseInt(url.searchParams.get('limit') || '20'),
      100
    )
    const cursor = url.searchParams.get('cursor') || undefined
    let cursorData = parseCursor(cursor)

    // Validate cursor data
    if (cursorData && (!isValidCursorDate(cursorData.d) || !isValidCursorId(cursorData.id))) {
      cursorData = null
    }

    // Search param (full-text via TSVECTOR)
    const q = url.searchParams.get('q')

    // Filter params
    const connectionType = url.searchParams.get('connection_type')
    const crimeCategory = url.searchParams.get('crime_category')
    const corruptionLevel = url.searchParams.get('corruption_level')
    const recipientType = url.searchParams.get('recipient_type')
    const researchStatus = url.searchParams.get('research_status')
    const postPardonStatus = url.searchParams.get('post_pardon_status')
    const sort = url.searchParams.get('sort') || 'date'

    // Validate enum params
    if (connectionType && !VALID_CONNECTION_TYPES.has(connectionType)) {
      return badParam('connection_type', connectionType)
    }
    if (crimeCategory && !VALID_CRIME_CATEGORIES.has(crimeCategory)) {
      return badParam('crime_category', crimeCategory)
    }
    if (recipientType && !VALID_RECIPIENT_TYPES.has(recipientType)) {
      return badParam('recipient_type', recipientType)
    }
    if (researchStatus && !VALID_RESEARCH_STATUSES.has(researchStatus)) {
      return badParam('research_status', researchStatus)
    }
    if (postPardonStatus && !VALID_POST_PARDON_STATUSES.has(postPardonStatus)) {
      return badParam('post_pardon_status', postPardonStatus)
    }
    if (corruptionLevel) {
      const level = parseInt(corruptionLevel)
      if (isNaN(level) || level < 1 || level > 5) {
        return badParam('corruption_level', corruptionLevel)
      }
    }
    if (!VALID_SORT_OPTIONS.has(sort)) {
      return badParam('sort', sort)
    }

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

    // Apply sort order
    if (sort === 'corruption') {
      // Highest corruption first, nulls last
      query = query
        .order('corruption_level', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })
    } else if (sort === 'name') {
      // Alphabetical A-Z
      query = query
        .order('recipient_name', { ascending: true })
        .order('id', { ascending: true })
    } else {
      // Default: date (newest first)
      query = query
        .order('pardon_date', { ascending: false })
        .order('id', { ascending: false })
    }

    query = query.limit(limit + 1) // Get one extra to check for next page

    // Apply cursor pagination based on sort type
    if (cursorData && cursorData.s === sort) {
      if (sort === 'corruption' && cursorData.c !== undefined) {
        // corruption_level DESC, id DESC - get items with lower corruption or same corruption with lower id
        // Handle nulls: if cursor has null, only get items with lower id
        if (cursorData.c === null) {
          query = query.is('corruption_level', null).lt('id', cursorData.id)
        } else {
          query = query.or(
            `corruption_level.lt.${cursorData.c},corruption_level.is.null,and(corruption_level.eq.${cursorData.c},id.lt.${cursorData.id})`
          )
        }
      } else if (sort === 'name' && cursorData.n) {
        // recipient_name ASC, id ASC - get items with greater name or same name with greater id
        query = query.or(
          `recipient_name.gt.${cursorData.n},and(recipient_name.eq.${cursorData.n},id.gt.${cursorData.id})`
        )
      } else if (cursorData.d) {
        // date sort: pardon_date DESC, id DESC
        query = query.or(
          `pardon_date.lt.${cursorData.d},and(pardon_date.eq.${cursorData.d},id.lt.${cursorData.id})`
        )
      }
    }

    // Full-text search
    if (q && q.trim()) {
      query = query.textSearch('search_vector', q.trim(), {
        type: 'websearch',
        config: 'english'
      })
    }

    // Apply filters (already validated above)
    if (connectionType) {
      query = query.eq('primary_connection_type', connectionType)
    }
    if (crimeCategory) {
      query = query.eq('crime_category', crimeCategory)
    }
    if (corruptionLevel) {
      query = query.eq('corruption_level', parseInt(corruptionLevel))
    }
    if (recipientType) {
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
      ? createCursor(items[items.length - 1], sort)
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
