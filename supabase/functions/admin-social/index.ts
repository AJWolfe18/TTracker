// Edge Function: admin-social
// Admin Social tab (ADO-572): list the social_posts queue and approve / reject /
// edit drafts. Password-gated + service role, same shape as admin-pipeline-skips
// (social_posts has no anon grants, so the dashboard cannot read it directly).
//
// POST /admin-social
//   { action: 'list', statuses?: string[], before_id?: number, limit?: number, days?: number }
//     -> { rows: [...], next_before_id: number|null }
//        rows newest first (cursor on id); `days` restricts to created_at within N days (posted history)
//   { action: 'update', id: number, status: 'approved'|'rejected'|'draft', copy?: string }
//     -> { row }
//        approved: approved_at = now(); rejected/draft: approved_at = null; copy is stored when given
//        (em/en dashes become hyphens - the no-em-dash rule holds for hand edits too).
//        Only draft/approved/rejected/failed rows can be changed; posted rows are immutable here.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { checkAdminPassword } from '../_shared/auth.ts'

const STATUSES = ['draft', 'approved', 'rejected', 'posted', 'failed']
const EDITABLE_FROM = ['draft', 'approved', 'rejected', 'failed']
const TARGET_STATUSES = ['approved', 'rejected', 'draft']
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const MAX_COPY_CHARS = 5000
const SELECT = 'id,platform,entity_type,entity_id,status,copy,link_url,image_url,post_id,post_url,error,attempts,created_at,updated_at,approved_at,posted_at'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    if (!checkAdminPassword(req)) return json({ error: 'Unauthorized' }, 401)
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    let body: Record<string, unknown> = {}
    try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const action = String(body.action ?? 'list')

    if (action === 'list') {
      const requested = Array.isArray(body.statuses) ? body.statuses.map(String) : ['draft', 'failed']
      const statuses = requested.filter((s) => STATUSES.includes(s))
      if (statuses.length === 0) return json({ error: 'statuses must include at least one valid status' }, 400)
      const limitRaw = Number(body.limit ?? DEFAULT_LIMIT)
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limitRaw))) : DEFAULT_LIMIT
      const beforeId = body.before_id == null ? null : Number(body.before_id)
      if (beforeId !== null && (!Number.isInteger(beforeId) || beforeId <= 0)) return json({ error: 'before_id must be a positive integer' }, 400)
      const days = body.days == null ? null : Number(body.days)
      if (days !== null && (!Number.isFinite(days) || days <= 0 || days > 3650)) return json({ error: 'days must be 1-3650' }, 400)

      let q = supabase.from('social_posts').select(SELECT).in('status', statuses).order('id', { ascending: false }).limit(limit + 1)
      if (beforeId !== null) q = q.lt('id', beforeId)
      if (days !== null) q = q.gte('created_at', new Date(Date.now() - days * 86400000).toISOString())
      const { data, error } = await q
      if (error) {
        console.error('admin-social list failed:', error.message)
        return json({ error: 'Query failed' }, 500)
      }
      const rows = data ?? []
      const hasMore = rows.length > limit
      const page = hasMore ? rows.slice(0, limit) : rows
      return json({ rows: page, next_before_id: hasMore ? page[page.length - 1].id : null })
    }

    if (action === 'update') {
      const id = Number(body.id)
      if (!Number.isInteger(id) || id <= 0) return json({ error: 'id must be a positive integer' }, 400)
      const status = String(body.status ?? '')
      if (!TARGET_STATUSES.includes(status)) return json({ error: `status must be one of ${TARGET_STATUSES.join(', ')}` }, 400)

      const updates: Record<string, unknown> = { status, approved_at: status === 'approved' ? new Date().toISOString() : null }
      if (body.copy !== undefined) {
        if (typeof body.copy !== 'string') return json({ error: 'copy must be a string' }, 400)
        const copy = body.copy.replace(/\s*[—–]\s*/g, (m: string) => (/\s/.test(m) ? ', ' : '-')).trim()
        if (copy.length === 0) return json({ error: 'copy cannot be empty' }, 400)
        if (copy.length > MAX_COPY_CHARS) return json({ error: `copy exceeds ${MAX_COPY_CHARS} characters` }, 400)
        updates.copy = copy
      }
      if (status === 'draft') {
        // re-queue a rejected/failed row: clear the failure so the poster retries cleanly
        updates.error = null
      }

      const { data, error } = await supabase
        .from('social_posts')
        .update(updates)
        .eq('id', id)
        .in('status', EDITABLE_FROM)
        .select(SELECT)
        .maybeSingle()
      if (error) {
        console.error('admin-social update failed:', error.message)
        return json({ error: 'Update failed' }, 500)
      }
      if (!data) return json({ error: 'Not found, or the row is already posted' }, 404)
      return json({ row: data })
    }

    return json({ error: `Unknown action ${action}` }, 400)
  } catch (err) {
    console.error('Error in admin-social:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})
