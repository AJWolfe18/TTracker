// Edge Function: admin-pipeline-skips
// Returns aggregated pipeline_skips data for the Admin Dashboard silent-skip card.
// ADO-466: Silent Skip Visibility
//
// POST /admin-pipeline-skips
// Body (all optional):
//   hours:    time window (24, 168=7d, 720=30d). Default 24. Clamped to [1, 720].
//   pipeline: filter by pipeline (exact match)
//   reason:   filter by reason (exact match)
//   limit:    max recent rows returned. Default 50, max 200.
//
// Response:
//   {
//     time_range_hours, total_count,
//     by_pipeline: [{ pipeline, count, reasons: [{ reason, count }] }],
//     recent_rows: [{ id, pipeline, reason, entity_type, entity_id, metadata, created_at }],
//     timestamp
//   }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { checkAdminPassword } from '../_shared/auth.ts'

const MAX_AGGREGATION_ROWS = 100000 // hard cap on rows pulled for aggregation (bumped for freshness_filter volume)
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const DEFAULT_HOURS = 24
const MAX_HOURS = 720 // 30 days

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

    // Accept params from either POST body or GET query string (body wins)
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
    const pipelineFilter = pick('pipeline')
    const reasonFilter = pick('reason')
    const limitRaw = parseInt(pick('limit') || String(DEFAULT_LIMIT), 10)
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(MAX_LIMIT, limitRaw)) : DEFAULT_LIMIT

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

    // Build aggregation query (pipeline + reason only, for fast aggregation)
    let aggQuery = supabase
      .from('pipeline_skips')
      .select('pipeline,reason')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(MAX_AGGREGATION_ROWS)

    if (pipelineFilter) aggQuery = aggQuery.eq('pipeline', pipelineFilter)
    if (reasonFilter) aggQuery = aggQuery.eq('reason', reasonFilter)

    // Build recent-rows query (full columns, capped)
    let rowsQuery = supabase
      .from('pipeline_skips')
      .select('id,pipeline,reason,entity_type,entity_id,metadata,created_at')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (pipelineFilter) rowsQuery = rowsQuery.eq('pipeline', pipelineFilter)
    if (reasonFilter) rowsQuery = rowsQuery.eq('reason', reasonFilter)

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
    const truncated = aggRows.length >= MAX_AGGREGATION_ROWS

    // Aggregate by pipeline + reason
    const byPipelineMap = new Map<string, { count: number; reasons: Map<string, number> }>()
    for (const row of aggRows) {
      const p = row.pipeline
      const r = row.reason
      if (!byPipelineMap.has(p)) byPipelineMap.set(p, { count: 0, reasons: new Map() })
      const entry = byPipelineMap.get(p)!
      entry.count++
      entry.reasons.set(r, (entry.reasons.get(r) || 0) + 1)
    }

    const byPipeline = Array.from(byPipelineMap.entries())
      .map(([pipeline, entry]) => ({
        pipeline,
        count: entry.count,
        reasons: Array.from(entry.reasons.entries())
          .map(([reason, count]) => ({ reason, count }))
          .sort((a, b) => b.count - a.count)
      }))
      .sort((a, b) => b.count - a.count)

    const response = {
      time_range_hours: hours,
      total_count: aggRows.length,
      truncated,
      filters: {
        pipeline: pipelineFilter,
        reason: reasonFilter
      },
      by_pipeline: byPipeline,
      recent_rows: rowsResult.data || [],
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
    console.error('Error in admin-pipeline-skips:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
