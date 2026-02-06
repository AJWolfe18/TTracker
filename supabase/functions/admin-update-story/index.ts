// Edge Function: admin-update-story
// Updates story fields with admin authentication
// ADO: Feature 328, Story 336

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { checkAdminPassword } from '../_shared/auth.ts'

// Allowed fields that can be updated (whitelist for security)
const ALLOWED_FIELDS = [
  'primary_headline',
  'primary_source',
  'primary_source_url',
  'primary_actor',
  'status',
  'severity',
  'category',
  'lifecycle_state',
  'confidence_score'
]

// Valid enum values for validation
const VALID_STATUS = ['active', 'closed', 'archived']
const VALID_SEVERITY = ['critical', 'severe', 'moderate', 'minor', null]
const VALID_CATEGORY = [
  'corruption_scandals', 'democracy_elections', 'policy_legislation',
  'justice_legal', 'executive_actions', 'foreign_policy',
  'corporate_financial', 'civil_liberties', 'media_disinformation',
  'epstein_associates', 'other', null
]
const VALID_LIFECYCLE = ['emerging', 'developing', 'mature', null]

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
    const { story_id, updates } = body

    // Validate story_id
    if (!story_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: story_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const storyId = parseInt(String(story_id), 10)
    if (isNaN(storyId) || storyId <= 0) {
      return new Response(
        JSON.stringify({ error: 'story_id must be a positive integer' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate updates object
    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
      return new Response(
        JSON.stringify({ error: 'No updates provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Filter to only allowed fields (security: prevent arbitrary field updates)
    const sanitizedUpdates: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(updates)) {
      if (ALLOWED_FIELDS.includes(key)) {
        sanitizedUpdates[key] = value
      }
    }

    if (Object.keys(sanitizedUpdates).length === 0) {
      return new Response(
        JSON.stringify({ error: 'No valid fields to update' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate enum fields
    if ('status' in sanitizedUpdates && !VALID_STATUS.includes(sanitizedUpdates.status as string)) {
      return new Response(
        JSON.stringify({ error: `Invalid status. Must be one of: ${VALID_STATUS.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if ('severity' in sanitizedUpdates && sanitizedUpdates.severity !== null && !VALID_SEVERITY.includes(sanitizedUpdates.severity as string)) {
      return new Response(
        JSON.stringify({ error: `Invalid severity. Must be one of: ${VALID_SEVERITY.filter(v => v !== null).join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if ('category' in sanitizedUpdates && sanitizedUpdates.category !== null && !VALID_CATEGORY.includes(sanitizedUpdates.category as string)) {
      return new Response(
        JSON.stringify({ error: 'Invalid category' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if ('lifecycle_state' in sanitizedUpdates && sanitizedUpdates.lifecycle_state !== null && !VALID_LIFECYCLE.includes(sanitizedUpdates.lifecycle_state as string)) {
      return new Response(
        JSON.stringify({ error: `Invalid lifecycle_state. Must be one of: ${VALID_LIFECYCLE.filter(v => v !== null).join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate confidence_score if provided
    if ('confidence_score' in sanitizedUpdates && sanitizedUpdates.confidence_score !== null) {
      const score = parseFloat(String(sanitizedUpdates.confidence_score))
      if (isNaN(score) || score < 0 || score > 100) {
        return new Response(
          JSON.stringify({ error: 'confidence_score must be a number between 0 and 100' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      sanitizedUpdates.confidence_score = score
    }

    // Validate URL if provided
    if ('primary_source_url' in sanitizedUpdates && sanitizedUpdates.primary_source_url) {
      try {
        new URL(sanitizedUpdates.primary_source_url as string)
      } catch {
        return new Response(
          JSON.stringify({ error: 'primary_source_url must be a valid URL' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Update the story
    const { data, error } = await supabase
      .from('stories')
      .update(sanitizedUpdates)
      .eq('id', storyId)
      .select()
      .single()

    if (error) {
      console.error('Update error:', error)
      if (error.code === 'PGRST116') {
        return new Response(
          JSON.stringify({ error: 'Story not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      throw new Error(`Failed to update story: ${error.message}`)
    }

    // Log the action
    console.log(`admin_action: update_story story_id=${storyId} fields=${Object.keys(sanitizedUpdates).join(',')}`)

    return new Response(
      JSON.stringify({
        success: true,
        story: data
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Error in admin-update-story:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
