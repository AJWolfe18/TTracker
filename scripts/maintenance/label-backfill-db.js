// ADO-594 S3: the ONLY database door for the one-time action label backfill
// (docs/features/events-tracker/label-backfill-prompt.md). Same shape as
// scripts/fronts/front-agent-db.js: a cloud routine is allowed exactly
// Bash(node scripts/maintenance/label-backfill-db.js *), so the script can only do the
// backfill's designed job - read a page of unlabeled stories, record one page of labels.
//
// Usage (each call is its own Bash command, starting exactly with `node scripts/...`):
//   node scripts/maintenance/label-backfill-db.js candidates [--limit 1-50] [--out tmp/<name>.json] [--prod]
//   node scripts/maintenance/label-backfill-db.js record <file.json> [--dry-run] [--prod]
//
// `candidates` calls label_backfill_candidates (migration 125). With --out the rows go to a
// file under tmp/ and stdout gets a one-line summary (a page of 50 summaries is too big for
// one tool output). `record` writes one page through record_action_labels (migration 125),
// which writes only still-unlabeled stories and logs every row it did not write to
// pipeline_skips. The file is
//   {"run_id": "...", "labels": [{"id": 17240, "action_label": "did",
//     "action_actor": "administration", "uncertain": false}, ...]}   (1-50 labels)
// Every entry is checked before anything is sent: one bad entry refuses the whole file
// (exit 2, nothing written). The RPC checks again and is atomic.
//
// PROD guard: a SUPABASE_URL that points at PROD is refused unless --prod is passed, and
// --prod is refused unless the URL points at PROD. --dry-run makes `record` check the file
// and write nothing. Output: one JSON object on stdout; usage errors exit 2, a failed RPC
// call exits 1. Dependency-free on purpose: the cloud sandbox has no npm install step.
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROD_REF } from '../../lib/env-validation.js';

export const MAX_PAGE = 50;
export const LABELS = Object.freeze(['did', 'said', 'coverage']);
export const ACTORS = Object.freeze(['trump', 'administration', 'ally', 'other']);
const TIMEOUT_MS = 30_000;
const MAX_FILE_BYTES = 64 * 1024;
const ENTRY_KEYS = new Set(['id', 'action_label', 'action_actor', 'uncertain']);

const out = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

function fail(code, message) {
  out({ ok: false, error: message });
  process.exit(code);
}

// Argument and file checks throw this; the dispatcher turns it into exit 2.
export class UsageError extends Error {}
const usage = (message) => { throw new UsageError(message); };

// --- target: TEST by default, PROD only on purpose -------------------------------------

export function checkTarget(url, key, prodFlag) {
  if (typeof url !== 'string' || !url.startsWith('https://') || !key) {
    usage('SUPABASE_URL (https://) and SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  const isProd = url.includes(PROD_REF);
  if (isProd && !prodFlag) usage('SUPABASE_URL is PROD; pass --prod only after the TEST gold check passed');
  if (!isProd && prodFlag) usage('--prod was passed but SUPABASE_URL is not PROD');
  return { api: `${url.replace(/\/+$/, '')}/rest/v1`, key, isProd };
}

async function rest(target, path, body) {
  const headers = { apikey: target.key, Authorization: `Bearer ${target.key}`, 'Content-Type': 'application/json' };
  try {
    const res = await fetch(`${target.api}/${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body: keep text */ }
    return { status: res.status, json, text };
  } catch (err) {
    return { status: 0, json: null, text: String(err?.message || err) };
  }
}

// --- the label page: checked in full before anything is sent ---------------------------

export function validateLabelPage(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) usage('the file must be a JSON object {"run_id": ..., "labels": [...]}');
  const runId = doc.run_id;
  if (typeof runId !== 'string' || !/^[\w.:-]{1,80}$/.test(runId)) usage(`run_id must be 1-80 chars of [A-Za-z0-9_.:-], got "${runId}"`);
  const list = doc.labels;
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_PAGE) usage(`labels must be an array of 1-${MAX_PAGE} entries`);

  const seen = new Set();
  const labels = list.map((e, i) => {
    const bad = (msg) => usage(`labels[${i}]: ${msg}`);
    if (!e || typeof e !== 'object' || Array.isArray(e)) bad('each label must be an object');
    const extra = Object.keys(e).filter((k) => !ENTRY_KEYS.has(k));
    if (extra.length) bad(`unknown field(s) ${extra.join(', ')}; allowed: id, action_label, action_actor, uncertain`);
    if (!Number.isSafeInteger(e.id) || e.id < 1) bad(`id must be a positive integer, got ${JSON.stringify(e.id)}`);
    if (!LABELS.includes(e.action_label)) bad(`action_label must be one of ${LABELS.join(', ')}, got ${JSON.stringify(e.action_label)}`);
    if (!ACTORS.includes(e.action_actor)) bad(`action_actor must be one of ${ACTORS.join(', ')}, got ${JSON.stringify(e.action_actor)}`);
    if (e.uncertain !== undefined && typeof e.uncertain !== 'boolean') bad(`uncertain must be true or false, got ${JSON.stringify(e.uncertain)}`);
    if (seen.has(e.id)) bad(`story ${e.id} appears twice`);
    seen.add(e.id);
    return { id: e.id, action_label: e.action_label, action_actor: e.action_actor, uncertain: e.uncertain === true };
  });
  return { runId, labels };
}

export function readLabelFile(path) {
  // Relative or absolute, plain characters only, .json, never a parent-directory hop.
  if (typeof path !== 'string' || !/^[\w./-]{1,200}\.json$/.test(path) || path.split('/').includes('..')) {
    usage(`file must be a .json path of [A-Za-z0-9_./-] without "..", got "${path}"`);
  }
  let size;
  try { size = statSync(path).size; } catch { usage(`cannot read ${path}`); }
  if (size > MAX_FILE_BYTES) usage(`${path} is ${size} bytes; the limit is ${MAX_FILE_BYTES}`);
  let doc;
  try { doc = JSON.parse(readFileSync(path, 'utf8')); } catch (err) { usage(`${path} is not valid JSON: ${err.message}`); }
  return validateLabelPage(doc);
}

// --- arguments ---------------------------------------------------------------------------

export function parseArgs(args) {
  const opts = { prod: false, dryRun: false, limit: MAX_PAGE, out: null, positional: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--prod') opts.prod = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--limit' || a === '--out') {
      if (i + 1 >= args.length) usage(`${a} needs a value`);
      const v = args[++i];
      if (a === '--limit') {
        const n = Number(v);
        if (!/^\d+$/.test(v) || n < 1 || n > MAX_PAGE) usage(`limit must be 1-${MAX_PAGE}, got "${v}"`);
        opts.limit = n;
      } else {
        if (!/^tmp\/[\w.-]{1,100}\.json$/.test(v) || v.includes('..')) usage(`--out must be tmp/<name>.json, got "${v}"`);
        opts.out = v;
      }
    } else if (a.startsWith('--')) usage(`unknown flag "${a}"`);
    else opts.positional.push(a);
  }
  return opts;
}

const target = (opts) => checkTarget(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '', opts.prod);

// --- verbs -------------------------------------------------------------------------------

async function candidates(opts) {
  if (opts.positional.length) usage(`candidates takes no positional arguments, got "${opts.positional.join(' ')}"`);
  if (opts.dryRun) usage('--dry-run applies to record only (candidates only reads)');
  const t = target(opts);
  const r = await rest(t, 'rpc/label_backfill_candidates', { p_limit: opts.limit });
  if (r.status !== 200 || !Array.isArray(r.json)) fail(1, `label_backfill_candidates failed: HTTP ${r.status} ${r.text.slice(0, 300)}`);
  if (!opts.out) return process.stdout.write(`${JSON.stringify(r.json)}\n`);
  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, `${JSON.stringify(r.json, null, 1)}\n`);
  return out({
    ok: true,
    status: 'written',
    file: opts.out,
    rows: r.json.length,
    pool_size: r.json[0]?.pool_size ?? 0,
    target: t.isProd ? 'prod' : 'test',
  });
}

async function record(opts) {
  if (opts.positional.length !== 1) usage('record takes exactly one file path');
  const { runId, labels } = readLabelFile(opts.positional[0]);
  const t = target(opts);
  const uncertain = labels.filter((l) => l.uncertain).length;
  if (opts.dryRun) {
    return out({ ok: true, status: 'dry_run', sent: labels.length, uncertain, results: labels.map((l) => ({ story_id: l.id, outcome: 'dry_run' })) });
  }
  const r = await rest(t, 'rpc/record_action_labels', { p_run_id: runId, p_rows: labels });
  if (r.status !== 200 || !Array.isArray(r.json)) {
    fail(1, `record_action_labels failed, nothing written: HTTP ${r.status} ${r.text.slice(0, 300)}`);
  }
  const count = (o) => r.json.filter((x) => x.outcome === o).length;
  const skipped = r.json.filter((x) => x.outcome !== 'written');
  return out({
    ok: r.json.length === labels.length,
    status: 'recorded',
    target: t.isProd ? 'prod' : 'test',
    sent: labels.length,
    written: count('written'),
    already_labeled: count('already_labeled'),
    not_found: count('not_found'),
    uncertain,
    skipped: skipped.map((x) => ({ story_id: x.story_id, outcome: x.outcome })),
  });
}

const COMMANDS = { candidates, record };

async function main(argv) {
  const [verb, ...args] = argv;
  if (!Object.hasOwn(COMMANDS, verb)) fail(2, `unknown command "${verb}"; expected one of ${Object.keys(COMMANDS).join(', ')}`);
  try {
    await COMMANDS[verb](parseArgs(args));
  } catch (err) {
    if (err instanceof UsageError) fail(2, err.message);
    throw err;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
