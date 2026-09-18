// ADO-583 / ADO-584: the Stories and Judge cloud-agent prompts write raw strings
// over PostgREST, so the contract between each prompt and its migration is text.
// These checks fail the smoke suite if a prompt drifts back to the shapes that
// caused the September 2026 incidents (12-hour re-enrichment treadmill; looped /
// scripted PROD writes the cloud sandbox denies).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const stories = read('../../docs/features/stories-claude-agent/prompt-v1.md');
const judge = read('../../docs/features/clustering-judge/prompt-v1.md');
const mig117 = read('../../migrations/117_stories_needing_enrichment.sql');

// --- Stories agent: candidates come from the RPC, never a hand-written filter ---
assert.ok(stories.includes('rpc/stories_needing_enrichment'), 'Stories Step 2 must call stories_needing_enrichment');
assert.ok(stories.includes('"p_limit": 40'), 'Stories batch size stays 40');
assert.ok(!stories.includes('COOLDOWN_CUTOFF'), 'the 12-hour cutoff query must not come back');
assert.ok(!/stories\?status=eq\.active&or=\(last_enriched_at/.test(stories), 'no direct stories?...or=(last_enriched_at...) candidate query');
assert.ok(stories.includes('PGRST202'), 'Stories prompt must stop when the RPC is missing (deploy-order guard)');

// --- migration 117 defines exactly what the prompt calls, with the new-article rule ---
assert.ok(mig117.includes('FUNCTION public.stories_needing_enrichment('), 'migration 117 defines the RPC');
assert.ok(/a\.matched_at > s\.last_enriched_at/.test(mig117), 'RPC must require an article attached after last_enriched_at');
assert.ok(mig117.includes("s.enrichment_meta->>'source' = 'claude-agent'"), 'RPC must keep the claude-agent source discriminator');
assert.ok(mig117.includes('ORDER BY s.last_enriched_at ASC NULLS FIRST'), 'never-enriched stories come first');
assert.ok(mig117.includes('TO service_role'), 'RPC is service_role only');
for (const col of ['id', 'primary_headline', 'last_enriched_at', 'enrichment_failure_count', 'enrichment_meta']) {
  assert.ok(new RegExp(`^\\s+${col}\\s`, 'm').test(mig117), `RPC must return ${col} (Step 6 concurrency guard reads last_enriched_at verbatim)`);
}

// --- Judge agent: writes shaped for the sandbox's command screening ---
assert.ok(judge.includes('# Clustering Judge merge'), 'merge curl must carry its explanatory comment');
assert.ok(judge.includes('rpc/merge_stories'), 'merge goes through merge_stories');
assert.ok(judge.includes('-d @/tmp/judge-log-rows.json'), 'audit log is one bulk POST from a temp file');
assert.ok(judge.includes('never insert a "test" or "probe" row'), 'no probe rows in the audit log');
assert.ok(judge.includes('do NOT rephrase, split, loop, or route the same write'), 'denial rule must forbid workarounds');
assert.ok(judge.includes('rationale prefixed `blocked:`'), 'blocked merges are logged merged=false with a blocked: rationale');

console.log('agent-prompt-contracts: all checks passed');
