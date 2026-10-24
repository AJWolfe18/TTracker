// Pure helpers for the admin-fronts "updates" (ADO-547 AC5) and "Tracker pins" (AC6) actions.
// No Deno or Supabase imports on purpose: scripts/tests/admin-fronts-updates-pins.test.mjs
// imports this file directly (Node strips the types), so the validation the edge function
// runs is the validation the test checks.

export class BadRequest extends Error {}
export const bad = (msg: string): never => { throw new BadRequest(msg) }

// ---------------------------------------------------------------------------
// Updates (event_updates, migration 111)
// ---------------------------------------------------------------------------

export const UPDATE_PAGE = 25
export const MAX_UPDATE_STORIES = 50
export const UPDATE_FIELDS = 'id,event_id,headline,body,happened_at,sort_key,significance,approval_state,decided_at,decided_by,was_edited,created_by,created_at,updated_at'
const SIGNIFICANCE = ['major', 'minor']
// What an admin may set on an existing update. 'pending' is the agent-draft state and the
// decided_check CHECK forbids decision fields on it, so nothing moves a row back to pending.
const SETTABLE_STATES = ['approved', 'rejected']
const CONTENT_FIELDS = ['headline', 'body', 'happened_at', 'significance'] as const
const EARLIEST = Date.parse('2000-01-01T00:00:00Z')
const FUTURE_SLACK_MS = 2 * 86400000

function text(v: unknown, name: string, max: number, required: boolean): string | null {
  if (v === null || v === undefined) {
    if (required) bad(`${name} is required`)
    return null
  }
  if (typeof v !== 'string') bad(`${name} must be text`)
  const s = (v as string).trim()
  if (s.length > max) bad(`${name} is too long (${s.length} characters, limit ${max})`)
  if (!s && required) bad(`${name} is required`)
  return s === '' ? null : s
}

function happenedAt(v: unknown, now: Date): string {
  const t = typeof v === 'string' ? Date.parse(v) : NaN
  if (!Number.isFinite(t)) bad('the date it happened is not a valid date')
  if (t < EARLIEST) bad('the date it happened is too far in the past')
  if (t > now.getTime() + FUTURE_SLACK_MS) bad('the date it happened cannot be in the future')
  return new Date(t).toISOString()
}

/**
 * Whitelisted, validated column patch for an event_updates insert (current = null) or update.
 * Only headline, body, happened_at, significance and (on edit) approval_state are read from
 * `fields`; everything else (event_id, created_by, decided_*, was_edited, sort_key, ...) is set
 * here or never written, so a request cannot mass-assign columns.
 *   create: always approved, decided_by 'human', decided_at now, created_by 'human' (AC5).
 *   edit:   a change of approval_state stamps decided_by 'human' + decided_at now; a content
 *           change on an agent-drafted row sets was_edited (the PRD 7.3 draft-quality metric).
 */
// deno-lint-ignore no-explicit-any
export function buildUpdatePatch(fields: Record<string, unknown>, current: any | null, now = new Date()): Record<string, unknown> {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(fields, k)
  // deno-lint-ignore no-explicit-any
  const patch: Record<string, any> = {}
  const isNew = !current

  if (isNew || has('headline')) patch.headline = text(fields.headline, 'headline', 300, true)
  if (has('body')) patch.body = text(fields.body, 'what happened', 5000, false)
  if (isNew || has('happened_at')) {
    if (isNew && (fields.happened_at === undefined || fields.happened_at === null || fields.happened_at === '')) bad('the date it happened is required')
    patch.happened_at = happenedAt(fields.happened_at, now)
  }
  if (has('significance') || isNew) {
    const sig = fields.significance === undefined || fields.significance === null ? 'minor' : String(fields.significance)
    if (!SIGNIFICANCE.includes(sig)) bad('importance must be major or minor')
    patch.significance = sig
  }

  if (isNew) {
    patch.approval_state = 'approved'
    patch.decided_by = 'human'
    patch.decided_at = now.toISOString()
    patch.created_by = 'human'
    return patch
  }

  // Drop no-op content fields so "Save" without changes writes nothing and was_edited stays honest.
  for (const k of CONTENT_FIELDS) {
    if (!(k in patch)) continue
    const cur = current[k] ?? null
    const same = k === 'happened_at'
      ? cur != null && Date.parse(cur) === Date.parse(patch[k])
      : cur === patch[k]
    if (same) delete patch[k]
  }
  if (current.created_by === 'agent' && CONTENT_FIELDS.some((k) => k in patch)) patch.was_edited = true

  if (has('approval_state')) {
    const st = String(fields.approval_state)
    if (st !== current.approval_state) {
      if (!SETTABLE_STATES.includes(st)) bad('an update can be shown (approved) or hidden (rejected)')
      patch.approval_state = st
      patch.decided_by = 'human'
      patch.decided_at = now.toISOString()
    }
  }
  return patch
}

/** Optional story list for linking stories to an update; undefined = leave links alone. */
export function optStoryIds(v: unknown): number[] | undefined {
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v)) bad('story_ids must be a list of story numbers')
  const out = new Set<number>()
  for (const x of v as unknown[]) {
    const n = typeof x === 'number' ? x : typeof x === 'string' && /^\s*#?\d+\s*$/.test(x) ? Number(x.replace(/[#\s]/g, '')) : NaN
    if (!Number.isSafeInteger(n) || n <= 0) bad(`"${String(x)}" is not a story number`)
    out.add(n)
  }
  if (out.size > MAX_UPDATE_STORIES) bad(`at most ${MAX_UPDATE_STORIES} stories per update`)
  return [...out]
}

// Keyset cursor for "newest first": (happened_at, sort_key, id) descending, the timeline order
// (idx_event_updates_event_timeline). The timestamp is kept exactly as Postgres returned it
// (microseconds): a millisecond round-trip would skip or repeat rows on the page boundary.
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/

// deno-lint-ignore no-explicit-any
export function encodeUpdateCursor(row: any): string {
  return `${row.happened_at}|${row.sort_key}|${row.id}`
}

export function parseUpdateCursor(v: unknown): { happened_at: string; sort_key: number; id: number } | null {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string') bad('cursor must be text')
  const parts = (v as string).split('|')
  if (parts.length !== 3) bad('cursor is not valid')
  const [h, s, i] = parts
  const sortKey = /^-?\d{1,19}$/.test(s) ? Number(s) : NaN
  const id = /^\d{1,19}$/.test(i) ? Number(i) : NaN
  if (!TS_RE.test(h) || !Number.isSafeInteger(sortKey) || !Number.isSafeInteger(id) || id <= 0) bad('cursor is not valid')
  return { happened_at: h, sort_key: sortKey, id }
}

/** PostgREST or() body for rows strictly after the cursor in descending timeline order. */
export function updateCursorFilter(c: { happened_at: string; sort_key: number; id: number }): string {
  const h = `"${c.happened_at}"`
  return `happened_at.lt.${h},and(happened_at.eq.${h},sort_key.lt.${c.sort_key}),and(happened_at.eq.${h},sort_key.eq.${c.sort_key},id.lt.${c.id})`
}

// ---------------------------------------------------------------------------
// Tracker pins (tracker_pin, migration 112)
// ---------------------------------------------------------------------------

export const PIN_SOURCES = ['stories', 'eos', 'scotus', 'pardons'] as const
export type PinSource = typeof PIN_SOURCES[number]
export const PIN_VALUES = ['force_show', 'force_hide']
export const MAX_PINS = 1000            // same cap as fetchTrackerPins() in src/lib/timeline.ts
// Mirrors src/lib/timeline.ts: TERM_START bounds every Tracker source, and EO/SCOTUS/pardon
// rows reach the main line at MAIN_LINE_SOURCE_ALARM (stories use stories.main_line).
export const TERM_START = '2025-01-20'
export const MAIN_LINE_SOURCE_ALARM = 4

export function pinSource(v: unknown): PinSource {
  const s = String(v ?? '')
  if (!(PIN_SOURCES as readonly string[]).includes(s)) bad(`source must be one of ${PIN_SOURCES.join(', ')}`)
  return s as PinSource
}

/** entity_id as tracker_pin stores it (TEXT). EO ids are text on PROD ('eo_<ts>_<suffix>'). */
export function pinEntityId(source: PinSource, v: unknown): string {
  const s = (typeof v === 'number' ? String(v) : typeof v === 'string' ? v : '').trim().replace(/^#/, '')
  if (source === 'eos') {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) bad('enter the executive order\'s id')
    return s
  }
  if (!/^\d{1,18}$/.test(s) || Number(s) <= 0) bad('enter the item\'s number')
  return String(Number(s))
}

/** An existing pin's entity_id exactly as stored (clearing must match a hand-written row too). */
export function pinEntityKey(v: unknown): string {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v : ''
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) bad('entity_id is not valid')
  return s
}

export function pinValue(v: unknown): string {
  const s = String(v ?? '')
  if (!PIN_VALUES.includes(s)) bad('pin must be force_show (always show) or force_hide (never show)')
  return s
}

/** The item a pin points at, normalized across the four sources (null = no such row). */
export interface PinItem {
  title: string | null
  date: string | null          // first_seen_at / date / decided_at / pardon_date
  alarm: number | null         // effective alarm for the source's main-line bar
  is_public?: boolean | null   // eos / scotus / pardons
  status?: string | null       // stories
  merged_into_story_id?: number | null
  enriched?: boolean           // stories: summary_neutral set (the publish gate)
  main_line?: boolean          // stories: the stored flag after the last refresh
}

/**
 * Can this item appear on the Tracker at all? dead = no: the pin does nothing (ADO-554 design
 * note: force_show cannot resurrect a closed or unenriched story). note = it can appear, but
 * the pin repeats what the rule already does. Copy is for the admin, plain words.
 */
export function pinStatus(source: PinSource, pin: string, item: PinItem | null): { dead: boolean; reason: string | null } {
  if (!item) return { dead: true, reason: 'This item no longer exists, so the pin does nothing.' }
  const beforeTerm = !item.date || item.date.slice(0, 10) < TERM_START
  if (source === 'stories') {
    if (item.merged_into_story_id) return { dead: true, reason: `Combined into story #${item.merged_into_story_id}, so it never shows. Pin #${item.merged_into_story_id} instead.` }
    if (item.status !== 'active') return { dead: true, reason: `The story is ${item.status || 'not active'}, so it never shows on the Tracker. A pin cannot bring it back.` }
    if (!item.enriched) return { dead: true, reason: 'The story has no summary yet (not published), so it cannot show until it is.' }
    if (beforeTerm) return { dead: true, reason: 'First seen before January 20, 2025, outside the Tracker.' }
    return { dead: false, reason: null }
  }
  if (item.is_public !== true) return { dead: true, reason: 'Not published on the site, so it never shows on the Tracker.' }
  if (beforeTerm) {
    return { dead: true, reason: source === 'scotus' && !item.date ? 'Not decided yet, so it is not on the Tracker.' : 'Dated before January 20, 2025, outside the Tracker.' }
  }
  const atBar = item.alarm != null && item.alarm >= MAIN_LINE_SOURCE_ALARM
  if (pin === 'force_show' && atBar) return { dead: false, reason: `Already on the homepage by its alarm level (${item.alarm}); the pin changes nothing today.` }
  if (pin === 'force_hide' && !atBar) return { dead: false, reason: 'Not on the homepage anyway (alarm below 4); the pin only matters if its alarm goes up.' }
  return { dead: false, reason: null }
}

/** Effective story alarm: alarm_level, else the migration-064 severity map, else 2 (v_event_stats). */
export function storyAlarm(alarmLevel: number | null, severity: string | null): number {
  if (alarmLevel != null) return alarmLevel
  const map: Record<string, number> = { critical: 5, severe: 4, moderate: 3, minor: 2 }
  return (severity && map[severity]) || 2
}
