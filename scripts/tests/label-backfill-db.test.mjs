// ADO-594 S3: the label backfill writer (scripts/maintenance/label-backfill-db.js), its routine
// prompt and migration 125 share text contracts (skip strings, commands, the PROD guard).
// No network: the CLI checks below all stop before a request is made.
// Run: node scripts/tests/label-backfill-db.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PIPELINES, REASONS } from '../lib/skip-reasons.js';
import { PROD_REF } from '../../lib/env-validation.js';
import { validateLabelPage, checkTarget, parseArgs, UsageError, MAX_PAGE } from '../maintenance/label-backfill-db.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const migration = read('../../migrations/125_label_backfill.sql');
const prompt = read('../../docs/features/events-tracker/label-backfill-prompt.md');
const script = read('../maintenance/label-backfill-db.js');
const gold = JSON.parse(read('./fixtures/action-label-gold.json')).stories;

const RUN = 'labels-2026-10-05T14-00-00Z';
const ok = [
  { id: 17240, action_label: 'did', action_actor: 'administration' },
  { id: 17216, action_label: 'said', action_actor: 'trump', uncertain: false },
  { id: 17248, action_label: 'coverage', action_actor: 'trump', uncertain: true },
];
const refuses = (doc, pattern, why) => assert.throws(() => validateLabelPage(doc), (e) => e instanceof UsageError && pattern.test(e.message), why);

// --- validateLabelPage --------------------------------------------------------------------
const page = validateLabelPage({ run_id: RUN, labels: ok });
assert.equal(page.runId, RUN);
assert.deepEqual(page.labels.map((l) => l.uncertain), [false, false, true], 'uncertain defaults to false');
assert.deepEqual(Object.keys(page.labels[0]), ['id', 'action_label', 'action_actor', 'uncertain'], 'only the four fields are sent');
assert.equal(validateLabelPage({ run_id: RUN, labels: Array.from({ length: MAX_PAGE }, (_, i) => ({ ...ok[0], id: 1 + i })) }).labels.length, 50, '50 labels is a full page');

refuses([ok[0]], /JSON object/, 'a bare array');
refuses(null, /JSON object/, 'null');
refuses({ run_id: 'run;rm', labels: ok }, /run_id/, 'an unsafe run_id');
refuses({ labels: ok }, /run_id/, 'a missing run_id');
refuses({ run_id: RUN, labels: [] }, /1-50/, 'an empty page');
refuses({ run_id: RUN, labels: Array.from({ length: 51 }, (_, i) => ({ ...ok[0], id: 1 + i })) }, /1-50/, '51 labels');
refuses({ run_id: RUN }, /1-50/, 'no labels array');
refuses({ run_id: RUN, labels: [ok[0], ok[0]] }, /^labels\[1\]: story 17240 appears twice/, 'a duplicate id');
refuses({ run_id: RUN, labels: [{ ...ok[0], id: '17240' }] }, /id must be a positive integer/, 'an id as a string');
refuses({ run_id: RUN, labels: [{ ...ok[0], id: 0 }] }, /id must be a positive integer/, 'id 0');
refuses({ run_id: RUN, labels: [{ ...ok[0], id: -3 }] }, /id must be a positive integer/, 'a negative id');
refuses({ run_id: RUN, labels: [{ ...ok[0], id: 3.5 }] }, /id must be a positive integer/, 'a fractional id');
refuses({ run_id: RUN, labels: [{ ...ok[0], action_label: 'analysis' }] }, /action_label must be one of did, said, coverage/, 'the public word Analysis');
refuses({ run_id: RUN, labels: [{ ...ok[0], action_label: 'Did' }] }, /action_label/, 'a capitalized label');
refuses({ run_id: RUN, labels: [{ ...ok[0], action_actor: 'congress' }] }, /action_actor must be one of/, 'an unknown actor');
refuses({ run_id: RUN, labels: [{ id: 1, action_label: 'did' }] }, /action_actor/, 'a missing actor');
refuses({ run_id: RUN, labels: [{ ...ok[0], uncertain: 'true' }] }, /uncertain must be true or false/, 'uncertain as a string');
refuses({ run_id: RUN, labels: [{ ...ok[0], label: 'did' }] }, /unknown field\(s\) label/, 'an unknown field (typo guard)');
refuses({ run_id: RUN, labels: [{ ...ok[0], action_label_source: 'human' }] }, /unknown field/, 'a source field (the writer always sends backfill)');
refuses({ run_id: RUN, labels: ['17240'] }, /must be an object/, 'a non-object entry');
refuses({ run_id: RUN, labels: [ok[1], { ...ok[0], action_actor: 'x' }] }, /^labels\[1\]:/, 'the error names the bad entry');

// --- checkTarget: TEST by default, PROD only with --prod ----------------------------------
const TEST_URL = 'https://wnrjrywpcadwutfykflu.supabase.co';
const PROD_URL = `https://${PROD_REF}.supabase.co`;
assert.equal(checkTarget(TEST_URL, 'k', false).isProd, false);
assert.equal(checkTarget(`${PROD_URL}/`, 'k', true).api, `${PROD_URL}/rest/v1`, 'PROD with --prod is allowed; trailing slash trimmed');
assert.throws(() => checkTarget(PROD_URL, 'k', false), /PROD; pass --prod/, 'PROD without --prod is refused');
assert.throws(() => checkTarget(TEST_URL, 'k', true), /not PROD/, '--prod against TEST is refused');
assert.throws(() => checkTarget('http://plain.example', 'k', false), /https/, 'https is required');
assert.throws(() => checkTarget(TEST_URL, '', false), /SERVICE_ROLE_KEY/, 'the key is required');

// --- parseArgs ----------------------------------------------------------------------------
assert.equal(parseArgs([]).limit, 50, 'pages default to 50');
assert.equal(parseArgs(['--limit', '7']).limit, 7);
for (const bad of [['--limit', '51'], ['--limit', '0'], ['--limit', '5x'], ['--limit'], ['--out', '../x.json'], ['--out', 'tmp/../x.json'],
  ['--out', 'page.json'], ['--out', 'tmp/sub/x.json'], ['--force']]) {
  assert.throws(() => parseArgs(bad), UsageError, `refuses ${bad.join(' ')}`);
}
assert.deepEqual(parseArgs(['tmp/a.json', '--dry-run', '--prod']), { prod: true, dryRun: true, limit: 50, out: null, positional: ['tmp/a.json'] });

// --- the CLI: every check below exits before any request -----------------------------------
const scriptPath = fileURLToPath(new URL('../maintenance/label-backfill-db.js', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const run = (args, extraEnv = {}) => {
  const r = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, SUPABASE_URL: TEST_URL, SUPABASE_SERVICE_ROLE_KEY: 'test-key', ...extraEnv },
  });
  return { code: r.status, json: JSON.parse(r.stdout.trim().split('\n').pop()) };
};
assert.equal(run(['drop-table']).code, 2, 'unknown verbs are refused');
assert.equal(run(['constructor']).code, 2, 'inherited object keys are not commands');
assert.equal(run(['candidates', '--limit', '500']).code, 2, 'candidates limit is capped at 50');
assert.equal(run(['candidates', '50']).code, 2, 'candidates takes --limit, not a positional');
assert.equal(run(['candidates', '--dry-run']).code, 2, 'dry-run is for record only');
assert.match(run(['candidates'], { SUPABASE_URL: PROD_URL }).json.error, /PROD/, 'candidates refuses PROD without --prod');
assert.equal(run(['record', 'tmp/x.json', 'tmp/y.json']).code, 2, 'record takes one file');

mkdirSync(join(repoRoot, 'tmp'), { recursive: true });
const file = (name, doc) => {
  const rel = `tmp/label-backfill-test-${process.pid}-${name}.json`;
  writeFileSync(join(repoRoot, rel), typeof doc === 'string' ? doc : JSON.stringify(doc));
  return rel;
};
try {
  const dry = run(['record', file('ok', { run_id: RUN, labels: ok }), '--dry-run']);
  assert.equal(dry.code, 0, 'a valid page passes (dry-run)');
  assert.equal(dry.json.status, 'dry_run', 'dry-run writes nothing');
  assert.equal(dry.json.sent, 3);
  assert.equal(dry.json.uncertain, 1);
  assert.deepEqual(dry.json.results.map((r) => r.story_id), [17240, 17216, 17248]);

  assert.equal(run(['record', file('prod', { run_id: RUN, labels: ok }), '--dry-run'], { SUPABASE_URL: PROD_URL }).code, 2, 'record refuses PROD without --prod, even in dry-run');
  assert.equal(run(['record', file('prod2', { run_id: RUN, labels: ok }), '--dry-run', '--prod'], { SUPABASE_URL: PROD_URL }).code, 0, 'PROD with --prod is allowed');
  const bad = run(['record', file('bad', { run_id: RUN, labels: [ok[0], { ...ok[1], action_label: 'maybe' }] })]);
  assert.equal(bad.code, 2, 'one bad entry refuses the whole file');
  assert.match(bad.json.error, /^labels\[1\]:/);
  assert.equal(run(['record', file('broken', '{"run_id": ')]).code, 2, 'invalid JSON is refused');
  assert.equal(run(['record', 'tmp/../package.json']).code, 2, 'parent-directory hops are refused');
  assert.equal(run(['record', 'package.json.txt']).code, 2, 'only .json files');
  assert.equal(run(['record', 'tmp/does-not-exist.json']).code, 2, 'a missing file is a usage error');
  assert.equal(run(['record', file('big', 'x'.repeat(70 * 1024))]).code, 2, 'files over 64 KB are refused');
} finally {
  for (const f of readdirSync(join(repoRoot, 'tmp')).filter((n) => n.startsWith(`label-backfill-test-${process.pid}-`))) rmSync(join(repoRoot, 'tmp', f));
}

// --- contracts: skip strings, script, prompt, gold set -------------------------------------
assert.equal(PIPELINES.LABEL_BACKFILL, 'label_backfill');
for (const reason of [REASONS.ALREADY_LABELED, REASONS.STORY_NOT_FOUND, REASONS.LABEL_UNCERTAIN]) {
  assert.ok(migration.includes(`VALUES ('${PIPELINES.LABEL_BACKFILL}', '${reason}'`), `migration 125 must write the ${reason} skip row`);
}
assert.ok(/WHERE s\.id = v_id\s+AND s\.action_label IS NULL/.test(migration), 'the write must only fill unlabeled stories');
assert.ok(migration.includes("action_label_source = 'backfill'"), 'backfill writes carry source backfill');
assert.ok(!/content|embedding/i.test(migration.slice(migration.indexOf('RETURNS TABLE'), migration.indexOf('COMMENT ON FUNCTION public.label_backfill_candidates'))),
  'the candidate RPC must never read content or embeddings');
assert.ok(!script.includes(PROD_REF), 'the PROD ref comes from lib/env-validation.js, not a literal (lint-prod-refs)');

const CMD = 'node scripts/maintenance/label-backfill-db.js';
assert.ok(prompt.includes(`${CMD} candidates --limit 50 --out tmp/labels-in-1.json`), 'prompt must read pages through the script');
assert.ok(prompt.includes(`${CMD} record tmp/labels-out-1.json`), 'prompt must record pages through the script');
assert.ok(prompt.includes('node scripts/maintenance/action-label-gold-check.js --db'), 'prompt must name the gold check');
assert.ok(prompt.includes('--prod'), 'prompt must explain the PROD flag');
assert.ok(!prompt.includes('set_story_action_label'), 'no agent prompt may name the human-label door (PRD 14.7)');
assert.ok(!/curl\s/.test(prompt), 'prompt must not call PostgREST with curl');
for (const heading of prompt.match(/^#{1,2} .+$/gm)) {
  assert.equal(prompt.split(/\r?\n/).filter((l) => l === heading).length, 1, `prompt heading must appear exactly once: ${heading}`);
}
for (let n = 1; n <= 12; n++) assert.ok(new RegExp(`^${n}\\. \\*\\*`, 'm').test(prompt), `prompt must carry edge case ${n}`);
const byId = new Map(gold.map((g) => [g.id, g]));
for (const id of [17240, 17216, 17248, 17233, 17231, 17246]) {
  const g = byId.get(id);
  assert.ok(g, `gold fixture has ${id}`);
  assert.ok(new RegExp(`\\| ${id} \\|[^\\n]*\\| ${g.action_label} \\| ${g.action_actor} \\|`).test(prompt), `prompt calibration row ${id} must match the gold label ${g.action_label}/${g.action_actor}`);
}

console.log('label-backfill-db: all checks passed');
