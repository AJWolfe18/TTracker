// Edge Function: admin-judge-log
// Returns Clustering Judge verdicts for the Admin Dashboard "Judge" tab.
// ADO-533: Clustering Judge agent observability. Mirrors admin-pipeline-skips (service_role,
// password-gated) so clustering_judge_log never needs an anon grant.
//
// POST /admin-judge-log
// Body (all optional):
//   hours:   time window (24, 168=7d, 720=30d). Default 168. Clamped to [1, 720].
//   verdict: filter by verdict ('merge' | 'keep' | 'uncertain').
//   source:  filter by source ('judge-agent' | 'inline' | 'manual').
//   limit:   max rows returned. Default 100, max 500.
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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

    // Aggregation query (verdict + merged only, for fast counts)
    let aggQuery = supabase
      .from('clustering_judge_log')
      .select('verdict,merged')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(MAX_AGGREGATION_ROWS)

    if (verdictFilter) aggQuery = aggQuery.eq('verdict', verdictFilter)
    if (sourceFilter) aggQuery = aggQuery.eq('source', sourceFilter)

    // Recent-rows query (full columns, capped)
    let rowsQuery = supabase
      .from('clustering_judge_log')
      .select('id,source,story_id_a,story_id_b,headline_a,headline_b,verdict,confidence,rationale,centroid_sim,merged,dry_run,run_id,created_at')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(limit)

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
      filters: { verdict: verdictFilter, source: sourceFilter },
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
