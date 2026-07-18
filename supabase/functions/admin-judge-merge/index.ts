// Edge Function: admin-judge-merge
// Executes an admin-initiated (manual) story merge from the Admin Dashboard "Judge" tab.
// ADO-537: human override for uncertain/missed Judge verdicts. Mirrors admin-judge-log
// (service_role, password-gated) so nothing here needs an anon grant.
//
// POST /admin-judge-merge
// Body:
//   action:      'preview' | 'merge' (required)
//   survivor_id: story id that keeps the articles (required, positive integer)
//   loser_id:    story id that gets tombstoned into the survivor (required, positive integer)
//
// preview response: { ok, survivor: {...}, loser: {...}, warnings: [...] }
// merge response:   { ok, skipped?, reason?, run_id, articles_moved?, survivor_source_count?, log_error? }
//
// The merge itself is the hardened merge_stories RPC (migrations 100/101/102): row-locked,
// per-run hard-capped, snapshotted to story_merge_audit, loser tombstoned (never deleted).
// Each manual merge uses a fresh run_id ('manual-admin-<ts>') so the per-run cap of 10 never
// throttles a legitimate one-off action while the DB-side guard still applies.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { checkAdminPassword } from '../_shared/auth.ts'

const STORY_FIELDS = 'id,primary_headline,status,source_count,merged_into_story_id,first_seen_at,last_updated_at'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(
    JSON.stringify(body),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

function parseStoryId(value: unknown): number | null {
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n <= 0) return null
  return n
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (!checkAdminPassword(req)) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }
    if (req.method !== 'POST') {
      return jsonResponse({ error: 'POST only' }, 405)
    }

    let body: Record<string, unknown> = {}
    try {
      const text = await req.text()
      body = text ? JSON.parse(text) : {}
    } catch (_) {
      return jsonResponse({ error: 'Invalid JSON body' }, 400)
    }

    const action = String(body.action || '').trim()
    const survivorId = parseStoryId(body.survivor_id)
    const loserId = parseStoryId(body.loser_id)

    if (action !== 'preview' && action !== 'merge') {
      return jsonResponse({ error: "action must be 'preview' or 'merge'" }, 400)
    }
    if (survivorId == null || loserId == null) {
      return jsonResponse({ error: 'survivor_id and loser_id must be positive integers' }, 400)
    }
    if (survivorId === loserId) {
      return jsonResponse({ error: 'survivor_id and loser_id must be different stories' }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Both actions need the two story rows: preview displays them; merge snapshots the
    // headlines for the clustering_judge_log row (headlines survive the merge unchanged,
    // but reading first keeps the log write independent of post-merge state).
    const { data: stories, error: fetchError } = await supabase
      .from('stories')
      .select(STORY_FIELDS)
      .in('id', [survivorId, loserId])

    if (fetchError) {
      console.error('Story fetch failed:', fetchError.message)
      return jsonResponse({ error: 'Story lookup failed' }, 500)
    }

    const survivor = (stories || []).find((s) => s.id === survivorId) || null
    const loser = (stories || []).find((s) => s.id === loserId) || null

    if (action === 'preview') {
      const warnings: string[] = []
      if (!survivor) warnings.push(`Survivor story #${survivorId} not found`)
      if (!loser) warnings.push(`Loser story #${loserId} not found`)
      if (survivor?.status === 'merged_into') {
        warnings.push(`Survivor #${survivorId} is already merged into #${survivor.merged_into_story_id} — merge will be refused; target that story instead`)
      }
      if (loser?.status === 'merged_into') {
        warnings.push(`Loser #${loserId} was already merged into #${loser.merged_into_story_id} — merge will be a no-op`)
      }
      return jsonResponse({ ok: !!(survivor && loser), survivor, loser, warnings })
    }

    // action === 'merge'
    if (!survivor || !loser) {
      return jsonResponse({ ok: false, reason: !survivor ? 'survivor_not_found' : 'loser_not_found' })
    }

    const runId = `manual-admin-${Date.now()}`
    const { data: result, error: rpcError } = await supabase.rpc('merge_stories', {
      p_loser_id: loserId,
      p_survivor_id: survivorId,
      p_run_id: runId
    })

    if (rpcError) {
      console.error('merge_stories RPC failed:', rpcError.message)
      return jsonResponse({ error: 'Merge failed', detail: rpcError.message }, 500)
    }

    // merge_stories returns business failures as { ok:false, reason } — pass through untouched.
    if (!result?.ok || result?.skipped) {
      return jsonResponse({ ...result, run_id: runId })
    }

    // Log the executed merge so the Judge tab shows it (source='manual', migration 104).
    // The merge is already committed; a log failure must not fail the request.
    const { error: logError } = await supabase.from('clustering_judge_log').insert({
      source: 'manual',
      story_id_a: survivorId,
      story_id_b: loserId,
      headline_a: survivor.primary_headline,
      headline_b: loser.primary_headline,
      verdict: 'merge',
      rationale: `Manual merge via admin Judge tab: #${loserId} merged into #${survivorId}`,
      merged: true,
      dry_run: false,
      run_id: runId
    })
    if (logError) {
      console.error('clustering_judge_log insert failed (merge already executed):', logError.message)
    }

    return jsonResponse({
      ...result,
      run_id: runId,
      log_error: logError ? logError.message : undefined
    })
  } catch (error) {
    console.error('Error in admin-judge-merge:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
})
