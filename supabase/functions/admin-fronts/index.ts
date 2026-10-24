// Edge Function: admin-fronts
// Everything the Admin Dashboard "Fronts" tab does (ADO-547): list and edit fronts, tune the
// keyword sweep + assignment agent rules, file / move / remove stories, and the unassigned pool.
// Password-gated (x-admin-password), service_role (drafts, story_event.note and the RPCs are not
// anon-readable). Same auth + CORS shape as admin-feeds.
//
// POST /admin-fronts   body: { action, ... }
//   list                                   -> { fronts: [...], stats_available }
//   get        { event_id }                -> { front }
//   save       { event_id?, fields }       -> { ok, front, warnings[], refresh }   (no event_id = create)
//   retire     { event_id }                -> { ok, front, previous: {sweep_*, agent_pattern}, warnings[], refresh }
//   members    { event_id, cursor?, search? } -> { stories: [...], next_cursor }
//   pool       { cursor?, search? }        -> { stories: [...], next_cursor }
//   lookup     { story_id }                -> { story }   (any story: its front, so the tab can offer a move)
//   assign     { event_id, story_ids[], move? } -> { ok, results: [{story_id, status, from_event_id}], refresh }
//   unassign   { event_id, story_ids[] }   -> { ok, results: [{story_id, status, sweep_would_refile, agent_may_refile}], refresh }
//   check_pattern { pattern }              -> { ok, error }
//   preview    { pattern, coword?, summary?, kind: 'sweep'|'agent', days?, event_id? }
//                                          -> { total_matches, on_this_front, on_other_front, unassigned, samples[] }
//
// Every write that changes a front or a membership calls refresh_tracker_derived() afterwards
// (stories.main_line is a stored column; without it the change waits for the next pipeline run).
// A failed refresh does not undo the write: it comes back as refresh.ok = false.
//
// Rules (sweep_pattern, sweep_coword, agent_pattern) are compiled by admin_check_front_pattern
// (migration 134, same ~* operator as the sweep) before anything is written, so a bad regex fails
// here and never in the 2-hourly sweep or the daily agent run.
// Retire = take a front off the site and stop new stories reaching it: publish_state draft, the
// whole sweep rule and the agent pattern cleared (the ADO-610 convention for merged fronts; the
// agent definition stays, it is inert without a pattern). Members are kept. The old rule comes
// back in the response so the admin can restore it.
// Pattern text is never trimmed (leading/trailing spaces are part of a regex).
// Slugs are fixed after create: public URLs and the agent's decline records use them.
//
// Needs migration 134 for assign / unassign / check_pattern / preview and for saving a rule; until
// it is applied those return { error, needs_migration: '134' } (HTTP 503). list/get/members/pool
// and saving the other fields work without it.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { checkAdminPassword } from '../_shared/auth.ts'

const LIST_FIELDS = 'id,slug,name,tier,lifecycle,publish_state,published_at,alarm_level,sweep_priority,sweep_pattern,agent_pattern,updated_at'
const FULL_FIELDS = 'id,slug,name,dek,alarm_level,tier,lifecycle,publish_state,published_at,started_at,resolved_at,created_by,sweep_pattern,sweep_coword,sweep_priority,sweep_summary,agent_pattern,agent_definition,created_at,updated_at'
const STORY_FIELDS = 'id,primary_headline,alarm_level,severity,category,action_label,status,merged_into_story_id,first_seen_at,last_updated_at,main_line'
const PAGE = 50
const MAX_IDS = 200
const MAX_FRONTS = 200
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/
const TIERS = ['flagship', 'major', 'standard']
const LIFECYCLES = ['open', 'dormant', 'resolved']
const PUBLISH_STATES = ['draft', 'review', 'published']
const RULE_FIELDS = ['sweep_pattern', 'sweep_coword', 'agent_pattern'] as const
const AGENT_FIELDS = ['agent_pattern', 'agent_definition', 'publish_state']
// The daily fronts agent runs at 14:00 UTC (9:00 AM CT) for a few minutes. A definitions change
// mid-run hides that run's later declines from the changed front (fronts-claude-agent/plan.md).
const RUN_WINDOW_START_MIN = 13 * 60 + 55
const RUN_WINDOW_END_MIN = 14 * 60 + 20

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(
    JSON.stringify(body),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

class BadRequest extends Error {}
const bad = (msg: string): never => { throw new BadRequest(msg) }

function posInt(v: unknown, name: string): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN
  if (!Number.isSafeInteger(n) || n <= 0) bad(`${name} must be a positive integer`)
  return n
}

function optCursor(v: unknown): number | null {
  return v === undefined || v === null || v === '' ? null : posInt(v, 'cursor')
}

function idList(v: unknown): number[] {
  if (!Array.isArray(v) || v.length === 0) bad('story_ids must be a non-empty array')
  const ids = [...new Set((v as unknown[]).map((x) => posInt(x, 'story_ids[]')))]
  if (ids.length > MAX_IDS) bad(`at most ${MAX_IDS} stories at a time`)
  return ids
}

// ilike needle: PostgREST wildcards and LIKE escapes stripped, so the text is matched literally.
function searchTerm(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/[%_*\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
  return s.length >= 2 ? s : null
}

function optText(v: unknown, name: string, max: number): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') bad(`${name} must be text`)
  const s = (v as string).trim()
  if (s.length > max) bad(`${name} is too long (${s.length} characters, limit ${max})`)
  return s === '' ? null : s
}

// Regex text is NOT trimmed: ' ice ' (spaces to skip "police") means something different from
// 'ice'. Blank = no rule; line breaks are dropped (a pattern is one line).
function optPattern(v: unknown, name: string): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') bad(`${name} must be text`)
  const s = (v as string).replace(/[\r\n]+/g, '')
  if (s.length > 4000) bad(`${name} is too long (${s.length} characters, limit 4000)`)
  return s.trim() === '' ? null : s
}

function inRunWindow(d = new Date()): boolean {
  const m = d.getUTCHours() * 60 + d.getUTCMinutes()
  return m >= RUN_WINDOW_START_MIN && m <= RUN_WINDOW_END_MIN
}

function isMissingFn(err: { code?: string; message?: string } | null): boolean {
  return !!err && (err.code === 'PGRST202' || err.code === '42883')
}

const NEEDS_134 = { error: 'This needs database migration 134 (admin fronts), which is not applied yet.', needs_migration: '134' }

async function refresh(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc('refresh_tracker_derived')
  if (error) {
    console.error('refresh_tracker_derived failed:', error.message)
    return { ok: false, error: 'The Tracker main line was not refreshed; it catches up on the next pipeline run.' }
  }
  const row = Array.isArray(data) ? data[0] : data
  return { ok: true, rows_changed: row?.rows_changed ?? null }
}

// NULL = valid; string = the Postgres error; throws MissingFn when migration 134 is absent.
class MissingFn extends Error {}
async function checkPattern(supabase: SupabaseClient, pattern: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('admin_check_front_pattern', { p_pattern: pattern })
  if (isMissingFn(error)) throw new MissingFn()
  if (error) throw new Error(`pattern check failed: ${error.message}`)
  return (data as string | null) ?? null
}

// deno-lint-ignore no-explicit-any
function withAgentFlag(f: any, hasDef: boolean) {
  return {
    ...f,
    has_sweep: !!f.sweep_pattern,
    has_agent_pattern: !!f.agent_pattern,
    has_agent_definition: hasDef,
    // the same three conditions front_agent_candidates_all() uses (migration 127)
    agent_active: f.publish_state === 'published' && !!f.agent_pattern && hasDef
  }
}

// Validates the editable fields present in `fields` against the current row (null on create).
// deno-lint-ignore no-explicit-any
function buildPatch(fields: Record<string, unknown>, current: any | null) {
  // deno-lint-ignore no-explicit-any
  const patch: Record<string, any> = {}
  const has = (k: string) => Object.prototype.hasOwnProperty.call(fields, k)

  if (has('name') || !current) {
    const name = optText(fields.name, 'name', 120)
    if (!name) bad('name is required')
    patch.name = name
  }
  if (!current) {
    const slug = typeof fields.slug === 'string' ? fields.slug.trim() : ''
    if (!SLUG_RE.test(slug)) bad('slug must be lowercase letters, digits and hyphens (for example "rfk-hhs")')
    patch.slug = slug
    patch.created_by = 'human'
  } else if (has('slug') && fields.slug !== current.slug) {
    bad('the slug cannot change after a front is created (public links and agent records use it)')
  }
  if (has('dek')) patch.dek = optText(fields.dek, 'summary', 2000)
  if (has('alarm_level')) {
    const n = Number(fields.alarm_level)
    if (!Number.isInteger(n) || n < 0 || n > 5) bad('alarm level must be 0-5')
    patch.alarm_level = n
  }
  if (has('tier')) {
    if (!TIERS.includes(String(fields.tier))) bad(`tier must be one of ${TIERS.join(', ')}`)
    patch.tier = fields.tier
  }
  if (has('started_at')) {
    const v = fields.started_at
    if (v === null || v === '') patch.started_at = null
    else {
      const t = typeof v === 'string' ? Date.parse(v) : NaN
      if (!Number.isFinite(t)) bad('start date is not a valid date')
      patch.started_at = new Date(t).toISOString()
    }
  }
  if (has('lifecycle')) {
    const lc = String(fields.lifecycle)
    if (!LIFECYCLES.includes(lc)) bad(`lifecycle must be one of ${LIFECYCLES.join(', ')}`)
    patch.lifecycle = lc
    const wasResolved = current?.lifecycle === 'resolved'
    if (lc === 'resolved' && !wasResolved) patch.resolved_at = new Date().toISOString()
    if (lc !== 'resolved' && (wasResolved || !current)) patch.resolved_at = null
  }
  if (has('publish_state')) {
    const ps = String(fields.publish_state)
    if (!PUBLISH_STATES.includes(ps)) bad(`publish state must be one of ${PUBLISH_STATES.join(', ')}`)
    patch.publish_state = ps
    // publishing stamps published_at (the CHECK requires it); unpublishing keeps the old stamp
    if (ps === 'published' && current?.publish_state !== 'published') patch.published_at = new Date().toISOString()
  }
  for (const k of RULE_FIELDS) if (has(k)) patch[k] = optPattern(fields[k], k)
  if (has('sweep_priority')) {
    const n = Number(fields.sweep_priority)
    if (!Number.isInteger(n) || n < 1 || n > 32767) bad('sweep priority must be a whole number from 1 to 32767')
    patch.sweep_priority = n
  }
  if (has('sweep_summary')) {
    if (typeof fields.sweep_summary !== 'boolean') bad('sweep_summary must be true or false')
    patch.sweep_summary = fields.sweep_summary
  }
  if (has('agent_definition')) patch.agent_definition = optText(fields.agent_definition, 'agent definition', 20000)
  return patch
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
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return jsonResponse({ error: 'Body must be a JSON object' }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    const action = String(body.action || 'list').trim()

    try {
      switch (action) {
        case 'list': {
          const [frontsRes, statsRes, defsRes] = await Promise.all([
            supabase.from('events').select(LIST_FIELDS).order('sweep_priority', { ascending: true }).order('id', { ascending: true }).limit(MAX_FRONTS),
            supabase.from('v_event_stats').select('event_id,story_count,last_activity_at,update_count').limit(MAX_FRONTS),
            // ids only: definitions run to several KB each, and the list just needs "has one"
            supabase.from('events').select('id').not('agent_definition', 'is', null).not('agent_definition', 'match', '^\\s*$').limit(MAX_FRONTS)
          ])
          if (frontsRes.error) {
            console.error('events read failed:', frontsRes.error.message)
            return jsonResponse({ error: 'Front list query failed' }, 500)
          }
          if (statsRes.error) console.error('v_event_stats read failed:', statsRes.error.message)
          if (defsRes.error) console.error('agent definition read failed:', defsRes.error.message)
          const withDef = new Set((defsRes.data || []).map((d) => Number(d.id)))
          const stats = new Map((statsRes.data || []).map((s) => [Number(s.event_id), s]))
          const fronts = (frontsRes.data || []).map((f) => {
            const s = stats.get(Number(f.id))
            return {
              ...withAgentFlag(f, withDef.has(Number(f.id))),
              story_count: s ? s.story_count : null,
              last_activity_at: s ? s.last_activity_at : null,
              update_count: s ? s.update_count : null
            }
          })
          return jsonResponse({ fronts, stats_available: !statsRes.error })
        }

        case 'get': {
          const id = posInt(body.event_id, 'event_id')
          const { data, error } = await supabase.from('events').select(FULL_FIELDS).eq('id', id).maybeSingle()
          if (error) throw new Error(`events read failed: ${error.message}`)
          if (!data) return jsonResponse({ ok: false, reason: 'front_not_found' }, 404)
          return jsonResponse({ front: data })
        }

        case 'save': {
          const fields = body.fields
          if (!fields || typeof fields !== 'object' || Array.isArray(fields)) bad('fields must be an object')
          const f = fields as Record<string, unknown>
          const eventId = body.event_id == null ? null : posInt(body.event_id, 'event_id')

          // deno-lint-ignore no-explicit-any
          let current: any = null
          if (eventId != null) {
            const { data, error } = await supabase.from('events').select(FULL_FIELDS).eq('id', eventId).maybeSingle()
            if (error) throw new Error(`events read failed: ${error.message}`)
            if (!data) return jsonResponse({ ok: false, reason: 'front_not_found' }, 404)
            current = data
          }
          const patch = buildPatch(f, current)

          // Compile every rule that is being set before writing anything.
          const ruleErrors: Record<string, string> = {}
          for (const k of RULE_FIELDS) {
            if (typeof patch[k] === 'string' && patch[k] !== (current?.[k] ?? null)) {
              const err = await checkPattern(supabase, patch[k])
              if (err) ruleErrors[k] = err
            }
          }
          if (Object.keys(ruleErrors).length) {
            return jsonResponse({ ok: false, reason: 'bad_pattern', rule_errors: ruleErrors }, 400)
          }

          const q = current
            ? supabase.from('events').update(patch).eq('id', eventId!).select(FULL_FIELDS).maybeSingle()
            : supabase.from('events').insert(patch).select(FULL_FIELDS).maybeSingle()
          const { data: saved, error: saveErr } = await q
          if (saveErr) {
            if (saveErr.code === '23505') return jsonResponse({ ok: false, reason: 'slug_taken', error: `the slug "${patch.slug}" is already used by another front` }, 409)
            if (saveErr.code === '23514') return jsonResponse({ ok: false, reason: 'check_failed', error: saveErr.message }, 400)
            throw new Error(`events save failed: ${saveErr.message}`)
          }
          if (!saved) return jsonResponse({ ok: false, reason: 'front_not_found' }, 404)

          const warnings: string[] = []
          if (saved.sweep_summary && !saved.sweep_coword) {
            warnings.push('"Also search summaries" does nothing without a required word: the sweep only reads summaries when the headline has one.')
          }
          const hasDef = typeof saved.agent_definition === 'string' && saved.agent_definition.trim() !== ''
          if (!!saved.agent_pattern !== hasDef) {
            warnings.push('The assignment agent needs BOTH a candidate pattern and a definition; with only one it skips this front.')
          } else if (saved.agent_pattern && hasDef && saved.publish_state !== 'published') {
            warnings.push('The assignment agent only files into live fronts; this one is not live, so the agent skips it.')
          }
          if (saved.sweep_pattern) {
            const { data: same } = await supabase.from('events').select('name').eq('sweep_priority', saved.sweep_priority).neq('id', saved.id).not('sweep_pattern', 'is', null).limit(3)
            if (same && same.length) warnings.push(`Sweep priority ${saved.sweep_priority} is shared with ${same.map((s) => s.name).join(', ')}; when both match, the older front wins. Give each front its own number.`)
          }
          const agentTouched = AGENT_FIELDS.some((k) => Object.prototype.hasOwnProperty.call(patch, k) && patch[k] !== (current?.[k] ?? null))
          if (agentTouched && inRunWindow()) {
            warnings.push('Saved during the daily fronts agent run (14:00-14:15 UTC). Check the next run looks right.')
          }

          return jsonResponse({ ok: true, created: !current, front: saved, warnings, refresh: await refresh(supabase) })
        }

        case 'retire': {
          const id = posInt(body.event_id, 'event_id')
          const { data: cur, error: curErr } = await supabase.from('events').select('id,sweep_pattern,sweep_coword,sweep_summary,agent_pattern').eq('id', id).maybeSingle()
          if (curErr) throw new Error(`events read failed: ${curErr.message}`)
          if (!cur) return jsonResponse({ ok: false, reason: 'front_not_found' }, 404)
          // the whole sweep rule goes (a stale required word would silently gate a later new pattern)
          const { data: saved, error } = await supabase.from('events')
            .update({ publish_state: 'draft', sweep_pattern: null, sweep_coword: null, sweep_summary: false, agent_pattern: null })
            .eq('id', id).select(FULL_FIELDS).maybeSingle()
          if (error) throw new Error(`retire failed: ${error.message}`)
          return jsonResponse({
            ok: true,
            front: saved,
            previous: { sweep_pattern: cur.sweep_pattern, sweep_coword: cur.sweep_coword, sweep_summary: cur.sweep_summary, agent_pattern: cur.agent_pattern },
            warnings: inRunWindow() ? ['Retired during the daily fronts agent run (14:00-14:15 UTC). Check the next run looks right.'] : [],
            refresh: await refresh(supabase)
          })
        }

        case 'members': {
          const id = posInt(body.event_id, 'event_id')
          const cursor = optCursor(body.cursor)
          const term = searchTerm(body.search)
          let q = supabase.from('story_event')
            .select(`story_id,assigned_by,confidence,assigned_at,reassigned_at,reassigned_from_event_id,note,stories!inner(${STORY_FIELDS})`)
            .eq('event_id', id)
            .order('story_id', { ascending: false })
            .limit(PAGE + 1)
          if (cursor != null) q = q.lt('story_id', cursor)
          if (term) q = q.ilike('stories.primary_headline', `%${term}%`)
          const { data, error } = await q
          if (error) throw new Error(`members read failed: ${error.message}`)
          const rows = data || []
          const page = rows.slice(0, PAGE)
          return jsonResponse({
            // deno-lint-ignore no-explicit-any
            stories: page.map((r: any) => ({ ...r.stories, assigned_by: r.assigned_by, confidence: r.confidence, assigned_at: r.assigned_at, reassigned_at: r.reassigned_at, reassigned_from_event_id: r.reassigned_from_event_id, note: r.note })),
            next_cursor: rows.length > PAGE ? page[page.length - 1].story_id : null
          })
        }

        case 'pool': {
          const cursor = optCursor(body.cursor)
          const term = searchTerm(body.search)
          // Unassigned = active + enriched (summary_neutral set, the publish gate) with no story_event
          // row (PostgREST anti-join on the one-to-one embed).
          let q = supabase.from('stories')
            .select(`${STORY_FIELDS},story_event(story_id)`)
            .eq('status', 'active')
            .not('summary_neutral', 'is', null)
            .is('story_event', null)
            .order('id', { ascending: false })
            .limit(PAGE + 1)
          if (cursor != null) q = q.lt('id', cursor)
          if (term) q = q.ilike('primary_headline', `%${term}%`)
          const { data, error } = await q
          if (error) throw new Error(`pool read failed: ${error.message}`)
          const rows = data || []
          const page = rows.slice(0, PAGE)
          return jsonResponse({
            // deno-lint-ignore no-explicit-any
            stories: page.map(({ story_event: _se, ...s }: any) => s),
            next_cursor: rows.length > PAGE ? page[page.length - 1].id : null
          })
        }

        case 'lookup': {
          const id = posInt(body.story_id, 'story_id')
          // "enriched" is a second id-only read so the summary text never leaves the database
          const [storyRes, enrichedRes] = await Promise.all([
            supabase.from('stories').select(`${STORY_FIELDS},story_event(event_id)`).eq('id', id).maybeSingle(),
            supabase.from('stories').select('id').eq('id', id).not('summary_neutral', 'is', null).maybeSingle()
          ])
          if (storyRes.error) throw new Error(`story read failed: ${storyRes.error.message}`)
          if (!storyRes.data) return jsonResponse({ ok: false, reason: 'story_not_found' }, 404)
          // deno-lint-ignore no-explicit-any
          const { story_event: se, ...s } = storyRes.data as any
          return jsonResponse({ story: { ...s, enriched: !enrichedRes.error && !!enrichedRes.data, event_id: se?.event_id ?? null } })
        }

        case 'assign': {
          const id = posInt(body.event_id, 'event_id')
          const ids = idList(body.story_ids)
          const move = body.move === true
          const { data, error } = await supabase.rpc('admin_assign_stories_to_front', { p_story_ids: ids, p_event_id: id, p_move: move })
          if (isMissingFn(error)) return jsonResponse(NEEDS_134, 503)
          if (error) {
            if (error.code === 'P0002') return jsonResponse({ ok: false, reason: 'front_not_found' }, 404)
            throw new Error(`assign failed: ${error.message}`)
          }
          // deno-lint-ignore no-explicit-any
          const results = (data || []) as any[]
          const changed = results.some((r) => r.status === 'assigned' || r.status === 'moved')
          return jsonResponse({ ok: true, results, refresh: changed ? await refresh(supabase) : { ok: true, rows_changed: 0 } })
        }

        case 'unassign': {
          const id = posInt(body.event_id, 'event_id')
          const ids = idList(body.story_ids)
          const { data, error } = await supabase.rpc('admin_unassign_stories', { p_story_ids: ids, p_event_id: id })
          if (isMissingFn(error)) return jsonResponse(NEEDS_134, 503)
          if (error) throw new Error(`unassign failed: ${error.message}`)
          // deno-lint-ignore no-explicit-any
          const results = (data || []) as any[]
          const changed = results.some((r) => r.status === 'removed')
          return jsonResponse({ ok: true, results, refresh: changed ? await refresh(supabase) : { ok: true, rows_changed: 0 } })
        }

        case 'check_pattern': {
          const pattern = optPattern(body.pattern, 'pattern')
          if (!pattern) return jsonResponse({ ok: true, error: null })
          const err = await checkPattern(supabase, pattern)
          return jsonResponse({ ok: err == null, error: err })
        }

        case 'preview': {
          const pattern = optPattern(body.pattern, 'pattern')
          if (!pattern) bad('enter a pattern to preview')
          const kind = body.kind === 'agent' ? 'agent' : 'sweep'
          const coword = kind === 'sweep' ? optPattern(body.coword, 'required word') : null
          for (const p of [pattern, coword]) {
            if (p) {
              const err = await checkPattern(supabase, p)
              if (err) return jsonResponse({ ok: false, reason: 'bad_pattern', error: err }, 400)
            }
          }
          const days = Math.min(Math.max(Number(body.days) || 30, 1), 90)
          const eventId = body.event_id == null ? null : posInt(body.event_id, 'event_id')
          const { data, error } = await supabase.rpc('admin_preview_front_rule', {
            p_pattern: pattern, p_coword: coword, p_summary: body.summary === true, p_kind: kind, p_days: days, p_event_id: eventId
          })
          if (isMissingFn(error)) return jsonResponse(NEEDS_134, 503)
          if (error) throw new Error(`preview failed: ${error.message}`)
          // deno-lint-ignore no-explicit-any
          const rows = (data || []) as any[]
          const head = rows[0] || {}
          return jsonResponse({
            ok: true,
            days,
            total_matches: head.total_matches ?? 0,
            on_this_front: head.on_this_front ?? 0,
            on_other_front: head.on_other_front ?? 0,
            unassigned: head.unassigned ?? 0,
            samples: rows.filter((r) => r.sample_story_id != null).map((r) => ({ id: r.sample_story_id, headline: r.sample_headline, front: r.sample_front }))
          })
        }

        default:
          return jsonResponse({ error: 'unknown action' }, 400)
      }
    } catch (err) {
      if (err instanceof BadRequest) return jsonResponse({ ok: false, reason: 'bad_request', error: err.message }, 400)
      if (err instanceof MissingFn) return jsonResponse(NEEDS_134, 503)
      throw err
    }
  } catch (error) {
    console.error('Error in admin-fronts:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
})
