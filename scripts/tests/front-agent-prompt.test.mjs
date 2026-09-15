// ADO-582: the front assignment agent prompt writes raw strings over PostgREST,
// so the contract between the prompt, the skip constants, and migration 116's
// RPC filter is text. These checks fail the smoke suite if any side drifts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

console.log('front-agent-prompt: all checks passed');
