// Edge Function: admin-executive-orders
// Returns paginated EO list with sub-tab predicates, filters, run log, and run drill-down.
// Mirrors admin-scotus pattern with EO-specific contracts (plan §4 of ADO-480).
//
// Auth: x-admin-password header (SCOTUS parity).
// Actions: list | run_log | run_log_detail
// ADO: Story 480

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { checkAdminPassword } from '../_shared/auth.ts'

// ─── Constants ──────────────────────────────────────────────────────────────

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

// Sort key whitelist — parsed via lastIndexOf('-') so underscored keys work
const SORT_COLUMNS = new Set(['date', 'alarm_level', 'enriched_at'])
const SORT_DIRS = new Set(['asc', 'desc'])

// Filter enums
const VALID_CATEGORIES = [
  'immigration_border', 'environment_energy', 'health_care', 'education',
  'justice_civil_rights_voting', 'natsec_foreign', 'economy_jobs_taxes',
  'technology_data_privacy', 'infra_housing_transport', 'gov_ops_workforce',
]
const VALID_SUBTABS = ['needs_review', 'unenriched', 'unpublished', 'published', 'failed', 'all']

// Cursor/date validators
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/  // strict YYYY-MM-DD; rejects ISO timestamps

// ─── Helpers ────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

// Parse "field-direction" using lastIndexOf so underscored fields like enriched_at-desc work.
// Returns null if invalid.
function parseSort(input: unknown): { col: string; dir: 'asc' | 'desc' } | null {
  if (typeof input !== 'string' || input.length === 0) return null
  const sep = input.lastIndexOf('-')
  if (sep <= 0 || sep >= input.length - 1) return null
  const col = input.substring(0, sep)
  const dir = input.substring(sep + 1)
  if (!SORT_COLUMNS.has(col) || !SORT_DIRS.has(dir)) return null
  return { col, dir: dir as 'asc' | 'desc' }
}

// Cursor schema:
//   { col: 'date',         val: 'YYYY-MM-DD',   id: string }
//   { col: 'alarm_level',  val: '0'..'5' | NULL_SENTINEL, id: string }
//   { col: 'enriched_at',  val: ISO timestamp | NULL_SENTINEL, id: string }
// `col` MUST match the request's sort column or the cursor is rejected with 400 —
// catches stale URLs from when the sort was different.
//
// `id` is an opaque EO identifier: PROD legacy `eo_<timestamp>_<suffix>` (VARCHAR(50))
// or TEST numeric ID coerced to string. Restricted to `[A-Za-z0-9_-]` so it can be
// safely interpolated into PostgREST filter strings without breaking on `,`/`(`/`)`.
//
// NULL_SENTINEL ('null' literal): only valid for nullable sort columns (alarm_level,
// enriched_at). Signals the paginator is in the NULL tail — all remaining rows have
// NULL in the sort column, paginated by id. Without this, keyset pagination on
// `col < value` would skip NULL rows entirely (SQL semantics: NULL < anything is
// UNKNOWN, not TRUE) and the unenriched tail would be unreachable past page 1.
interface CursorPayload { col: string; val: string; id: string }

const EO_ID_RE = /^[A-Za-z0-9_-]{1,50}$/
const ALARM_RE = /^[0-5]$/
// Full-string anchor is mandatory — without `$` a payload like
// `2026-04-17T00:00:00,and(id.gt.0` would pass the prefix check and inject a
// second predicate into the `.or()` string we construct below.
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/
const NULL_SENTINEL = 'null'
const NULLABLE_SORT_COLS = new Set(['alarm_level', 'enriched_at'])

function validateCursorVal(col: string, val: string): boolean {
  // NULL_SENTINEL only valid for nullable sort columns.
  if (val === NULL_SENTINEL) return NULLABLE_SORT_COLS.has(col)
  if (col === 'date') return DATE_RE.test(val)            // strict YYYY-MM-DD only
  if (col === 'alarm_level') return ALARM_RE.test(val)
  if (col === 'enriched_at') return ISO_TS_RE.test(val)
  return false
}

function decodeCursor(cursor: string | undefined | null, expectedCol: string): CursorPayload | null | 'invalid' {
  if (!cursor) return null
  try {
    const decoded = JSON.parse(atob(cursor))
    if (typeof decoded !== 'object' || decoded === null) return 'invalid'
    const col = (decoded as Record<string, unknown>).col
    const val = (decoded as Record<string, unknown>).val
    const id = (decoded as Record<string, unknown>).id
    if (typeof col !== 'string' || col !== expectedCol) return 'invalid'
    if (typeof val !== 'string' || !validateCursorVal(col, val)) return 'invalid'
    // Accept either string or number (legacy cursors from TEST days); coerce to string.
    const idStr = typeof id === 'number' && Number.isFinite(id) ? String(id) : id
    if (typeof idStr !== 'string') return 'invalid'
    // Special case: Phase-2 BRIDGE cursor emitted when Phase-1 exhausts mid-scan
    // with NULL rows still in scope. Empty id here means "no id keyset yet —
    // start of NULL tail". Only legal when val === NULL_SENTINEL.
    if (idStr === '') {
      if (val !== NULL_SENTINEL) return 'invalid'
      return { col, val, id: '' }
    }
    if (!EO_ID_RE.test(idStr)) return 'invalid'
    return { col, val, id: idStr }
  } catch {
    return 'invalid'
  }
}

function encodeCursor(payload: CursorPayload): string {
  return btoa(JSON.stringify(payload))
}

// Search is interpolated into a PostgREST `.or()` predicate string downstream. Reject
// any character that could alter the filter grammar — `,` separates predicates,
// `()` groups them, `"` opens quoted literals. Backslash neutralized by the `%_\\`
// escape in applyUserFilters, but explicit rejection here fails closed.
const SEARCH_FORBIDDEN_RE = /[,()"`\\]/

// Validate filter inputs and return an error string or null.
function validateFilters(filters: Record<string, unknown>): string | null {
  if (filters.search != null) {
    if (typeof filters.search !== 'string') return 'filters.search must be a string'
    if (filters.search.length > 200) return 'filters.search must be ≤200 characters'
    if (SEARCH_FORBIDDEN_RE.test(filters.search)) {
      return 'filters.search contains unsupported characters (,()\"`\\)'
    }
  }

  if (filters.alarm_level != null) {
    if (!Array.isArray(filters.alarm_level)) return 'filters.alarm_level must be an array'
    for (const v of filters.alarm_level as unknown[]) {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 5) {
        return 'filters.alarm_level entries must be integers 0-5'
      }
    }
  }

  if (filters.category != null) {
    if (!Array.isArray(filters.category)) return 'filters.category must be an array'
    for (const v of filters.category as unknown[]) {
      if (typeof v !== 'string' || !VALID_CATEGORIES.includes(v)) {
        return `filters.category entries must be one of: ${VALID_CATEGORIES.join(', ')}`
      }
    }
  }

  if (filters.prompt_version != null) {
    if (!Array.isArray(filters.prompt_version)) return 'filters.prompt_version must be an array'
    for (const v of filters.prompt_version as unknown[]) {
      if (typeof v !== 'string' || v.length > 32) return 'filters.prompt_version entries must be short strings'
    }
  }

  if (filters.date_from != null && (typeof filters.date_from !== 'string' || !DATE_RE.test(filters.date_from))) {
    return 'filters.date_from must be YYYY-MM-DD'
  }
  if (filters.date_to != null && (typeof filters.date_to !== 'string' || !DATE_RE.test(filters.date_to))) {
    return 'filters.date_to must be YYYY-MM-DD'
  }

  return null
}

// Apply user filters (search + chips). Sub-tab predicates applied separately.
// deno-lint-ignore no-explicit-any
function applyUserFilters(query: any, filters: Record<string, unknown>) {
  const search = typeof filters.search === 'string' ? filters.search.trim() : ''
  if (search.length > 0) {
    const escaped = search.replace(/[%_\\]/g, '\\$&')
    // Always search order_number + title. Previously the numeric branch also filtered
    // on `id.eq` but that only matched on TEST (INTEGER IDs) — on PROD (VARCHAR legacy
    // `eo_<ts>_<suffix>` IDs) a bare digit search never matches the id column anyway,
    // and user-facing search on the internal DB id is not a useful UX in either env.
    query = query.or(`order_number.ilike.%${escaped}%,title.ilike.%${escaped}%`)
  }

  const alarmLevels = filters.alarm_level as number[] | undefined
  if (alarmLevels && alarmLevels.length > 0) {
    query = query.in('alarm_level', alarmLevels)
  }

  const categories = filters.category as string[] | undefined
  if (categories && categories.length > 0) {
    query = query.in('category', categories)
  }

  const promptVersions = filters.prompt_version as string[] | undefined
  if (promptVersions && promptVersions.length > 0) {
    query = query.in('prompt_version', promptVersions)
  }

  if (typeof filters.date_from === 'string') {
    query = query.gte('date', filters.date_from)
  }
  if (typeof filters.date_to === 'string') {
    query = query.lte('date', filters.date_to)
  }

  return query
}

// Tab predicate row check, given EO state + latest log status.
function matchesSubtab(
  eo: { prompt_version: string | null; is_public: boolean; needs_manual_review: boolean },
  latestLogStatus: string | null,
  subtab: string,
): boolean {
  switch (subtab) {
    case 'needs_review':
      return eo.prompt_version === 'v1' && !eo.is_public && eo.needs_manual_review
    case 'unenriched':
      return eo.prompt_version !== 'v1'
    case 'unpublished':
      return eo.prompt_version === 'v1' && !eo.is_public
    case 'published':
      return eo.is_public === true
    case 'failed':
      return eo.prompt_version !== 'v1' && latestLogStatus === 'failed'
    case 'all':
    default:
      return true
  }
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
      // empty body OK for default list
    }

    const action = String(body.action ?? 'list')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    if (action === 'run_log') {
      return await handleRunLog(supabase)
    }

    if (action === 'run_log_detail') {
      const runId = body.run_id
      if (typeof runId !== 'string' || runId.length === 0 || runId.length > 128) {
        return jsonResponse({ error: 'run_id must be a non-empty string' }, 400)
      }
      return await handleRunLogDetail(supabase, runId)
    }

    if (action !== 'list') {
      return jsonResponse({ error: `Unknown action: ${action}` }, 400)
    }

    return await handleList(supabase, body)

  } catch (error) {
    console.error('Error in admin-executive-orders:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
})

// ─── List handler ───────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function handleList(supabase: any, body: Record<string, unknown>) {
  // Sub-tab
  const subtab = String(body.subtab ?? 'all')
  if (!VALID_SUBTABS.includes(subtab)) {
    return jsonResponse({ error: `Invalid subtab. Must be one of: ${VALID_SUBTABS.join(', ')}` }, 400)
  }

  // Filters
  const filters = (body.filters ?? {}) as Record<string, unknown>
  if (typeof filters !== 'object' || filters === null) {
    return jsonResponse({ error: 'filters must be an object' }, 400)
  }
  const filterError = validateFilters(filters)
  if (filterError) return jsonResponse({ error: filterError }, 400)

  // Sort
  const sort = parseSort(body.sort) ?? { col: 'date', dir: 'desc' as const }

  // Cursor — validated against current sort column so stale cursors from a
  // previous sort don't yield wrong pages.
  const cursorResult = decodeCursor(
    typeof body.after === 'string' ? body.after : null,
    sort.col,
  )
  if (cursorResult === 'invalid') {
    return jsonResponse({ error: 'Invalid cursor' }, 400)
  }
  const cursor: CursorPayload | null = cursorResult

  // Limit
  const rawLimit = parseInt(String(body.limit ?? '25'), 10)
  const limit = Math.min(Math.max(isNaN(rawLimit) ? 25 : rawLimit, 1), 100)

  // ─── Step 1: fetch ALL filtered EO state for counts_by_subtab + failed predicate ───
  // For ~285 EO scale this is trivially fast. If we ever scale to 100k+ EOs, push
  // counts to per-subtab COUNT(*) queries with subtab predicates pushed down.
  // Hard cap of 5000 prevents PostgREST silent default-cap (1000) from yielding
  // wrong counts; if hit, response sets `truncated: true` so the UI can warn.
  const STATE_HARD_CAP = 5000
  // Include the nullable sort column in the state select so we can later compute
  // `hasNullsInScope` without an extra query — needed to emit a Phase-2 bridge
  // cursor when Phase-1 keyset exhausts across multiple pages without the NULL
  // boundary falling inside a fetched page.
  const stateSelect = NULLABLE_SORT_COLS.has(sort.col)
    ? `id, prompt_version, is_public, needs_manual_review, ${sort.col}`
    : 'id, prompt_version, is_public, needs_manual_review'
  let stateQuery = supabase
    .from('executive_orders')
    .select(stateSelect)
    .limit(STATE_HARD_CAP)
  stateQuery = applyUserFilters(stateQuery, filters)

  const { data: stateRows, error: stateError } = await stateQuery
  if (stateError) {
    console.error('State query error:', stateError)
    return jsonResponse({ error: 'Failed to fetch EO state' }, 500)
  }
  const truncated = (stateRows ?? []).length >= STATE_HARD_CAP

  // IDs treated as opaque strings: PROD is VARCHAR(50), TEST is INTEGER. String
  // coercion unifies the two so Map keys / PostgREST filters work on both.
  const allFilteredIds: string[] = (stateRows ?? []).map((r: { id: unknown }) => String(r.id))

  // ─── Step 2: fetch latest log row per EO (in scope) ───
  // Two-step: pull recent log rows for these EOs, then keep latest per eo_id.
  // Tiebreaker: created_at DESC, id DESC (per plan §4.4)
  const latestLogByEoId = new Map<string, { id: number; status: string; created_at: string; needs_manual_review: boolean; run_id: string; duration_ms: number | null; notes: string | null; prompt_version: string }>()

  if (allFilteredIds.length > 0) {
    // Batch in 200-id chunks to keep PostgREST query length reasonable
    const CHUNK = 200
    for (let i = 0; i < allFilteredIds.length; i += CHUNK) {
      const chunk = allFilteredIds.slice(i, i + CHUNK)
      const { data: logRows, error: logError } = await supabase
        .from('executive_orders_enrichment_log')
        .select('id, eo_id, status, created_at, needs_manual_review, run_id, duration_ms, notes, prompt_version')
        .in('eo_id', chunk)
        .order('eo_id', { ascending: true })
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })

      if (logError) {
        console.error('Log query error:', logError)
        return jsonResponse({ error: 'Failed to fetch enrichment logs' }, 500)
      }

      for (const row of (logRows ?? [])) {
        const key = String(row.eo_id)
        if (!latestLogByEoId.has(key)) {
          latestLogByEoId.set(key, {
            id: row.id,
            status: row.status,
            created_at: row.created_at,
            needs_manual_review: row.needs_manual_review,
            run_id: row.run_id,
            duration_ms: row.duration_ms,
            notes: row.notes,
            prompt_version: row.prompt_version,
          })
        }
      }
    }
  }

  // ─── Step 3: compute counts_by_subtab (filtered denominators, I1) ───
  const counts: Record<string, number> = {
    needs_review: 0, unenriched: 0, unpublished: 0, published: 0, failed: 0, all: 0,
  }
  for (const row of (stateRows ?? [])) {
    const latestStatus = latestLogByEoId.get(String(row.id))?.status ?? null
    counts.all++
    if (matchesSubtab(row, latestStatus, 'needs_review')) counts.needs_review++
    if (matchesSubtab(row, latestStatus, 'unenriched')) counts.unenriched++
    if (matchesSubtab(row, latestStatus, 'unpublished')) counts.unpublished++
    if (matchesSubtab(row, latestStatus, 'published')) counts.published++
    if (matchesSubtab(row, latestStatus, 'failed')) counts.failed++
  }

  // ─── Step 4: filter to current sub-tab + collect matching IDs ───
  // Also track whether any in-scope row has NULL in the nullable sort column —
  // used below to emit a Phase-2 bridge cursor when Phase-1 keyset exhausts.
  const matchingIds: string[] = []
  let hasNullsInScope = false
  for (const row of (stateRows ?? [])) {
    const latestStatus = latestLogByEoId.get(String(row.id))?.status ?? null
    if (matchesSubtab(row, latestStatus, subtab)) {
      matchingIds.push(String(row.id))
      if (NULLABLE_SORT_COLS.has(sort.col) && (row as Record<string, unknown>)[sort.col] == null) {
        hasNullsInScope = true
      }
    }
  }

  if (matchingIds.length === 0) {
    return jsonResponse({
      items: [],
      count: 0,
      next_cursor: null,
      counts_by_subtab: counts,
      truncated,
    }, 200)
  }

  // ─── Step 5: paginated fetch of full EO rows ───
  let listQuery = supabase
    .from('executive_orders')
    .select(SELECT_FIELDS)
    .in('id', matchingIds)

  // Sort
  const ascending = sort.dir === 'asc'
  listQuery = listQuery.order(sort.col, { ascending, nullsFirst: false })
  if (sort.col !== 'id') {
    listQuery = listQuery.order('id', { ascending })
  }

  // Cursor — keyset on (sort.col, id) for any whitelisted sort column.
  //
  // Two-phase pagination for nullable sort columns (alarm_level, enriched_at):
  //   Phase 1 (cursor.val != NULL_SENTINEL): keyset on the non-NULL value range.
  //   Phase 2 (cursor.val === NULL_SENTINEL): `.is(col, null)` + id keyset only.
  //
  // The phase transition happens when Phase 1 exhausts — the next_cursor emission
  // below detects the end of the non-NULL range and emits a NULL_SENTINEL cursor so
  // the client can continue into the NULL tail. Without this, unenriched rows
  // (NULL alarm_level / enriched_at) are unreachable past the first page of these
  // sorts because SQL `col < value` returns UNKNOWN (not TRUE) for NULL.
  //
  // cursor.id is passed as a double-quoted PostgREST literal. Works for both
  // INTEGER (TEST) and VARCHAR (PROD) id columns — PostgreSQL casts the quoted
  // string to the column's declared type. EO_ID_RE on decode guarantees no
  // `,`/`(`/`)`/`"` can break the `.or()` predicate parser.
  if (cursor) {
    const op = ascending ? 'gt' : 'lt'
    if (cursor.val === NULL_SENTINEL) {
      // Phase 2: all remaining rows have NULL in the sort column. Bridge cursor
      // (empty id) skips the id keyset so we scan the entire NULL tail from the
      // start; subsequent pages within Phase 2 carry a real id and keyset on it.
      listQuery = listQuery.is(sort.col, null)
      if (cursor.id !== '') {
        if (ascending) listQuery = listQuery.gt('id', cursor.id)
        else listQuery = listQuery.lt('id', cursor.id)
      }
    } else {
      // Phase 1: non-NULL keyset. Also exclude NULL rows — those belong to Phase 2
      // and would otherwise duplicate-emit when the client transitions.
      listQuery = listQuery.or(
        `${sort.col}.${op}.${cursor.val},and(${sort.col}.eq.${cursor.val},id.${op}."${cursor.id}")`
      )
      if (NULLABLE_SORT_COLS.has(sort.col)) {
        listQuery = listQuery.not(sort.col, 'is', null)
      }
    }
  }
  // First-page (no cursor) + nullable sort: NULLs appear naturally at the tail via
  // `nullsFirst: false`. If there's room on page 1 for NULLs, they show up; the
  // next_cursor below detects the NULL boundary and emits a NULL_SENTINEL cursor
  // so subsequent pages stay in Phase 2.

  // Fetch limit + 1 for has_more detection
  listQuery = listQuery.limit(limit + 1)

  const { data: listRows, error: listError } = await listQuery
  if (listError) {
    console.error('List query error:', listError)
    return jsonResponse({ error: 'Failed to fetch EOs' }, 500)
  }

  const rawRows = listRows ?? []
  const hasMore = rawRows.length > limit
  // Capture the discarded probe row (the limit+1-th row) so the next-cursor emission
  // can detect the non-null → null boundary even when the boundary falls between the
  // last kept row and the discarded probe. Without this, a page whose last kept row
  // is non-null but whose probe row is NULL would emit a Phase-1 cursor, and the
  // subsequent Phase-1 query (with `.not(col, 'is', null)`) would return zero rows —
  // stranding the unenriched tail as unreachable.
  const probeRow = hasMore ? rawRows[limit] : null
  const items = (hasMore ? rawRows.slice(0, limit) : rawRows).map((eo: Record<string, unknown>) => ({
    ...eo,
    latest_log: latestLogByEoId.get(String(eo.id)) ?? null,
  }))

  // Next cursor — encodes (sort.col, last item's value, id). ID is coerced to string
  // and validated against EO_ID_RE before encoding so malformed IDs can't produce a
  // cursor that would be rejected by decodeCursor on the next Load More.
  //
  // Phase-2 emission triggers when ANY of:
  //   (a) already in Phase 2 — `cursor.val === NULL_SENTINEL`, continue by id
  //   (b) last kept row has NULL in the sort column — boundary crossed inside page
  //   (c) last kept row is non-null BUT the probe row is NULL — boundary at edge
  // Phase-2 BRIDGE emission triggers when:
  //   (d) Phase 1 exhausted this page (hasMore=false) with no NULL boundary hit,
  //       but NULL rows still exist in scope — emit bridge cursor (empty id) so
  //       Load More jumps straight to the start of the NULL tail.
  // Without (d), a multi-page Phase-1 scan that never sees a NULL on any page
  // would silently strand the unenriched tail — the exact bug ADO-481 addresses.
  let nextCursor: string | null = null
  const inPhase2 = cursor?.val === NULL_SENTINEL
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1]
    const rawVal = last[sort.col]
    const lastId = String(last.id)
    if (EO_ID_RE.test(lastId)) {
      const probeIsNull = probeRow != null && probeRow[sort.col] == null
      const shouldEnterPhase2 = (inPhase2 || rawVal == null || probeIsNull)
        && NULLABLE_SORT_COLS.has(sort.col)
      if (shouldEnterPhase2) {
        nextCursor = encodeCursor({ col: sort.col, val: NULL_SENTINEL, id: lastId })
      } else if (rawVal != null) {
        const valStr = String(rawVal)
        if (validateCursorVal(sort.col, valStr)) {
          nextCursor = encodeCursor({ col: sort.col, val: valStr, id: lastId })
        }
      }
    }
  } else if (!hasMore && !inPhase2 && hasNullsInScope && NULLABLE_SORT_COLS.has(sort.col)) {
    // Phase-1 exhausted but NULL rows remain — bridge to Phase 2 with empty id.
    nextCursor = encodeCursor({ col: sort.col, val: NULL_SENTINEL, id: '' })
  }

  return jsonResponse({
    items,
    count: matchingIds.length,
    next_cursor: nextCursor,
    counts_by_subtab: counts,
    truncated,
  }, 200)
}

// ─── Run log handler ────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function handleRunLog(supabase: any) {
  // Aggregate per run_id from log rows. PostgREST has no native GROUP BY, so we
  // fetch recent rows and aggregate in JS. To bound the work we cap at the most
  // recent 5000 log rows (roughly 50 runs of 100 EOs each).
  const { data: rows, error } = await supabase
    .from('executive_orders_enrichment_log')
    .select('run_id, status, duration_ms, needs_manual_review, created_at')
    .order('created_at', { ascending: false })
    .limit(5000)

  if (error) {
    console.error('Run log query error:', error)
    return jsonResponse({ error: 'Failed to fetch run log' }, 500)
  }

  type RunAgg = {
    run_id: string
    started_at: string  // MIN(created_at) — we update as we see earlier rows
    total_duration_ms: number
    eos_processed: number
    eos_flagged: number
    status_counts: { running: number; completed: number; failed: number }
  }
  const byRun = new Map<string, RunAgg>()

  for (const row of (rows ?? [])) {
    const runId = row.run_id as string
    let agg = byRun.get(runId)
    if (!agg) {
      agg = {
        run_id: runId,
        started_at: row.created_at,
        total_duration_ms: 0,
        eos_processed: 0,
        eos_flagged: 0,
        status_counts: { running: 0, completed: 0, failed: 0 },
      }
      byRun.set(runId, agg)
    }
    if (row.created_at < agg.started_at) agg.started_at = row.created_at
    agg.total_duration_ms += (row.duration_ms ?? 0)
    if (row.status !== 'running') agg.eos_processed++
    if (row.needs_manual_review) agg.eos_flagged++
    const status = row.status as 'running' | 'completed' | 'failed'
    if (status in agg.status_counts) agg.status_counts[status]++
  }

  // Sort by started_at desc, take top 50
  const runs = Array.from(byRun.values())
    .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
    .slice(0, 50)

  return jsonResponse({ runs }, 200)
}

// deno-lint-ignore no-explicit-any
async function handleRunLogDetail(supabase: any, runId: string) {
  // Cap at 500 — protects against PostgREST silent default-cap (1000) and keeps the
  // detail modal responsive. Surfaces `truncated: true` so the UI can warn.
  const RUN_DETAIL_CAP = 500
  const { data: rows, error } = await supabase
    .from('executive_orders_enrichment_log')
    .select(`
      id, eo_id, prompt_version, run_id, status,
      duration_ms, needs_manual_review, notes, created_at,
      executive_orders ( title, order_number )
    `)
    .eq('run_id', runId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(RUN_DETAIL_CAP)

  if (error) {
    console.error('Run log detail query error:', error)
    return jsonResponse({ error: 'Failed to fetch run detail' }, 500)
  }
  const truncated = (rows ?? []).length >= RUN_DETAIL_CAP

  // Flatten the joined fields for client convenience
  const runs = (rows ?? []).map((row: Record<string, unknown>) => {
    const eo = row.executive_orders as { title?: string; order_number?: string } | null
    return {
      id: row.id,
      eo_id: row.eo_id,
      prompt_version: row.prompt_version,
      run_id: row.run_id,
      status: row.status,
      duration_ms: row.duration_ms,
      needs_manual_review: row.needs_manual_review,
      notes: row.notes,
      created_at: row.created_at,
      eo_title: eo?.title ?? null,
      eo_order_number: eo?.order_number ?? null,
    }
  })

  return jsonResponse({ runs, truncated }, 200)
}
