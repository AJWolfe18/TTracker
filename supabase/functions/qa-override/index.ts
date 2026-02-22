// Edge Function: qa-override
// POST: Allows admin to override QA verdict with reason
//
// Required headers:
//   x-api-key: ADMIN_API_KEY (set in Supabase Edge Function environment)
//   x-admin-id: Identifier for who made the override (for audit trail, optional)
//
// Body:
//   content_id: SCOTUS case ID (required)
//   original_verdict: The verdict being overridden (required)
//   override_verdict: The new verdict (required: APPROVE, FLAG, REJECT)
//   override_reason: Why the override is justified (required)
//   dismissed_issues: Array of issue objects being dismissed (optional)
//   add_to_gold_set: Whether to add to gold set for training (optional)
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, handleCors } from '../_shared/cors.ts'
import { getAdminClient, checkAdminAuth } from '../_shared/auth.ts'

const VALID_VERDICTS = ['APPROVE', 'FLAG', 'REJECT']

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

  if (req.method !== 'POST') {
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
    const body = await req.json()
    const {
      content_id,
      original_verdict,
      override_verdict,
      override_reason,
      dismissed_issues,
      add_to_gold_set,
    } = body

    // Validate required fields
    if (!content_id || typeof content_id !== 'number') {
      return new Response(
        JSON.stringify({ error: 'content_id (number) is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    if (!VALID_VERDICTS.includes(original_verdict)) {
      return new Response(
        JSON.stringify({ error: `original_verdict must be one of: ${VALID_VERDICTS.join(', ')}` }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    if (!VALID_VERDICTS.includes(override_verdict)) {
      return new Response(
        JSON.stringify({ error: `override_verdict must be one of: ${VALID_VERDICTS.join(', ')}` }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    if (!override_reason || typeof override_reason !== 'string' || override_reason.length < 10) {
      return new Response(
        JSON.stringify({ error: 'override_reason (string, min 10 chars) is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // Get admin ID from header (for audit trail)
    // Callers should set x-admin-id header to identify who made the override
    const adminId = req.headers.get('x-admin-id') || 'system'

    // Create override record
    const { data: override, error: overrideError } = await supabase
      .from('qa_overrides')
      .insert({
        content_type: 'scotus_case',
        content_id,
        original_verdict,
        override_verdict,
        override_reason,
        dismissed_issues: dismissed_issues || [],
        admin_id: adminId,
        add_to_gold_set: add_to_gold_set || false,
      })
      .select('id, created_at')
      .single()

    if (overrideError) {
      throw new Error(`Failed to create override: ${overrideError.message}`)
    }

    // Update the case with the overridden verdict
    const { error: updateError } = await supabase
      .from('scotus_cases')
      .update({
        qa_verdict: override_verdict,
        // Clear Layer B issues if admin is overriding to APPROVE
        ...(override_verdict === 'APPROVE' ? { qa_layer_b_issues: [] } : {}),
      })
      .eq('id', content_id)

    if (updateError) {
      throw new Error(`Failed to update case: ${updateError.message}`)
    }

    // Create revision record
    const { error: revError } = await supabase
      .rpc('add_content_revision_scotus', {
        p_content_id: content_id,
        p_trigger_source: 'admin_override',
        p_trigger_id: override.id.toString(),
        p_snapshot: {
          original_verdict,
          override_verdict,
          override_reason,
        },
        p_changed_fields: ['qa_verdict'],
        p_actor_type: 'admin',
        p_actor_id: adminId,
        p_change_summary: `Override: ${original_verdict} -> ${override_verdict}`,
      })

    if (revError) {
      console.warn('Failed to create revision:', revError.message)
      // Non-fatal, continue
    }

    return new Response(
      JSON.stringify({
        override_id: override.id,
        content_id,
        original_verdict,
        override_verdict,
        created_at: override.created_at,
        message: 'Override applied successfully',
      }),
      {
        status: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('qa-override error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
