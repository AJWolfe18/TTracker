// Edge Function: qa-run
// POST: Creates a pending QA job (enqueues item for Node worker)
// GET: Polls for job result by job_id
//
// This function is orchestration only - no OpenAI calls.
// The Node worker (scripts/qa/process-batch.js) does the actual QA.
//
// Required headers:
//   x-api-key: ADMIN_API_KEY (set in Supabase Edge Function environment)
//
// POST body:
//   content_type: "scotus_case" (required)
//   content_id: SCOTUS case ID (required)
//   options: Additional options (optional)
//
// GET params:
//   job_id: Job ID to poll (required)
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
      // Create a pending QA job
      const body = await req.json()
      const { content_type, content_id, options } = body

      // Validate required fields
      if (content_type !== 'scotus_case') {
        return new Response(
          JSON.stringify({ error: 'Only scotus_case content_type is supported' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }

      if (!content_id || typeof content_id !== 'number') {
        return new Response(
          JSON.stringify({ error: 'content_id (number) is required' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }

      // Create a batch with single item
      const { data: batch, error: batchError } = await supabase
        .from('qa_batches')
        .insert({
          content_type: 'scotus_case',
          status: 'pending',
          filter_criteria: { single_case: content_id },
          options: options || {},
          total_items: 1,
          initiated_by: 'qa-run-endpoint',
        })
        .select('id')
        .single()

      if (batchError) {
        throw new Error(`Failed to create batch: ${batchError.message}`)
      }

      // Insert the item
      const { data: item, error: itemError } = await supabase
        .from('qa_batch_items')
        .insert({
          batch_id: batch.id,
          content_type: 'scotus_case',
          content_id,
          status: 'pending',
          options: options || {},
        })
        .select('id')
        .single()

      if (itemError) {
        throw new Error(`Failed to create item: ${itemError.message}`)
      }

      return new Response(
        JSON.stringify({
          job_id: item.id,
          batch_id: batch.id,
          status: 'pending',
          message: 'QA job enqueued. Poll GET /qa-run?job_id=<id> for result.',
        }),
        {
          status: 201,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    if (req.method === 'GET') {
      // Poll for job result
      const url = new URL(req.url)
      const jobId = url.searchParams.get('job_id')

      if (!jobId) {
        return new Response(
          JSON.stringify({ error: 'job_id query param is required' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }

      const { data: item, error: itemError } = await supabase
        .from('qa_batch_items')
        .select('id, content_id, status, qa_verdict, qa_issues, error_message, started_at, completed_at, latency_ms, cost_usd')
        .eq('id', parseInt(jobId))
        .single()

      if (itemError || !item) {
        return new Response(
          JSON.stringify({ error: 'Job not found' }),
          {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }

      return new Response(
        JSON.stringify({
          job_id: item.id,
          content_id: item.content_id,
          status: item.status,
          verdict: item.qa_verdict,
          issues: item.qa_issues,
          error: item.error_message,
          started_at: item.started_at,
          completed_at: item.completed_at,
          latency_ms: item.latency_ms,
          cost_usd: item.cost_usd,
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
    console.error('qa-run error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
