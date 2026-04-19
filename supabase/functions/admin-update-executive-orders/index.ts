// Edge Function: admin-update-executive-orders
// Single-row mutations (update/publish/unpublish/re_enrich) and bulk_publish for EOs.
// Mirrors admin-update-scotus pattern with EO-specific contracts (plan §4 of ADO-480).
//
// Auth: x-admin-password header (SCOTUS parity).
// Optimistic locking via if_updated_at CAS.
// Bulk response shape: {success, published[], skipped[], failed[], summary} — SCOTUS parity (I6).
// ADO: Story 480

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { checkAdminPassword } from '../_shared/auth.ts'
import { deriveSeverityRating } from '../_shared/eo-severity.ts'

// ─── Constants ──────────────────────────────────────────────────────────────

// Editable allowlist (plan §5.2). Anything outside this is rejected.
const ALLOWED_FIELDS = [
  // Identity
  'order_number', 'title', 'date', 'source_url',
  // Editorial
  'section_what_they_say', 'section_what_it_means', 'section_reality_check', 'section_why_it_matters',
  // Metadata
  'alarm_level', 'category', 'regions', 'policy_areas', 'affected_agencies',
  // Action
  'action_tier', 'action_confidence', 'action_reasoning', 'action_section',
]

// Server-managed fields — explicit reject if client tries to set them via update
const REJECTED_FIELDS_IN_UPDATE = [
  'severity_rating',  // server-derived from alarm_level
  'is_public',        // use publish/unpublish action
  'needs_manual_review',  // managed by sync trigger + publish action
  'prompt_version', 'enriched_at', 'enrichment_meta',  // managed by agent / re_enrich action
  'id', 'created_at', 'updated_at', 'added_at',  // system
]

const VALID_CATEGORIES = [
  'immigration_border', 'environment_energy', 'health_care', 'education',
  'justice_civil_rights_voting', 'natsec_foreign', 'economy_jobs_taxes',
  'technology_data_privacy', 'infra_housing_transport', 'gov_ops_workforce',
]
const VALID_ACTION_TIERS = ['direct', 'systemic', 'tracking']

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const URL_RE = /^https?:\/\/.+/

const SELECT_FIELDS = `
  id, order_number, date, title, source_url,
  section_what_they_say, section_what_it_means, section_reality_check, section_why_it_matters,
  alarm_level, severity_rating, category, regions, policy_areas, affected_agencies,
  action_tier, action_confidence, action_reasoning, action_section,
  enriched_at, prompt_version, enrichment_meta,
  is_public, needs_manual_review,
  created_at, updated_at, added_at,
  archived, archive_reason, verified
`

// ─── Helpers ────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

function validateArrayField(value: unknown, name: string, maxLen = 3): string | null {
  if (!Array.isArray(value)) return `${name} must be an array`
  if (value.length > maxLen) return `${name} must have at most ${maxLen} entries`
  for (const v of value) {
    if (typeof v !== 'string' || v.trim().length === 0) return `${name} entries must be non-empty strings`
  }
  return null
}

// Validate sanitized update payload. Mutates payload to coerce types where needed.
function validateUpdates(sanitized: Record<string, unknown>): string | null {
  if ('alarm_level' in sanitized) {
    const v = sanitized.alarm_level
    if (v !== null) {
      const n = typeof v === 'number' ? v : parseInt(String(v), 10)
      if (isNaN(n) || n < 0 || n > 5 || !Number.isInteger(n)) {
        return 'alarm_level must be an integer 0-5 or null'
      }
      sanitized.alarm_level = n
    }
  }

  if ('action_confidence' in sanitized) {
    const v = sanitized.action_confidence
    if (v !== null) {
      const n = typeof v === 'number' ? v : parseInt(String(v), 10)
      if (isNaN(n) || n < 1 || n > 10 || !Number.isInteger(n)) {
        return 'action_confidence must be an integer 1-10 or null'
      }
      sanitized.action_confidence = n
    }
  }

  if ('category' in sanitized) {
    const v = sanitized.category
    if (v !== null && !VALID_CATEGORIES.includes(v as string)) {
      return `category must be one of: ${VALID_CATEGORIES.join(', ')}`
    }
  }

  if ('action_tier' in sanitized) {
    const v = sanitized.action_tier
    if (v !== null && !VALID_ACTION_TIERS.includes(v as string)) {
      return `action_tier must be one of: ${VALID_ACTION_TIERS.join(', ')}`
    }
  }

  for (const arrayField of ['regions', 'policy_areas', 'affected_agencies']) {
    if (arrayField in sanitized) {
      const v = sanitized[arrayField]
      if (v !== null) {
        const err = validateArrayField(v, arrayField)
        if (err) return err
      }
    }
  }

  if ('action_section' in sanitized) {
    const v = sanitized.action_section
    if (v !== null && (typeof v !== 'object' || Array.isArray(v))) {
      return 'action_section must be an object or null'
    }
  }

  if ('date' in sanitized) {
    const v = sanitized.date
    if (v !== null && (typeof v !== 'string' || !DATE_RE.test(v))) {
      return 'date must be YYYY-MM-DD or null'
    }
  }

  if ('source_url' in sanitized) {
    const v = sanitized.source_url
    if (v !== null && (typeof v !== 'string' || !URL_RE.test(v))) {
      return 'source_url must be an http(s) URL or null'
    }
  }

  // String fields — reject non-string non-null values
  const stringFields = [
    'order_number', 'title',
    'section_what_they_say', 'section_what_it_means',
    'section_reality_check', 'section_why_it_matters',
    'action_reasoning',
  ]
  for (const field of stringFields) {
    if (field in sanitized) {
      const v = sanitized[field]
      if (v !== null && typeof v !== 'string') return `${field} must be a string or null`
    }
  }

  return null
}

// ─── Handler ────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (!checkAdminPassword(req)) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405)
    }

    let body: Record<string, unknown> = {}
    try {
      body = await req.json()
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400)
    }

    const action = String(body.action ?? '')
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    switch (action) {
      case 'update':     return await handleUpdate(supabase, body)
      case 'publish':    return await handlePublish(supabase, body)
      case 'unpublish':  return await handleUnpublish(supabase, body)
      case 're_enrich':  return await handleReEnrich(supabase, body)
      case 'bulk_publish': return await handleBulkPublish(supabase, body)
      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400)
    }
  } catch (error) {
    console.error('Error in admin-update-executive-orders:', error)
    return jsonResponse({ error: (error as Error).message || 'Internal server error' }, 500)
  }
})

// ─── Single-row helpers ─────────────────────────────────────────────────────

// IDs are opaque strings: PROD uses legacy `eo_<timestamp>_<suffix>` (VARCHAR(50)), TEST
// uses numeric IDs coerced to strings. Accept either form. Pattern restriction keeps
// PostgREST filter values safe (no `,`, `(`, `)`, `.`, quotes, etc.).
const EO_ID_RE = /^[A-Za-z0-9_-]{1,50}$/

function parseId(raw: unknown): string | null {
  const s = typeof raw === 'number' ? String(raw) : (typeof raw === 'string' ? raw : null)
  if (s === null || !EO_ID_RE.test(s)) return null
  return s
}

// deno-lint-ignore no-explicit-any
async function fetchEoForCAS(supabase: any, id: string) {
  const { data, error } = await supabase
    .from('executive_orders')
    .select('id, is_public, prompt_version, enriched_at, updated_at, alarm_level, action_tier')
    .eq('id', id)
    .single()
  if (error || !data) return null
  return data as {
    id: string
    is_public: boolean
    prompt_version: string | null
    enriched_at: string | null
    updated_at: string
    alarm_level: number | null
    action_tier: string | null
  }
}

// ─── Update handler ─────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function handleUpdate(supabase: any, body: Record<string, unknown>) {
  const id = parseId(body.id)
  if (id === null) return jsonResponse({ error: 'id must be a non-empty alphanumeric string (≤50 chars, [A-Za-z0-9_-])' }, 400)

  const ifUpdatedAt = body.if_updated_at
  if (typeof ifUpdatedAt !== 'string' || !ISO_DATETIME_RE.test(ifUpdatedAt)) {
    return jsonResponse({ error: 'if_updated_at must be an ISO 8601 timestamp' }, 400)
  }

  const fields = body.fields
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return jsonResponse({ error: 'fields must be an object' }, 400)
  }

  // Reject server-managed fields explicitly
  for (const f of REJECTED_FIELDS_IN_UPDATE) {
    if (f in (fields as Record<string, unknown>)) {
      return jsonResponse({ error: `Field "${f}" is server-managed and cannot be set via update` }, 400)
    }
  }

  // Filter to allowlist
  const sanitized: Record<string, unknown> = {}
  const rejected: string[] = []
  for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
    if (ALLOWED_FIELDS.includes(k)) {
      sanitized[k] = v
    } else {
      rejected.push(k)
    }
  }
  if (rejected.length > 0) {
    return jsonResponse({ error: `Unknown field(s): ${rejected.join(', ')}` }, 400)
  }
  if (Object.keys(sanitized).length === 0) {
    return jsonResponse({ error: 'No valid fields to update' }, 400)
  }

  const validationError = validateUpdates(sanitized)
  if (validationError) return jsonResponse({ error: validationError }, 400)

  // Fetch current row to derive cross-field invariants
  const current = await fetchEoForCAS(supabase, id)
  if (!current) return jsonResponse({ error: 'EO not found' }, 404)

  // I4: action_tier resolution. If the EFFECTIVE tier (post-update OR current DB value)
  // is 'tracking', server normalizes action_section to null regardless of what client sent.
  // Two cases (per plan §5.2):
  //   1. Admin switches tier direct→tracking and forgets to null orphan action_section
  //   2. Admin sends action_section while tier is already tracking (current code missed this)
  const effectiveTier = 'action_tier' in sanitized
    ? (sanitized.action_tier as string | null)
    : current.action_tier
  if (effectiveTier === 'tracking') {
    sanitized.action_section = null
  }

  // I3: severity_rating recomputed from new alarm_level if alarm_level is touched.
  if ('alarm_level' in sanitized) {
    sanitized.severity_rating = deriveSeverityRating(sanitized.alarm_level as number | null)
  }

  // CAS UPDATE
  const { data, error } = await supabase
    .from('executive_orders')
    .update(sanitized)
    .eq('id', id)
    .eq('updated_at', ifUpdatedAt)
    .select(SELECT_FIELDS)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows → check if missing or stale
      const fresh = await fetchEoForCAS(supabase, id)
      if (!fresh) return jsonResponse({ error: 'EO not found' }, 404)
      return jsonResponse({
        ok: false,
        error: 'stale_updated_at',
        message: 'Record was modified by another process. Please refresh and try again.',
        current_updated_at: fresh.updated_at,
      }, 409)
    }
    console.error('Update error:', error)
    return jsonResponse({ ok: false, error: error.message }, 500)
  }

  return jsonResponse({ ok: true, item: data }, 200)
}

// ─── Publish handler ────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function handlePublish(supabase: any, body: Record<string, unknown>) {
  const id = parseId(body.id)
  if (id === null) return jsonResponse({ error: 'id must be a non-empty alphanumeric string (≤50 chars, [A-Za-z0-9_-])' }, 400)

  const ifUpdatedAt = body.if_updated_at
  if (typeof ifUpdatedAt !== 'string' || !ISO_DATETIME_RE.test(ifUpdatedAt)) {
    return jsonResponse({ error: 'if_updated_at must be an ISO 8601 timestamp' }, 400)
  }

  const current = await fetchEoForCAS(supabase, id)
  if (!current) return jsonResponse({ error: 'EO not found' }, 404)

  if (current.prompt_version !== 'v1') {
    return jsonResponse({
      ok: false,
      error: 'not_enriched',
      message: `Cannot publish: EO has prompt_version '${current.prompt_version ?? 'NULL'}', must be 'v1'`,
    }, 400)
  }

  // Publish atomically clears needs_manual_review (durable acknowledgment per plan §2)
  const { data, error } = await supabase
    .from('executive_orders')
    .update({ is_public: true, needs_manual_review: false })
    .eq('id', id)
    .eq('updated_at', ifUpdatedAt)
    .select(SELECT_FIELDS)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      const fresh = await fetchEoForCAS(supabase, id)
      if (!fresh) return jsonResponse({ error: 'EO not found' }, 404)
      return jsonResponse({
        ok: false,
        error: 'stale_updated_at',
        message: 'Record was modified by another process. Please refresh and try again.',
        current_updated_at: fresh.updated_at,
      }, 409)
    }
    console.error('Publish error:', error)
    return jsonResponse({ ok: false, error: error.message }, 500)
  }

  return jsonResponse({ ok: true, item: data }, 200)
}

// ─── Unpublish handler ──────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function handleUnpublish(supabase: any, body: Record<string, unknown>) {
  const id = parseId(body.id)
  if (id === null) return jsonResponse({ error: 'id must be a non-empty alphanumeric string (≤50 chars, [A-Za-z0-9_-])' }, 400)

  const ifUpdatedAt = body.if_updated_at
  if (typeof ifUpdatedAt !== 'string' || !ISO_DATETIME_RE.test(ifUpdatedAt)) {
    return jsonResponse({ error: 'if_updated_at must be an ISO 8601 timestamp' }, 400)
  }

  // Unpublish does NOT touch needs_manual_review (acknowledgment is durable)
  const { data, error } = await supabase
    .from('executive_orders')
    .update({ is_public: false })
    .eq('id', id)
    .eq('updated_at', ifUpdatedAt)
    .select(SELECT_FIELDS)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      const fresh = await fetchEoForCAS(supabase, id)
      if (!fresh) return jsonResponse({ error: 'EO not found' }, 404)
      return jsonResponse({
        ok: false,
        error: 'stale_updated_at',
        message: 'Record was modified by another process. Please refresh and try again.',
        current_updated_at: fresh.updated_at,
      }, 409)
    }
    console.error('Unpublish error:', error)
    return jsonResponse({ ok: false, error: error.message }, 500)
  }

  return jsonResponse({ ok: true, item: data }, 200)
}

// ─── Re-enrich handler ──────────────────────────────────────────────────────
// Sets prompt_version=NULL, enriched_at=NULL, is_public=false in one UPDATE.
// Works on enriched AND unenriched rows (B5 — natural retry affordance for failed runs).
// NULL writes pass the existing lock_enriched_at trigger (NULL comparisons return NULL).

// deno-lint-ignore no-explicit-any
async function handleReEnrich(supabase: any, body: Record<string, unknown>) {
  const id = parseId(body.id)
  if (id === null) return jsonResponse({ error: 'id must be a non-empty alphanumeric string (≤50 chars, [A-Za-z0-9_-])' }, 400)

  const ifUpdatedAt = body.if_updated_at
  if (typeof ifUpdatedAt !== 'string' || !ISO_DATETIME_RE.test(ifUpdatedAt)) {
    return jsonResponse({ error: 'if_updated_at must be an ISO 8601 timestamp' }, 400)
  }

  const { data, error } = await supabase
    .from('executive_orders')
    .update({
      prompt_version: null,
      enriched_at: null,
      is_public: false,
    })
    .eq('id', id)
    .eq('updated_at', ifUpdatedAt)
    .select(SELECT_FIELDS)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      const fresh = await fetchEoForCAS(supabase, id)
      if (!fresh) return jsonResponse({ error: 'EO not found' }, 404)
      return jsonResponse({
        ok: false,
        error: 'stale_updated_at',
        message: 'Record was modified by another process. Please refresh and try again.',
        current_updated_at: fresh.updated_at,
      }, 409)
    }
    console.error('Re-enrich error:', error)
    return jsonResponse({ ok: false, error: error.message }, 500)
  }

  return jsonResponse({ ok: true, item: data }, 200)
}

// ─── Bulk publish handler ───────────────────────────────────────────────────
// Response shape matches admin-update-scotus bulk response (I6, plan §4.3).

// deno-lint-ignore no-explicit-any
async function handleBulkPublish(supabase: any, body: Record<string, unknown>) {
  const items = body.items
  if (!Array.isArray(items) || items.length === 0) {
    return jsonResponse({ error: 'items must be a non-empty array' }, 400)
  }
  if (items.length > 50) {
    return jsonResponse({ error: 'Bulk publish limited to 50 items per request' }, 400)
  }

  // Validate each item shape upfront
  type Item = { id: string; if_updated_at: string }
  const parsedItems: Item[] = []
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') {
      return jsonResponse({ error: 'Each item must be {id, if_updated_at}' }, 400)
    }
    const item = raw as Record<string, unknown>
    const id = parseId(item.id)
    if (id === null) {
      return jsonResponse({ error: `Invalid id in item: ${JSON.stringify(item)}` }, 400)
    }
    const iua = item.if_updated_at
    if (typeof iua !== 'string' || !ISO_DATETIME_RE.test(iua)) {
      return jsonResponse({ error: `Invalid if_updated_at in item id=${id}` }, 400)
    }
    parsedItems.push({ id, if_updated_at: iua })
  }

  const published: { id: string; new_updated_at: string }[] = []
  const skipped: { id: string; current_updated_at?: string; reason: string }[] = []
  const failed: { id: string; reason: string; message: string }[] = []

  // Pre-fetch all rows for state checks (already_published, not_enriched)
  const ids = parsedItems.map(i => i.id)
  const { data: currentRows, error: fetchError } = await supabase
    .from('executive_orders')
    .select('id, is_public, prompt_version, updated_at')
    .in('id', ids)
  if (fetchError) {
    console.error('Bulk fetch error:', fetchError)
    return jsonResponse({ error: 'Failed to fetch EOs for bulk publish' }, 500)
  }

  const stateById = new Map<string, { is_public: boolean; prompt_version: string | null; updated_at: string }>()
  for (const r of (currentRows ?? [])) {
    stateById.set(String(r.id), {
      is_public: r.is_public as boolean,
      prompt_version: r.prompt_version as string | null,
      updated_at: r.updated_at as string,
    })
  }

  for (const item of parsedItems) {
    const cur = stateById.get(item.id)
    if (!cur) {
      failed.push({ id: item.id, reason: 'not_found', message: 'EO not found' })
      continue
    }
    if (cur.is_public === true) {
      skipped.push({ id: item.id, current_updated_at: cur.updated_at, reason: 'already_published' })
      continue
    }
    if (cur.prompt_version !== 'v1') {
      failed.push({
        id: item.id,
        reason: 'not_enriched',
        message: `prompt_version is '${cur.prompt_version ?? 'NULL'}', must be 'v1'`,
      })
      continue
    }

    // CAS UPDATE per row.
    // Extra `is_public=false` guard handles the race where another writer published
    // between our pre-fetch and this UPDATE — we want to report `already_published`
    // consistently rather than no-op-overwrite.
    const { data, error } = await supabase
      .from('executive_orders')
      .update({ is_public: true, needs_manual_review: false })
      .eq('id', item.id)
      .eq('updated_at', item.if_updated_at)
      .eq('is_public', false)
      .select('id, updated_at')
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        // 0 rows matched — could be stale_updated_at OR concurrently published.
        // Re-fetch to distinguish so we report the correct reason.
        const { data: fresh } = await supabase
          .from('executive_orders')
          .select('is_public, updated_at')
          .eq('id', item.id)
          .single()
        if (fresh?.is_public === true) {
          skipped.push({ id: item.id, current_updated_at: fresh.updated_at, reason: 'already_published' })
        } else {
          skipped.push({ id: item.id, current_updated_at: fresh?.updated_at ?? cur.updated_at, reason: 'stale_updated_at' })
        }
      } else {
        failed.push({ id: item.id, reason: 'db_error', message: error.message })
      }
      continue
    }

    published.push({ id: item.id, new_updated_at: data.updated_at as string })
  }

  console.log(`admin_action: bulk_publish_eo published=${published.length} skipped=${skipped.length} failed=${failed.length}`)

  return jsonResponse({
    success: true,
    published,
    skipped,
    failed,
    summary: {
      total: parsedItems.length,
      published_count: published.length,
      skipped_count: skipped.length,
      failed_count: failed.length,
    },
  }, 200)
}
