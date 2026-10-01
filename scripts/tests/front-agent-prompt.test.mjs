// ADO-582: the front assignment agent prompt writes raw strings over PostgREST,
// so the contract between the prompt, the skip constants, and migration 116's
// RPC filter is text. These checks fail the smoke suite if any side drifts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PIPELINES, REASONS } from '../lib/skip-reasons.js';

const prompt = readFileSync(new URL('../../docs/features/fronts-claude-agent/prompt-v1.md', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../migrations/116_front_agent_candidates.sql', import.meta.url), 'utf8');

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

// --- the seeded agent pattern covers the redistricting terms the sweep skips ---
const m = migration.match(/SET agent_pattern = '([^']+)'/);
assert.ok(m, 'migration must seed agent_pattern');
const re = new RegExp(m[1].replace(/\\m/g, '\\b').replace(/\\M/g, '\\b'), 'i'); // \m \M are Postgres word bounds
for (const h of [
  'Missouri court allows Trump-backed congressional map to take effect',
  'Indiana governor calls special session to redistrict',
  'When Gerry met a salamander: the 1812 roots of gerrymandering',
  'Poll: most Americans expect the midterms to be unfair',
  'County refuses to certify election results',
]) assert.ok(re.test(h), `agent_pattern should match candidate headline: ${h}`);
for (const h of ['EPA rolls back pollution rules', 'Apollo mission anniversary', 'Senate votes on defense bill']) {
  // "votes" IS an election word by design (the agent declines the noise); only the two non-words must miss
  if (!/votes/.test(h)) assert.ok(!re.test(h), `agent_pattern should not match: ${h}`);
}

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

console.log('front-agent-prompt: all checks passed');
