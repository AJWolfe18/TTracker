// Edge Function: trigger-enrichment
// Triggers AI re-enrichment for stories (and other entity types)
// ADO: Feature 328, Story 336

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { checkAdminPassword } from '../_shared/auth.ts'

// Estimated costs per entity type (USD)
const COSTS: Record<string, number> = {
  story: 0.003,
  pardon: 0.005,
  scotus: 0.01,
  eo: 0.008,
  article_entities: 0.0003
}

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

    // Only accept POST
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse request body
    const body = await req.json()
    const { entity_type } = body

    if (!entity_type || body.entity_id === undefined || body.entity_id === null) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: entity_type, entity_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate entity_id is a positive integer
    const entity_id = parseInt(String(body.entity_id), 10)
    if (isNaN(entity_id) || entity_id <= 0) {
      return new Response(
        JSON.stringify({ error: 'entity_id must be a positive integer' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate entity_type is one of the allowed types
    const validTypes = ['story', 'pardon', 'scotus', 'eo', 'article_entities']
    if (!validTypes.includes(entity_type)) {
      return new Response(
        JSON.stringify({ error: `Invalid entity_type. Must be one of: ${validTypes.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Check budget before proceeding
    const today = new Date().toISOString().split('T')[0]
    const { data: budget, error: budgetError } = await supabase
      .from('budgets')
      .select('spent_usd, cap_usd')
      .eq('day', today)
      .single()

    const cost = COSTS[entity_type] || 0.003

    // Soft budget check - real enforcement happens in the enrichment pipeline
    // This is a pre-check to give immediate feedback to the user
    if (budget && !budgetError && budget.spent_usd + cost > budget.cap_usd) {
      return new Response(
        JSON.stringify({
          error: 'Daily budget exceeded',
          spent: budget.spent_usd,
          cap: budget.cap_usd,
          estimated_cost: cost
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Trigger re-enrichment based on entity type
    let result: { data?: unknown; error?: unknown }

    switch (entity_type) {
      case 'story':
        // Clear enrichment timestamp to trigger re-enrichment
        const { data: storyData, error: storyError } = await supabase
          .from('stories')
          .update({
            last_enriched_at: null,
            enrichment_status: 'pending',
            enrichment_failure_count: 0
          })
          .eq('id', entity_id)
          .select('id, primary_headline')
          .single()

        if (storyError) {
          throw new Error(`Failed to update story: ${storyError.message}`)
        }

        result = {
          data: {
            success: true,
            story_id: entity_id,
            headline: storyData?.primary_headline,
            message: 'Story queued for re-enrichment'
          }
        }
        break

      case 'pardon':
        // Clear enriched_at to trigger re-enrichment
        const { error: pardonError } = await supabase
          .from('pardons')
          .update({ enriched_at: null })
          .eq('id', entity_id)

        if (pardonError) {
          throw new Error(`Failed to update pardon: ${pardonError.message}`)
        }

        result = {
          data: {
            success: true,
            pardon_id: entity_id,
            message: 'Pardon queued for re-enrichment'
          }
        }
        break

      case 'scotus':
        // Clear enrichment to trigger re-enrichment
        const { error: scotusError } = await supabase
          .from('scotus_cases')
          .update({ enriched_at: null, prompt_version: null })
          .eq('id', entity_id)

        if (scotusError) {
          throw new Error(`Failed to update SCOTUS case: ${scotusError.message}`)
        }

        result = {
          data: {
            success: true,
            scotus_id: entity_id,
            message: 'SCOTUS case queued for re-enrichment'
          }
        }
        break

      case 'eo':
        // Clear enriched_at to trigger re-enrichment
        const { error: eoError } = await supabase
          .from('executive_orders')
          .update({ enriched_at: null })
          .eq('id', entity_id)

        if (eoError) {
          throw new Error(`Failed to update EO: ${eoError.message}`)
        }

        result = {
          data: {
            success: true,
            eo_id: entity_id,
            message: 'Executive order queued for re-enrichment'
          }
        }
        break

      default:
        return new Response(
          JSON.stringify({ error: `Unknown entity type: ${entity_type}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

    // Note: Admin action logging (log_admin_action RPC) will be added in Phase 2
    // when the admin.action_log table and RPC are created
    console.log(`admin_action: re-enrich entity_type=${entity_type} entity_id=${entity_id} cost=${cost}`)

    return new Response(
      JSON.stringify({
        ...result.data,
        estimated_cost: cost
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Error in trigger-enrichment:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
