// Edge Function: admin-undo
// Password-gated Undo for the admin dashboard (ADO-525).
// Reverts the most recent logged change on one entity by calling the
// undo_content_change RPC with the service role. The RPC is no longer
// executable by anon/authenticated (migration 118), so this is the only way in.

import { corsHeaders } from '../_shared/cors.ts'
import { checkAdminPassword, getAdminClient } from '../_shared/auth.ts'

// Entity types undo_content_change knows, with the id shape each table uses.
// story/pardon/scotus/feed ids are bigint; articles use text ids; EO ids are
// integer on TEST and 'eo_<uuid>' on PROD, so both shapes are accepted there.
const ENTITY_ID_PATTERNS: Record<string, RegExp> = {
  story: /^[1-9][0-9]{0,17}$/,
  pardon: /^[1-9][0-9]{0,17}$/,
  scotus: /^[1-9][0-9]{0,17}$/,
  feed: /^[1-9][0-9]{0,17}$/,
  eo: /^([1-9][0-9]{0,17}|eo_[A-Za-z0-9-]{1,60})$/,
  article: /^[A-Za-z0-9_-]{1,100}$/,
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (!checkAdminPassword(req)) {
      return json({ error: 'Unauthorized' }, 401)
    }
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405)
    }

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Body must be JSON' }, 400)
    }

    const entityType = String(body?.entity_type ?? '')
    const entityId = String(body?.entity_id ?? '')
    const pattern = ENTITY_ID_PATTERNS[entityType]
    if (!pattern) {
      return json({ error: `entity_type must be one of ${Object.keys(ENTITY_ID_PATTERNS).join(', ')}` }, 400)
    }
    if (!pattern.test(entityId)) {
      return json({ error: `invalid entity_id for ${entityType}` }, 400)
    }

    const { data, error } = await getAdminClient().rpc('undo_content_change', {
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_changed_by: 'admin',
    })
    if (error) {
      console.error('undo_content_change failed:', error.message)
      return json({ error: 'Undo failed' }, 500)
    }

    // The RPC answers { success, field, restored_value } or { success: false, error }
    return json(data)
  } catch (err) {
    console.error('admin-undo error:', err instanceof Error ? err.message : String(err))
    return json({ error: 'Internal server error' }, 500)
  }
})
