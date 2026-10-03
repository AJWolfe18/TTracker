#!/usr/bin/env node
/**
 * Daily Discord alert when RSS ingest is quietly losing text or feeds (ADO-597).
 *
 * On October 2, 2026 we found PROD had stored NO articles.content since at least January (PROD ran
 * the migration-005a upsert RPC; TEST had the fix), Votebeat had stored empty excerpts, and four
 * active feeds (CSM, Time, Reason, Politico Top) had produced zero PROD articles for 30 days. The
 * pipeline stayed green the whole time: every one of these fails silently. A July 1 handoff even
 * noticed the missing content and nobody followed up. This check asks PROD three questions a day:
 *
 *   content_missing  articles arrived in the last 24h, but none stored content
 *   empty_excerpt    articles from the last 24h with an empty excerpt (names the sources)
 *   silent_feeds     active feeds whose source has no article in FEED_SILENT_DAYS (default 7)
 *
 * One Discord message per run listing every problem; a healthy run posts nothing. Runs as a step
 * of the 6-hourly health check on main only (it reads PROD), but checks only on the scheduled run starting 12:00-17:59 UTC
 * (7 AM CT in summer) or a manual run, so a known problem is reported once a day, not four times.
 *
 * Egress: every read is bounded (limit) and selects only ids, timestamps or source names, never
 * content. Silent-feed check matches on source_name because PROD articles carry no feed_id.
 *
 * Usage: node scripts/monitoring/alert-ingest-health.js
 * Env:   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, DISCORD_WEBHOOK_URL (no URL = no message),
 *        FEED_SILENT_DAYS (optional), INGEST_HEALTH_FORCE=1 or GITHUB_EVENT_NAME=workflow_dispatch
 *        to check outside that window (push-triggered runs never check)
 *
 * Exit codes: 0 when the check ran or was skipped (each failed read is reported in the message).
 * 1 when it could not run at all; the workflow's follow-up step posts that to Discord.
 */

import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { postDiscord, COLORS } from '../lib/discord.js';

// The health check is scheduled every 6 hours (0, 6, 12, 18 UTC), so exactly one scheduled run
// starts in [12:00, 18:00) even when GitHub starts it late (an exact-hour match skipped the whole
// day whenever the 12:00 run slipped past 13:00).
export const CHECK_WINDOW_UTC = Object.freeze([12, 18]);
const DAY_MS = 24 * 3600000;

const out = (line) => process.stdout.write(`${line}\n`);

/**
 * Once a day: the scheduled run that starts in the 12:00-17:59 UTC window. Manual runs always check.
 * Push-triggered runs of the health workflow (scripts/rss/**, migrations/**) never do, or a push
 * inside the window would post the same problems twice.
 */
export function shouldCheck({ env = process.env, now = Date.now() } = {}) {
  if (env.INGEST_HEALTH_FORCE === '1' || env.GITHUB_EVENT_NAME === 'workflow_dispatch') return true;
  if (env.GITHUB_EVENT_NAME === 'push') return false;
  const h = new Date(now).getUTCHours();
  return h >= CHECK_WINDOW_UTC[0] && h < CHECK_WINDOW_UTC[1];
}

/**
 * @param {{recentArticles: boolean, recentWithContent: boolean, emptyExcerptSources: string[],
 *          silentSources: string[], silentDays: number, readErrors: string[]}} f
 * @returns {null | {title, description, color}} null when ingest is healthy
 */
export function buildIngestAlert(f) {
  const problems = [];
  if (f.recentArticles && !f.recentWithContent) {
    problems.push('**No article from the last 24 hours stored its text** (articles.content is empty on all of them). The Stories agent, embeddings and entity extraction only see the 500-character excerpt. Check upsert_article_and_enqueue_jobs on PROD (migration 121).');
  }
  if (f.emptyExcerptSources.length) {
    problems.push(`**Articles saved with no text at all** in the last 24 hours, from: ${f.emptyExcerptSources.join(', ')}. The feed probably puts its text in a field the parser does not read (pickItemText in scripts/rss/utils/primitive.js).`);
  }
  if (f.silentSources.length) {
    problems.push(`**Active feeds with no article in ${f.silentDays} days:** ${f.silentSources.join(', ')}. The feed may be dead, blocking us (403), or filtered out by filter_config. Check the RSS Tracker run logs.`);
  }
  for (const e of f.readErrors) problems.push(`Could not read: ${e}`);
  if (!problems.length) return null;
  return {
    title: 'RSS ingest health: problems found',
    description: problems.join('\n\n').slice(0, 3900),
    // amber when ingest needs a human; red when the check could not read at all
    color: problems.length === f.readErrors.length ? COLORS.error : COLORS.warning,
  };
}

export async function runIngestHealth({ env = process.env, fetchImpl = globalThis.fetch, log = out, now = Date.now() } = {}) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  if (!shouldCheck({ env, now })) {
    log(`[ingest-health] skipped (checks once a day: the scheduled run starting ${CHECK_WINDOW_UTC[0]}:00-${CHECK_WINDOW_UTC[1] - 1}:59 UTC, or a manual run)`);
    return { state: 'skipped', posted: false };
  }
  const base = `${url.replace(/\/$/, '')}/rest/v1`;
  const get = async (path) => {
    const res = await fetchImpl(`${base}${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error(`unexpected response: ${JSON.stringify(rows).slice(0, 200)}`);
    return rows;
  };
  const since24h = encodeURIComponent(new Date(now - DAY_MS).toISOString());
  const silentDays = Number(env.FEED_SILENT_DAYS) > 0 ? Number(env.FEED_SILENT_DAYS) : 7;
  const sinceSilent = encodeURIComponent(new Date(now - silentDays * DAY_MS).toISOString());
  const f = { recentArticles: false, recentWithContent: true, emptyExcerptSources: [], silentSources: [], silentDays, readErrors: [] };

  try {
    f.recentArticles = (await get(`/articles?select=id&created_at=gte.${since24h}&limit=1`)).length > 0;
    if (f.recentArticles) {
      f.recentWithContent = (await get(`/articles?select=id&created_at=gte.${since24h}&content=not.is.null&limit=1`)).length > 0;
    }
  } catch (err) { f.readErrors.push(`content check (${err.message})`); }

  try {
    const rows = await get(`/articles?select=source_name&created_at=gte.${since24h}&or=(excerpt.is.null,excerpt.eq.)&limit=200`);
    f.emptyExcerptSources = [...new Set(rows.map((r) => r.source_name || '(no source)'))].sort();
  } catch (err) { f.readErrors.push(`empty-excerpt check (${err.message})`); }

  let sources = [];
  try {
    const feeds = await get('/feed_registry?select=source_name&is_active=eq.true&limit=200');
    sources = [...new Set(feeds.map((r) => r.source_name).filter(Boolean))].sort();
  } catch (err) { f.readErrors.push(`silent-feed check, feed list (${err.message})`); }
  // One read per source, each in its own try: a failed read names that source and the rest still run.
  for (const s of sources) {
    try {
      const rows = await get(`/articles?select=id&source_name=eq.${encodeURIComponent(s)}&created_at=gte.${sinceSilent}&limit=1`);
      if (!rows.length) f.silentSources.push(s);
    } catch (err) { f.readErrors.push(`silent-feed check for ${s} (${err.message})`); }
  }

  const alert = buildIngestAlert(f);
  log(`[ingest-health] recent=${f.recentArticles} content=${f.recentWithContent} empty_excerpt=[${f.emptyExcerptSources.join(', ')}] silent=[${f.silentSources.join(', ')}] errors=${f.readErrors.length}`);
  const posted = alert ? await postDiscord(alert, { webhookUrl: env.DISCORD_WEBHOOK_URL, fetchImpl }) : false;
  return { state: alert ? 'problems' : 'healthy', posted, findings: f };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runIngestHealth()
    .then((r) => { out(`[ingest-health] done: ${r.state}`); process.exit(0); })
    .catch((err) => { console.error(`[ingest-health] could not run: ${err.message}`); process.exit(1); });
}
