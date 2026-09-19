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
// v4 (PR #145 review, P1): a failed attempt must not move the watermark past unpublished evidence
assert.ok(failureBody.includes('"attempt_evidence_as_of"'), 'failure body records what the failed attempt saw separately');
assert.ok(!successBody.includes('attempt_evidence_as_of'), 'a success write drops attempt_evidence_as_of (the RPC relies on that)');
assert.ok(failureBody.includes('prior_evidence_as_of'), 'failure body explains evidence_as_of = Step 2 prior_evidence_as_of');
assert.ok(!/verbatim, on success and on failure/.test(stories), 'the old rule (echo the new watermark on failure) must not come back');

// --- Stories agent: the evidence that re-qualified a story is actually read ---
const step3 = stories.slice(stories.indexOf('### Step 3: Fetch Source Articles'), stories.indexOf('### Step 4'));
assert.ok(step3.includes('new_article_ids') && step3.includes('article_id=in.('), 'Step 3B must fetch new_article_ids by id (top-6-by-similarity can miss them)');
// v4 (PR #145 review, P1): a burst over six articles is read in full, the overflow at headline level
assert.ok(step3.includes('every remaining id') && step3.includes('articles(title,source_name,excerpt)'), 'Step 3B reads ids 7+ at headline level instead of dropping them');

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
assert.ok(mig117.includes("s.enrichment_meta->>'attempt_evidence_as_of'"), 'RPC must read what a failed attempt saw');
assert.ok(/WHEN jsonb_typeof\(s\.enrichment_meta->'evidence_as_of'\) = 'null' THEN NULL/.test(mig117), 'a present JSON-null evidence_as_of (first attempt failed) means nothing was seen - it must NOT fall back to the failure timestamp');
assert.ok(/k\.watermark IS NULL\s+OR a\.matched_at > k\.watermark/.test(mig117), 'new_article_ids must list every article when the watermark is NULL');
assert.ok(/JSON `null`/.test(stories), 'prompt must say a null prior watermark is written as JSON null');
assert.ok(mig117.includes('m.fresh_cnt > 0') && mig117.includes('mc.max_change > aw.attempt_mark'), 'uncapped branches look only at evidence newer than the last attempt, so the failure cap still bites');
assert.ok(/w\.watermark\s+AS prior_evidence_as_of/.test(mig117), 'RPC returns the watermark it used so a failure can echo it back');
const idsSql = mig117.slice(mig117.indexOf('ARRAY_AGG(x.article_id'), mig117.indexOf('AS new_article_ids'));
assert.ok(idsSql.length > 0 && !/LIMIT/i.test(idsSql), 'new_article_ids must not be capped: the watermark advances past every new article');
for (const col of ['id', 'primary_headline', 'last_enriched_at', 'enrichment_failure_count', 'enrichment_meta', 'evidence_as_of', 'prior_evidence_as_of', 'new_article_ids', 'reason', 'pool_size']) {
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
