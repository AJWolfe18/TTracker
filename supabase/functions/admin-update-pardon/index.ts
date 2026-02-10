// Edge Function: admin-update-pardon
// Updates pardon fields with admin authentication, optimistic locking, and audit logging
// ADO: Story 339

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { checkAdminPassword } from '../_shared/auth.ts'

// Allowed fields that can be updated (whitelist for security) — 33 fields
const ALLOWED_FIELDS = [
  // Identity (6)
  'recipient_name', 'nickname', 'photo_url', 'recipient_type', 'recipient_count', 'recipient_criteria',
  // Pardon & Crime (8)
  'pardon_date', 'clemency_type', 'status', 'case_number', 'crime_description', 'crime_category', 'original_sentence', 'conviction_date',
  // Trump Connection (6)
  'primary_connection_type', 'secondary_connection_types', 'corruption_level', 'corruption_reasoning', 'trump_connection_detail', 'donation_amount_usd',
  // AI Content (4)
  'summary_neutral', 'summary_spicy', 'why_it_matters', 'pattern_analysis',
  // JSONB Arrays (2)
  'receipts_timeline', 'pardon_advocates',
  // Admin & Sources (7)
  'research_status', 'post_pardon_status', 'post_pardon_notes', 'is_public', 'needs_review', 'primary_source_url', 'source_urls'
]

// Valid enum values (mirrored from admin-pardons)
const VALID_CLEMENCY_TYPES = ['pardon', 'commutation', 'pre_emptive']
const VALID_STATUS = ['confirmed', 'reported']
const VALID_RECIPIENT_TYPES = ['person', 'group']
const VALID_POST_PARDON_STATUS = ['quiet', 'under_investigation', 're_offended']
const VALID_CRIME_CATEGORIES = [
  'white_collar', 'obstruction', 'political_corruption',
  'violent', 'drug', 'election', 'jan6', 'other',
]
const VALID_CONNECTION_TYPES = [
  'mar_a_lago_vip', 'major_donor', 'family', 'political_ally',
  'campaign_staff', 'business_associate', 'jan6_defendant',
  'fake_electors', 'celebrity', 'no_connection',
]
const VALID_RESEARCH_STATUS = ['complete', 'in_progress', 'pending']

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

function validateUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Authentication check
    if (!checkAdminPassword(req)) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    // Only accept POST
    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405)
    }

    // Parse request body
    const body = await req.json()
    const { pardon_id, updates, original_updated_at } = body

    // Validate pardon_id
    if (!pardon_id) {
      return jsonResponse({ error: 'Missing required field: pardon_id' }, 400)
    }

    const pardonId = parseInt(String(pardon_id), 10)
    if (isNaN(pardonId) || pardonId <= 0) {
      return jsonResponse({ error: 'pardon_id must be a positive integer' }, 400)
    }

    // Validate updates object
    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
      return jsonResponse({ error: 'No updates provided' }, 400)
    }

    // Filter to only allowed fields
    const sanitizedUpdates: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(updates)) {
      if (ALLOWED_FIELDS.includes(key)) {
        sanitizedUpdates[key] = value
      }
    }

    if (Object.keys(sanitizedUpdates).length === 0) {
      return jsonResponse({ error: 'No valid fields to update' }, 400)
    }

    // --- Type-specific validation ---

    // Enum: clemency_type
    if ('clemency_type' in sanitizedUpdates) {
      const v = sanitizedUpdates.clemency_type
      if (v !== null && !VALID_CLEMENCY_TYPES.includes(v as string)) {
        return jsonResponse({ error: `Invalid clemency_type. Must be one of: ${VALID_CLEMENCY_TYPES.join(', ')}` }, 400)
      }
    }

    // Enum: status
    if ('status' in sanitizedUpdates) {
      const v = sanitizedUpdates.status
      if (v !== null && !VALID_STATUS.includes(v as string)) {
        return jsonResponse({ error: `Invalid status. Must be one of: ${VALID_STATUS.join(', ')}` }, 400)
      }
    }

    // Enum: recipient_type
    if ('recipient_type' in sanitizedUpdates) {
      const v = sanitizedUpdates.recipient_type
      if (v !== null && !VALID_RECIPIENT_TYPES.includes(v as string)) {
        return jsonResponse({ error: `Invalid recipient_type. Must be one of: ${VALID_RECIPIENT_TYPES.join(', ')}` }, 400)
      }
    }

    // Enum: crime_category
    if ('crime_category' in sanitizedUpdates) {
      const v = sanitizedUpdates.crime_category
      if (v !== null && !VALID_CRIME_CATEGORIES.includes(v as string)) {
        return jsonResponse({ error: `Invalid crime_category. Must be one of: ${VALID_CRIME_CATEGORIES.join(', ')}` }, 400)
      }
    }

    // Enum: primary_connection_type
    if ('primary_connection_type' in sanitizedUpdates) {
      const v = sanitizedUpdates.primary_connection_type
      if (v !== null && !VALID_CONNECTION_TYPES.includes(v as string)) {
        return jsonResponse({ error: `Invalid primary_connection_type. Must be one of: ${VALID_CONNECTION_TYPES.join(', ')}` }, 400)
      }
    }

    // Enum: research_status
    if ('research_status' in sanitizedUpdates) {
      const v = sanitizedUpdates.research_status
      if (v !== null && !VALID_RESEARCH_STATUS.includes(v as string)) {
        return jsonResponse({ error: `Invalid research_status. Must be one of: ${VALID_RESEARCH_STATUS.join(', ')}` }, 400)
      }
    }

    // Enum: post_pardon_status
    if ('post_pardon_status' in sanitizedUpdates) {
      const v = sanitizedUpdates.post_pardon_status
      if (v !== null && !VALID_POST_PARDON_STATUS.includes(v as string)) {
        return jsonResponse({ error: `Invalid post_pardon_status. Must be one of: ${VALID_POST_PARDON_STATUS.join(', ')}` }, 400)
      }
    }

    // Integer 1-5: corruption_level
    if ('corruption_level' in sanitizedUpdates) {
      const v = sanitizedUpdates.corruption_level
      if (v !== null) {
        const level = parseInt(String(v), 10)
        if (isNaN(level) || level < 1 || level > 5) {
          return jsonResponse({ error: 'corruption_level must be an integer between 1 and 5' }, 400)
        }
        sanitizedUpdates.corruption_level = level
      }
    }

    // Numeric >= 0: donation_amount_usd
    if ('donation_amount_usd' in sanitizedUpdates) {
      const v = sanitizedUpdates.donation_amount_usd
      if (v !== null) {
        const amount = parseFloat(String(v))
        if (isNaN(amount) || amount < 0) {
          return jsonResponse({ error: 'donation_amount_usd must be a number >= 0' }, 400)
        }
        sanitizedUpdates.donation_amount_usd = amount
      }
    }

    // Integer >= 0: recipient_count
    if ('recipient_count' in sanitizedUpdates) {
      const v = sanitizedUpdates.recipient_count
      if (v !== null) {
        const count = parseInt(String(v), 10)
        if (isNaN(count) || count < 0) {
          return jsonResponse({ error: 'recipient_count must be a non-negative integer' }, 400)
        }
        sanitizedUpdates.recipient_count = count
      }
    }

    // Dates: pardon_date, conviction_date
    for (const field of ['pardon_date', 'conviction_date']) {
      if (field in sanitizedUpdates) {
        const v = sanitizedUpdates[field]
        if (v !== null && v !== '') {
          if (typeof v !== 'string' || !DATE_RE.test(v)) {
            return jsonResponse({ error: `${field} must be a date in YYYY-MM-DD format` }, 400)
          }
        } else {
          sanitizedUpdates[field] = null
        }
      }
    }

    // URLs: primary_source_url, photo_url
    for (const field of ['primary_source_url', 'photo_url']) {
      if (field in sanitizedUpdates) {
        const v = sanitizedUpdates[field]
        if (v !== null && v !== '' && typeof v === 'string' && v.trim().length > 0) {
          if (!validateUrl(v as string)) {
            return jsonResponse({ error: `${field} must be a valid http/https URL` }, 400)
          }
        } else {
          sanitizedUpdates[field] = null
        }
      }
    }

    // Booleans: is_public, needs_review
    for (const field of ['is_public', 'needs_review']) {
      if (field in sanitizedUpdates) {
        if (typeof sanitizedUpdates[field] !== 'boolean') {
          return jsonResponse({ error: `${field} must be a boolean` }, 400)
        }
      }
    }

    // text[]: secondary_connection_types
    if ('secondary_connection_types' in sanitizedUpdates) {
      const v = sanitizedUpdates.secondary_connection_types
      if (v !== null) {
        if (!Array.isArray(v)) {
          return jsonResponse({ error: 'secondary_connection_types must be an array' }, 400)
        }
        const cleaned = (v as unknown[])
          .filter(item => typeof item === 'string' && item.trim().length > 0)
          .map(item => (item as string).trim())
        for (const item of cleaned) {
          if (!VALID_CONNECTION_TYPES.includes(item)) {
            return jsonResponse({ error: `Invalid secondary_connection_type: ${item}` }, 400)
          }
        }
        sanitizedUpdates.secondary_connection_types = cleaned
      }
    }

    // JSONB: receipts_timeline
    if ('receipts_timeline' in sanitizedUpdates) {
      const v = sanitizedUpdates.receipts_timeline
      if (v !== null) {
        if (typeof v === 'string') {
          return jsonResponse({ error: 'receipts_timeline must be a JSON array, not a string. Parse JSON before sending.' }, 400)
        }
        if (!Array.isArray(v)) {
          return jsonResponse({ error: 'receipts_timeline must be a JSON array' }, 400)
        }
        // Each element must be an object with at least event_type
        for (let i = 0; i < (v as unknown[]).length; i++) {
          const item = (v as unknown[])[i]
          if (typeof item !== 'object' || item === null || Array.isArray(item)) {
            return jsonResponse({ error: `receipts_timeline[${i}] must be an object` }, 400)
          }
          if (typeof (item as Record<string, unknown>).event_type !== 'string') {
            return jsonResponse({ error: `receipts_timeline[${i}].event_type is required and must be a string` }, 400)
          }
        }
      }
    }

    // JSONB: pardon_advocates
    if ('pardon_advocates' in sanitizedUpdates) {
      const v = sanitizedUpdates.pardon_advocates
      if (v !== null) {
        if (typeof v === 'string') {
          return jsonResponse({ error: 'pardon_advocates must be a JSON array, not a string. Parse JSON before sending.' }, 400)
        }
        if (!Array.isArray(v)) {
          return jsonResponse({ error: 'pardon_advocates must be a JSON array' }, 400)
        }
      }
    }

    // JSONB: source_urls — array of URL strings
    if ('source_urls' in sanitizedUpdates) {
      const v = sanitizedUpdates.source_urls
      if (v !== null) {
        if (typeof v === 'string') {
          return jsonResponse({ error: 'source_urls must be a JSON array, not a string. Parse JSON before sending.' }, 400)
        }
        if (!Array.isArray(v)) {
          return jsonResponse({ error: 'source_urls must be a JSON array' }, 400)
        }
        // Trim, drop blanks, validate each as URL
        const cleaned: string[] = []
        for (const item of v as unknown[]) {
          if (typeof item !== 'string') continue
          const trimmed = item.trim()
          if (trimmed.length === 0) continue
          if (!validateUrl(trimmed)) {
            return jsonResponse({ error: `Invalid URL in source_urls: ${trimmed}` }, 400)
          }
          cleaned.push(trimmed)
        }
        sanitizedUpdates.source_urls = cleaned
      }
    }

    // --- Database operations ---
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Step 1: Fetch current row for old values (needed for audit logging)
    const { data: currentPardon, error: fetchError } = await supabase
      .from('pardons')
      .select([...ALLOWED_FIELDS, 'updated_at'].join(','))
      .eq('id', pardonId)
      .single()

    if (fetchError || !currentPardon) {
      console.error('Fetch error:', fetchError)
      return jsonResponse({ error: 'Pardon not found' }, 404)
    }

    // Step 2: Guarded UPDATE — atomic lock at DB level
    let query = supabase
      .from('pardons')
      .update(sanitizedUpdates)
      .eq('id', pardonId)

    // Apply optimistic locking if original_updated_at provided
    if (original_updated_at) {
      query = query.eq('updated_at', original_updated_at)
    }

    const { data, error } = await query.select().single()

    if (error) {
      console.error('Update error:', error)
      if (error.code === 'PGRST116') {
        // 0 rows matched — either not found or concurrent edit
        if (original_updated_at) {
          // Fetch current to return conflict info
          const { data: current } = await supabase
            .from('pardons')
            .select('updated_at')
            .eq('id', pardonId)
            .single()

          return jsonResponse({
            error: 'This record was modified by another process while you were editing. Please refresh and try again.',
            conflict: true,
            current_updated_at: current?.updated_at
          }, 409)
        }
        return jsonResponse({ error: 'Pardon not found' }, 404)
      }
      throw new Error(`Failed to update pardon: ${error.message}`)
    }

    // Step 3: Log diffs (only fields that actually changed)
    const changedFields: Record<string, { old: string | null; new: string | null }> = {}
    for (const [field, newValue] of Object.entries(sanitizedUpdates)) {
      const oldValue = currentPardon[field]
      const oldStr = oldValue != null ? String(typeof oldValue === 'object' ? JSON.stringify(oldValue) : oldValue) : null
      const newStr = newValue != null ? String(typeof newValue === 'object' ? JSON.stringify(newValue) : newValue) : null

      if (oldStr !== newStr) {
        changedFields[field] = { old: oldStr, new: newStr }

        try {
          await supabase.rpc('log_content_change', {
            p_entity_type: 'pardon',
            p_entity_id: String(pardonId),
            p_field_name: field,
            p_old_value: oldStr,
            p_new_value: newStr,
            p_changed_by: 'admin',
            p_change_source: 'admin'
          })
        } catch (historyError) {
          console.error(`Failed to log history for field ${field}:`, historyError)
        }
      }
    }

    console.log(`admin_action: update_pardon pardon_id=${pardonId} fields=${Object.keys(sanitizedUpdates).join(',')}`)

    return jsonResponse({
      success: true,
      pardon: data,
      changed_fields: changedFields
    }, 200)

  } catch (error) {
    console.error('Error in admin-update-pardon:', error)
    return jsonResponse({ error: error.message || 'Internal server error' }, 500)
  }
})
