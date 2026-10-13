// Edge Function: admin-judge-log
// Returns Clustering Judge verdicts for the Admin Dashboard "Judge" tab.
// ADO-533: Clustering Judge agent observability. Mirrors admin-pipeline-skips (service_role,
// password-gated) so clustering_judge_log never needs an anon grant.
//
// POST /admin-judge-log
// Body (all optional):
//   hours:    time window (24, 168=7d, 720=30d). Default 168. Clamped to [1, 720].
//   verdict:  filter by verdict ('merge' | 'keep' | 'uncertain' | 'unmerge').
//   source:   filter by source ('judge-agent' | 'inline' | 'manual').
//   story_id: return only verdicts touching this story (story_id_a OR story_id_b).
//             Ignores the time window — an old merge must always be findable (ADO-537 UX).
//   limit:    max rows returned. Default 100, max 500.
//   view:     'needs_review' → only pairs whose LATEST live verdict is 'uncertain' and whose
//             stories are both still live (not merged away). A later manual dismiss ('keep'),
//             merge or unmerge on the pair takes it out. Always looks at the last 30 days and
//             ignores hours / verdict / story_id (source still applies to the uncertain row).
//             total_count = number of pairs needing review.
//
// Response:
//   {
//     time_range_hours, total_count, merged_count,
//     by_verdict: [{ verdict, count }],
//     rows: [{ id, source, story_id_a, story_id_b, headline_a, headline_b, verdict,
//              confidence, rationale, centroid_sim, merged, dry_run, run_id, created_at }],
//     timestamp
//   }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { checkAdminPassword } from '../_shared/auth.ts'

const MAX_AGGREGATION_ROWS = 100000
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500
const DEFAULT_HOURS = 168
const MAX_HOURS = 720 // 30 days
const VALID_VERDICTS = new Set(['merge', 'keep', 'uncertain', 'unmerge'])
const VALID_SOURCES = new Set(['judge-agent', 'inline', 'manual'])
const ROW_FIELDS = 'id,source,story_id_a,story_id_b,headline_a,headline_b,verdict,confidence,rationale,centroid_sim,merged,dry_run,run_id,created_at'
const STORY_ID_CHUNK = 200
const NEEDS_REVIEW_PAGE = 1000
const NEEDS_REVIEW_MAX_ROWS = 20000

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(
    JSON.stringify(body),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extraHeaders } }
  )
}

const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`)

// "Needs review": pairs whose latest live (non-dry-run) verdict is 'uncertain' and whose two
// stories are both still live. Any later verdict on the pair — a manual dismiss ('keep'), a
// merge, an unmerge, or a newer Judge verdict — supersedes the uncertain one.
// deno-lint-ignore no-explicit-any
async function needsReview(supabase: any, sourceFilter: string | null, limit: number) {
  const cutoff = new Date(Date.now() - MAX_HOURS * 60 * 60 * 1000).toISOString()
  // Cursor-paged by id (identity, so newest-first == id desc): PostgREST caps a single
  // response at max_rows (1000 on Supabase), and a missed newer row could resurrect a
  // dismissed pair.
  // deno-lint-ignore no-explicit-any
  const decisions: any[] = []
  let cursor: number | null = null
  while (decisions.length < NEEDS_REVIEW_MAX_ROWS) {
    let q = supabase
      .from('clustering_judge_log')
      .select('id,source,story_id_a,story_id_b,verdict')
      .eq('dry_run', false)
      .not('story_id_a', 'is', null)
      .not('story_id_b', 'is', null)
      .not('verdict', 'is', null)
      .gte('created_at', cutoff)
      .order('id', { ascending: false })
      .limit(NEEDS_REVIEW_PAGE)
    if (cursor != null) q = q.lt('id', cursor)
    const { data: page, error } = await q
    if (error) throw new Error(`Needs-review query failed: ${error.message}`)
    decisions.push(...(page || []))
    if (!page || page.length < NEEDS_REVIEW_PAGE) break
    cursor = page[page.length - 1].id
  }

  // Rows are newest-first, so the first row seen per pair is that pair's latest verdict.
  const seen = new Set<string>()
  const candidates: { id: number; story_id_a: number; story_id_b: number }[] = []
  for (const row of decisions) {
    const key = pairKey(row.story_id_a, row.story_id_b)
    if (seen.has(key)) continue
    seen.add(key)
    if (row.verdict !== 'uncertain') continue
    if (sourceFilter && row.source !== sourceFilter) continue
    candidates.push(row)
  }

  // Drop pairs where either story was merged away (or deleted) since the verdict.
  const storyIds = [...new Set(candidates.flatMap((r) => [r.story_id_a, r.story_id_b]))]
  const live = new Set<number>()
  for (let i = 0; i < storyIds.length; i += STORY_ID_CHUNK) {
    const { data: stories, error: storyError } = await supabase
      .from('stories')
      .select('id,status')
      .in('id', storyIds.slice(i, i + STORY_ID_CHUNK))
    if (storyError) throw new Error(`Story status lookup failed: ${storyError.message}`)
    for (const st of stories || []) {
      if (st.status !== 'merged_into') live.add(st.id)
    }
  }
  const open = candidates.filter((r) => live.has(r.story_id_a) && live.has(r.story_id_b))

  const pageIds = open.slice(0, limit).map((r) => r.id)
  let rows: unknown[] = []
  if (pageIds.length > 0) {
    const { data, error: rowsError } = await supabase
      .from('clustering_judge_log')
      .select(ROW_FIELDS)
      .in('id', pageIds)
      .order('created_at', { ascending: false })
    if (rowsError) throw new Error(`Rows query failed: ${rowsError.message}`)
    rows = data || []
  }

  return {
    view: 'needs_review',
    time_range_hours: MAX_HOURS,
    total_count: open.length,
    merged_count: 0,
    truncated: decisions.length >= NEEDS_REVIEW_MAX_ROWS,
    filters: { verdict: null, source: sourceFilter, story_id: null },
    by_verdict: [{ verdict: 'uncertain', count: open.length }],
    rows,
    timestamp: new Date().toISOString()
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (!checkAdminPassword(req)) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const url = new URL(req.url)
    let body: Record<string, unknown> = {}
    if (req.method === 'POST') {
      try {
        const text = await req.text()
        body = text ? JSON.parse(text) : {}
      } catch (_) {
        body = {}
      }
    }
    const pick = (key: string): string | null => {
      const v = body[key] ?? url.searchParams.get(key)
      if (v == null) return null
      return String(v).trim() || null
    }

    const hoursRaw = parseInt(pick('hours') || String(DEFAULT_HOURS), 10)
    const hours = Number.isFinite(hoursRaw) ? Math.max(1, Math.min(MAX_HOURS, hoursRaw)) : DEFAULT_HOURS
    const verdictRaw = pick('verdict')
    const verdictFilter = verdictRaw && VALID_VERDICTS.has(verdictRaw) ? verdictRaw : null
    const sourceRaw = pick('source')
    const sourceFilter = sourceRaw && VALID_SOURCES.has(sourceRaw) ? sourceRaw : null
    const limitRaw = parseInt(pick('limit') || String(DEFAULT_LIMIT), 10)
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(MAX_LIMIT, limitRaw)) : DEFAULT_LIMIT
    const storyIdRaw = pick('story_id')
    const storyIdParsed = storyIdRaw != null ? parseInt(storyIdRaw, 10) : NaN
    const storyIdFilter = Number.isSafeInteger(storyIdParsed) && storyIdParsed > 0 ? storyIdParsed : null

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    if (pick('view') === 'needs_review') {
      try {
        return jsonResponse(await needsReview(supabase, sourceFilter, limit))
      } catch (err) {
        console.error((err as Error).message)
        return jsonResponse({ error: 'Needs-review query failed' }, 500)
      }
    }

    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

    // Aggregation query (verdict + merged only, for fast counts).
    // A story_id search ignores the time cutoff: its whole point is finding the old merge
    // that ate a story, and that merge may be far outside any selectable window.
    let aggQuery = supabase
      .from('clustering_judge_log')
      .select('verdict,merged')
      .order('created_at', { ascending: false })
      .limit(MAX_AGGREGATION_ROWS)

    if (!storyIdFilter) aggQuery = aggQuery.gte('created_at', cutoff)
    if (storyIdFilter) aggQuery = aggQuery.or(`story_id_a.eq.${storyIdFilter},story_id_b.eq.${storyIdFilter}`)
    if (verdictFilter) aggQuery = aggQuery.eq('verdict', verdictFilter)
    if (sourceFilter) aggQuery = aggQuery.eq('source', sourceFilter)

    // Recent-rows query (full columns, capped)
    let rowsQuery = supabase
      .from('clustering_judge_log')
      .select(ROW_FIELDS)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (!storyIdFilter) rowsQuery = rowsQuery.gte('created_at', cutoff)
    if (storyIdFilter) rowsQuery = rowsQuery.or(`story_id_a.eq.${storyIdFilter},story_id_b.eq.${storyIdFilter}`)
    if (verdictFilter) rowsQuery = rowsQuery.eq('verdict', verdictFilter)
    if (sourceFilter) rowsQuery = rowsQuery.eq('source', sourceFilter)

    const [aggResult, rowsResult] = await Promise.all([aggQuery, rowsQuery])

    if (aggResult.error) {
      console.error('Aggregation query failed:', aggResult.error.message)
      return new Response(
        JSON.stringify({ error: 'Aggregation query failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (rowsResult.error) {
      console.error('Rows query failed:', rowsResult.error.message)
      return new Response(
        JSON.stringify({ error: 'Rows query failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const aggRows = aggResult.data || []

    // Count by verdict (skip null verdicts — heartbeat rows) + total executed merges
    const verdictMap = new Map<string, number>()
    let mergedCount = 0
    for (const row of aggRows) {
      if (row.verdict) verdictMap.set(row.verdict, (verdictMap.get(row.verdict) || 0) + 1)
      if (row.merged) mergedCount++
    }

    const byVerdict = Array.from(verdictMap.entries())
      .map(([verdict, count]) => ({ verdict, count }))
      .sort((a, b) => b.count - a.count)

    const response = {
      time_range_hours: hours,
      total_count: aggRows.length,
      merged_count: mergedCount,
      truncated: aggRows.length >= MAX_AGGREGATION_ROWS,
      filters: { verdict: verdictFilter, source: sourceFilter, story_id: storyIdFilter },
      by_verdict: byVerdict,
      rows: rowsResult.data || [],
      timestamp: new Date().toISOString()
    }

    return new Response(
      JSON.stringify(response),
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
    console.error('Error in admin-judge-log:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
