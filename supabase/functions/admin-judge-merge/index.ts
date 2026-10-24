// Edge Function: admin-judge-merge
// Executes an admin-initiated (manual) story merge from the Admin Dashboard "Judge" tab.
// ADO-537: human override for uncertain/missed Judge verdicts. Mirrors admin-judge-log
// (service_role, password-gated) so nothing here needs an anon grant.
//
// POST /admin-judge-merge
// Body:
//   action:      'preview' | 'merge' | 'unmerge' | 'dismiss' (required)
//   survivor_id: story id that keeps the articles (required, positive integer)
//   loser_id:    story id that gets tombstoned into the survivor (required, positive integer)
//
// For 'unmerge' the two ids are just "the pair" — the function resolves which one is actually
// tombstoned into the other (agent-sourced log rows don't guarantee which column was the loser)
// and reverses that merge via the unmerge_story RPC (migration 105).
//
//   via:         optional 'stories_combine' (ADO-60: the Stories tab Combine dialog) — only changes the
//                judge-log rationale text; the merge path is identical to the Judge tab's.
//
// preview response: { ok, survivor: {...}, loser: {...}, warnings: [...], fronts_checked }
//   (each story also carries article_count = article_story rows, and front = {event_id,name}|null)
// merge response:   { ok, skipped?, reason?, run_id, articles_moved?, survivor_source_count?, log_error?, refresh_error? }
// unmerge response: { ok, reason?, run_id, loser_id?, survivor_id?, articles_restored?, refresh_error? }
// After an executed merge/unmerge, refresh_tracker_derived() runs (best-effort) so the Tracker
// main line and masthead tally don't wait for the next pipeline run.
//   (the 'unmerge' judge-log row is written atomically by the unmerge_story RPC — migration 107)
// dismiss response: { ok, run_id }
//
// 'dismiss' is the admin "keep separate" decision for a reviewed pair (usually an uncertain
// verdict). It changes no story — it only logs a source='manual', verdict='keep' row, which
// the Judge's verdict memory (migration 106) treats as settled: the pair is not re-judged
// until a new article attaches to either story. It also drops the pair out of the Judge tab's
// "Needs review" view (admin-judge-log view='needs_review').
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

// A merge tombstones a story and an unmerge revives one; both change stories.status, which the Tracker
// main-line rule and the masthead tally read from stored columns (migration 113). Refresh them now
// instead of waiting for the next pipeline run. Best-effort: the merge/unmerge is already committed.
// deno-lint-ignore no-explicit-any
async function refreshTracker(supabase: any): Promise<string | undefined> {
  const { error } = await supabase.rpc('refresh_tracker_derived')
  if (error) {
    console.error('refresh_tracker_derived failed (merge/unmerge already committed):', error.message)
    return error.message
  }
  return undefined
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
    // Which admin screen asked (audit text only). ADO-60: the Stories tab Combine loops 'merge' per story.
    const fromStoriesCombine = body.via === 'stories_combine'

    if (action !== 'preview' && action !== 'merge' && action !== 'unmerge' && action !== 'dismiss') {
      return jsonResponse({ error: "action must be 'preview', 'merge', 'unmerge' or 'dismiss'" }, 400)
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

      // ADO-60: real article counts (article_story rows; stories.source_count can drift) and front
      // membership, for the Stories tab "Combine" dialog. merge_stories does NOT move story_event,
      // so a loser's front is flagged rather than silently left on the tombstone. Best-effort:
      // a failed lookup leaves the fields off and fronts_checked=false (the merge itself is unaffected).
      const found = [survivor, loser].filter((s): s is NonNullable<typeof s> => !!s)
      const extra: Record<number, { article_count?: number; front?: { event_id: number; name: string } | null }> = {}
      let frontsChecked = false
      try {
        const counts = await Promise.all(found.map((s) =>
          supabase.from('article_story').select('article_id', { count: 'exact', head: true }).eq('story_id', s.id)
        ))
        counts.forEach((c, i) => {
          if (!c.error && typeof c.count === 'number') extra[found[i].id] = { article_count: c.count }
        })

        const { data: members, error: memberError } = await supabase
          .from('story_event')
          .select('story_id,event_id')
          .in('story_id', found.map((s) => s.id))
        if (memberError) throw memberError
        const eventIds = [...new Set((members || []).map((m) => m.event_id))]
        const names: Record<number, string> = {}
        if (eventIds.length > 0) {
          const { data: events, error: eventError } = await supabase.from('events').select('id,name').in('id', eventIds)
          if (eventError) throw eventError
          for (const e of events || []) names[e.id] = e.name
        }
        for (const s of found) {
          const m = (members || []).find((row) => row.story_id === s.id)
          extra[s.id] = { ...extra[s.id], front: m ? { event_id: m.event_id, name: names[m.event_id] || `front #${m.event_id}` } : null }
        }
        frontsChecked = true
      } catch (lookupError) {
        console.error('Preview count/front lookup failed:', (lookupError as Error)?.message || lookupError)
      }

      const survivorOut = survivor ? { ...survivor, ...extra[survivor.id] } : null
      const loserOut = loser ? { ...loser, ...extra[loser.id] } : null
      if (frontsChecked && loserOut?.front && loserOut.status !== 'merged_into') {
        if (!survivorOut?.front) {
          warnings.push(`Loser #${loserId} is on the front "${loserOut.front.name}" but survivor #${survivorId} is on no front. Merging does not move front membership.`)
        } else if (survivorOut.front.event_id !== loserOut.front.event_id) {
          warnings.push(`Loser #${loserId} is on the front "${loserOut.front.name}"; survivor #${survivorId} stays on "${survivorOut.front.name}".`)
        }
      }
      return jsonResponse({ ok: !!(survivor && loser), survivor: survivorOut, loser: loserOut, warnings, fronts_checked: frontsChecked })
    }

    if (action === 'unmerge') {
      // Resolve which of the pair is actually the tombstoned loser (don't trust column order).
      const a = survivor
      const b = loser
      let actualLoser = null
      if (a && a.status === 'merged_into' && a.merged_into_story_id === b?.id) actualLoser = a
      else if (b && b.status === 'merged_into' && b.merged_into_story_id === a?.id) actualLoser = b
      if (!actualLoser) {
        return jsonResponse({ ok: false, reason: 'not_merged_pair' })
      }

      const runId = `manual-admin-${Date.now()}`
      const { data: result, error: rpcError } = await supabase.rpc('unmerge_story', {
        p_loser_id: actualLoser.id,
        p_run_id: runId
      })
      if (rpcError) {
        console.error('unmerge_story RPC failed:', rpcError.message)
        return jsonResponse({ error: 'Unmerge failed', detail: rpcError.message }, 500)
      }
      if (!result?.ok) {
        return jsonResponse({ ...result, run_id: runId })
      }

      // The 'unmerge' clustering_judge_log row is written by unmerge_story ITSELF, inside the
      // unmerge transaction (migration 107). It is the Judge's verdict memory (migration 106) —
      // a best-effort insert here could fail after commit and leave the Judge free to re-merge
      // a human unmerge, so this function no longer writes it.
      const refreshError = await refreshTracker(supabase)
      return jsonResponse({ ...result, run_id: runId, refresh_error: refreshError })
    }

    if (action === 'dismiss') {
      // For dismiss the two ids are just "the pair" (no survivor/loser roles).
      if (!survivor || !loser) {
        return jsonResponse({ ok: false, reason: !survivor ? 'survivor_not_found' : 'loser_not_found' })
      }
      const runId = `manual-admin-${Date.now()}`
      // Unlike the post-merge log write, this row IS the action — a failed insert fails the request.
      const { error: logError } = await supabase.from('clustering_judge_log').insert({
        source: 'manual',
        story_id_a: survivorId,
        story_id_b: loserId,
        headline_a: survivor.primary_headline,
        headline_b: loser.primary_headline,
        verdict: 'keep',
        rationale: `Dismissed via admin Judge tab: keep #${survivorId} and #${loserId} separate`,
        merged: false,
        dry_run: false,
        run_id: runId
      })
      if (logError) {
        console.error('clustering_judge_log insert failed (dismiss):', logError.message)
        return jsonResponse({ error: 'Dismiss failed', detail: logError.message }, 500)
      }
      return jsonResponse({ ok: true, run_id: runId })
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
      rationale: fromStoriesCombine
        ? `Manual merge via admin Stories tab (Combine): #${loserId} merged into #${survivorId}`
        : `Manual merge via admin Judge tab: #${loserId} merged into #${survivorId}`,
      merged: true,
      dry_run: false,
      run_id: runId
    })
    if (logError) {
      console.error('clustering_judge_log insert failed (merge already executed):', logError.message)
    }

    const refreshError = await refreshTracker(supabase)

    return jsonResponse({
      ...result,
      run_id: runId,
      log_error: logError ? logError.message : undefined,
      refresh_error: refreshError
    })
  } catch (error) {
    console.error('Error in admin-judge-merge:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
})
