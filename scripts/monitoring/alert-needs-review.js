#!/usr/bin/env node
/**
 * Discord alert for enrichment output that needs a human (ADO-577 AC 3).
 *
 * The cloud agents flag uncertain output (needs_manual_review / needs_review)
 * but only phone-notify on hard failures, so a flagged case could sit in the
 * DB unnoticed. This runs as the last step of each fetch workflow and posts
 * one Discord message per domain naming the flagged records and the reason.
 *
 * The rules below are decided (Josh, September 25, 2026). The full rationale lives in
 * docs/reference/discord-alerts.md - change both together.
 * - Queue: every row that is STILL flagged, whatever its age. Nothing ages out unreviewed.
 * - Recent = enriched in the last ALERT_WINDOW_HOURS (default 168h = 7 days). Any recent flag makes
 *   the run post, so a late or skipped workflow run cannot lose one. Rows enriched in the last 26h
 *   are marked "new".
 * - Older flags alone post only on the weekly reminder day (Monday, Central time), so a backlog
 *   (36 published SCOTUS cases with low-confidence flags on September 25, 2026) reminds weekly
 *   instead of every run. Every message states how many older flags are still open.
 * - The message stops by itself once the records are reviewed in admin. Nothing flagged => no message.
 *
 * Stories (ADO-602) are different: the Stories agent flags its own log rows (stories_enrichment_log)
 * and there is no "reviewed" state, so an open queue would repeat forever. Instead it is a daily digest:
 * flagged, completed log rows CREATED in a fixed slot that ends 6 hours before the daily check window
 * opens (storiesSlot: yesterday 06:00 UTC to today 06:00 UTC), checked only on the once-a-day run of
 * the RSS health check (scripts/lib/daily-check-window.js). The 6-hour lag means every story in the
 * slot has finished (a story takes minutes) before the digest looks, so each flag is reported exactly
 * once, on the database's own clock. Every flag in the digest is named. A scheduled run that never
 * happens skips its slot. Thin-source notes without the flag never alert.
 *
 * Usage: node scripts/monitoring/alert-needs-review.js --domain scotus|eo|pardons|stories
 * Env:   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or the SUPABASE_TEST_* names),
 *        DISCORD_WEBHOOK_URL, ALERT_WINDOW_HOURS (optional),
 *        ALERT_ENV=test marks the message [TEST] and links the TEST site (set by the workflows)
 *
 * Never silent, never fails the ingest job:
 * - A check that cannot run (missing credentials, failed query, crash) posts its own "could not run"
 *   Discord message.
 * - Exit 1 only when Discord could not be told: the "could not run" message failed, or an alert was
 *   due and could not be delivered. The workflow steps are continue-on-error, so that marks the
 *   step red without failing the job.
 */

import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { postDiscord, COLORS } from '../lib/discord.js';
import { isDailyCheckRun, dailySlot } from '../lib/daily-check-window.js';

const DEFAULT_WINDOW_HOURS = 168;
const NEW_HOURS = 26;
const QUERY_LIMIT = 50;
// Stories digest: a slot is reported once and never again, so every flag in it must be fetched and named
const DAILY_QUERY_LIMIT = 500;
// The slot ends this long before the check window opens. A log row is created when a story starts and
// turns completed at the end (minutes later), so a slot that ended at the check hour would miss a row
// still running when the digest ran, on both days (Codex, PR #190). Rows still running 6h on are stuck.
const STORIES_SLOT_LAG_MS = 6 * 3600000;
const DIGEST_BUDGET = 3800; // stay under discord.js MAX_DESCRIPTION (4000) so no name is cut off

/** The Stories digest slot: dailySlot shifted STORIES_SLOT_LAG_MS earlier (06:00 to 06:00 UTC). */
export function storiesSlot(now = Date.now()) {
  const { start, end } = dailySlot(now);
  return { start: new Date(start.getTime() - STORIES_SLOT_LAG_MS), end: new Date(end.getTime() - STORIES_SLOT_LAG_MS) };
}
const REMINDER_WEEKDAY = 'Mon'; // weekly reminder day for older flags, Central time
const ORIGINS = Object.freeze({ prod: 'https://trumpytracker.com', test: 'https://test--taupe-capybara-0ff2ed.netlify.app' });

// Every query: still flagged, newest first, no age filter. The total comes from Content-Range.
export const DOMAINS = Object.freeze({
  scotus: {
    label: 'SCOTUS',
    path: () => `/scotus_cases?select=id,case_name_short,case_name,low_confidence_reason,enriched_at`
      + `&needs_manual_review=eq.true&manual_reviewed_at=is.null&order=enriched_at.desc.nullslast&limit=${QUERY_LIMIT}`,
    name: (r) => r.case_name_short || r.case_name || `case ${r.id}`,
    reason: (r) => r.low_confidence_reason,
    adminTab: 'SCOTUS',
  },
  eo: {
    label: 'Executive orders',
    // The EO agent writes its reason to the LOG row (`notes`); a trigger only syncs the boolean onto
    // executive_orders. Embed the newest flagged log row to get the reason in the same bounded request.
    path: () => `/executive_orders?select=id,title,order_number,enriched_at,executive_orders_enrichment_log(notes,created_at)`
      + `&executive_orders_enrichment_log.needs_manual_review=eq.true&executive_orders_enrichment_log.order=created_at.desc&executive_orders_enrichment_log.limit=1`
      + `&needs_manual_review=eq.true&order=enriched_at.desc.nullslast&limit=${QUERY_LIMIT}`,
    name: (r) => (r.order_number ? `EO ${r.order_number}` : `EO ${r.id}`) + (r.title ? `: ${String(r.title).slice(0, 60)}` : ''),
    reason: (r) => r.executive_orders_enrichment_log?.[0]?.notes || null,
    adminTab: 'Exec Orders',
  },
  pardons: {
    label: 'Pardons',
    path: () => `/pardons?select=id,recipient_name,enrichment_meta,enriched_at`
      + `&needs_review=eq.true&order=enriched_at.desc.nullslast&limit=${QUERY_LIMIT}`,
    name: (r) => r.recipient_name || `pardon ${r.id}`,
    reason: (r) => r.enrichment_meta?.review_reason || null,
    adminTab: 'Pardons',
  },
  stories: {
    label: 'Stories',
    // A fixed daily slot, not an open queue: the log has no reviewed state (ADO-602). The flag alone
    // decides, so a thin_source note without needs_manual_review never alerts.
    // Slot by created_at (the database's clock), lagged by STORIES_SLOT_LAG_MS (see storiesSlot).
    daily: true,
    slot: storiesSlot,
    table: 'stories_enrichment_log',
    path: ({ slot }) => `/stories_enrichment_log?select=id,story_id,notes,created_at,stories(primary_headline)`
      + `&needs_manual_review=eq.true&status=eq.completed`
      + `&created_at=gte.${encodeURIComponent(slot.start.toISOString())}&created_at=lt.${encodeURIComponent(slot.end.toISOString())}`
      + `&order=created_at.desc&limit=${DAILY_QUERY_LIMIT}`,
    shortName: (r) => (r.story_id ? `Story ${r.story_id}` : `Log row ${r.id}`),
    name: (r) => DOMAINS.stories.shortName(r) + (r.stories?.primary_headline ? `: ${String(r.stories.primary_headline).slice(0, 80)}` : ''),
    reason: (r) => r.notes,
    adminTab: 'Stories',
  },
});

/** Is `now` the weekly reminder day in Central time? */
export function isReminderDay(now = Date.now()) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).format(new Date(now)) === REMINDER_WEEKDAY;
}

const ageHours = (r, now) => (r.enriched_at ? (now - new Date(r.enriched_at).getTime()) / 3600000 : Infinity);

/**
 * @param {object} [opts]
 * @param {number} [opts.total] - every still-flagged row (Content-Range); defaults to rows.length
 * @param {number} [opts.windowHours] - recent window, default 168
 */
export function buildAlert(domainKey, rows, { origin = ORIGINS.prod, now = Date.now(), total = rows?.length ?? 0, windowHours = DEFAULT_WINDOW_HOURS } = {}) {
  const d = DOMAINS[domainKey];
  if (!d) throw new Error(`unknown domain ${domainKey}`);
  if (!rows || rows.length === 0) return null;
  total = Math.max(total, rows.length);
  // Names (headlines, case names) and reasons both come from source or agent text: no em/en dashes
  const line = (r, prefix = '') => {
    const why = d.reason(r);
    return `• ${prefix}${d.name(r)}${why ? ` - ${String(why).slice(0, 160)}` : ''}`.replace(/[—–]/g, '-');
  };
  if (d.daily) {
    // Reported once and never again, so every flag is named: ten with their notes, the other stories
    // by short name (once each), as many as fit the embed. Anything still unnamed gets a runnable query.
    const { start, end } = (d.slot || dailySlot)(now);
    const footer = `\n\nCheck the copy in ${origin}/admin.html (${d.adminTab} tab). Daily digest: each flag is reported once, there is nothing to mark as reviewed.`;
    const detailed = rows.slice(0, 10).map((r) => line(r));
    const shown = new Set(rows.slice(0, 10).map(d.shortName));
    const rest = [...new Set(rows.slice(10).map(d.shortName))].filter((n) => !shown.has(n));
    const compose = (named) => {
      const lines = [...detailed];
      if (named.length) lines.push(`Also flagged: ${named.join(', ')}`);
      const left = rest.length - named.length;
      if (left > 0) {
        lines.push(`… and ${left} more not listed here: ${d.table} rows with needs_manual_review=true, status=completed, created_at from ${start.toISOString()} to ${end.toISOString()}`);
      }
      return `${lines.join('\n')}${footer}`;
    };
    // Exact fit: drop names from the end until the whole description is inside the budget
    let n = rest.length;
    let description = compose(rest);
    while (n > 0 && description.length > DIGEST_BUDGET) description = compose(rest.slice(0, --n));
    const at = (t) => `${new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric' }).format(t)} ${t.getUTCHours()}:00 UTC`;
    return {
      title: `${d.label}: the agent flagged ${total} enrichment${total === 1 ? '' : 's'} for review (stories started ${at(start)} to ${at(end)})`,
      description,
      color: COLORS.warning,
    };
  }
  const isNew = (r) => ageHours(r, now) <= NEW_HOURS;
  const newCount = rows.filter(isNew).length;
  const recentCount = rows.filter((r) => ageHours(r, now) <= windowHours).length;
  // Rows come newest first, so the unfetched rows are older than the last fetched one. That makes
  // them all "older" only when the last fetched row is already outside the window; otherwise the
  // split is unknown and the line is left out rather than overstated (code review, September 25).
  const lastIsOlder = rows.length > 0 && ageHours(rows[rows.length - 1], now) > windowHours;
  const olderCount = total === rows.length || lastIsOlder ? total - recentCount : 0;
  const lines = rows.slice(0, 10).map((r) => line(r, isNew(r) ? 'NEW ' : ''));
  if (total > 10) lines.push(`… and ${total - 10} more`);
  const days = Math.round(windowHours / 24);
  const older = olderCount > 0
    ? `\n${olderCount} of these ${olderCount === 1 ? 'has' : 'have'} been waiting more than ${days} day${days === 1 ? '' : 's'} (reminded every Monday until reviewed).`
    : '';
  return {
    title: `${d.label}: ${total} enrichment${total === 1 ? '' : 's'} waiting for review (${newCount} new)`,
    description: `${lines.join('\n')}${older}\n\nReview in ${origin}/admin.html (${d.adminTab} tab). This reminder stops once they are reviewed.`,
    color: COLORS.warning,
  };
}

// Workflow logs are this script's only output channel; stdout directly, no console.log in production code.
const out = (line) => process.stdout.write(`${line}\n`);

/** "0-19/57" -> 57; missing or "*" -> null */
function contentRangeTotal(header) {
  const m = /\/(\d+)$/.exec(header || '');
  return m ? Number(m[1]) : null;
}

export async function runNeedsReviewAlert({ env = process.env, argv = process.argv.slice(2), fetchImpl = globalThis.fetch, log = out, now = Date.now() } = {}) {
  const i = argv.indexOf('--domain');
  const domainKey = i >= 0 ? argv[i + 1] : null;
  if (!domainKey || !DOMAINS[domainKey]) throw new Error(`--domain must be one of ${Object.keys(DOMAINS).join('|')}`);
  const d = DOMAINS[domainKey];
  // The daily digest runs inside the 6-hourly health check: only the once-a-day run checks, or a
  // flag would be posted up to four times (manual runs always check, push runs never do)
  if (d.daily && !isDailyCheckRun({ env, now })) {
    log(`[needs-review] ${domainKey}: not the daily check run, skipping`);
    return { flagged: 0, due: false, posted: false };
  }
  const url = env.SUPABASE_URL || env.SUPABASE_TEST_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_TEST_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  const hours = Number(env.ALERT_WINDOW_HOURS) > 0 ? Number(env.ALERT_WINDOW_HOURS) : DEFAULT_WINDOW_HOURS;
  const slot = (d.slot || dailySlot)(now);
  const res = await fetchImpl(`${url.replace(/\/$/, '')}/rest/v1${d.path({ slot })}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' },
  });
  if (!res.ok) throw new Error(`query failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  const total = Math.max(contentRangeTotal(res.headers?.get?.('content-range')) ?? rows.length, rows.length);
  const envLabel = env.ALERT_ENV === 'test' ? 'test' : 'prod';
  const origin = env.SITE_ORIGIN || ORIGINS[envLabel];
  if (d.daily) {
    // A slot is never reported again, so a capped (partial) result is a could-not-run, not a digest
    if (total > rows.length) throw new Error(`${domainKey} digest hit its query cap (${total} flags, ${rows.length} fetched); not sending a partial digest`);
    log(`[needs-review] ${domainKey}: ${total} flagged, created ${slot.start.toISOString()} to ${slot.end.toISOString()}`);
    if (total === 0) return { flagged: 0, due: false, posted: false };
    const posted = await postDiscord(buildAlert(domainKey, rows, { origin, now, total }), { webhookUrl: env.DISCORD_WEBHOOK_URL, fetchImpl, envLabel });
    return { flagged: total, due: true, posted };
  }
  const recent = rows.filter((r) => ageHours(r, now) <= hours).length;
  const reminderDay = isReminderDay(now);
  const due = recent > 0 || (total > 0 && reminderDay);
  log(`[needs-review] ${domainKey}: ${total} still flagged (${recent} from the last ${hours}h, ${total - recent} older; weekly reminder day: ${reminderDay ? 'yes' : 'no'})`);
  if (!due) return { flagged: total, due: false, posted: false };
  const alert = buildAlert(domainKey, rows, { origin, now, total, windowHours: hours });
  const posted = await postDiscord(alert, { webhookUrl: env.DISCORD_WEBHOOK_URL, fetchImpl, envLabel });
  return { flagged: total, due: true, posted };
}

/** CLI wrapper. Returns the exit code: 1 only when something needed saying and Discord could not be told. */
export async function runCli({ env = process.env, argv = process.argv.slice(2), fetchImpl = globalThis.fetch, log = out, logError = console.error } = {}) {
  const envLabel = env.ALERT_ENV === 'test' ? 'test' : 'prod';
  try {
    const r = await runNeedsReviewAlert({ env, argv, fetchImpl, log });
    log(`[needs-review] done: flagged=${r.flagged} due=${r.due} posted=${r.posted}`);
    if (r.due && !r.posted) {
      logError(`[needs-review] ${r.flagged} flagged but the Discord alert was NOT delivered`);
      return 1;
    }
    return 0;
  } catch (err) {
    logError(`[needs-review] could not run: ${err.message}`);
    const i = argv.indexOf('--domain');
    const told = await postDiscord({
      title: `Needs-review check could not run (${(i >= 0 && argv[i + 1]) || 'unknown domain'})`,
      description: `Flagged enrichments are not being reported until this is fixed.\n${String(err.message).slice(0, 300)}`,
      color: COLORS.error,
    }, { webhookUrl: env.DISCORD_WEBHOOK_URL, fetchImpl, envLabel });
    return told ? 0 : 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli().then((code) => process.exit(code));
}
