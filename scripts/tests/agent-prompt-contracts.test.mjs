// ADO-583 / ADO-584: the Stories and Judge cloud-agent prompts write raw strings
// over PostgREST, so the contract between each prompt and its migration is text.
// These checks fail the smoke suite if a prompt drifts back to the shapes that
// caused the September 2026 incidents (12-hour re-enrichment treadmill; Judge PROD
// writes the cloud sandbox denies) or loses the review fixes (evidence watermark,
// merge re-qualification, failed-attempt retry) and the Judge -> executor hand-off
// (the agent writes one verdict file, .github/workflows/judge-executor.yml writes the DB).
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

// --- Stories agent: the evidence that re-qualified a story is actually read ---
const step3 = stories.slice(stories.indexOf('### Step 3: Fetch Source Articles'), stories.indexOf('### Step 4'));
assert.ok(step3.includes('new_article_ids') && step3.includes('article_id=in.('), 'Step 3B must fetch new_article_ids by id (top-6-by-similarity can miss them)');

// --- migration 117 defines exactly what the prompt calls, with the review-fixed rules ---
assert.ok(mig117.includes('FUNCTION public.stories_needing_enrichment('), 'migration 117 defines the RPC');
assert.ok(mig117.includes("s.enrichment_meta->>'evidence_as_of'"), 'RPC must read the echoed watermark');
assert.ok(/a\.matched_at > w\.watermark/.test(mig117), 'RPC must compare attaches against the watermark, not last_enriched_at');
assert.ok(mig117.includes('story_merge_audit'), 'RPC must re-qualify survivors of Judge merges/unmerges');
assert.ok(mig117.includes('GREATEST(m.max_matched, mc.max_change)'), 'issued watermark must cover merge/unmerge times, or merged survivors re-qualify forever');
assert.ok(/a\.article_id = ANY \(ma\.loser_article_ids\)/.test(mig117), 'new_article_ids must include the articles a merge brought in');
assert.ok(mig117.includes("'last_attempt_status' = 'failed'"), 'RPC must retry failed attempts under the cap');
assert.ok(mig117.includes('s.summary_neutral IS NULL'), 'RPC must retry never-published stories under the cap');
assert.ok(mig117.includes("s.enrichment_meta->>'source' = 'claude-agent'"), 'RPC must keep the claude-agent source discriminator');
assert.ok(mig117.includes('ORDER BY p.last_enriched_at ASC NULLS FIRST'), 'never-enriched stories come first');
assert.ok(mig117.includes('p_max_failures   INTEGER DEFAULT 3'), 'default failure cap is 3');
assert.ok(mig117.includes('TO service_role'), 'RPC is service_role only');
for (const col of ['id', 'primary_headline', 'last_enriched_at', 'enrichment_failure_count', 'enrichment_meta', 'evidence_as_of', 'new_article_ids', 'reason', 'pool_size']) {
  assert.ok(new RegExp(`^\\s+${col}\\s`, 'm').test(mig117), `RPC must return ${col}`);
}

// --- Judge agent (v1.2, ADO-583): the agent never writes to the database; the executor does ---
const workflow = read('../../.github/workflows/judge-executor.yml');
const executor = read('../clustering/execute-judge-verdicts.js');
assert.ok(!judge.includes('rpc/merge_stories'), 'the prompt must not show a merge_stories call anywhere (Section 2 examples included)');
assert.ok(!/-X POST "\$\{API_BASE\}\/clustering_judge_log"/.test(judge), 'the prompt must not show a clustering_judge_log insert');
assert.ok(!judge.includes('-X PATCH') && !judge.includes('-X DELETE'), 'no PATCH/DELETE shapes in the prompt');
assert.ok(judge.includes('You do NOT call `merge_stories`'), 'Step 5 forbids the merge call outright');
assert.ok(judge.includes('judge-inbox/<RUN_ID>.json') && judge.includes('"schema": "judge-verdicts/v1"'), 'Step 6 writes the verdict file in the executor schema');
assert.ok(judge.includes('"survivor_id"') && judge.includes('"loser_id"'), 'merge verdicts carry survivor/loser for the executor');
assert.ok(judge.includes('BRANCH="judge-run/${ENV_NAME}/${RUN_ID}"') && judge.includes('git push -q origin "${BRANCH}"'), 'Step 7 publishes on the judge-run/<env>/<run_id> branch the workflow listens to');
assert.ok(judge.includes('wnrjrywpcadwutfykflu'), 'environment is derived from the TEST project ref, never a PROD ref');
assert.ok(!judge.includes('osjbulmltfpcoldydexg'), 'no PROD project ref in the prompt');
assert.ok(judge.includes('with the **Write tool**'), 'verdict file is written with the Write tool, not jq --arg in Bash');
assert.ok(judge.includes('do NOT rephrase, split, loop, or route the same action'), 'denial rule must forbid workarounds');
assert.ok(/Never fall back to writing the database\s+yourself/.test(judge), 'a failed push never turns into a direct DB write');
assert.ok(judge.includes('`"verdicts": []`'), '0 candidates still publishes a file so the executor writes the heartbeat');
assert.ok(judge.includes('`prompt_version`: `judge-v1.2`'), 'prompt version bumped for the executor hand-off');
// executor + workflow implement the same contract
assert.ok(executor.includes("SCHEMA = 'judge-verdicts/v1'"), 'executor validates the schema the prompt writes');
assert.ok(executor.includes("'merge_stories'") && executor.includes('p_run_id: runId'), 'executor merges through merge_stories with the DB cap');
assert.ok(executor.includes('MERGE_CAP = 10'), 'executor cap mirrors migration 101');
assert.ok(executor.includes("'clustering_judge_log'"), 'executor writes the audit log');
assert.ok(workflow.includes('- "judge-run/**"') && workflow.includes('scripts/clustering/execute-judge-verdicts.js'), 'workflow listens on judge-run/** and runs the executor');
assert.ok(workflow.includes('secrets.SUPABASE_SERVICE_KEY') && workflow.includes('secrets.SUPABASE_TEST_SERVICE_KEY'), 'workflow injects both service keys from secrets');

console.log('agent-prompt-contracts: all checks passed');
