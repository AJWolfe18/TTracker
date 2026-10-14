// Edge Function: admin-feeds
// Feed health list + the two admin feed actions for the Admin Dashboard Feeds tab (ADO-343).
// Password-gated (x-admin-password), service_role reads — feed_registry is not anon-readable.
//
// POST /admin-feeds
// Body:
//   action:    'list' (default) | 'set_active' | 'reset_failures'
//   feed_id:   positive integer (required for set_active / reset_failures)
//   is_active: boolean (required for set_active)
//
// list response:
//   {
//     feeds: [{ id, feed_name, feed_url, source_name, tier, is_active, is_opinion_source,
//               failure_count, last_fetched_at, last_failed_at, last_item_published_at,
//               has_compliance_rule,   // true/false, or null when the rules table can't be read
//               failing, silent }],
//     counts: { all, failing, silent, inactive },
//     compliance_available, compliance_status ('ok' | 'missing_table' | 'error'),
//     silent_days, failing_threshold, timestamp
//   }
// set_active / reset_failures response: { ok, feed } (feed = the updated row, list columns only)
//
// Definitions match the rest of the system so the numbers agree:
//   failing = active and failure_count >= 5 — same as admin-stats 'feeds_failed' (Home "Feeds
//             failed"), the fetcher's quarantine (scripts/rss/feed-health.js: retried once a day
//             while >= 5) and the daily ingest check's quarantined list. Inactive feeds are never
//             fetched, so their count never resets; they show under Inactive instead.
//   silent  = active, and the newest item in the feed is older than 7 days — the feed-level half
//             of the daily ingest check's stale_feeds (scripts/monitoring/alert-ingest-health.js),
//             without its "source still has fresh articles" condition, so a feed can be both
//             failing and silent. NULL = not yet stamped since migration 131, so not counted.
// reset_failures sets failure_count = 0, which puts a quarantined feed back on the normal schedule
// on the next RSS run (last_failed_at is kept as history).
//
// PROD has no feed_compliance_rules table (TEST does). The fetcher falls back to its 5,000-char
// default there, so a failed rules read is reported as compliance_available=false, not an error.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { checkAdminPassword } from '../_shared/auth.ts'

const FEED_FIELDS = 'id,feed_name,feed_url,source_name,tier,is_active,is_opinion_source,failure_count,last_fetched_at,last_failed_at,last_item_published_at'
const FAILING_THRESHOLD = 5
const SILENT_DAYS = 7
const MAX_FEEDS = 1000 // feed_registry is a few dozen rows; the cap only guards the response size

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(
    JSON.stringify(body),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

function parseFeedId(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

function isMissingTable(err: { code?: string }): boolean {
  return err.code === 'PGRST205' || err.code === '42P01'
}

// deno-lint-ignore no-explicit-any
function withFlags(feed: any, now: number, complianceIds: Set<number> | null) {
  const newest = feed.last_item_published_at ? Date.parse(feed.last_item_published_at) : NaN
  return {
    ...feed,
    has_compliance_rule: complianceIds ? complianceIds.has(feed.id) : null,
    failing: !!feed.is_active && (feed.failure_count ?? 0) >= FAILING_THRESHOLD,
    silent: !!feed.is_active && Number.isFinite(newest) && now - newest > SILENT_DAYS * 24 * 60 * 60 * 1000
  }
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

    const action = String(body.action || 'list').trim()
    if (action !== 'list' && action !== 'set_active' && action !== 'reset_failures') {
      return jsonResponse({ error: "action must be 'list', 'set_active' or 'reset_failures'" }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    const now = Date.now()

    if (action === 'list') {
      const [feedsResult, rulesResult] = await Promise.all([
        supabase.from('feed_registry').select(FEED_FIELDS).order('id', { ascending: true }).limit(MAX_FEEDS),
        supabase.from('feed_compliance_rules').select('feed_id').limit(MAX_FEEDS)
      ])
      if (feedsResult.error) {
        console.error('feed_registry read failed:', feedsResult.error.message)
        return jsonResponse({ error: 'Feed list query failed' }, 500)
      }
      // 'missing_table' (PGRST205 / 42P01, i.e. PROD today) vs any other read failure ('error'):
      // only the first means "every feed is on the fetcher's default".
      const complianceStatus = !rulesResult.error
        ? 'ok'
        : isMissingTable(rulesResult.error) ? 'missing_table' : 'error'
      if (complianceStatus === 'error') console.error('feed_compliance_rules read failed:', rulesResult.error!.message)
      const complianceIds = rulesResult.error
        ? null
        : new Set<number>((rulesResult.data || []).map((r) => Number(r.feed_id)))

      const feeds = (feedsResult.data || []).map((f) => withFlags(f, now, complianceIds))
      return jsonResponse({
        feeds,
        counts: {
          all: feeds.length,
          failing: feeds.filter((f) => f.failing).length,
          silent: feeds.filter((f) => f.silent).length,
          inactive: feeds.filter((f) => !f.is_active).length
        },
        compliance_available: complianceIds !== null,
        compliance_status: complianceStatus,
        silent_days: SILENT_DAYS,
        failing_threshold: FAILING_THRESHOLD,
        timestamp: new Date(now).toISOString()
      })
    }

    // Writes
    const feedId = parseFeedId(body.feed_id)
    if (feedId == null) {
      return jsonResponse({ error: 'feed_id must be a positive integer' }, 400)
    }

    let patch: Record<string, unknown>
    if (action === 'set_active') {
      if (typeof body.is_active !== 'boolean') {
        return jsonResponse({ error: 'is_active must be true or false' }, 400)
      }
      patch = { is_active: body.is_active }
    } else {
      patch = { failure_count: 0 }
    }

    const { data: updated, error: updateError } = await supabase
      .from('feed_registry')
      .update(patch)
      .eq('id', feedId)
      .select(FEED_FIELDS)
      .maybeSingle()

    if (updateError) {
      console.error(`feed_registry ${action} failed:`, updateError.message)
      return jsonResponse({ error: 'Feed update failed' }, 500)
    }
    if (!updated) {
      return jsonResponse({ ok: false, reason: 'feed_not_found' }, 404)
    }

    // The rules lookup only feeds the single-row flag; a missing table (PROD) leaves it null.
    const { data: rule, error: ruleError } = await supabase
      .from('feed_compliance_rules')
      .select('feed_id')
      .eq('feed_id', feedId)
      .maybeSingle()
    const complianceIds = ruleError ? null : new Set<number>(rule ? [feedId] : [])

    return jsonResponse({ ok: true, feed: withFlags(updated, now, complianceIds) })
  } catch (error) {
    console.error('Error in admin-feeds:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
})
