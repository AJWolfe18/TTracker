// Edge Function: trigger-enrichment
// Triggers AI re-enrichment by dispatching GitHub Actions workflow
// ADO: Feature 328, Story 336, 337

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

// GitHub repo for workflow dispatch
const GITHUB_OWNER = 'AJWolfe18'
const GITHUB_REPO = 'TTracker'

// Detect environment from Supabase URL
function getEnvironment(supabaseUrl: string): 'test' | 'prod' {
  if (supabaseUrl.includes('wnrjrywpcadwutfykflu')) return 'test'
  if (supabaseUrl.includes('osjbulmltfpcoldydexg')) return 'prod'
  return 'test' // Default to test for safety
}

// Trigger GitHub Actions workflow
async function triggerWorkflow(
  workflowFile: string,
  inputs: Record<string, string>,
  githubToken: string
): Promise<{ success: boolean; message: string; run_url?: string }> {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${workflowFile}/dispatches`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `Bearer ${githubToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'TTracker-Admin'
    },
    body: JSON.stringify({
      ref: inputs.environment === 'prod' ? 'main' : 'test',
      inputs
    })
  })

  if (response.status === 204) {
    // Success - workflow dispatched
    const runUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${workflowFile}`
    return { success: true, message: 'Workflow dispatched', run_url: runUrl }
  }

  const errorText = await response.text()
  console.error('GitHub API error:', response.status, errorText)
  return { success: false, message: `GitHub API error: ${response.status}` }
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

    // Check for GitHub token
    const githubToken = Deno.env.get('GITHUB_PAT')
    if (!githubToken) {
      return new Response(
        JSON.stringify({ error: 'GITHUB_PAT not configured - cannot trigger enrichment' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
    const validTypes = ['story', 'pardon', 'scotus', 'eo']
    if (!validTypes.includes(entity_type)) {
      return new Response(
        JSON.stringify({ error: `Invalid entity_type. Must be one of: ${validTypes.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Detect environment
    const environment = getEnvironment(supabaseUrl)

    // Check budget before proceeding
    const today = new Date().toISOString().split('T')[0]
    const { data: budget, error: budgetError } = await supabase
      .from('budgets')
      .select('spent_usd, cap_usd')
      .eq('day', today)
      .single()

    const cost = COSTS[entity_type] || 0.003

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

    // Map entity type to workflow file
    const workflowMap: Record<string, string> = {
      story: 'enrich-story.yml',
      // Future: pardon, scotus, eo workflows
    }

    const workflowFile = workflowMap[entity_type]
    if (!workflowFile) {
      return new Response(
        JSON.stringify({ error: `Re-enrichment not yet supported for ${entity_type}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Mark as pending in database
    if (entity_type === 'story') {
      await supabase
        .from('stories')
        .update({
          enrichment_status: 'pending',
          enrichment_failure_count: 0
        })
        .eq('id', entity_id)
    }

    // Trigger the workflow
    const result = await triggerWorkflow(
      workflowFile,
      {
        story_id: String(entity_id),
        environment
      },
      githubToken
    )

    if (!result.success) {
      return new Response(
        JSON.stringify({ error: result.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`admin_action: re-enrich entity_type=${entity_type} entity_id=${entity_id} env=${environment}`)

    return new Response(
      JSON.stringify({
        success: true,
        entity_type,
        entity_id,
        message: `Enrichment started (${environment})`,
        estimated_cost: cost,
        run_url: result.run_url
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
