#!/usr/bin/env node
/**
 * Discord alert for enrichment output that needs a human (ADO-577 AC 3).
 *
 * The cloud agents flag uncertain output (needs_manual_review / needs_review)
 * but only phone-notify on hard failures, so a flagged case could sit in the
 * DB unnoticed. This runs as the last step of each fetch workflow and posts
 * one Discord message per domain naming the flagged records and the reason.
 *
 * Window: every row that is STILL flagged and was enriched in the last ALERT_WINDOW_HOURS
 * (default 168h = 7 days). It is a reminder of the open review queue, not a one-shot event: a late
 * or skipped workflow run (GitHub delays, weekends for the weekday-only workflows) cannot lose a
 * flag, and the message stops by itself once the record is reviewed in admin. Rows enriched in
 * the last 26h are marked "new". Nothing flagged => no message.
 *
 * Usage: node scripts/monitoring/alert-needs-review.js --domain scotus|eo|pardons
 * Env:   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or the SUPABASE_TEST_* names),
 *        DISCORD_WEBHOOK_URL, ALERT_WINDOW_HOURS (optional),
 *        ALERT_ENV=test marks the message [TEST] and links the TEST site (set by the workflows)
 *
 * Never silent, never fails the ingest job:
 * - A check that cannot run (missing credentials, failed query, crash) posts its own "could not run"
 *   Discord message.
 * - Exit 1 only when Discord could not be told: the "could not run" message failed, or records are
 *   flagged and the alert could not be delivered. The workflow steps are continue-on-error, so that
 *   marks the step red without failing the job.
 */

import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { postDiscord, COLORS } from '../lib/discord.js';

const DEFAULT_WINDOW_HOURS = 168;
const NEW_HOURS = 26;
const ORIGINS = Object.freeze({ prod: 'https://trumpytracker.com', test: 'https://test--taupe-capybara-0ff2ed.netlify.app' });

export const DOMAINS = Object.freeze({
  scotus: {
    label: 'SCOTUS',
    path: (since) => `/scotus_cases?select=id,case_name_short,case_name,low_confidence_reason,enriched_at`
      + `&needs_manual_review=eq.true&manual_reviewed_at=is.null&enriched_at=gt.${encodeURIComponent(since)}&order=enriched_at.desc&limit=20`,
    name: (r) => r.case_name_short || r.case_name || `case ${r.id}`,
    reason: (r) => r.low_confidence_reason,
    adminTab: 'SCOTUS',
  },
  eo: {
    label: 'Executive orders',
    // The EO agent writes its reason to the LOG row (`notes`); a trigger only syncs the boolean onto
    // executive_orders. Embed the newest flagged log row to get the reason in the same bounded request.
    path: (since) => `/executive_orders?select=id,title,order_number,enriched_at,executive_orders_enrichment_log(notes,created_at)`
      + `&executive_orders_enrichment_log.needs_manual_review=eq.true&executive_orders_enrichment_log.order=created_at.desc&executive_orders_enrichment_log.limit=1`
      + `&needs_manual_review=eq.true&enriched_at=gt.${encodeURIComponent(since)}&order=enriched_at.desc&limit=20`,
    name: (r) => (r.order_number ? `EO ${r.order_number}` : `EO ${r.id}`) + (r.title ? `: ${String(r.title).slice(0, 60)}` : ''),
    reason: (r) => r.executive_orders_enrichment_log?.[0]?.notes || null,
    adminTab: 'Exec Orders',
  },
  pardons: {
    label: 'Pardons',
    path: (since) => `/pardons?select=id,recipient_name,enrichment_meta,enriched_at`
      + `&needs_review=eq.true&enriched_at=gt.${encodeURIComponent(since)}&order=enriched_at.desc&limit=20`,
    name: (r) => r.recipient_name || `pardon ${r.id}`,
    reason: (r) => r.enrichment_meta?.review_reason || null,
    adminTab: 'Pardons',
  },
});

export function buildAlert(domainKey, rows, { origin = ORIGINS.prod, now = Date.now() } = {}) {
  const d = DOMAINS[domainKey];
  if (!d) throw new Error(`unknown domain ${domainKey}`);
  if (!rows || rows.length === 0) return null;
  const isNew = (r) => r.enriched_at && now - new Date(r.enriched_at).getTime() <= NEW_HOURS * 3600000;
  const newCount = rows.filter(isNew).length;
  const lines = rows.slice(0, 10).map((r) => {
    const why = d.reason(r);
    return `• ${isNew(r) ? 'NEW ' : ''}${d.name(r)}${why ? ` - ${String(why).replace(/[—–]/g, '-').slice(0, 160)}` : ''}`;
  });
  if (rows.length > 10) lines.push(`… and ${rows.length - 10} more`);
  return {
    title: `${d.label}: ${rows.length} enrichment${rows.length === 1 ? '' : 's'} waiting for review (${newCount} new)`,
    description: `${lines.join('\n')}\n\nReview in ${origin}/admin.html (${d.adminTab} tab). This reminder stops once they are reviewed.`,
    color: COLORS.warning,
  };
}

// Workflow logs are this script's only output channel; stdout directly, no console.log in production code.
const out = (line) => process.stdout.write(`${line}\n`);

export async function runNeedsReviewAlert({ env = process.env, argv = process.argv.slice(2), fetchImpl = globalThis.fetch, log = out, now = Date.now() } = {}) {
  const i = argv.indexOf('--domain');
  const domainKey = i >= 0 ? argv[i + 1] : null;
  if (!domainKey || !DOMAINS[domainKey]) throw new Error(`--domain must be one of ${Object.keys(DOMAINS).join('|')}`);
  const url = env.SUPABASE_URL || env.SUPABASE_TEST_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_TEST_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  const hours = Number(env.ALERT_WINDOW_HOURS) > 0 ? Number(env.ALERT_WINDOW_HOURS) : DEFAULT_WINDOW_HOURS;
  const since = new Date(now - hours * 3600000).toISOString();
  const res = await fetchImpl(`${url.replace(/\/$/, '')}/rest/v1${DOMAINS[domainKey].path(since)}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`query failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  log(`[needs-review] ${domainKey}: ${rows.length} still flagged from the last ${hours}h`);
  const envLabel = env.ALERT_ENV === 'test' ? 'test' : 'prod';
  const alert = buildAlert(domainKey, rows, { origin: env.SITE_ORIGIN || ORIGINS[envLabel], now });
  if (!alert) return { flagged: 0, posted: false };
  const posted = await postDiscord(alert, { webhookUrl: env.DISCORD_WEBHOOK_URL, fetchImpl, envLabel });
  return { flagged: rows.length, posted };
}

/** CLI wrapper. Returns the exit code: 1 only when something needed saying and Discord could not be told. */
export async function runCli({ env = process.env, argv = process.argv.slice(2), fetchImpl = globalThis.fetch, log = out, logError = console.error } = {}) {
  const envLabel = env.ALERT_ENV === 'test' ? 'test' : 'prod';
  try {
    const r = await runNeedsReviewAlert({ env, argv, fetchImpl, log });
    log(`[needs-review] done: flagged=${r.flagged} posted=${r.posted}`);
    if (r.flagged > 0 && !r.posted) {
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
