#!/usr/bin/env node
/**
 * Social draft queue (ADO-572).
 *
 * Turns every NEW alarm-5 main-line story, alarm-5 executive order and
 * corruption-5 pardon into one `social_posts` row (platform facebook,
 * status draft) with templated copy - no AI call, $0 - then pings Discord
 * so Josh knows drafts are waiting in the admin Social tab. The poster
 * (ADO-573) publishes rows once he approves them.
 *
 * Idempotent by construction: UNIQUE (platform, entity_type, entity_id)
 * turns a repeat into a 23505, which is recorded to pipeline_skips as
 * social_draft/already_drafted and skipped. Per-type watermarks in
 * social_state (draft_watermark_<type>) keep each run to rows updated since
 * the previous run.
 *
 * Usage:
 *   node scripts/social/draft-posts.js                # live: insert drafts, advance watermarks, ping Discord
 *   node scripts/social/draft-posts.js --dry-run      # print copy, write nothing
 *   node scripts/social/draft-posts.js --since <iso>  # override every watermark (backfill / testing)
 *
 * Env:
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or the SUPABASE_TEST_* names)
 *   SITE_ORIGIN                  public site for links + card images (default https://trumpytracker.com)
 *   SOCIAL_AUTO_APPROVE_ALARM5   'true' = rows are created approved (PRD D8 switch; default off)
 *   DISCORD_WEBHOOK_URL          optional; no URL = no ping
 */

import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { candidateQuery, normalizeCandidate, watermarkKey, TYPES } from './lib/select-candidates.mjs';
import { buildCopy, postUrl, imageUrl } from './lib/copy.mjs';
import { recordSkip, PIPELINES, REASONS } from '../lib/skip-reasons.js';
import { postDiscord, COLORS } from '../lib/discord.js';

const PLATFORM = 'facebook';
const EPOCH = '1970-01-01T00:00:00Z';

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const i = argv.indexOf('--since');
  const since = i >= 0 ? argv[i + 1] : null;
  if (i >= 0 && (!since || Number.isNaN(Date.parse(since)))) throw new Error('--since needs an ISO timestamp');
  return { dryRun, since };
}

/** Minimal PostgREST client over fetch (service role). */
function makeRest(url, key, fetchImpl) {
  const base = `${url.replace(/\/$/, '')}/rest/v1`;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  return {
    async get(path) {
      const res = await fetchImpl(`${base}${path}`, { headers });
      if (!res.ok) throw new Error(`GET ${path.split('?')[0]} -> ${res.status} ${await res.text()}`);
      return res.json();
    },
    /** @returns {{ok:true}|{ok:false,code:string,message:string}} */
    async insert(table, row) {
      const res = await fetchImpl(`${base}/${table}`, { method: 'POST', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(row) });
      if (res.ok) return { ok: true };
      let body = {};
      try { body = await res.json(); } catch { /* non-JSON error body */ }
      return { ok: false, code: body.code || String(res.status), message: body.message || res.statusText };
    },
    async upsert(table, row) {
      const res = await fetchImpl(`${base}/${table}`, { method: 'POST', headers: { ...headers, Prefer: 'return=minimal,resolution=merge-duplicates' }, body: JSON.stringify(row) });
      if (!res.ok) throw new Error(`UPSERT ${table} -> ${res.status} ${await res.text()}`);
    },
  };
}

/**
 * Core run. Everything injectable so the test drives it with a fake fetch.
 * @returns {Promise<{created:number, skipped:number, drafts:Array<object>, watermarks:Record<string,string>}>}
 */
export async function runDraftPosts({
  env = process.env,
  argv = process.argv.slice(2),
  fetchImpl = globalThis.fetch,
  supabase = null,          // only used for recordSkip; built from env when null
  log = console.log,
} = {}) {
  const { dryRun, since: sinceOverride } = parseArgs(argv);
  const url = env.SUPABASE_URL || env.SUPABASE_TEST_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_TEST_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  const origin = (env.SITE_ORIGIN || 'https://trumpytracker.com').replace(/\/$/, '');
  const autoApprove = env.SOCIAL_AUTO_APPROVE_ALARM5 === 'true';
  const rest = makeRest(url, key, fetchImpl);
  const sb = supabase ?? createClient(url, key, { auth: { persistSession: false } });

  // Watermarks (one GET). Missing key => epoch, which only happens before migration 114 seeds them.
  // A --since dry run skips the read so it works before the migration is applied.
  const stateRows = (sinceOverride && dryRun) ? [] : await rest.get(`/social_state?select=key,value&key=like.draft_watermark_*`);
  const stored = Object.fromEntries((stateRows || []).map((r) => [r.key, r.value]));

  const result = { created: 0, skipped: 0, drafts: [], watermarks: {} };

  for (const type of TYPES) {
    const since = sinceOverride || stored[watermarkKey(type)] || EPOCH;
    let newest = null;   // newest ts actually SEEN this run (never the since floor)
    const rows = await rest.get(candidateQuery(type, since));
    log(`[social] ${type}: ${rows.length} candidate${rows.length === 1 ? '' : 's'} since ${since}`);

    for (const raw of rows) {
      const c = normalizeCandidate(type, raw);
      if (c.ts && (!newest || c.ts > newest)) newest = c.ts;
      const link = postUrl(origin, type, c.id);
      const row = {
        platform: PLATFORM,
        entity_type: type,
        entity_id: String(c.id),
        status: autoApprove ? 'approved' : 'draft',
        copy: buildCopy({ headline: c.headline || '', spicy: c.spicy || '', alarm: c.alarm, sources: c.sources, url: link }),
        link_url: link,
        image_url: imageUrl(origin, type, c.id),
        approved_at: autoApprove ? new Date().toISOString() : null,
      };
      result.drafts.push(row);
      if (dryRun) {
        log(`\n--- ${type} ${c.id} (${row.status}) ---\n${row.copy}`);
        continue;
      }
      const ins = await rest.insert('social_posts', row);
      if (ins.ok) { result.created++; continue; }
      if (ins.code === '23505') {
        result.skipped++;
        await recordSkip(sb, { pipeline: PIPELINES.SOCIAL_DRAFT, reason: REASONS.ALREADY_DRAFTED, entity_type: type, entity_id: String(c.id), metadata: { platform: PLATFORM } });
        continue;
      }
      throw new Error(`insert social_posts ${type}/${c.id} failed: ${ins.code} ${ins.message}`);
    }

    // Watermark only moves FORWARD: a --since backfill must not drag it back to the override.
    const stored_wm = stored[watermarkKey(type)] || EPOCH;
    const advance = !!newest && newest > stored_wm;
    result.watermarks[type] = advance ? newest : stored_wm;
    if (!dryRun && advance) {
      await rest.upsert('social_state', { key: watermarkKey(type), value: newest, updated_at: new Date().toISOString() });
    }
  }

  log(`[social] drafts created: ${result.created}, already drafted: ${result.skipped}${dryRun ? ' (dry run, nothing written)' : ''}`);

  if (!dryRun && result.created > 0) {
    const n = result.created;
    await postDiscord({
      title: `${n} social draft${n === 1 ? '' : 's'} waiting for approval`,
      description: `${autoApprove ? 'Created as approved (auto-approve on).' : 'Approve or reject in the admin Social tab.'}\n${origin}/admin.html (Social tab)`,
      color: COLORS.warning,
      fields: result.drafts.slice(0, 5).map((d) => ({ name: `${d.entity_type} ${d.entity_id}`, value: d.copy.split('\n')[0].slice(0, 200) })),
    }, { webhookUrl: env.DISCORD_WEBHOOK_URL, fetchImpl });
  }

  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runDraftPosts()
    .then(() => process.exit(0))
    .catch((err) => { console.error(`[social] FAILED: ${err.message}`); process.exit(1); });
}
