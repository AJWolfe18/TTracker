#!/usr/bin/env node
/**
 * Discord alert for enrichment output that needs a human (ADO-577 AC 3).
 *
 * The cloud agents flag uncertain output (needs_manual_review / needs_review)
 * but only phone-notify on hard failures, so a flagged case could sit in the
 * DB unnoticed. This runs as the last step of each fetch workflow and posts
 * one Discord message per domain naming the flagged records and the reason.
 *
 * Window: rows enriched in the last WINDOW_HOURS (default 26h, the workflows
 * run daily) and not yet manually reviewed. Nothing flagged => no message.
 *
 * Usage: node scripts/monitoring/alert-needs-review.js --domain scotus|eo|pardons
 * Env:   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or the SUPABASE_TEST_* names),
 *        DISCORD_WEBHOOK_URL (no URL = no message), ALERT_WINDOW_HOURS (optional)
 *
 * NEVER fails the caller: any error logs one line and exits 0.
 */

import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { postDiscord, COLORS } from '../lib/discord.js';

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
    path: (since) => `/executive_orders?select=id,title,order_number,enrichment_meta,enriched_at`
      + `&needs_manual_review=eq.true&enriched_at=gt.${encodeURIComponent(since)}&order=enriched_at.desc&limit=20`,
    name: (r) => (r.order_number ? `EO ${r.order_number}` : `EO ${r.id}`) + (r.title ? `: ${String(r.title).slice(0, 60)}` : ''),
    reason: (r) => r.enrichment_meta?.review_reason || r.enrichment_meta?.low_confidence_reason || null,
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

export function buildAlert(domainKey, rows, { origin = 'https://trumpytracker.com' } = {}) {
  const d = DOMAINS[domainKey];
  if (!d) throw new Error(`unknown domain ${domainKey}`);
  if (!rows || rows.length === 0) return null;
  const lines = rows.slice(0, 10).map((r) => {
    const why = d.reason(r);
    return `• ${d.name(r)}${why ? ` - ${String(why).replace(/[—–]/g, '-').slice(0, 160)}` : ''}`;
  });
  if (rows.length > 10) lines.push(`… and ${rows.length - 10} more`);
  return {
    title: `${d.label}: ${rows.length} enrichment${rows.length === 1 ? '' : 's'} flagged for review`,
    description: `${lines.join('\n')}\n\nReview in ${origin}/admin.html (${d.adminTab} tab).`,
    color: COLORS.warning,
  };
}

export async function runNeedsReviewAlert({ env = process.env, argv = process.argv.slice(2), fetchImpl = globalThis.fetch, log = console.log } = {}) {
  const i = argv.indexOf('--domain');
  const domainKey = i >= 0 ? argv[i + 1] : null;
  if (!domainKey || !DOMAINS[domainKey]) throw new Error(`--domain must be one of ${Object.keys(DOMAINS).join('|')}`);
  const url = env.SUPABASE_URL || env.SUPABASE_TEST_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_TEST_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  const hours = Number(env.ALERT_WINDOW_HOURS) > 0 ? Number(env.ALERT_WINDOW_HOURS) : 26;
  const since = new Date(Date.now() - hours * 3600000).toISOString();
  const res = await fetchImpl(`${url.replace(/\/$/, '')}/rest/v1${DOMAINS[domainKey].path(since)}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`query failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  log(`[needs-review] ${domainKey}: ${rows.length} flagged in the last ${hours}h`);
  const alert = buildAlert(domainKey, rows, { origin: env.SITE_ORIGIN });
  if (!alert) return { flagged: 0, posted: false };
  const posted = await postDiscord(alert, { webhookUrl: env.DISCORD_WEBHOOK_URL, fetchImpl });
  return { flagged: rows.length, posted };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runNeedsReviewAlert()
    .then((r) => { console.log(`[needs-review] done: flagged=${r.flagged} posted=${r.posted}`); process.exit(0); })
    .catch((err) => { console.error(`[needs-review] skipped: ${err.message}`); process.exit(0); });
}
