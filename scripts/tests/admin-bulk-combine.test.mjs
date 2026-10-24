/**
 * ADO-60: the admin Stories tab "Combine" dialog (bulk merge of duplicate stories).
 *
 * Runs the real helpers extracted from public/admin.html (they live in a text/babel
 * script, so they cannot be imported; they sit between the `bulkCombine:start` /
 * `bulkCombine:end` marker comments): keeper choice, the combine plan (merged-away,
 * missing, keeper-is-a-tombstone, fewer than 2, front warnings) and how each merge
 * reply is reported. Also checks the admin-judge-merge contract the dialog relies on.
 *
 * Run: node scripts/tests/admin-bulk-combine.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const adminHtml = readFileSync(`${repoRoot}public/admin.html`, 'utf8');
const mergeFn = readFileSync(`${repoRoot}supabase/functions/admin-judge-merge/index.ts`, 'utf8');

const helperSrc = adminHtml.match(/\/\/ bulkCombine:start([\s\S]*?)\/\/ bulkCombine:end/);
assert.ok(helperSrc, 'bulkCombine:start/end markers not found in admin.html');

const { pickDefaultKeeper, buildCombinePlan, classifyMergeResult, mergeReasonText, COMBINE_MAX_STORIES } = new Function(
  `${helperSrc[1]}\nreturn { pickDefaultKeeper, buildCombinePlan, classifyMergeResult, mergeReasonText, COMBINE_MAX_STORIES };`,
)();

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const story = (id, extra = {}) => ({
  id,
  primary_headline: `Story ${id}`,
  status: 'active',
  merged_into_story_id: null,
  article_count: 1,
  first_seen_at: '2026-10-01T00:00:00Z',
  front: null,
  ...extra,
});

// ---- keeper choice ----
test('keeper defaults to the story with the most articles', () => {
  const stories = [story(1, { article_count: 2 }), story(2, { article_count: 7 }), story(3, { article_count: 3 })];
  assert.equal(pickDefaultKeeper(stories), 2);
});

test('article tie goes to the oldest story (first seen), then the lowest id', () => {
  const stories = [
    story(10, { article_count: 4, first_seen_at: '2026-10-05T00:00:00Z' }),
    story(11, { article_count: 4, first_seen_at: '2026-10-02T00:00:00Z' }),
    story(12, { article_count: 1, first_seen_at: '2026-09-01T00:00:00Z' }),
  ];
  assert.equal(pickDefaultKeeper(stories), 11);
  const sameTime = [story(21, { article_count: 2 }), story(20, { article_count: 2 })];
  assert.equal(pickDefaultKeeper(sameTime), 20);
});

test('a merged-away or missing story is never the default keeper, even with the most articles', () => {
  const stories = [
    story(1, { article_count: 50, status: 'merged_into', merged_into_story_id: 9 }),
    story(2, { article_count: 40, missing: true }),
    story(3, { article_count: 1 }),
  ];
  assert.equal(pickDefaultKeeper(stories), 3);
  assert.equal(pickDefaultKeeper([story(1, { status: 'merged_into', merged_into_story_id: 2 })]), null);
});

// ---- plan ----
test('plan: N-1 stories merge into the keeper and their article counts add up', () => {
  const stories = [story(1, { article_count: 5 }), story(2, { article_count: 2 }), story(3, { article_count: 3 })];
  const plan = buildCombinePlan(stories, 1);
  assert.equal(plan.blocker, null);
  assert.deepEqual(plan.toMerge.map((s) => s.id), [2, 3]);
  assert.equal(plan.articles, 5);
  assert.deepEqual(plan.skipped, []);
  assert.deepEqual(plan.warnings, []);
});

test('plan: a selected story already merged elsewhere is skipped, with a pointer to its survivor', () => {
  const stories = [story(1), story(2), story(3, { status: 'merged_into', merged_into_story_id: 77 })];
  const plan = buildCombinePlan(stories, 1);
  assert.deepEqual(plan.toMerge.map((s) => s.id), [2]);
  assert.equal(plan.skipped.length, 1);
  assert.match(plan.skipped[0].text, /Already merged into #77/);
});

test('plan: a story already merged into the keeper says so (nothing to do)', () => {
  const plan = buildCombinePlan([story(1), story(2), story(3, { status: 'merged_into', merged_into_story_id: 1 })], 1);
  assert.match(plan.skipped[0].text, /Already part of #1/);
});

test('plan: a story merged into another story in this Combine comes along (no misleading advice)', () => {
  const plan = buildCombinePlan([story(5), story(6), story(7, { status: 'merged_into', merged_into_story_id: 6 })], 5);
  assert.deepEqual(plan.toMerge.map((s) => s.id), [6]);
  assert.match(plan.skipped[0].text, /merged into #6, which is being combined into #5/);
  assert.doesNotMatch(plan.skipped[0].text, /instead/);
});

test('plan: a missing story is skipped', () => {
  const plan = buildCombinePlan([story(1), story(2), story(3, { missing: true })], 1);
  assert.deepEqual(plan.toMerge.map((s) => s.id), [2]);
  assert.match(plan.skipped[0].text, /Not found/);
});

test('plan: the keeper cannot be a tombstone', () => {
  const plan = buildCombinePlan([story(1, { status: 'merged_into', merged_into_story_id: 5 }), story(2)], 1);
  assert.match(plan.blocker, /already merged into #5/);
});

test('plan: fewer than 2 live stories is blocked', () => {
  const plan = buildCombinePlan([story(1), story(2, { status: 'merged_into', merged_into_story_id: 9 })], 1);
  assert.match(plan.blocker, /at least 2 live stories/);
  assert.equal(buildCombinePlan([story(1), story(2)], null).blocker, 'Pick the story to keep.');
});

test('plan: a loser on a front the keeper is not on gets a one-line warning (merge does not move fronts)', () => {
  const front = { event_id: 4, name: 'The Epstein Files' };
  const noFront = buildCombinePlan([story(1), story(2, { front })], 1);
  assert.equal(noFront.warnings.length, 1);
  assert.match(noFront.warnings[0], /#2 is on the front "The Epstein Files" but #1 is on no front/);

  const otherFront = buildCombinePlan([story(1, { front: { event_id: 5, name: 'Tariffs' } }), story(2, { front })], 1);
  assert.match(otherFront.warnings[0], /#1 stays on "Tariffs"/);

  const sameFront = buildCombinePlan([story(1, { front }), story(2, { front })], 1);
  assert.deepEqual(sameFront.warnings, []);
});

// ---- results ----
test('result: merged / already merged / failed with the shared reason text', () => {
  assert.deepEqual(classifyMergeResult(2, { ok: true, skipped: false, articles_moved: 3 }).kind, 'merged');
  assert.match(classifyMergeResult(2, { ok: true, articles_moved: 1 }).text, /1 article moved/);
  const already = classifyMergeResult(2, { ok: true, skipped: true, reason: 'loser_already_merged', survivor_id: 9 });
  assert.equal(already.kind, 'already');
  assert.match(already.text, /into #9/);
  const failed = classifyMergeResult(2, { ok: false, reason: 'survivor_is_merged', survivor_points_to: 8 });
  assert.equal(failed.kind, 'failed');
  assert.match(failed.text, /has itself been merged.*#8/);
  assert.match(classifyMergeResult(2, null, 'Merge failed').text, /Failed: Merge failed/);
  assert.match(classifyMergeResult(2, { ok: true, articles_moved: 2, log_error: 'x' }).text, /Judge log entry failed/);
});

test('every reason code merge_stories / unmerge_story / admin-judge-merge return has plain text', () => {
  const migrationReasons = new Set();
  for (const file of ['migrations/102_merge_stories_concurrency.sql']) {
    const sql = readFileSync(`${repoRoot}${file}`, 'utf8');
    for (const m of sql.matchAll(/'reason',\s*'([a-z_]+)'/g)) migrationReasons.add(m[1]);
  }
  for (const m of mergeFn.matchAll(/reason: '([a-z_]+)'/g)) migrationReasons.add(m[1]);
  assert.ok(migrationReasons.size >= 6, `expected merge reasons, found ${[...migrationReasons]}`);
  for (const r of migrationReasons) {
    assert.notEqual(mergeReasonText(r), r, `no plain text for reason '${r}'`);
  }
  assert.equal(mergeReasonText('something_new'), 'something_new');
  assert.equal(mergeReasonText(undefined), 'unknown reason');
});

// ---- contracts ----
test('admin-judge-merge preview returns article_count, front and fronts_checked; merge accepts via=stories_combine', () => {
  assert.match(mergeFn, /article_count/);
  assert.match(mergeFn, /from\('story_event'\)/);
  assert.match(mergeFn, /fronts_checked: frontsChecked/);
  assert.match(mergeFn, /body\.via === 'stories_combine'/);
  assert.match(adminHtml, /via: 'stories_combine'/);
});

test('Tracker refresh: after a single merge/unmerge, and once per Combine batch (not per story)', () => {
  const calls = mergeFn.match(/await refreshTracker\(supabase\)/g) || [];
  assert.equal(calls.length, 3, 'expected refreshTracker in the refresh action, after unmerge, and after a non-Combine merge');
  assert.match(mergeFn, /rpc\('refresh_tracker_derived'\)/);
  assert.match(mergeFn, /fromStoriesCombine \? undefined : await refreshTracker\(supabase\)/);
  assert.match(mergeFn, /action === 'refresh'/);
  assert.match(adminHtml, /invokeMerge\(\{ action: 'refresh' \}\)/);
});

test('the Combine dialog goes through admin-judge-merge, one merge per story (no new batch endpoint)', () => {
  assert.ok(COMBINE_MAX_STORIES >= 2 && COMBINE_MAX_STORIES <= 25);
  const modal = adminHtml.match(/function CombineStoriesModal[\s\S]*?\n {8}}\n/);
  assert.ok(modal, 'CombineStoriesModal not found');
  assert.match(modal[0], /functions\.invoke\('admin-judge-merge'/);
  assert.match(modal[0], /for \(const s of plan\.toMerge\)/);
  assert.match(modal[0], /busyRef\.current/);
});

test('Stories tab refreshes the list and Home\'s Judge count after a combine', () => {
  assert.match(adminHtml, /<StoriesTab password=\{password\} supabase=\{supabase\} onReviewChanged=\{fetchJudgeReviewCount\} \/>/);
  const handler = adminHtml.match(/const handleCombineFinished = [\s\S]*?\n {12}};/);
  assert.ok(handler, 'handleCombineFinished not found');
  assert.match(handler[0], /fetchStories\(false, null, null\)/);
  assert.match(handler[0], /onReviewChanged\?\.\(\)/);
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
if (failed) process.exit(1);
