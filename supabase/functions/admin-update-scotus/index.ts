// Edge Function: admin-update-scotus
// Updates SCOTUS case fields with admin authentication, optimistic locking, and audit logging
// Supports single updates, publish/unpublish, reject, and bulk publish
// ADO: Story 340

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { checkAdminPassword } from '../_shared/auth.ts'

// Allowed fields that can be updated (whitelist for security) — 28 fields
const ALLOWED_FIELDS = [
  // Case Identity (4)
  'case_name', 'docket_number', 'term', 'decided_at',
  // Vote (3)
  'vote_split', 'majority_author', 'dissent_authors',
  // Classification (6)
  'disposition', 'case_type', 'merits_reached', 'prevailing_party', 'issue_area', 'holding',
  // Editorial (11)
  'ruling_impact_level', 'ruling_label', 'summary_spicy', 'who_wins', 'who_loses',
  'why_it_matters', 'dissent_highlights', 'practical_effect', 'media_says', 'actually_means',
  'evidence_anchors',
  // Review (3)
  'needs_manual_review', 'manual_review_note', 'low_confidence_reason',
  // Status/QA (5)
  'is_public', 'qa_status', 'qa_review_note', 'enrichment_status', 'enriched_at',
]

// Valid enum values (mirrored from DB CHECK constraints)
const VALID_DISPOSITIONS = [
  'affirmed', 'reversed', 'vacated', 'remanded',
  'reversed_and_remanded', 'vacated_and_remanded', 'affirmed_and_remanded',
  'dismissed', 'granted', 'denied', 'GVR', 'other',
]
const VALID_CASE_TYPES = ['merits', 'procedural', 'shadow_docket', 'cert_stage', 'unclear']
const VALID_PREVAILING_PARTIES = ['petitioner', 'respondent', 'partial', 'unclear']
const VALID_QA_STATUSES = ['pending_qa', 'approved', 'flagged', 'rejected', 'human_override']
const VALID_ENRICHMENT_STATUSES = ['pending', 'enriched', 'flagged', 'failed']

const VOTE_SPLIT_RE = /^\d+-\d+$/
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

// Validate and sanitize a single updates object. Returns error string or null.
function validateUpdates(sanitized: Record<string, unknown>): string | null {
  // Enum: disposition
  if ('disposition' in sanitized) {
    const v = sanitized.disposition
    if (v !== null && !VALID_DISPOSITIONS.includes(v as string)) {
      return `Invalid disposition. Must be one of: ${VALID_DISPOSITIONS.join(', ')}`
    }
  }

  // Enum: case_type
  if ('case_type' in sanitized) {
    const v = sanitized.case_type
    if (v !== null && !VALID_CASE_TYPES.includes(v as string)) {
      return `Invalid case_type. Must be one of: ${VALID_CASE_TYPES.join(', ')}`
    }
  }

  // Enum: prevailing_party
  if ('prevailing_party' in sanitized) {
    const v = sanitized.prevailing_party
    if (v !== null && !VALID_PREVAILING_PARTIES.includes(v as string)) {
      return `Invalid prevailing_party. Must be one of: ${VALID_PREVAILING_PARTIES.join(', ')}`
    }
  }

  // Enum: qa_status
  if ('qa_status' in sanitized) {
    const v = sanitized.qa_status
    if (v !== null && !VALID_QA_STATUSES.includes(v as string)) {
      return `Invalid qa_status. Must be one of: ${VALID_QA_STATUSES.join(', ')}`
    }
  }

  // Enum: enrichment_status
  if ('enrichment_status' in sanitized) {
    const v = sanitized.enrichment_status
    if (v !== null && !VALID_ENRICHMENT_STATUSES.includes(v as string)) {
      return `Invalid enrichment_status. Must be one of: ${VALID_ENRICHMENT_STATUSES.join(', ')}`
    }
  }

  // Integer 0-5: ruling_impact_level
  if ('ruling_impact_level' in sanitized) {
    const v = sanitized.ruling_impact_level
    if (v !== null) {
      const level = parseInt(String(v), 10)
      if (isNaN(level) || level < 0 || level > 5) {
        return 'ruling_impact_level must be an integer between 0 and 5'
      }
      sanitized.ruling_impact_level = level
    }
  }

  // Text pattern: vote_split
  if ('vote_split' in sanitized) {
    const v = sanitized.vote_split
    if (v !== null && v !== '') {
      if (typeof v !== 'string' || !VOTE_SPLIT_RE.test(v)) {
        return 'vote_split must match pattern "N-N" (e.g., "6-3") or be null'
      }
    } else {
      sanitized.vote_split = null
    }
  }

  // Booleans: merits_reached, needs_manual_review, is_public
  for (const field of ['merits_reached', 'needs_manual_review', 'is_public']) {
    if (field in sanitized) {
      if (typeof sanitized[field] !== 'boolean') {
        return `${field} must be a boolean`
      }
    }
  }

  // Text arrays: dissent_authors, evidence_anchors
  for (const field of ['dissent_authors', 'evidence_anchors']) {
    if (field in sanitized) {
      const v = sanitized[field]
      if (v !== null) {
        if (!Array.isArray(v)) {
          return `${field} must be an array of strings`
        }
        const cleaned = (v as unknown[])
          .filter(item => typeof item === 'string' && item.trim().length > 0)
          .map(item => (item as string).trim())
        sanitized[field] = cleaned
      }
    }
  }

  // Timestamp: enriched_at
  if ('enriched_at' in sanitized) {
    const v = sanitized.enriched_at
    if (v !== null && v !== '') {
      if (typeof v !== 'string' || !ISO_DATETIME_RE.test(v)) {
        return 'enriched_at must be an ISO 8601 timestamp or null'
      }
    } else {
      sanitized.enriched_at = null
    }
  }

  // Text fields: allow null or string (no extra validation needed)
  const textFields = [
    'majority_author', 'issue_area', 'holding',
    'ruling_label', 'summary_spicy', 'who_wins', 'who_loses',
    'why_it_matters', 'dissent_highlights', 'practical_effect',
    'media_says', 'actually_means', 'manual_review_note',
    'low_confidence_reason', 'qa_review_note',
  ]
  for (const field of textFields) {
    if (field in sanitized) {
      const v = sanitized[field]
      if (v !== null && typeof v !== 'string') {
        return `${field} must be a string or null`
      }
    }
  }

  return null
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
    const { case_id, case_ids, updates, original_updated_at } = body

    // --- Bulk Update Path ---
    if (Array.isArray(case_ids)) {
      return await handleBulkPublish(case_ids, req)
    }

    // --- Single Update Path ---
    if (!case_id) {
      return jsonResponse({ error: 'Missing required field: case_id or case_ids' }, 400)
    }

    const caseId = parseInt(String(case_id), 10)
    if (isNaN(caseId) || caseId <= 0) {
      return jsonResponse({ error: 'case_id must be a positive integer' }, 400)
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

    // Type-specific validation
    const validationError = validateUpdates(sanitizedUpdates)
    if (validationError) {
      return jsonResponse({ error: validationError }, 400)
    }

    // --- Database operations ---
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Step 1: Fetch current row for old values
    const { data: currentCase, error: fetchError } = await supabase
      .from('scotus_cases')
      .select([...ALLOWED_FIELDS, 'updated_at', 'enrichment_status', 'is_public', 'qa_status'].join(','))
      .eq('id', caseId)
      .single()

    if (fetchError || !currentCase) {
      console.error('Fetch error:', fetchError)
      return jsonResponse({ error: 'SCOTUS case not found' }, 404)
    }

    // Step 2: Publish gate — enforce enrichment_status = 'enriched' before publishing
    if (sanitizedUpdates.is_public === true && !currentCase.is_public) {
      // Block setting enrichment_status and is_public in the same request (bypass attempt)
      if ('enrichment_status' in sanitizedUpdates) {
        return jsonResponse({
          error: 'Cannot set enrichment_status and is_public in the same request'
        }, 400)
      }
      if (currentCase.enrichment_status !== 'enriched') {
        return jsonResponse({
          error: `Cannot publish: case has enrichment_status '${currentCase.enrichment_status}', must be 'enriched'`
        }, 400)
      }
    }

    // Step 3: Apply coupled workflows

    // Publish: is_public false→true → also set qa_status, qa_reviewed_at, clear needs_manual_review
    if (sanitizedUpdates.is_public === true && !currentCase.is_public) {
      sanitizedUpdates.qa_status = 'approved'
      sanitizedUpdates.qa_reviewed_at = new Date().toISOString()
      sanitizedUpdates.needs_manual_review = false
    }

    // Unpublish: is_public true→false → reset qa_status, clear qa_reviewed_at
    if (sanitizedUpdates.is_public === false && currentCase.is_public) {
      sanitizedUpdates.qa_status = 'pending_qa'
      sanitizedUpdates.qa_reviewed_at = null
    }

    // Reject: qa_status→'rejected' → reset enrichment for re-queue
    if (sanitizedUpdates.qa_status === 'rejected') {
      if (!sanitizedUpdates.qa_review_note) {
        return jsonResponse({ error: 'qa_review_note is required when rejecting a case' }, 400)
      }
      sanitizedUpdates.enrichment_status = 'pending'
      sanitizedUpdates.enriched_at = null
    }

    // Step 4: Guarded UPDATE — atomic lock at DB level
    let query = supabase
      .from('scotus_cases')
      .update(sanitizedUpdates)
      .eq('id', caseId)

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
          const { data: current } = await supabase
            .from('scotus_cases')
            .select('updated_at')
            .eq('id', caseId)
            .single()

          return jsonResponse({
            error: 'This record was modified by another process while you were editing. Please refresh and try again.',
            conflict: true,
            current_updated_at: current?.updated_at
          }, 409)
        }
        return jsonResponse({ error: 'SCOTUS case not found' }, 404)
      }
      throw new Error(`Failed to update SCOTUS case: ${error.message}`)
    }

    // Step 5: Log diffs (only fields that actually changed)
    const changedFields: Record<string, { old: string | null; new: string | null }> = {}
    for (const [field, newValue] of Object.entries(sanitizedUpdates)) {
      const oldValue = currentCase[field]
      const oldStr = oldValue != null ? String(typeof oldValue === 'object' ? JSON.stringify(oldValue) : oldValue) : null
      const newStr = newValue != null ? String(typeof newValue === 'object' ? JSON.stringify(newValue) : newValue) : null

      if (oldStr !== newStr) {
        changedFields[field] = { old: oldStr, new: newStr }

        try {
          await supabase.rpc('log_content_change', {
            p_entity_type: 'scotus',
            p_entity_id: String(caseId),
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

    console.log(`admin_action: update_scotus case_id=${caseId} fields=${Object.keys(sanitizedUpdates).join(',')}`)

    return jsonResponse({
      success: true,
      scotus_case: data,
      changed_fields: changedFields
    }, 200)

  } catch (error) {
    console.error('Error in admin-update-scotus:', error)
    return jsonResponse({ error: (error as Error).message || 'Internal server error' }, 500)
  }
})

// --- Bulk Publish Handler ---
async function handleBulkPublish(caseIds: unknown[], req: Request): Promise<Response> {
  // Validate case_ids
  if (!Array.isArray(caseIds) || caseIds.length === 0) {
    return jsonResponse({ error: 'case_ids must be a non-empty array' }, 400)
  }

  if (caseIds.length > 50) {
    return jsonResponse({ error: 'Bulk publish limited to 50 cases per request' }, 400)
  }

  // Parse and validate all IDs
  const ids: number[] = []
  for (const id of caseIds) {
    const parsed = parseInt(String(id), 10)
    if (isNaN(parsed) || parsed <= 0) {
      return jsonResponse({ error: `Invalid case_id in array: ${id}` }, 400)
    }
    ids.push(parsed)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const published: number[] = []
  const skipped: { id: number; reason: string }[] = []
  const failed: { id: number; error: string }[] = []

  // Fetch all cases in one query
  const { data: cases, error: fetchError } = await supabase
    .from('scotus_cases')
    .select('id, is_public, enrichment_status, updated_at')
    .in('id', ids)

  if (fetchError) {
    console.error('Bulk fetch error:', fetchError)
    return jsonResponse({ error: 'Failed to fetch cases for bulk publish' }, 500)
  }

  const caseMap = new Map((cases || []).map((c: Record<string, unknown>) => [c.id as number, c]))

  // Process each case
  const now = new Date().toISOString()
  for (const id of ids) {
    const currentCase = caseMap.get(id)

    if (!currentCase) {
      skipped.push({ id, reason: 'Case not found' })
      continue
    }

    if (currentCase.is_public) {
      skipped.push({ id, reason: 'Already published' })
      continue
    }

    if (currentCase.enrichment_status !== 'enriched') {
      skipped.push({ id, reason: `enrichment_status is '${currentCase.enrichment_status}', must be 'enriched'` })
      continue
    }

    // Optimistic lock per case
    const { data: updated, error: updateError } = await supabase
      .from('scotus_cases')
      .update({
        is_public: true,
        qa_status: 'approved',
        qa_reviewed_at: now,
        needs_manual_review: false,
      })
      .eq('id', id)
      .eq('updated_at', currentCase.updated_at)
      .select('id')
      .single()

    if (updateError) {
      if (updateError.code === 'PGRST116') {
        skipped.push({ id, reason: 'Concurrent modification — refresh and retry' })
      } else {
        failed.push({ id, error: updateError.message })
      }
      continue
    }

    published.push(id)

    // Audit log for each published case
    try {
      await supabase.rpc('log_content_change', {
        p_entity_type: 'scotus',
        p_entity_id: String(id),
        p_field_name: 'is_public',
        p_old_value: 'false',
        p_new_value: 'true',
        p_changed_by: 'admin',
        p_change_source: 'admin_bulk_publish'
      })
    } catch (historyError) {
      console.error(`Failed to log bulk publish history for case ${id}:`, historyError)
    }
  }

  console.log(`admin_action: bulk_publish published=${published.length} skipped=${skipped.length} failed=${failed.length}`)

  return jsonResponse({
    success: true,
    published,
    skipped,
    failed,
    summary: {
      total: ids.length,
      published_count: published.length,
      skipped_count: skipped.length,
      failed_count: failed.length,
    }
  }, 200)
}
