// ADO-582 / ADO-592: the front assignment agent prompt drives a script that writes raw strings over
// PostgREST, so the contract between the prompt, the skip constants, the script and migrations
// 116 / 127 is text. These checks fail the smoke suite if any side drifts.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PIPELINES, REASONS } from '../lib/skip-reasons.js';

const prompt = readFileSync(new URL('../../docs/features/fronts-claude-agent/prompt-v1.md', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../migrations/116_front_agent_candidates.sql', import.meta.url), 'utf8');
const m127 = readFileSync(new URL('../../migrations/127_all_fronts_agent.sql', import.meta.url), 'utf8');

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
for (const literal of [`pipeline: "${PIPELINES.FRONT_ASSIGNMENT}"`, `reason: "${REASONS.AGENT_DECLINED}"`, 'entity_type: "story"', 'front: "none"', 'metadata.front: "none"']) {
  assert.ok(prompt.includes(literal), `prompt is missing the decline literal ${literal}`);
}
assert.ok(prompt.includes('rpc/front_agent_candidates_all'), 'prompt must read the pool through front_agent_candidates_all');
assert.ok(!prompt.includes('"p_slug"'), 'the all-fronts prompt must not pin the pool to one front');
assert.ok(prompt.includes('rpc/refresh_tracker_derived'), 'prompt must refresh the main line after assigning');
assert.ok(prompt.includes('assigned_by: "agent"'), 'assignments must be assigned_by=agent');
assert.ok(!/event_id:\s*\d+/.test(prompt), 'prompt must never hardcode an event_id (TEST and PROD ids differ)');
// ADO-594 S7 (PRD 14.6): coverage never reaches the agent; labels are hints next to headline and summary
assert.ok(prompt.includes('`coverage`') && /action_label/.test(prompt) && /action_actor/.test(prompt), 'prompt must explain the coverage filter and the label hints');
assert.ok(/hints, not gates/i.test(prompt), 'prompt must treat the labels as hints, not gates');
assert.ok(/lowest `sweep_priority`|lower `sweep_priority`/.test(prompt), 'prompt must state the sweep-priority tie-break');
// the per-front rubric is data now; the prompt must not carry a front's rubric of its own
assert.ok(!prompt.includes('Missouri court allows Trump-backed congressional districts'), 'the election calibration table lives in events.agent_definition, not the prompt');

// --- migration 116's RPC filter matches the same strings (it stays for the deploy window) ---
assert.ok(migration.includes(`ps.pipeline    = '${PIPELINES.FRONT_ASSIGNMENT}'`), 'RPC must filter on the FRONT_ASSIGNMENT pipeline');
assert.ok(migration.includes(`ps.reason      = '${REASONS.AGENT_DECLINED}'`), 'RPC must filter on the AGENT_DECLINED reason');
assert.ok(migration.includes("ps.entity_type = 'story'"), 'RPC must filter on entity_type=story');
assert.ok(migration.includes("ps.metadata->>'front' = p_slug"), 'RPC must scope declines to the front');
assert.ok(migration.includes('ON public.story_event TO anon'), 'story_event anon grant must be column-level (note hidden)');
assert.ok(!/GRANT SELECT \([^)]*\bnote\b[^)]*\) ON public\.story_event/.test(migration), 'note must not be in the anon column grant');

// --- migration 127 (ADO-592): the all-fronts RPC filters on the same strings ---------------
for (const lit of [`ps.pipeline    = '${PIPELINES.FRONT_ASSIGNMENT}'`, `ps.reason      = '${REASONS.AGENT_DECLINED}'`, "ps.entity_type = 'story'"]) {
  assert.ok(m127.includes(lit), `127 must filter declines on ${lit}`);
}
assert.ok(m127.includes("ps.metadata->>'front' = 'none'") && m127.includes("ps.metadata->'judged_fronts' ? f.front_slug"), '127: a fits-no-front decline hides the story from the fronts its run judged');
assert.ok(m127.includes("ps.metadata->>'front' = f.front_slug"), '127: an old per-front decline hides the story from that front only');
assert.ok(m127.includes("st.action_label IS DISTINCT FROM 'coverage'"), '127: coverage out, unlabeled in (fail open)');
assert.ok(m127.includes("e.publish_state = 'published'") && m127.includes('e.agent_pattern IS NOT NULL') && m127.includes("NULLIF(btrim(e.agent_definition), '') IS NOT NULL"), '127: agent fronts = published + pattern + definition');
assert.ok(m127.includes('GRANT EXECUTE ON FUNCTION public.front_agent_candidates_all(INTEGER) TO service_role') && m127.includes('FROM PUBLIC, anon, authenticated'), '127: service_role only');
assert.ok(m127.includes('AND agent_definition IS NULL'), '127: the election seed never overwrites an edited definition');
assert.ok(!/CREATE OR REPLACE FUNCTION public\.front_agent_candidates\(/.test(m127), '127 must leave the election-only RPC alone (PROD runs it until the new prompt is on main)');

// --- the election definition seed is fronts-v1 Section 4, carried over unchanged ------------
const seed = m127.slice(m127.indexOf('$def$') + 5, m127.indexOf('$def$', m127.indexOf('$def$') + 5)).replace(/\r\n/g, '\n');
for (const line of [
  'The front is "**fronts they are screwing us on**"',
  '4. **How districts are drawn**',
  '| Missouri court allows Trump-backed congressional districts to take effect | **assign** 0.90 |',
  '| Senate Democrats vow to fight the SAVE Act in committee | **decline** 0.60, borderline |',
  '| City council vote on downtown zoning ballot measure | **decline** 0.95 | Election word is incidental |',
  '**Alarm level is not part of the decision.**',
]) assert.ok(seed.includes(line), `election seed must keep the fronts-v1 rubric line: ${line}`);
assert.equal(seed.split('\n| ').length - 1, 15, 'election seed keeps the 14 calibration rows (plus the header)');

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
for (const verb of ['fronts', 'candidates 25', 'record tmp/fronts-page-1.json', 'assign ', 'decline ', 'refresh', 'notify ']) {
  assert.ok(prompt.includes(`node scripts/fronts/front-agent-db.js ${verb}`), `prompt must use the script's ${verb.split(' ')[0]} command`);
}
// every command line in a prompt code block starts with the allowed prefix (the rule matches nothing else)
const fenced = [...prompt.matchAll(/```bash\r?\n([\s\S]*?)```/g)].flatMap((b) => b[1].split(/\r?\n/));
for (const line of fenced.filter((l) => /front-agent-db/.test(l))) {
  assert.ok(line.startsWith('node scripts/fronts/front-agent-db.js '), `script call must start with the allowed prefix: ${line}`);
  assert.ok(!/[;&|`]|\$\(/.test(line.replace(/"[^"]*"/g, '""')), `script call must be a single command: ${line}`);
}
assert.ok(!/FRONT_SLUG|p_slug/.test(script), 'the script must not be pinned to one front');
assert.ok(script.includes('publish_state=eq.published&agent_pattern=not.is.null&agent_definition=not.is.null'), 'the script reaches only agent fronts (published, pattern, definition)');
assert.ok(script.includes("const NO_FRONT = 'none'"), 'declines are written as fitting no front');
assert.ok(script.includes('PIPELINES.FRONT_ASSIGNMENT') && script.includes('REASONS.AGENT_DECLINED'), 'script must write the skip constants, not literals');
assert.ok(script.includes("entity_type: 'story'"), 'decline rows must match the RPC filter');
assert.ok(script.includes("assigned_by: 'agent'"), 'script assignments must be assigned_by=agent');
assert.ok(script.includes("rest('rpc/front_agent_candidates_all'"), 'script must read the all-fronts pool');

// --- script behavior against a fake PostgREST (no network): guards, dry-run, writes ---------
const scriptPath = fileURLToPath(new URL('../fronts/front-agent-db.js', import.meta.url));
const mockUrl = new URL('./fixtures/front-agent-fetch-mock.mjs', import.meta.url).href;
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
mkdirSync(join(repoRoot, 'tmp'), { recursive: true });
const logPath = join(repoRoot, 'tmp', `front-agent-test-${process.pid}-requests.jsonl`);
const requests = () => {
  try { return readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
};
const run = (args, extraEnv = {}) => {
  rmSync(logPath, { force: true });
  const r = spawnSync(process.execPath, ['--import', mockUrl, scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-key', DISCORD_WEBHOOK_URL: '', FRONTS_DRY_RUN: '', FRONT_AGENT_MOCK_LOG: logPath, FRONT_AGENT_MOCK_EVENTS: '', ...extraEnv },
  });
  return { code: r.status, json: JSON.parse(r.stdout.trim().split('\n').pop()), requests: requests() };
};
const writes = (reqs) => reqs.filter((q) => q.method !== 'GET' && !q.path.startsWith('rpc/'));

try {
  assert.equal(run(['drop-table']).code, 2, 'unknown verbs are refused');
  assert.equal(run(['constructor']).code, 2, 'inherited object keys are not commands');
  assert.equal(run(['__proto__']).code, 2, 'inherited object keys are not commands');
  assert.equal(run(['candidates', '500']).code, 2, 'candidates limit is capped at 25');
  assert.equal(run(['assign', '12abc', 'ice-deportations', '0.9', 'x']).code, 2, 'story_id must be an integer');
  assert.equal(run(['assign', '12', 'ice-deportations', '0.65', 'x']).code, 2, 'assign below 0.70 is refused');
  assert.equal(run(['assign', '12', 'ice-deportations', '0.9', '']).code, 2, 'assign needs a rationale');
  assert.equal(run(['assign', '12', '0.9', 'x']).code, 2, 'assign needs a front (old 3-argument form is refused)');
  assert.equal(run(['assign', '12', 'ICE;rm', '0.9', 'x']).code, 2, 'front must look like a slug');
  assert.equal(run(['assign', '12', 'none', '0.9', 'x']).code, 2, '"none" is not a front');
  let r = run(['assign', '12', 'the-courts', '0.9', 'x']);
  assert.equal(r.code, 2, 'assign to a front outside the agent fronts is refused');
  assert.equal(writes(r.requests).length, 0, 'a refused assign writes nothing');
  r = run(['assign', '12', 'rfk-hhs', '0.9', 'x']);
  assert.equal(r.code, 2, 'a front with a blank definition is not an agent front');
  assert.equal(run(['decline', '12', '0.8', 'run;rm', 'false', 'x']).code, 2, 'run_id is restricted to safe characters');
  assert.equal(run(['decline', '12', '0.8', 'run-1', 'maybe', 'x']).code, 2, 'uncertain must be true or false');
  assert.equal(run(['assign', '12', 'ice-deportations', '0.9', 'x'], { SUPABASE_URL: 'http://plain.example' }).code, 2, 'https is required');
  for (const args of [['assign', '12', 'ice-deportations', '0.9', 'why'], ['decline', '12', '0.8', 'run-1', 'true', 'why'], ['refresh']]) {
    r = run(args, { FRONTS_DRY_RUN: 'true' });
    assert.equal(r.code, 0, `dry-run ${args[0]} exits 0`);
    assert.equal(r.json.status, 'dry_run', `dry-run ${args[0]} writes nothing`);
    assert.equal(writes(r.requests).length, 0, `dry-run ${args[0]} sends no write`);
  }
  assert.equal(run(['notify', 'hello']).json.status, 'skipped', 'notify without a webhook is a no-op');

  // fronts: the agent fronts with their definitions, blank definitions dropped
  r = run(['fronts']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.fronts.map((f) => f.slug), ['election-suppression', 'ice-deportations'], 'fronts lists agent fronts only');
  assert.equal(r.json.fronts[1].definition, 'ICE definition', 'fronts prints each definition');
  assert.match(r.requests[0].query, /publish_state=eq\.published&agent_pattern=not\.is\.null&agent_definition=not\.is\.null/, 'fronts reads only published fronts with a pattern and a definition');
  assert.doesNotMatch(r.requests[0].query, /select=[^&]*agent_pattern/, 'fronts does not fetch the patterns');
  assert.equal(run(['fronts'], { FRONT_AGENT_MOCK_EVENTS: 'fail' }).code, 1, 'a failed fronts read exits 1');

  // candidates: the all-fronts RPC with only a limit
  r = run(['candidates', '25']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.requests.map((q) => [q.path, q.body]), [['rpc/front_agent_candidates_all', { p_limit: 25 }]], 'candidates calls the all-fronts RPC with p_limit only');

  // live single-story writes
  r = run(['assign', '12', 'ice-deportations', '0.9', 'ICE raided a plant']);
  assert.equal(r.json.status, 'assigned');
  let se = writes(r.requests).find((q) => q.path === 'story_event');
  assert.deepEqual(se.body, { story_id: 12, event_id: 18, assigned_by: 'agent', confidence: 0.9, note: 'fronts-v2: ice-deportations: ICE raided a plant' }, 'assign writes the looked-up event_id and a note naming the front');
  r = run(['decline', '12', '0.8', 'run-1', 'false', 'fits nothing']);
  assert.equal(r.json.status, 'declined');
  const skip = writes(r.requests).find((q) => q.path === 'pipeline_skips');
  assert.equal(skip.body.pipeline, PIPELINES.FRONT_ASSIGNMENT);
  assert.equal(skip.body.reason, REASONS.AGENT_DECLINED);
  assert.equal(skip.body.entity_type, 'story');
  assert.equal(skip.body.entity_id, '12');
  assert.equal(skip.body.metadata.front, 'none', 'a decline is "fits no front"');
  assert.equal(skip.body.metadata.prompt_version, 'fronts-v2');
  assert.deepEqual(skip.body.metadata.judged_fronts, ['election-suppression', 'ice-deportations'], 'a decline records the agent fronts it was judged against');
  r = run(['assign', '999', 'election-suppression', '0.9', 'x']);
  assert.equal(r.json.status, 'already_assigned', 'a unique violation is already_assigned');
  r = run(['assign', '998', 'election-suppression', '0.9', 'x']);
  assert.equal(r.json.status, 'error');
  assert.equal(r.json.skip_row_written, true, 'a failed assign leaves an api_error row');
  const err = writes(r.requests).find((q) => q.path === 'pipeline_skips');
  assert.equal(err.body.reason, REASONS.API_ERROR);
  assert.equal(err.body.metadata.front, 'election-suppression', 'the api_error row names the front');
  r = run(['assign', '12', 'ice-deportations', '0.9', 'x'], { FRONT_AGENT_MOCK_EVENTS: 'fail' });
  assert.equal(r.code, 1, 'a failed fronts lookup before an assign exits 1');
  assert.equal(writes(r.requests).length, 0, 'and writes nothing');

  // --- September 30, 2026: `record <file>` writes one page of decisions per call ----------
  assert.ok(/tmp\/\s*$/m.test(readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8')), 'decision files go in tmp/, which must stay gitignored');
  const page = (name, doc) => {
    const rel = `tmp/front-agent-test-${process.pid}-${name}.json`;
    writeFileSync(join(repoRoot, rel), typeof doc === 'string' ? doc : JSON.stringify(doc));
    return rel;
  };
  const RUN = 'fronts-all-2026-10-04T00-00-00.000Z';
  const ok = [
    { story_id: 101, decision: 'assign', front: 'election-suppression', confidence: 0.85, rationale: 'court let a mid-decade map stand' },
    { story_id: 102, decision: 'decline', confidence: 0.9, uncertain: false, rationale: 'horse race' },
    { story_id: 103, decision: 'decline', confidence: 0.6, uncertain: true, rationale: 'borderline ice-deportations: plan not yet ordered' },
    { story_id: 104, decision: 'assign', front: 'ice-deportations', confidence: 0.9, rationale: 'ICE raid' },
  ];
  const dry = run(['record', page('ok', { run_id: RUN, decisions: ok })], { FRONTS_DRY_RUN: 'true' });
  assert.equal(dry.code, 0, 'a valid page records (dry-run)');
  assert.equal(dry.json.status, 'dry_run', 'dry-run record writes nothing');
  assert.equal(writes(dry.requests).length, 0, 'dry-run record sends no write');
  assert.equal(dry.json.judged, 4);
  assert.equal(dry.json.uncertain, 1, 'borderline declines are counted');
  assert.deepEqual(dry.json.results.map((x) => [x.story_id, x.decision, x.status]), [[101, 'assign', 'dry_run'], [102, 'decline', 'dry_run'], [103, 'decline', 'dry_run'], [104, 'assign', 'dry_run']]);

  const live = run(['record', page('live', { run_id: RUN, decisions: [...ok, { ...ok[0], story_id: 999 }] })]);
  assert.equal(live.code, 0);
  assert.equal(live.json.status, 'recorded');
  assert.equal(live.json.assigned, 2);
  assert.deepEqual(live.json.assigned_by_front, { 'election-suppression': 1, 'ice-deportations': 1 }, 'record counts assignments per front');
  assert.equal(live.json.already_assigned, 1);
  assert.equal(live.json.declined, 2);
  assert.equal(live.json.errors, 0);
  const w = writes(live.requests);
  assert.deepEqual(w.map((q) => [q.path, q.body.story_id ?? Number(q.body.entity_id), q.body.event_id ?? q.body.metadata.front]),
    [['story_event', 101, 14], ['pipeline_skips', 102, 'none'], ['pipeline_skips', 103, 'none'], ['story_event', 104, 18], ['story_event', 999, 14]],
    'each decision writes one row, to the front it names');
  assert.equal(live.requests.filter((q) => q.path === 'events').length, 1, 'the agent fronts are read once per call');

  const refused = (name, doc, why) => {
    const x = run(['record', page(name, doc)]);
    assert.equal(x.code, 2, `record refuses ${why}`);
    assert.equal(x.json.ok, false);
    assert.equal(writes(x.requests).length, 0, `record writes nothing when it refuses ${why}`);
    return x;
  };
  refused('low-assign', { run_id: RUN, decisions: [{ ...ok[0], confidence: 0.65 }] }, 'an assign below 0.70');
  refused('no-front', { run_id: RUN, decisions: [{ ...ok[0], front: undefined }] }, 'an assign without a front');
  refused('decline-front', { run_id: RUN, decisions: [{ ...ok[1], front: 'iran' }] }, 'a decline that names a front');
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
  const mixed = refused('mixed', { run_id: RUN, decisions: [ok[1], { ...ok[0], confidence: 0.5 }] }, 'a page with one bad entry');
  assert.match(mixed.json.error, /^decisions\[1\]:/, 'the error names the bad entry');
  // an unknown front anywhere refuses the whole file before any write, also in dry-run
  const unknown = refused('unknown-front', { run_id: RUN, decisions: [ok[1], ok[0], { ...ok[3], front: 'the-courts' }] }, 'an assign to a front outside the agent fronts');
  assert.match(unknown.json.error, /^decisions\[2\]: front "the-courts" is not an agent front/, 'the error names the entry and the front');
  assert.equal(run(['record', page('unknown-dry', { run_id: RUN, decisions: [{ ...ok[3], front: 'the-courts' }] })], { FRONTS_DRY_RUN: 'true' }).code, 2, 'dry-run checks the fronts too');
  const down = run(['record', page('down', { run_id: RUN, decisions: ok })], { FRONT_AGENT_MOCK_EVENTS: 'fail' });
  assert.equal(down.code, 1, 'a failed fronts lookup refuses the page');
  assert.equal(writes(down.requests).length, 0, 'and writes nothing');

  assert.equal(run(['record', 'tmp/../package.json']).code, 2, 'parent-directory hops are refused');
  assert.equal(run(['record', 'package.json.txt']).code, 2, 'only .json files');
  assert.equal(run(['record', 'tmp/does-not-exist.json']).code, 2, 'a missing file is a usage error');
  assert.equal(run(['record', page('ok2', { run_id: RUN, decisions: ok })], { SUPABASE_URL: 'http://plain.example' }).code, 2, 'record needs https');
} finally {
  for (const f of readdirSync(join(repoRoot, 'tmp')).filter((n) => n.startsWith(`front-agent-test-${process.pid}-`))) rmSync(join(repoRoot, 'tmp', f));
}

console.log('front-agent-prompt: all checks passed');
