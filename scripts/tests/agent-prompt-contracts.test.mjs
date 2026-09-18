// ADO-583 / ADO-584: the Stories and Judge cloud-agent prompts write raw strings
// over PostgREST, so the contract between each prompt and its migration is text.
// These checks fail the smoke suite if a prompt drifts back to the shapes that
// caused the September 2026 incidents (12-hour re-enrichment treadmill; looped /
// scripted PROD writes the cloud sandbox denies) or loses the review fixes
// (evidence watermark, merge re-qualification, failed-attempt retry, per-merge log row).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const stories = read('../../docs/features/stories-claude-agent/prompt-v1.md');
const judge = read('../../docs/features/clustering-judge/prompt-v1.md');
const mig117 = read('../../migrations/117_stories_needing_enrichment.sql');

// --- Stories agent: candidates come from the RPC, never a hand-written filter ---
assert.ok(stories.includes('rpc/stories_needing_enrichment'), 'Stories Step 2 must call stories_needing_enrichment');
assert.ok(stories.includes('"p_limit": 40'), 'Stories batch size stays 40');
assert.ok(stories.includes('"p_max_failures": 3'), 'failed-attempt retry cap is 3 (ADO-584 AC 2)');
assert.ok(!stories.includes('COOLDOWN_CUTOFF'), 'the 12-hour cutoff query must not come back');
assert.ok(!/last_enriched_at\.lt\./.test(stories), 'no last_enriched_at.lt. filter anywhere (Section 2 examples included)');
assert.ok(!stories.includes('article_story!inner('), 'no inner-join candidate select recipe anywhere');
assert.ok(stories.includes('PGRST202'), 'Stories prompt must stop when the RPC is missing (deploy-order guard)');

// --- Stories agent: the evidence watermark round-trips on BOTH write paths ---
const successBody = stories.slice(stories.indexOf('#### Success body'), stories.indexOf('#### Failure body'));
const failureBody = stories.slice(stories.indexOf('#### Failure body'), stories.indexOf('#### NEVER WRITE'));
assert.ok(successBody.includes('"evidence_as_of"'), 'success body must echo evidence_as_of into enrichment_meta');
assert.ok(failureBody.includes('"evidence_as_of"'), 'failure body must echo evidence_as_of into enrichment_meta');
assert.ok(/evidence_as_of.*verbatim/i.test(stories), 'prompt must say the watermark is echoed verbatim');

// --- migration 117 defines exactly what the prompt calls, with the review-fixed rules ---
assert.ok(mig117.includes('FUNCTION public.stories_needing_enrichment('), 'migration 117 defines the RPC');
assert.ok(mig117.includes("s.enrichment_meta->>'evidence_as_of'"), 'RPC must read the echoed watermark');
assert.ok(/a\.matched_at > w\.watermark/.test(mig117), 'RPC must compare attaches against the watermark, not last_enriched_at');
assert.ok(mig117.includes('story_merge_audit'), 'RPC must re-qualify survivors of Judge merges/unmerges');
assert.ok(mig117.includes("'last_attempt_status' = 'failed'"), 'RPC must retry failed attempts under the cap');
assert.ok(mig117.includes('s.summary_neutral IS NULL'), 'RPC must retry never-published stories under the cap');
assert.ok(mig117.includes("s.enrichment_meta->>'source' = 'claude-agent'"), 'RPC must keep the claude-agent source discriminator');
assert.ok(mig117.includes('ORDER BY p.last_enriched_at ASC NULLS FIRST'), 'never-enriched stories come first');
assert.ok(mig117.includes('p_max_failures   INTEGER DEFAULT 3'), 'default failure cap is 3');
assert.ok(mig117.includes('TO service_role'), 'RPC is service_role only');
for (const col of ['id', 'primary_headline', 'last_enriched_at', 'enrichment_failure_count', 'enrichment_meta', 'evidence_as_of', 'reason', 'pool_size']) {
  assert.ok(new RegExp(`^\\s+${col}\\s`, 'm').test(mig117), `RPC must return ${col}`);
}

// --- Judge agent: writes shaped for the sandbox's command screening, crash-safe ---
assert.ok(judge.includes('# Clustering Judge merge'), 'merge curl must carry its explanatory comment');
assert.ok(judge.includes('rpc/merge_stories'), 'merge goes through merge_stories');
assert.ok(judge.includes('Log an executed merge immediately'), 'each executed merge must get its own log row at once');
assert.ok(judge.includes('-d @/tmp/judge-log-rows.json'), 'audit log rows go as a JSON array from a temp file');
assert.ok(!judge.includes('judge-log-row.json'), 'no single-object log body example left in the API reference');
assert.ok(judge.includes('Build the array file with the Write tool'), 'array file is written with the Write tool, not jq --arg in Bash');
assert.ok(judge.includes('never insert a "test" or "probe" row'), 'no probe rows in the audit log');
assert.ok(judge.includes('do NOT rephrase, split, loop, or route the same write'), 'denial rule must forbid workarounds');
assert.ok(judge.includes('rationale prefixed `blocked:`'), 'blocked merges are logged merged=false with a blocked: rationale');
assert.ok(/The only\s+exception is the platform denying the log write/.test(judge), 'invariant 1 carries the denial carve-out');

console.log('agent-prompt-contracts: all checks passed');
