// Edge Function: admin-scotus
// Returns paginated SCOTUS cases list with search/filter for Admin Dashboard
// Also supports action: 'run_log' for enrichment agent run history
// ADO: Story 340

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { checkAdminPassword } from '../_shared/auth.ts'

// Sort column whitelist — never interpolate raw input
const SORT_MAP: Record<string, string> = {
  id: 'id',
  decided_at: 'decided_at',
  ruling_impact_level: 'ruling_impact_level',
  case_name: 'case_name_short',
}

// Cursor validation patterns per sort column type
const CURSOR_VALIDATORS: Record<string, RegExp> = {
  id: /^\d+$/,
  decided_at: /^\d{4}-\d{2}-\d{2}$/,
  ruling_impact_level: /^[0-5]$/,
  case_name_short: /^[\w .'\-]+$/,
}

// Filter value whitelists
const VALID_ENRICHMENT_STATUSES = ['pending', 'enriched', 'flagged', 'failed']
const VALID_QA_STATUSES = ['pending_qa', 'approved', 'flagged', 'rejected', 'human_override']
const VALID_CASE_TYPES = ['merits', 'procedural', 'shadow_docket', 'cert_stage', 'unclear']

const SELECT_FIELDS = `
  id, case_name, case_name_short, case_name_full, docket_number, term, decided_at, argued_at, citation,
  vote_split, majority_author, dissent_authors, dissent_exists,
  disposition, case_type, merits_reached, is_merits_decision, prevailing_party, issue_area, holding,
  ruling_impact_level, ruling_label, summary_spicy, who_wins, who_loses,
  why_it_matters, dissent_highlights, practical_effect, media_says, actually_means,
  evidence_anchors, substantive_winner,
  fact_extraction_confidence, low_confidence_reason, needs_manual_review,
  enrichment_status, is_public, qa_status, qa_verdict, qa_review_note, qa_reviewed_at,
  manual_reviewed_at, manual_review_note,
  enriched_at, prompt_version, source_data_version, created_at, updated_at
`

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Authentication check
    if (!checkAdminPassword(req)) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    // Only accept POST
    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Parse params from POST body
    let body: Record<string, unknown> = {}
    try {
      body = await req.json()
    } catch {
      // Empty body defaults to no filters
    }

    const action = String(body.action ?? 'list')

    // --- Run Log Mode ---
    if (action === 'run_log') {
      const { data: runs, error: runError } = await supabase
        .from('scotus_enrichment_log')
        .select('id, ran_at, completed_at, status, agent_model, prompt_version, cases_found, cases_enriched, cases_failed, cases_skipped, duration_seconds, run_source, errors')
        .order('ran_at', { ascending: false })
        .limit(10)

      if (runError) {
        console.error('Run log query error:', runError)
        return jsonResponse({ error: 'Failed to fetch enrichment runs' }, 500)
      }

      return jsonResponse({ enrichment_runs: runs || [] }, 200)
    }

    // --- List Mode (default) ---
    const search = String(body.search ?? '').trim()
    const isPublic = String(body.isPublic ?? '')
    const term = String(body.term ?? '')
    const enrichmentStatus = String(body.enrichmentStatus ?? '')
    const needsManualReview = String(body.needsManualReview ?? '')
    const qaStatus = String(body.qaStatus ?? '')
    const caseType = String(body.caseType ?? '')
    const impactLevel = String(body.impactLevel ?? '')
    const sortBy = String(body.sortBy ?? 'decided_at')
    const sortDir = String(body.sortDir ?? 'desc')
    const cursor = String(body.cursor ?? '')

    const limitParam = parseInt(String(body.limit ?? '25'), 10)
    const limit = Math.min(Math.max(isNaN(limitParam) ? 25 : limitParam, 1), 100)

    // --- Fetch available terms (lightweight metadata) ---
    const { data: termsData } = await supabase
      .from('scotus_cases')
      .select('term')
      .neq('enrichment_status', 'flagged')
      .not('term', 'is', null)
      .order('term', { ascending: false })

    const availableTerms = [...new Set((termsData || []).map((t: { term: string }) => t.term).filter(Boolean))]

    // --- Build main query ---
    let query = supabase
      .from('scotus_cases')
      .select(SELECT_FIELDS)

    // Sorting — only whitelisted columns
    const sortCol = SORT_MAP[sortBy] ?? 'decided_at'
    const ascending = sortDir === 'asc'
    query = query.order(sortCol, { ascending, nullsFirst: false })

    // Deterministic tiebreaker: secondary sort on id in same direction
    if (sortCol !== 'id') {
      query = query.order('id', { ascending })
    }

    // Exclude null sort values when sorting by text column (prevents cursor issues)
    if (sortCol === 'case_name_short') {
      query = query.not('case_name_short', 'is', null)
    }

    // --- Keyset cursor pagination ---
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

    // --- Filters ---

    // isPublic (sub-tab)
    if (isPublic === 'true') {
      query = query.eq('is_public', true)
    } else if (isPublic === 'false') {
      query = query.eq('is_public', false)
    }

    // term — validated against available terms
    if (term && availableTerms.includes(term)) {
      query = query.eq('term', term)
    }

    // enrichmentStatus
    if (enrichmentStatus && VALID_ENRICHMENT_STATUSES.includes(enrichmentStatus)) {
      query = query.eq('enrichment_status', enrichmentStatus)
    }

    // needsManualReview
    if (needsManualReview === 'true') {
      query = query.eq('needs_manual_review', true)
    }

    // qaStatus
    if (qaStatus && VALID_QA_STATUSES.includes(qaStatus)) {
      query = query.eq('qa_status', qaStatus)
    }

    // caseType
    if (caseType && VALID_CASE_TYPES.includes(caseType)) {
      query = query.eq('case_type', caseType)
    }

    // impactLevel (0-5)
    const impactLevelNum = parseInt(impactLevel, 10)
    if (!isNaN(impactLevelNum) && impactLevelNum >= 0 && impactLevelNum <= 5) {
      query = query.eq('ruling_impact_level', impactLevelNum)
    }

    // Search — split numeric and text paths
    if (search.length > 0) {
      if (/^\d+$/.test(search) && search.length <= 10) {
        // Numeric-only input → search by ID exclusively
        query = query.eq('id', parseInt(search, 10))
      } else {
        // Text input → search by case_name only (never passed to id.eq)
        const escaped = search.replace(/[%_\\]/g, '\\$&')
        query = query.ilike('case_name_short', `%${escaped}%`)
      }
    }

    const { data, error } = await query

    if (error) {
      console.error('Query error:', error)
      return jsonResponse({ error: 'Failed to fetch SCOTUS cases' }, 500)
    }

    // has_more detection: if we got limit+1 rows, there are more
    const hasMore = (data || []).length > limit
    const cases = hasMore ? (data || []).slice(0, limit) : (data || [])

    // Next cursor generation
    let nextCursor: string | null = null
    if (hasMore && cases.length > 0) {
      const last = cases[cases.length - 1] as Record<string, unknown>
      if (sortCol === 'id') {
        nextCursor = String(last.id)
      } else {
        let sortValue = String(last[sortCol] ?? '')
        // Trim timestamps to date-only to match CURSOR_VALIDATORS pattern
        if (sortCol === 'decided_at' && sortValue.includes('T')) {
          sortValue = sortValue.substring(0, 10)
        }
        nextCursor = `${sortValue}::${last.id}`
      }
    }

    return jsonResponse({
      scotus_cases: cases,
      pagination: { next_cursor: nextCursor, has_more: hasMore },
      available_terms: availableTerms
    }, 200)

  } catch (error) {
    console.error('Error in admin-scotus:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
})
