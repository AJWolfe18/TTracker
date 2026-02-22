// Edge Function: qa-history
// GET: Returns revision history for a SCOTUS case
//
// Required headers:
//   x-api-key: ADMIN_API_KEY (set in Supabase Edge Function environment)
//
// Query params:
//   content_id: SCOTUS case ID (required)
//   limit: Max revisions to return (default: 20)
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

  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  const supabase = getAdminClient()

  try {
    const url = new URL(req.url)
    const contentId = url.searchParams.get('content_id')
    const limit = parseInt(url.searchParams.get('limit') || '20')

    if (!contentId) {
      return new Response(
        JSON.stringify({ error: 'content_id query param is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // Fetch revisions
    const { data: revisions, error: revError } = await supabase
      .from('content_revisions')
      .select('id, created_at, trigger_source, trigger_id, changed_fields, actor_type, actor_id, change_summary')
      .eq('content_type', 'scotus_case')
      .eq('content_id', parseInt(contentId))
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit)

    if (revError) {
      throw new Error(`Failed to fetch revisions: ${revError.message}`)
    }

    // Fetch current case state
    const { data: currentCase, error: caseError } = await supabase
      .from('scotus_cases')
      .select('id, case_name, qa_verdict, qa_layer_b_verdict, enriched_at')
      .eq('id', parseInt(contentId))
      .single()

    if (caseError) {
      throw new Error(`Failed to fetch case: ${caseError.message}`)
    }

    return new Response(
      JSON.stringify({
        content_id: parseInt(contentId),
        content_type: 'scotus_case',
        case_name: currentCase?.case_name,
        current_state: {
          qa_verdict: currentCase?.qa_verdict,
          qa_layer_b_verdict: currentCase?.qa_layer_b_verdict,
          enriched_at: currentCase?.enriched_at,
        },
        revisions: revisions || [],
        total_revisions: revisions?.length || 0,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('qa-history error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
