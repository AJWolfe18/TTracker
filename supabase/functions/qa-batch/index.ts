// Edge Function: qa-batch
// POST: Creates a batch with items for QA processing
// GET: Returns batch status with items and computed total_cost_usd
//
// Required headers:
//   x-api-key: ADMIN_API_KEY (set in Supabase Edge Function environment)
//   x-admin-id: Identifier for who initiated the batch (for audit trail, optional)
//
// POST body:
//   filter: Object with filtering criteria
//     - verdict: Array of verdicts to filter by (e.g., ['FLAG', 'REJECT'])
//     - since: ISO date string for enriched_at filter
//     - needs_qa: boolean to filter cases without Layer B QA
//     - case_ids: Array of specific case IDs
//   limit: Max items to include (default: 50)
//   options: Additional options for QA processing
//
// GET params:
//   batch_id: Batch ID to check (required)
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, handleCors } from '../_shared/cors.ts'
import { getAdminClient, checkAdminAuth } from '../_shared/auth.ts'

serve(async (req: Request) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  // Require admin auth
  if (!checkAdminAuth(req)) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  const supabase = getAdminClient()

  try {
    if (req.method === 'POST') {
      const body = await req.json()
      const { filter, limit, options } = body
      const maxItems = Math.min(limit || 50, 100) // Cap at 100 items

      // Build query for cases to include
      let query = supabase
        .from('scotus_cases')
        .select('id')
        .eq('enrichment_status', 'enriched')
        .not('summary_spicy', 'is', null)

      // Apply filters
      if (filter?.verdict && Array.isArray(filter.verdict)) {
        query = query.in('qa_verdict', filter.verdict)
      }

      if (filter?.since) {
        query = query.gte('enriched_at', filter.since)
      }

      if (filter?.needs_qa) {
        query = query.is('qa_layer_b_ran_at', null)
      }

      if (filter?.case_ids && Array.isArray(filter.case_ids)) {
        query = query.in('id', filter.case_ids)
      }

      query = query.order('enriched_at', { ascending: false }).limit(maxItems)

      const { data: cases, error: casesError } = await query

      if (casesError) {
        throw new Error(`Failed to fetch cases: ${casesError.message}`)
      }

      if (!cases || cases.length === 0) {
        return new Response(
          JSON.stringify({ error: 'No cases match the filter criteria' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }

      // Get admin ID from header (for audit trail)
      // Callers should set x-admin-id header to identify who initiated the batch
      const adminId = req.headers.get('x-admin-id') || 'system'

      // Create batch
      const { data: batch, error: batchError } = await supabase
        .from('qa_batches')
        .insert({
          content_type: 'scotus_case',
          status: 'pending',
          filter_criteria: filter || {},
          options: options || {},
          total_items: cases.length,
          initiated_by: adminId,
        })
        .select('id, created_at')
        .single()

      if (batchError) {
        throw new Error(`Failed to create batch: ${batchError.message}`)
      }

      // Insert batch items
      const items = cases.map(c => ({
        batch_id: batch.id,
        content_type: 'scotus_case',
        content_id: c.id,
        status: 'pending',
        options: options || {},
      }))

      const { error: itemsError } = await supabase
        .from('qa_batch_items')
        .insert(items)

      if (itemsError) {
        throw new Error(`Failed to create items: ${itemsError.message}`)
      }

      return new Response(
        JSON.stringify({
          batch_id: batch.id,
          status: 'pending',
          total_items: cases.length,
          created_at: batch.created_at,
          message: 'Batch created. Items will be processed by the QA worker.',
        }),
        {
          status: 201,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    if (req.method === 'GET') {
      const url = new URL(req.url)
      const batchId = url.searchParams.get('batch_id')

      if (!batchId) {
        return new Response(
          JSON.stringify({ error: 'batch_id query param is required' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }

      // Fetch batch
      const { data: batch, error: batchError } = await supabase
        .from('qa_batches')
        .select('id, status, created_at, started_at, completed_at, total_items, filter_criteria, options, initiated_by')
        .eq('id', parseInt(batchId))
        .single()

      if (batchError || !batch) {
        return new Response(
          JSON.stringify({ error: 'Batch not found' }),
          {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }

      // Fetch items with summary
      const { data: items, error: itemsError } = await supabase
        .from('qa_batch_items')
        .select('id, content_id, status, qa_verdict, error_message, cost_usd')
        .eq('batch_id', parseInt(batchId))
        .order('id')

      if (itemsError) {
        throw new Error(`Failed to fetch items: ${itemsError.message}`)
      }

      // Compute stats
      const stats = {
        pending: 0,
        processing: 0,
        completed: 0,
        error: 0,
        skipped: 0,
      }
      const verdictCounts = {
        APPROVE: 0,
        FLAG: 0,
        REJECT: 0,
      }

      let totalCostUsd = 0

      for (const item of items || []) {
        stats[item.status as keyof typeof stats]++
        if (item.qa_verdict) {
          verdictCounts[item.qa_verdict as keyof typeof verdictCounts]++
        }
        totalCostUsd += Number(item.cost_usd) || 0
      }

      const progress = batch.total_items > 0
        ? Math.round(((stats.completed + stats.error + stats.skipped) / batch.total_items) * 100)
        : 0

      return new Response(
        JSON.stringify({
          batch_id: batch.id,
          status: batch.status,
          created_at: batch.created_at,
          started_at: batch.started_at,
          completed_at: batch.completed_at,
          total_items: batch.total_items,
          progress_percent: progress,
          stats,
          verdict_counts: verdictCounts,
          total_cost_usd: totalCostUsd,
          filter_criteria: batch.filter_criteria,
          initiated_by: batch.initiated_by,
          items: items || [],
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('qa-batch error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
