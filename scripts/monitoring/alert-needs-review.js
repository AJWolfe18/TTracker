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
 * Usage: node scripts/monitoring/alert-needs-review.js --domain scotus|eo|pardons
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

const DEFAULT_WINDOW_HOURS = 168;
const NEW_HOURS = 26;
const QUERY_LIMIT = 50;
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
  const isNew = (r) => ageHours(r, now) <= NEW_HOURS;
  const newCount = rows.filter(isNew).length;
  const recentCount = rows.filter((r) => ageHours(r, now) <= windowHours).length;
  const olderCount = total - recentCount; // rows are newest first, so unfetched rows are older
  const lines = rows.slice(0, 10).map((r) => {
    const why = d.reason(r);
    return `• ${isNew(r) ? 'NEW ' : ''}${d.name(r)}${why ? ` - ${String(why).replace(/[—–]/g, '-').slice(0, 160)}` : ''}`;
  });
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
  const url = env.SUPABASE_URL || env.SUPABASE_TEST_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_TEST_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  const hours = Number(env.ALERT_WINDOW_HOURS) > 0 ? Number(env.ALERT_WINDOW_HOURS) : DEFAULT_WINDOW_HOURS;
  const res = await fetchImpl(`${url.replace(/\/$/, '')}/rest/v1${DOMAINS[domainKey].path()}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' },
  });
  if (!res.ok) throw new Error(`query failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  const total = Math.max(contentRangeTotal(res.headers?.get?.('content-range')) ?? rows.length, rows.length);
  const recent = rows.filter((r) => ageHours(r, now) <= hours).length;
  const reminderDay = isReminderDay(now);
  const due = recent > 0 || (total > 0 && reminderDay);
  log(`[needs-review] ${domainKey}: ${total} still flagged (${recent} from the last ${hours}h, ${total - recent} older; weekly reminder day: ${reminderDay ? 'yes' : 'no'})`);
  if (!due) return { flagged: total, due: false, posted: false };
  const envLabel = env.ALERT_ENV === 'test' ? 'test' : 'prod';
  const alert = buildAlert(domainKey, rows, { origin: env.SITE_ORIGIN || ORIGINS[envLabel], now, total, windowHours: hours });
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
