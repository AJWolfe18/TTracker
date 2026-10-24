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
//   updates    { event_id, cursor? }       -> { updates: [... + stories[]], next_cursor }   (newest first)
//   save_update { event_id, update_id?, fields, story_ids? }
//                                          -> { ok, update, links, refresh? }   (no update_id = create, approved)
//   delete_update { event_id, update_id }  -> { ok, refresh }
//   pins                                   -> { pins: [... + item, dead, reason], truncated }
//   pin_lookup { source, entity_id }       -> { item, pin, dead, reason }
//   pin_set    { source, entity_id, pin, note? } -> { ok, pin, item, dead, reason, refresh }
//   pin_clear  { source, entity_id }       -> { ok, removed, item, refresh }
//
// Updates (AC5): the admin writes updates straight in as approved (decided_by 'human' +
// decided_at); the anon RLS policy (migration 111) shows an approved update only while its front
// is published, so nothing here gates visibility. Fields are whitelisted in updates-pins.ts.
// Linking stories writes story_event.event_update_id (the composite FK keeps the link on the
// same front); those writes refresh the Tracker like every other story_event write. The update
// text itself feeds no stored Tracker column, so a text-only save does not refresh.
// Pins (AC6): tracker_pin rows for any of the four sources; every pin write refreshes the
// Tracker (stories.main_line is stored). A pin on an item that can never show on the Tracker
// (closed, merged, unpublished, before the term) is flagged "dead" in pins / pin_set.
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
import {
  BadRequest, bad, buildUpdatePatch, optStoryIds, encodeUpdateCursor, parseUpdateCursor, updateCursorFilter,
  UPDATE_FIELDS, UPDATE_PAGE, pinSource, pinEntityId, pinEntityKey, pinValue, pinStatus, storyAlarm, MAX_PINS,
  type PinItem, type PinSource
} from './updates-pins.ts'

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

// ---- updates (AC5) ----

// Member stories folded into each update (story_event.event_update_id), headline only.
async function updateStories(supabase: SupabaseClient, updateIds: number[]) {
  const out = new Map<number, { id: number; headline: string | null }[]>()
  if (!updateIds.length) return out
  const { data, error } = await supabase.from('story_event')
    .select('story_id,event_update_id,stories!inner(primary_headline)')
    .in('event_update_id', updateIds)
    .order('story_id', { ascending: false })
    .limit(1000)
  if (error) throw new Error(`update stories read failed: ${error.message}`)
  // deno-lint-ignore no-explicit-any
  for (const r of (data || []) as any[]) {
    const k = Number(r.event_update_id)
    if (!out.has(k)) out.set(k, [])
    out.get(k)!.push({ id: Number(r.story_id), headline: r.stories?.primary_headline ?? null })
  }
  return out
}

// Sets exactly `ids` as the stories of update `updateId` (on front `eventId`). Stories that are
// not on this front are reported, never filed (filing is the members list's job). A story
// belongs to at most one update (one story_event row), so linking takes it from another update.
async function linkStories(supabase: SupabaseClient, eventId: number, updateId: number, ids: number[]) {
  let rows: { story_id: number; event_id: number; event_update_id: number | null }[] = []
  if (ids.length) {
    const { data, error } = await supabase.from('story_event').select('story_id,event_id,event_update_id').in('story_id', ids).limit(ids.length)
    if (error) throw new Error(`story_event read failed: ${error.message}`)
    // deno-lint-ignore no-explicit-any
    rows = ((data || []) as any[]).map((r) => ({ story_id: Number(r.story_id), event_id: Number(r.event_id), event_update_id: r.event_update_id == null ? null : Number(r.event_update_id) }))
  }
  const onFront = rows.filter((r) => r.event_id === eventId)
  const onFrontIds = onFront.map((r) => r.story_id)
  const notOnFront = ids.filter((id) => !onFrontIds.includes(id))

  let unq = supabase.from('story_event').update({ event_update_id: null }).eq('event_update_id', updateId)
  if (onFrontIds.length) unq = unq.not('story_id', 'in', `(${onFrontIds.join(',')})`)
  const { data: unlinked, error: unErr } = await unq.select('story_id')
  if (unErr) throw new Error(`unlink failed: ${unErr.message}`)

  let linked: number[] = []
  if (onFrontIds.length) {
    // eq(event_id) again: a story moved to another front since the read is skipped, not linked
    // across fronts (the composite FK would reject that anyway).
    const { data, error } = await supabase.from('story_event').update({ event_update_id: updateId })
      .eq('event_id', eventId).in('story_id', onFrontIds).select('story_id')
    if (error) throw new Error(`link failed: ${error.message}`)
    linked = (data || []).map((r) => Number(r.story_id))
  }
  const changed = (unlinked || []).length > 0 || onFront.some((r) => r.event_update_id !== updateId && linked.includes(r.story_id))
  return {
    changed,
    result: {
      linked,
      not_on_front: [...notOnFront, ...onFrontIds.filter((id) => !linked.includes(id))],
      taken_from_other_update: onFront.filter((r) => r.event_update_id != null && r.event_update_id !== updateId && linked.includes(r.story_id)).map((r) => r.story_id),
      unlinked: (unlinked || []).map((r) => Number(r.story_id))
    }
  }
}

// ---- pins (AC6) ----

const ITEM_SPECS = {
  eos: { table: 'executive_orders', select: 'id,title,date,is_public,alarm_level', title: 'title', date: 'date', alarm: 'alarm_level' },
  scotus: { table: 'scotus_cases', select: 'id,case_name,case_name_short,decided_at,is_public,ruling_impact_level', title: 'case_name_short', date: 'decided_at', alarm: 'ruling_impact_level' },
  pardons: { table: 'pardons', select: 'id,recipient_name,pardon_date,is_public,corruption_level', title: 'recipient_name', date: 'pardon_date', alarm: 'corruption_level' }
} as const

// The pinned items, normalized (PinItem). Missing ids are simply absent from the map.
async function describeItems(supabase: SupabaseClient, source: PinSource, ids: string[]): Promise<Map<string, PinItem>> {
  const out = new Map<string, PinItem>()
  const numeric = ids.filter((i) => /^\d{1,18}$/.test(i))
  if (source === 'stories') {
    if (!numeric.length) return out
    // "enriched" is a second id-only read so summary text never leaves the database
    const [rows, enriched] = await Promise.all([
      supabase.from('stories').select('id,primary_headline,status,merged_into_story_id,main_line,first_seen_at,alarm_level,severity').in('id', numeric).limit(numeric.length),
      supabase.from('stories').select('id').in('id', numeric).not('summary_neutral', 'is', null).limit(numeric.length)
    ])
    if (rows.error) throw new Error(`stories read failed: ${rows.error.message}`)
    if (enriched.error) throw new Error(`stories read failed: ${enriched.error.message}`)
    const enr = new Set((enriched.data || []).map((r) => String(r.id)))
    // deno-lint-ignore no-explicit-any
    for (const r of (rows.data || []) as any[]) {
      out.set(String(r.id), {
        title: r.primary_headline, date: r.first_seen_at, alarm: storyAlarm(r.alarm_level, r.severity),
        status: r.status, merged_into_story_id: r.merged_into_story_id, enriched: enr.has(String(r.id)), main_line: !!r.main_line
      })
    }
    return out
  }
  const spec = ITEM_SPECS[source]
  // EO ids are INTEGER on TEST and text on PROD (migration 108 drift); a text id against an
  // integer column is 22P02, so retry with the numeric ids alone.
  let ask = source === 'eos' ? ids : numeric
  if (!ask.length) return out
  let res = await supabase.from(spec.table).select(spec.select).in('id', ask).limit(ask.length)
  if (res.error?.code === '22P02' && source === 'eos') {
    ask = numeric
    if (!ask.length) return out
    res = await supabase.from(spec.table).select(spec.select).in('id', ask).limit(ask.length)
  }
  if (res.error) throw new Error(`${spec.table} read failed: ${res.error.message}`)
  // deno-lint-ignore no-explicit-any
  for (const r of (res.data || []) as any[]) {
    out.set(String(r.id), {
      title: r[spec.title] ?? (source === 'scotus' ? r.case_name : null),
      date: r[spec.date] ?? null,
      alarm: r[spec.alarm] ?? null,
      is_public: r.is_public
    })
  }
  return out
}

// null = the pins could not be read (the members list still loads; the tab hides the pin menus)
async function storyPins(supabase: SupabaseClient, ids: number[]): Promise<Map<number, string> | null> {
  const out = new Map<number, string>()
  if (!ids.length) return out
  const { data, error } = await supabase.from('tracker_pin').select('entity_id,pin').eq('source', 'stories').in('entity_id', ids.map(String)).limit(ids.length)
  if (error) {
    console.error('tracker_pin read failed:', error.message)
    return null
  }
  for (const r of data || []) out.set(Number(r.entity_id), r.pin)
  return out
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
          // deno-lint-ignore no-explicit-any
          const pins = await storyPins(supabase, page.map((r: any) => Number(r.story_id)))
          return jsonResponse({
            // deno-lint-ignore no-explicit-any
            stories: page.map((r: any) => ({ ...r.stories, assigned_by: r.assigned_by, confidence: r.confidence, assigned_at: r.assigned_at, reassigned_at: r.reassigned_at, reassigned_from_event_id: r.reassigned_from_event_id, note: r.note, pin: pins?.get(Number(r.story_id)) ?? null })),
            next_cursor: rows.length > PAGE ? page[page.length - 1].story_id : null,
            pins_available: pins !== null
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

        // ---------------- updates (AC5) ----------------
        case 'updates': {
          const id = posInt(body.event_id, 'event_id')
          const cur = parseUpdateCursor(body.cursor)
          let q = supabase.from('event_updates').select(UPDATE_FIELDS)
            .eq('event_id', id)
            .order('happened_at', { ascending: false })
            .order('sort_key', { ascending: false })
            .order('id', { ascending: false })
            .limit(UPDATE_PAGE + 1)
          if (cur) q = q.or(updateCursorFilter(cur))
          const { data, error } = await q
          if (error) throw new Error(`updates read failed: ${error.message}`)
          // deno-lint-ignore no-explicit-any
          const rows = (data || []) as any[]
          const page = rows.slice(0, UPDATE_PAGE)
          const linked = await updateStories(supabase, page.map((u) => Number(u.id)))
          return jsonResponse({
            updates: page.map((u) => ({ ...u, stories: linked.get(Number(u.id)) || [] })),
            next_cursor: rows.length > UPDATE_PAGE ? encodeUpdateCursor(page[page.length - 1]) : null
          })
        }

        case 'save_update': {
          const eventId = posInt(body.event_id, 'event_id')
          const fields = body.fields
          if (!fields || typeof fields !== 'object' || Array.isArray(fields)) bad('fields must be an object')
          const storyIds = optStoryIds(body.story_ids)
          const updateId = body.update_id == null ? null : posInt(body.update_id, 'update_id')

          // deno-lint-ignore no-explicit-any
          let current: any = null
          if (updateId != null) {
            const { data, error } = await supabase.from('event_updates').select(UPDATE_FIELDS).eq('id', updateId).eq('event_id', eventId).maybeSingle()
            if (error) throw new Error(`update read failed: ${error.message}`)
            if (!data) return jsonResponse({ ok: false, reason: 'update_not_found', error: 'That update no longer exists on this front. Reload the list.' }, 404)
            current = data
          } else {
            const { data, error } = await supabase.from('events').select('id').eq('id', eventId).maybeSingle()
            if (error) throw new Error(`events read failed: ${error.message}`)
            if (!data) return jsonResponse({ ok: false, reason: 'front_not_found' }, 404)
          }

          const patch = buildUpdatePatch(fields as Record<string, unknown>, current)
          const wrote = !current || Object.keys(patch).length > 0
          // deno-lint-ignore no-explicit-any
          let saved: any = current
          if (wrote) {
            const q = current
              ? supabase.from('event_updates').update(patch).eq('id', updateId!).eq('event_id', eventId).select(UPDATE_FIELDS).maybeSingle()
              : supabase.from('event_updates').insert({ ...patch, event_id: eventId }).select(UPDATE_FIELDS).maybeSingle()
            const { data, error } = await q
            if (error) {
              if (error.code === '23514') return jsonResponse({ ok: false, reason: 'check_failed', error: error.message }, 400)
              if (error.code === '23503') return jsonResponse({ ok: false, reason: 'front_not_found' }, 404)
              throw new Error(`update save failed: ${error.message}`)
            }
            if (!data) return jsonResponse({ ok: false, reason: 'update_not_found', error: 'That update no longer exists on this front. Reload the list.' }, 404)
            saved = data
          }

          // deno-lint-ignore no-explicit-any
          let links: any = null
          // deno-lint-ignore no-explicit-any
          let refreshRes: any = null
          if (storyIds !== undefined) {
            try {
              const r = await linkStories(supabase, eventId, Number(saved.id), storyIds)
              links = r.result
              if (r.changed) refreshRes = await refresh(supabase)
            } catch (err) {
              console.error('linking stories failed:', err)
              links = { error: 'The update was saved, but linking its stories failed. Try saving again.' }
            }
          }
          const stories = (await updateStories(supabase, [Number(saved.id)])).get(Number(saved.id)) || []
          return jsonResponse({ ok: true, created: !current, changed: wrote, update: { ...saved, stories }, links, refresh: refreshRes })
        }

        case 'delete_update': {
          const eventId = posInt(body.event_id, 'event_id')
          const updateId = posInt(body.update_id, 'update_id')
          // Linked stories lose the link (story_event.event_update_id ON DELETE SET NULL): a story_event write.
          const { data: had, error: hadErr } = await supabase.from('story_event').select('story_id').eq('event_update_id', updateId).limit(1)
          if (hadErr) throw new Error(`story_event read failed: ${hadErr.message}`)
          const { data, error } = await supabase.from('event_updates').delete().eq('id', updateId).eq('event_id', eventId).select('id')
          if (error) throw new Error(`update delete failed: ${error.message}`)
          if (!data || !data.length) return jsonResponse({ ok: false, reason: 'update_not_found', error: 'That update no longer exists on this front. Reload the list.' }, 404)
          return jsonResponse({ ok: true, refresh: had && had.length ? await refresh(supabase) : null })
        }

        // ---------------- Tracker pins (AC6) ----------------
        case 'pins': {
          const { data, error } = await supabase.from('tracker_pin')
            .select('source,entity_id,pin,note,created_at,updated_at')
            .order('updated_at', { ascending: false })
            .limit(MAX_PINS + 1)
          if (error) throw new Error(`tracker_pin read failed: ${error.message}`)
          // deno-lint-ignore no-explicit-any
          const rows = ((data || []) as any[]).slice(0, MAX_PINS)
          const bySource = new Map<PinSource, string[]>()
          for (const r of rows) {
            if (!bySource.has(r.source)) bySource.set(r.source, [])
            bySource.get(r.source)!.push(r.entity_id)
          }
          const items = new Map<string, PinItem>()
          await Promise.all([...bySource].map(async ([src, ids]) => {
            for (const [k, v] of await describeItems(supabase, src, ids)) items.set(`${src}:${k}`, v)
          }))
          const pins = rows.map((r) => {
            const item = items.get(`${r.source}:${r.entity_id}`) ?? null
            return { ...r, item, ...pinStatus(r.source, r.pin, item) }
          })
          return jsonResponse({ pins, truncated: (data || []).length > MAX_PINS })
        }

        case 'pin_lookup': {
          const source = pinSource(body.source)
          const entityId = pinEntityId(source, body.entity_id)
          const [items, pinRes] = await Promise.all([
            describeItems(supabase, source, [entityId]),
            supabase.from('tracker_pin').select('pin,note,updated_at').eq('source', source).eq('entity_id', entityId).maybeSingle()
          ])
          if (pinRes.error) throw new Error(`tracker_pin read failed: ${pinRes.error.message}`)
          const item = items.get(entityId) ?? null
          if (!item && !pinRes.data) return jsonResponse({ ok: false, reason: 'item_not_found', error: `Nothing with id ${entityId} in that list.` }, 404)
          return jsonResponse({
            source, entity_id: entityId, item, pin: pinRes.data,
            show: pinStatus(source, 'force_show', item), hide: pinStatus(source, 'force_hide', item)
          })
        }

        case 'pin_set': {
          const source = pinSource(body.source)
          const entityId = pinEntityId(source, body.entity_id)
          const pin = pinValue(body.pin)
          const row: Record<string, unknown> = { source, entity_id: entityId, pin }
          // note only when sent, so changing the setting keeps an existing note
          if (Object.prototype.hasOwnProperty.call(body, 'note')) row.note = optText(body.note, 'note', 300)
          const item = (await describeItems(supabase, source, [entityId])).get(entityId) ?? null
          if (!item) return jsonResponse({ ok: false, reason: 'item_not_found', error: `Nothing with id ${entityId} in that list, so there is nothing to pin.` }, 404)
          const { data, error } = await supabase.from('tracker_pin')
            .upsert(row, { onConflict: 'source,entity_id' })
            .select('source,entity_id,pin,note,updated_at')
            .maybeSingle()
          if (error) throw new Error(`pin save failed: ${error.message}`)
          const refreshRes = await refresh(supabase)
          // stories: re-read so the response carries main_line after the refresh
          const after = source === 'stories' ? ((await describeItems(supabase, source, [entityId])).get(entityId) ?? item) : item
          return jsonResponse({ ok: true, pin: data, item: after, ...pinStatus(source, pin, after), refresh: refreshRes })
        }

        case 'pin_clear': {
          const source = pinSource(body.source)
          const entityId = pinEntityKey(body.entity_id)
          const { data, error } = await supabase.from('tracker_pin').delete().eq('source', source).eq('entity_id', entityId).select('pin')
          if (error) throw new Error(`pin clear failed: ${error.message}`)
          const removed = !!data && data.length > 0
          const refreshRes = removed ? await refresh(supabase) : null
          const item = source === 'stories' ? ((await describeItems(supabase, source, [entityId])).get(entityId) ?? null) : null
          return jsonResponse({ ok: true, removed, item, refresh: refreshRes })
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
