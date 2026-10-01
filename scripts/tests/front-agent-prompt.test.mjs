// ADO-582: the front assignment agent prompt writes raw strings over PostgREST,
// so the contract between the prompt, the skip constants, and migration 116's
// RPC filter is text. These checks fail the smoke suite if any side drifts.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PIPELINES, REASONS } from '../lib/skip-reasons.js';

const prompt = readFileSync(new URL('../../docs/features/fronts-claude-agent/prompt-v1.md', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../migrations/116_front_agent_candidates.sql', import.meta.url), 'utf8');

// --- the prompt is whole: every top-level heading appears exactly once ----------
// (September 30, 2026: a scripted edit pasted the file's first 52 lines into Section 2;
// substring checks alone passed against the duplicated text.)
for (const heading of prompt.match(/^#{1,2} .+$/gm)) {
  assert.equal(prompt.split(/\r?\n/).filter((l) => l === heading).length, 1, `prompt heading must appear exactly once: ${heading}`);
}

// --- constants exist and are the strings the prompt and RPC use --------------
assert.equal(PIPELINES.FRONT_ASSIGNMENT, 'front_assignment');
assert.equal(REASONS.AGENT_DECLINED, 'agent_declined');

// --- the prompt uses the exact constant values (a typo re-queues stories daily)
for (const literal of [`pipeline: "${PIPELINES.FRONT_ASSIGNMENT}"`, `reason: "${REASONS.AGENT_DECLINED}"`, 'entity_type: "story"', 'front: $front']) {
  assert.ok(prompt.includes(literal), `prompt is missing the decline literal ${literal}`);
}
assert.ok(prompt.includes('"p_slug": "election-suppression"'), 'prompt must call the RPC with the election-suppression slug');
assert.ok(prompt.includes('rpc/front_agent_candidates'), 'prompt must read the pool through front_agent_candidates');
assert.ok(prompt.includes('rpc/refresh_tracker_derived'), 'prompt must refresh the main line after assigning');
assert.ok(prompt.includes('assigned_by: "agent"'), 'assignments must be assigned_by=agent');
assert.ok(!/event_id:\s*\d+/.test(prompt), 'prompt must never hardcode an event_id (TEST and PROD ids differ)');

// --- the migration's RPC filter matches the same strings -----------------------
assert.ok(migration.includes(`ps.pipeline    = '${PIPELINES.FRONT_ASSIGNMENT}'`), 'RPC must filter on the FRONT_ASSIGNMENT pipeline');
assert.ok(migration.includes(`ps.reason      = '${REASONS.AGENT_DECLINED}'`), 'RPC must filter on the AGENT_DECLINED reason');
assert.ok(migration.includes("ps.entity_type = 'story'"), 'RPC must filter on entity_type=story');
assert.ok(migration.includes("ps.metadata->>'front' = p_slug"), 'RPC must scope declines to the front');
assert.ok(migration.includes('ON public.story_event TO anon'), 'story_event anon grant must be column-level (note hidden)');
assert.ok(!/GRANT SELECT \([^)]*\bnote\b[^)]*\) ON public\.story_event/.test(migration), 'note must not be in the anon column grant');

// --- the agent pattern: seeded by migration 116, tightened September 30, 2026 -----
// The live value is DATA (events.agent_pattern), recorded in the maintenance file below;
// re-running 116 PART D would reset it to the broad seed.
assert.ok(/SET agent_pattern = '([^']+)'/.test(migration), 'migration must seed agent_pattern');
const maintenance = readFileSync(new URL('../maintenance/2026-09-30-ado-582-tighten-agent-pattern.sql', import.meta.url), 'utf8');
const m = maintenance.match(/new_pattern CONSTANT TEXT := '([^']+)'/);
assert.ok(m, 'maintenance file must carry the current agent_pattern');
assert.ok(maintenance.includes("se.note LIKE 'fronts-v1%'") && maintenance.includes('RAISE EXCEPTION'), 'the PROD update must refuse a pattern that drops an agent-assigned story');
const re = new RegExp(m[1].replace(/\\m/g, '\\b').replace(/\\M/g, '\\b'), 'i'); // \m \M are Postgres word bounds
for (const h of [
  // headline or summary text of stories the agent assigned (the RPC matches either column)
  "blocked Missouri Republicans' emergency bid to use a new gerrymandered congressional map", // TEST 17194 summary
  'Trump Administration Asks Supreme Court to Allow Voter-Screening Tool', // TEST 17185 headline
  'Trump doubles down on SAVE America Act after Supreme Court loss on mail voting', // TEST 17031 headline
  'Alaska allows ballots postmarked by Election Day to be counted for up to 10 days', // TEST 16897 summary
  "delivering another setback to the president's voting restrictions agenda", // TEST 17038 summary
  'Missouri court allows Trump-backed congressional map to take effect',
  'Indiana governor calls special session to redistrict',
  'County refuses to certify election results',
  'Texas county closes a third of its polling places before the midterms',
]) assert.ok(re.test(h), `agent_pattern should match candidate headline: ${h}`);
for (const h of [
  // generic election words dropped September 30, 2026 (mostly horse race and floor votes)
  'Poll: most Americans expect the midterms to be unfair',
  'Game on: November elections kick into high gear with control of Congress in the balance',
  'Talarico and Paxton tied in latest Texas Senate poll',
  'House GOP leaders cancel votes, start recess early after member rebellion',
  'Senate votes on defense bill',
  'EPA rolls back pollution rules',
  'Apollo mission anniversary',
]) assert.ok(!re.test(h), `agent_pattern should not match: ${h}`);

// --- October 1, 2026: all database access goes through front-agent-db.js --------
// The PROD routine's direct curl reads were denied by the cloud classifier; one exact
// allow rule in the committed settings is what lets the script run, so the prompt,
// the rule and the script must agree.
const script = readFileSync(new URL('../fronts/front-agent-db.js', import.meta.url), 'utf8');
const settings = JSON.parse(readFileSync(new URL('../../.claude/settings.json', import.meta.url), 'utf8'));
const RULE = 'Bash(node scripts/fronts/front-agent-db.js *)';
assert.ok(settings.permissions.allow.includes(RULE), `.claude/settings.json must allow exactly ${RULE}`);
assert.ok(!/curl\s+-s\s+-X\s+POST\s+"\$\{API\}/.test(prompt), 'prompt must not call PostgREST with curl');
for (const verb of ['candidates 25', 'assign ', 'decline ', 'refresh', 'notify ']) {
  assert.ok(prompt.includes(`node scripts/fronts/front-agent-db.js ${verb}`), `prompt must use the script's ${verb.trim()} command`);
}
assert.ok(script.includes("const FRONT_SLUG = 'election-suppression'"), 'script must be pinned to the election-suppression front');
assert.ok(script.includes('PIPELINES.FRONT_ASSIGNMENT') && script.includes('REASONS.AGENT_DECLINED'), 'script must write the skip constants, not literals');
assert.ok(script.includes("entity_type: 'story'") && script.includes('front: FRONT_SLUG'), 'decline rows must match the RPC filter');
assert.ok(script.includes("assigned_by: 'agent'"), 'script assignments must be assigned_by=agent');

// --- script behavior that needs no network: argument guards and dry-run ---------
const scriptPath = fileURLToPath(new URL('../fronts/front-agent-db.js', import.meta.url));
const run = (args, extraEnv = {}) => {
  const r = spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-key', DISCORD_WEBHOOK_URL: '', FRONTS_DRY_RUN: '', ...extraEnv },
  });
  return { code: r.status, json: JSON.parse(r.stdout.trim().split('\n').pop()) };
};
assert.equal(run(['drop-table']).code, 2, 'unknown verbs are refused');
assert.equal(run(['constructor']).code, 2, 'inherited object keys are not commands');
assert.equal(run(['__proto__']).code, 2, 'inherited object keys are not commands');
assert.equal(run(['candidates', '500']).code, 2, 'candidates limit is capped at 25');
assert.equal(run(['assign', '12abc', '0.9', 'x']).code, 2, 'story_id must be an integer');
assert.equal(run(['assign', '12', '0.65', 'x']).code, 2, 'assign below 0.70 is refused');
assert.equal(run(['assign', '12', '0.9', '']).code, 2, 'assign needs a rationale');
assert.equal(run(['decline', '12', '0.8', 'run;rm', 'false', 'x']).code, 2, 'run_id is restricted to safe characters');
assert.equal(run(['decline', '12', '0.8', 'run-1', 'maybe', 'x']).code, 2, 'uncertain must be true or false');
assert.equal(run(['assign', '12', '0.9', 'x'], { SUPABASE_URL: 'http://plain.example' }).code, 2, 'https is required');
for (const args of [['assign', '12', '0.9', 'why'], ['decline', '12', '0.8', 'run-1', 'true', 'why'], ['refresh']]) {
  const r = run(args, { FRONTS_DRY_RUN: 'true' });
  assert.equal(r.code, 0, `dry-run ${args[0]} exits 0`);
  assert.equal(r.json.status, 'dry_run', `dry-run ${args[0]} writes nothing`);
}
assert.equal(run(['notify', 'hello']).json.status, 'skipped', 'notify without a webhook is a no-op');

// --- September 30, 2026: `record <file>` writes one page of decisions per call ----------
// The prompt records each page with one call; the file is fully checked before any write.
assert.ok(prompt.includes('node scripts/fronts/front-agent-db.js record tmp/fronts-page-1.json'), 'prompt must record a page with the record command');
assert.ok(/tmp\/\s*$/m.test(readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8')), 'decision files go in tmp/, which must stay gitignored');
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
mkdirSync(join(repoRoot, 'tmp'), { recursive: true });
const page = (name, doc) => {
  const rel = `tmp/front-agent-test-${process.pid}-${name}.json`;
  writeFileSync(join(repoRoot, rel), typeof doc === 'string' ? doc : JSON.stringify(doc));
  return rel;
};
const runIn = (args, extraEnv = {}) => {
  const r = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-key', DISCORD_WEBHOOK_URL: '', FRONTS_DRY_RUN: '', ...extraEnv },
  });
  return { code: r.status, json: JSON.parse(r.stdout.trim().split('\n').pop()) };
};
const RUN = 'fronts-election-2026-09-30T00-00-00.000Z';
const ok = [
  { story_id: 101, decision: 'assign', confidence: 0.85, rationale: 'court let a mid-decade map stand' },
  { story_id: 102, decision: 'decline', confidence: 0.9, uncertain: false, rationale: 'horse race' },
  { story_id: 103, decision: 'decline', confidence: 0.6, uncertain: true, rationale: 'borderline: bill not yet passed' },
];
try {
  const dry = runIn(['record', page('ok', { run_id: RUN, decisions: ok })], { FRONTS_DRY_RUN: 'true' });
  assert.equal(dry.code, 0, 'a valid page records (dry-run)');
  assert.equal(dry.json.status, 'dry_run', 'dry-run record writes nothing');
  assert.equal(dry.json.judged, 3);
  assert.equal(dry.json.uncertain, 1, 'borderline declines are counted');
  assert.deepEqual(dry.json.results.map((r) => [r.story_id, r.decision, r.status]), [[101, 'assign', 'dry_run'], [102, 'decline', 'dry_run'], [103, 'decline', 'dry_run']]);

  const refused = (name, doc, why) => {
    const r = runIn(['record', page(name, doc)]);
    assert.equal(r.code, 2, `record refuses ${why}`);
    assert.equal(r.json.ok, false);
  };
  refused('low-assign', { run_id: RUN, decisions: [{ ...ok[0], confidence: 0.65 }] }, 'an assign below 0.70');
  refused('dupe', { run_id: RUN, decisions: [ok[1], ok[1]] }, 'a story listed twice');
  refused('verb', { run_id: RUN, decisions: [{ ...ok[1], decision: 'reassign' }] }, 'an unknown decision');
  refused('no-uncertain', { run_id: RUN, decisions: [{ ...ok[1], uncertain: undefined }] }, 'a decline without uncertain');
  refused('str-uncertain', { run_id: RUN, decisions: [{ ...ok[1], uncertain: 'false' }] }, 'uncertain as a string');
  refused('conf-3dp', { run_id: RUN, decisions: [{ ...ok[1], confidence: 0.855 }] }, 'three-decimal confidence');
  refused('id', { run_id: RUN, decisions: [{ ...ok[1], story_id: -4 }] }, 'a negative story_id');
  refused('no-rationale', { run_id: RUN, decisions: [{ ...ok[1], rationale: '  ' }] }, 'an empty rationale');
  refused('run-id', { run_id: 'run;rm', decisions: [ok[1]] }, 'an unsafe run_id');
  refused('empty', { run_id: RUN, decisions: [] }, 'an empty page');
  refused('big', { run_id: RUN, decisions: Array.from({ length: 26 }, (_, i) => ({ ...ok[1], story_id: 1000 + i })) }, 'more than 25 decisions');
  refused('array', [ok[1]], 'a bare array');
  refused('broken', '{"run_id": ', 'invalid JSON');
  // one bad entry refuses the whole file, even after good ones (nothing is written)
  const mixed = runIn(['record', page('mixed', { run_id: RUN, decisions: [ok[1], { ...ok[0], confidence: 0.5 }] })]);
  assert.equal(mixed.code, 2, 'a bad entry refuses the whole file');
  assert.match(mixed.json.error, /^decisions\[1\]:/, 'the error names the bad entry');

  assert.equal(runIn(['record', 'tmp/../package.json']).code, 2, 'parent-directory hops are refused');
  assert.equal(runIn(['record', 'package.json.txt']).code, 2, 'only .json files');
  assert.equal(runIn(['record', 'tmp/does-not-exist.json']).code, 2, 'a missing file is a usage error');
  assert.equal(runIn(['record', page('ok2', { run_id: RUN, decisions: ok })], { SUPABASE_URL: 'http://plain.example' }).code, 2, 'record needs https');
} finally {
  for (const f of readdirSync(join(repoRoot, 'tmp')).filter((n) => n.startsWith(`front-agent-test-${process.pid}-`))) rmSync(join(repoRoot, 'tmp', f));
}

console.log('front-agent-prompt: all checks passed');
