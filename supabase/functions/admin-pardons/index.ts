// Edge Function: admin-pardons
// Returns paginated pardons list with search/filter for Admin Dashboard
// ADO: Story 338

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { checkAdminPassword } from '../_shared/auth.ts'

// Sort column whitelist — never interpolate raw input
const SORT_MAP: Record<string, string> = {
  id: 'id',
  pardon_date: 'pardon_date',
  corruption_level: 'corruption_level',
  name: 'recipient_slug',
}

// Cursor validation patterns per sort column type
const CURSOR_VALIDATORS: Record<string, RegExp> = {
  id: /^\d+$/,
  pardon_date: /^\d{4}-\d{2}-\d{2}$/,
  corruption_level: /^[1-5]$/,
  recipient_slug: /^[a-z0-9-]+$/,
}

const VALID_CONNECTION_TYPES = [
  'mar_a_lago_vip', 'major_donor', 'family', 'political_ally',
  'campaign_staff', 'business_associate', 'jan6_defendant',
  'fake_electors', 'celebrity', 'no_connection',
]

const VALID_CRIME_CATEGORIES = [
  'white_collar', 'obstruction', 'political_corruption',
  'violent', 'drug', 'election', 'jan6', 'other',
]

const VALID_RESEARCH_STATUS = ['complete', 'in_progress', 'pending']

const SELECT_FIELDS = `
  id, recipient_name, recipient_slug, nickname, photo_url,
  recipient_type, recipient_count, recipient_criteria,
  pardon_date, clemency_type, status,
  conviction_district, case_number, offense_raw,
  crime_description, crime_category, original_sentence, conviction_date,
  primary_connection_type, secondary_connection_types,
  corruption_level, corruption_reasoning,
  trump_connection_detail, donation_amount_usd, receipts_timeline,
  summary_neutral, summary_spicy, why_it_matters, pattern_analysis,
  research_status, research_prompt_version, researched_at,
  post_pardon_status, post_pardon_notes,
  is_public, needs_review, enriched_at,
  primary_source_url, source_urls, pardon_advocates,
  created_at, updated_at
`

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

    // Only accept POST
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
    const isPublic = String(body.isPublic ?? '')
    const connectionType = String(body.connectionType ?? '')
    const crimeCategory = String(body.crimeCategory ?? '')
    const corruptionLevel = String(body.corruptionLevel ?? '')
    const researchStatus = String(body.researchStatus ?? '')
    const enrichment = String(body.enrichment ?? '')
    const sortBy = String(body.sortBy ?? 'pardon_date')
    const sortDir = String(body.sortDir ?? 'desc')
    const cursor = String(body.cursor ?? '')

    const limitParam = parseInt(String(body.limit ?? '25'), 10)
    const limit = Math.min(Math.max(isNaN(limitParam) ? 25 : limitParam, 1), 100)

    // Build query
    let query = supabase
      .from('pardons')
      .select(SELECT_FIELDS)

    // Sorting — only whitelisted columns
    const sortCol = SORT_MAP[sortBy] ?? 'pardon_date'
    const ascending = sortDir === 'asc'
    query = query.order(sortCol, { ascending })

    // Tiebreaker direction matches sortDir
    if (sortCol !== 'id') {
      query = query.order('id', { ascending })
    }

    // Enforce non-null recipient_slug when sorting by name
    if (sortCol === 'recipient_slug') {
      query = query.not('recipient_slug', 'is', null)
    }

    // Keyset cursor pagination
    const op = ascending ? 'gt' : 'lt'

    if (cursor) {
      if (sortCol === 'id') {
        if (/^\d+$/.test(cursor)) {
          query = query[op]('id', cursor)
        }
        // else: malformed → ignore (returns first page)
      } else {
        const sepIdx = cursor.lastIndexOf('::')
        if (sepIdx > 0) {
          const cursorSortValue = cursor.substring(0, sepIdx)
          const cursorId = cursor.substring(sepIdx + 2)
          const sortValidator = CURSOR_VALIDATORS[sortCol]
          if (/^\d+$/.test(cursorId) && sortValidator?.test(cursorSortValue)) {
            query = query.or(
              `${sortCol}.${op}.${cursorSortValue},and(${sortCol}.eq.${cursorSortValue},id.${op}.${cursorId})`
            )
          }
          // else: malformed → ignore
        }
        // else: malformed → ignore
      }
    }

    // Fetch limit + 1 for has_more detection
    query = query.limit(limit + 1)

    // Filter: isPublic (sub-tab)
    if (isPublic === 'true') {
      query = query.eq('is_public', true)
    } else if (isPublic === 'false') {
      query = query.eq('is_public', false)
    }

    // Filter: connectionType — checks BOTH primary and secondary
    if (connectionType && VALID_CONNECTION_TYPES.includes(connectionType)) {
      query = query.or(
        `primary_connection_type.eq.${connectionType},secondary_connection_types.cs.{${connectionType}}`
      )
    }

    // Filter: crimeCategory
    if (crimeCategory && VALID_CRIME_CATEGORIES.includes(crimeCategory)) {
      query = query.eq('crime_category', crimeCategory)
    }

    // Filter: corruptionLevel (1-5)
    const corruptionLevelNum = parseInt(corruptionLevel, 10)
    if (!isNaN(corruptionLevelNum) && corruptionLevelNum >= 1 && corruptionLevelNum <= 5) {
      query = query.eq('corruption_level', corruptionLevelNum)
    }

    // Filter: researchStatus
    if (researchStatus && VALID_RESEARCH_STATUS.includes(researchStatus)) {
      query = query.eq('research_status', researchStatus)
    }

    // Filter: enrichment (derived from enriched_at)
    if (enrichment === 'enriched') {
      query = query.not('enriched_at', 'is', null)
    } else if (enrichment === 'pending') {
      query = query.is('enriched_at', null)
    }

    // Search: by name or exact ID
    if (search.length > 0) {
      if (/^\d+$/.test(search) && search.length <= 15) {
        const escaped = search.replace(/[%_\\]/g, '\\$&')
        query = query.or(`id.eq.${search},recipient_name.ilike.%${escaped}%`)
      } else {
        const escaped = search.replace(/[%_\\]/g, '\\$&')
        query = query.ilike('recipient_name', `%${escaped}%`)
      }
    }

    const { data, error } = await query

    if (error) {
      console.error('Query error:', error)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch pardons' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // has_more detection: if we got limit+1 rows, there are more
    const hasMore = (data || []).length > limit
    const pardons = hasMore ? (data || []).slice(0, limit) : (data || [])

    // Next cursor generation
    let nextCursor: string | null = null
    if (hasMore && pardons.length > 0) {
      const last = pardons[pardons.length - 1] as any
      nextCursor = sortCol === 'id'
        ? String(last.id)
        : `${last[sortCol]}::${last.id}`
    }

    return new Response(
      JSON.stringify({
        pardons,
        pagination: { next_cursor: nextCursor, has_more: hasMore }
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
    console.error('Error in admin-pardons:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
