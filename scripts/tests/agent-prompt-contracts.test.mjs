// ADO-583 / ADO-584: the Stories and Judge cloud-agent prompts write raw strings
// over PostgREST, so the contract between each prompt and its migration is text.
// These checks fail the smoke suite if a prompt drifts back to the shapes that
// caused the September 2026 incidents (12-hour re-enrichment treadmill; Judge PROD
// writes the cloud sandbox denies) or loses the review fixes (evidence watermark,
// merge re-qualification, failed-attempt retry) and the Judge -> executor hand-off
// (the agent writes one verdict file, .github/workflows/judge-executor.yml writes the DB).
// ADO-594 S2: the Stories action labels (success-only, human lock, gold-check mode writes nothing)
// and the rule that no agent prompt names the admin-only human-label door.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

// --- Stories agent: copy stays inside the source (ADO-597: 16294 "loosened", 16287 ORG-DHS, 16291 party labels) ---
const step4 = stories.slice(stories.indexOf('### Step 4'), stories.indexOf('### Step 5'));
const step5 = stories.slice(stories.indexOf('### Step 5'), stories.indexOf('### Step 6'));
assert.ok(step4.includes('Source-grounding rule') && /background knowledge is never a source/i.test(step4), 'Step 4 must forbid facts/entities from outside the source');
assert.ok(step4.includes('Thin-source rule') && step4.includes("notes='thin_source'"), 'Step 4 must carry the thin-source say-less rule');
assert.ok(/thin source alone is NOT a reason for `needs_manual_review=true`/i.test(step4), 'thin source alone must not set the review flag');
assert.ok(step5.includes('Source check, done now, before the write'), 'Step 5 must check the copy against the source before the single PATCH');
assert.ok(stories.includes('**Nothing from outside the source**'), 'Section 6 hard rule for source grounding');
const step7 = stories.slice(stories.indexOf('### Step 7'), stories.indexOf('## 4. Brand Voice'));
assert.ok(step7.includes('"needs_manual_review": false, "notes": "thin_source"'), 'Step 7 must show the thin_source log body, or thin runs log no notes');
assert.ok(/thin source never moves the level by itself/i.test(step4), 'thin source must not lower alarm_level (level 1 means a mixed outcome, not missing detail)');
assert.ok(/never under 50 characters/.test(step4), 'thin summary_neutral must stay >= 50 chars (migration 080 review-flag trigger)');

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

// --- Stories agent v1.1 (ADO-594 S2): action labels, the human lock, the gold check ---
const mig124 = read('../../migrations/124_stories_needing_enrichment_label_source.sql');
const jsonBlock = (s) => { const a = s.indexOf('```json'); return a < 0 ? '' : s.slice(a, s.indexOf('```', a + 7)); };
const successJson = jsonBlock(successBody);
const failureJson = jsonBlock(failureBody);
assert.ok(successJson.includes('"action_label":') && successJson.includes('"action_actor":'), 'success PATCH writes both action labels');
assert.ok(successJson.includes('"action_label_source": "agent"'), 'success PATCH writes action_label_source = agent with the labels');
assert.ok(failureJson.length > 0 && !failureJson.includes('action_'), 'failure PATCH writes no label field');
assert.ok(/leave all three keys out/.test(successBody) && successBody.includes("`action_label_source = 'human'`"), 'Step 6 leaves the labels out when a human locked them');
const step2 = stories.slice(stories.indexOf('### Step 2'), stories.indexOf('### Step 3'));
assert.ok(step2.includes('action_label_source}') && /`human` means Josh locked the label/.test(step2), 'Step 2 reads action_label_source and explains the human lock');
assert.ok(/no `action_label_source` key at all/.test(step2), 'Step 2 stops when migration 124 is missing instead of failing every PATCH');
assert.ok(step4.includes('| `action_label` | text |') && step4.includes('| `action_actor` | text |'), 'Step 4 output table has both labels');
for (let n = 1; n <= 12; n++) assert.ok(new RegExp(`^${n}\\. \\*\\*`, 'm').test(step4.slice(step4.indexOf('#### Action labels'))), `Step 4 carries action-label edge case ${n}`);
assert.ok(step4.includes('whichever way it goes') && step4.includes('label_uncertain'), 'court-ruling rule and the unsure rule are present');
assert.ok(step5.includes('`action_label` is exactly') && /not from how angry the headline sounds/.test(step5), 'Step 5 checks the label values and their basis');
assert.ok(stories.includes('| Prompt version | claude-v1.1 |') && !/"claude-v1"|\\"claude-v1\\"/.test(stories), 'prompt_version is claude-v1.1 everywhere');
const goldFixture = JSON.parse(read('./fixtures/action-label-gold.json')).stories;
for (const id of [17240, 17216, 17248, 17233, 17231, 17246]) {
  const g = goldFixture.find((x) => x.id === id);
  assert.ok(new RegExp(`^\\| ${id} \\|[^\\n]*\\| \`${g.action_label}\` / \`${g.action_actor}\` \\|`, 'm').test(step4), `gold example ${id} matches the fixture (${g.action_label}/${g.action_actor})`);
}
const gold = stories.slice(stories.indexOf('### Gold-Check Mode'), stories.indexOf('### Step 0a'));
assert.ok(gold.length > 0 && gold.includes('explicit list of numeric story ids') && gold.includes('gold-check refused: an explicit list of story ids is required'), 'gold-check mode refuses without an explicit id list');
assert.ok(gold.includes('Do **not** fall back to a normal run'), 'a refused gold check never turns into a normal (writing) run');
assert.ok(gold.includes('wnrjrywpcadwutfykflu') && gold.includes('TEST only'), 'gold-check mode is TEST only');
assert.ok(gold.includes('**no PATCH to `stories`**') && !/-X (PATCH|POST|DELETE)/.test(gold), 'gold-check mode writes no PATCH and shows no write call');
assert.ok(gold.includes('/tmp/action-label-gold-results.json') && gold.includes('action-label-gold-check.js --file'), 'gold-check output is the results file the gold-check script reads');
assert.ok(mig124.includes('DROP FUNCTION IF EXISTS public.stories_needing_enrichment(INTEGER, INTEGER, INTEGER);'), 'migration 124 drops the exact signature before changing the return type');
assert.ok(/pool_size\s+INTEGER,\s+action_label_source\s+TEXT\s+\)/.test(mig124) && mig124.includes('k.action_label_source'), 'migration 124 returns action_label_source as the last column');
assert.ok(mig124.includes('TO service_role') && mig124.includes('FROM PUBLIC, anon, authenticated'), 'migration 124 keeps the RPC service_role only');
// The human-label door is admin-only (PRD 14.7): no agent prompt may name it.
const promptFiles = [];
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/^prompt.*\.md$/i.test(e.name)) promptFiles.push(p);
  }
};
walk(fileURLToPath(new URL('../../docs/features/', import.meta.url)));
assert.ok(promptFiles.length > 0, 'found the agent prompt files');
for (const f of promptFiles) assert.ok(!readFileSync(f, 'utf8').includes('set_story_action_label'), `${f} must not name set_story_action_label`);

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
assert.ok(!/^\s+push:/m.test(workflow) && workflow.includes('scripts/clustering/process-judge-inbox.js') && read('../clustering/process-judge-inbox.js').includes('refs/heads/judge-run/*'), 'workflow listens on judge-run/** and runs the executor');
assert.ok(workflow.includes('secrets.SUPABASE_SERVICE_KEY') && workflow.includes('secrets.SUPABASE_TEST_SERVICE_KEY'), 'workflow injects both service keys from secrets');

console.log('agent-prompt-contracts: all checks passed');
