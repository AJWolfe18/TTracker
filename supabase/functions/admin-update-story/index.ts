// Edge Function: admin-update-story
// Updates story fields with admin authentication
// ADO: Feature 328, Story 336, 337 (content history)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { checkAdminPassword } from '../_shared/auth.ts'

// Allowed fields that can be updated (whitelist for security)
const ALLOWED_FIELDS = [
  // Metadata fields
  'primary_headline',
  'primary_source',
  'primary_source_url',
  'primary_actor',
  'status',
  'severity',
  'category',
  'lifecycle_state',
  'confidence_score',
  'alarm_level',
  // Enriched content fields
  'summary_neutral',
  'summary_spicy'
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
    const { story_id, updates, original_last_updated_at } = body

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

    // Validate alarm_level if provided (1-5)
    if ('alarm_level' in sanitizedUpdates && sanitizedUpdates.alarm_level !== null) {
      const level = parseInt(String(sanitizedUpdates.alarm_level), 10)
      if (isNaN(level) || level < 1 || level > 5) {
        return new Response(
          JSON.stringify({ error: 'alarm_level must be an integer between 1 and 5' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      sanitizedUpdates.alarm_level = level
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

    // Fetch current story values BEFORE update (for history logging and optimistic locking)
    const { data: currentStory, error: fetchError } = await supabase
      .from('stories')
      .select([...ALLOWED_FIELDS, 'last_updated_at'].join(','))
      .eq('id', storyId)
      .single()

    if (fetchError || !currentStory) {
      console.error('Fetch error:', fetchError)
      return new Response(
        JSON.stringify({ error: 'Story not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Optimistic locking: check if story was modified since user opened the edit modal
    if (original_last_updated_at) {
      const currentTimestamp = currentStory.last_updated_at
      if (currentTimestamp && currentTimestamp !== original_last_updated_at) {
        return new Response(
          JSON.stringify({
            error: 'This record was modified by another process while you were editing. Please refresh and try again.',
            conflict: true,
            current_last_updated_at: currentTimestamp
          }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

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

    // Log content changes for undo support
    const changedFields: Record<string, { old: string | null; new: string | null }> = {}
    for (const [field, newValue] of Object.entries(sanitizedUpdates)) {
      const oldValue = currentStory[field]
      // Only log if the value actually changed
      if (String(oldValue ?? '') !== String(newValue ?? '')) {
        changedFields[field] = {
          old: oldValue != null ? String(oldValue) : null,
          new: newValue != null ? String(newValue) : null
        }

        // Log each changed field to content history
        try {
          await supabase.rpc('log_content_change', {
            p_entity_type: 'story',
            p_entity_id: String(storyId),
            p_field_name: field,
            p_old_value: oldValue != null ? String(oldValue) : null,
            p_new_value: newValue != null ? String(newValue) : null,
            p_changed_by: 'admin', // Could be enhanced to pass actual user
            p_change_source: 'admin'
          })
        } catch (historyError) {
          // Log but don't fail the update if history logging fails
          console.error(`Failed to log history for field ${field}:`, historyError)
        }
      }
    }

    // Log the action
    console.log(`admin_action: update_story story_id=${storyId} fields=${Object.keys(sanitizedUpdates).join(',')}`)

    return new Response(
      JSON.stringify({
        success: true,
        story: data,
        changed_fields: changedFields // Return for undo support
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
