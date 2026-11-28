// ADO-644: the Netlify scheduled function that dispatches the daily PROD SCOTUS fetch.
// Only what is new for SCOTUS is tested here. The shared dispatch rules in netlify/lib/github-dispatch.mjs
// (token trimming, network-error codes, the response body never read, deployDecision failing closed)
// are covered by health-check-trigger.test.mjs and rss-prod-trigger.test.mjs.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fn, { dispatchScotusRun, DISPATCH_URL, config } from '../../netlify/functions/scotus-trigger.mjs';
import { config as rssConfig } from '../../netlify/functions/rss-prod-trigger.mjs';
import { TOKEN_ENV } from '../../netlify/lib/github-dispatch.mjs';
import { recordBackupSkip } from '../scotus/record-backup-skip.js';

const TOKEN = 'github_pat_TEST_SECRET_VALUE';
const PROD = { deploy: { context: 'production', published: true } };
const workflow = readFileSync(fileURLToPath(new URL('../../.github/workflows/scotus-tracker.yml', import.meta.url)), 'utf8');

// --- schedule + target
assert.equal(config.schedule, '47 19 * * *', 'once a day at 19:47 UTC');
assert.equal(config.path, undefined, 'scheduled functions must not have a URL path');
assert.equal(DISPATCH_URL, 'https://api.github.com/repos/AJWolfe18/TTracker/actions/workflows/scotus-tracker.yml/dispatches');
assert.equal(TOKEN_ENV, 'RSS_TRIGGER_GITHUB_TOKEN', 'same token as the other triggers: nothing new to set up');
{
  // Not in an RSS slot: the RSS trigger fires at minute 47 of every EVEN hour, so an odd hour keeps
  // the two workflows' assign-fronts / refresh-tracker steps from running side by side.
  const [min, hour] = config.schedule.split(' ').map(Number);
  assert.equal(rssConfig.schedule, '47 */2 * * *', 'RSS slot this test assumes');
  assert.equal(hour % 2, 1, 'odd UTC hour, between two RSS runs');
  assert.ok(hour >= 17, "after the SCOTUS agent's 16:00 UTC weekday run, as the 18:47 cron was");
  assert.ok(min !== 0, 'off the top of the hour');
  // The cron is due two hours AFTER the Netlify run, so even an on-time cron run finds that day's
  // Netlify run (at 18:47 the cron came first, the guard found nothing, and both ran). Why the guard
  // looks back 20 hours: a cron run d hours late finds that day's Netlify run 2+d hours old and the
  // previous day's 26+d hours old. 20 hours catches the first for delays up to 18 hours and never the
  // second.
  const cron = /cron:\s*"(\d+) (\d+) \* \* \*"/.exec(workflow);
  assert.ok(cron, 'workflow keeps a daily cron as the backup');
  const [cronMin, cronHour] = [Number(cron[1]), Number(cron[2])];
  assert.equal(cronHour * 60 + cronMin - (hour * 60 + min), 120, 'the cron is due two hours after the Netlify run');
  assert.equal(cronHour % 2, 1, 'the cron is not in an RSS slot either');
}

// --- the workflow accepts a dispatch with no inputs and does a FULL run
{
  const on = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\nconcurrency:'));
  assert.match(on, /^\s+workflow_dispatch:\s*$/m);
  assert.match(on, /skip_fetch:[\s\S]*?required: false[\s\S]*?default: false/, 'skip_fetch is optional and defaults to a full run');
  assert.ok(!/required: true/.test(on), 'no required inputs (a dispatch without them would be a 422)');
}

// --- backup guard: a late cron run after the Netlify run is skipped, everything else runs
{
  const guard = workflow.slice(workflow.indexOf('  backup_guard:'), workflow.indexOf('  scotus_pipeline:'));
  const pipeline = workflow.slice(workflow.indexOf('  scotus_pipeline:'), workflow.indexOf('    steps:', workflow.indexOf('  scotus_pipeline:')));
  assert.ok(guard.length > 0 && workflow.indexOf('  backup_guard:') < workflow.indexOf('  scotus_pipeline:'));
  // the guard runs only for scheduled runs, and obeys the kill switch too
  assert.match(guard, /if: github\.event_name == 'schedule' && github\.ref == 'refs\/heads\/main' && vars\.ENABLE_PROD_SCHEDULES == 'true'/);
  assert.match(guard, /date -u -d '20 hours ago'/);
  assert.match(guard, /--workflow scotus-tracker\.yml --branch main/);
  assert.match(guard, /--event workflow_dispatch --created ">=\$since"/);
  // Only a finished, successful dispatch counts: one still running could fail and the fetch be missed.
  // The price: a cron run that arrives while the Netlify run is still going runs too (a harmless fetch,
  // one duplicate flag alert). Of those, only a run whose fetch step succeeded counts (the bash run
  // below covers skip_fetch and the fail-open paths).
  assert.match(guard, /select\(\.status == "completed"\) \| \.databaseId/, 'only finished dispatches are looked at');
  assert.match(guard, /run_pipeline=false/);
  assert.match(pipeline, /needs: backup_guard/);
  // The pipeline: kill switch + branch lock for every event (so dispatched runs need no `scheduled`
  // input). A scheduled run needs the guard's yes, or a guard that did not succeed: the guard fails
  // open, also when it dies before writing its output. A guard skipped by the kill switch still means
  // no pipeline (the kill switch is in this condition too). !cancelled() instead of the default
  // success(), which would skip the pipeline whenever the guard was skipped (every Netlify and manual run).
  const cond = /if: >-\s*\n\s+(\$\{\{[\s\S]*?\}\})/.exec(pipeline)?.[1].replace(/\s+/g, ' ');
  assert.equal(cond, "${{ !cancelled() && github.ref == 'refs/heads/main' && vars.ENABLE_PROD_SCHEDULES == 'true'"
    + " && (github.event_name != 'schedule' || needs.backup_guard.result != 'success'"
    + " || needs.backup_guard.outputs.run_pipeline == 'true') }}");
  // ADO-466: the skip path records a pipeline_skips row, never fails the guard, and is the only path
  // that pays for checkout + npm ci
  const skipSteps = guard.slice(guard.indexOf('- name: Checkout (skip path)'));
  assert.ok(skipSteps.length < guard.length, 'skip-path steps exist');
  for (const step of skipSteps.split(/\n\s+- name: /)) {
    assert.match(step, /if: steps\.check\.outputs\.run_pipeline == 'false'/, step);
    assert.match(step, /continue-on-error: true/, step);
  }
  assert.match(skipSteps, /SUPABASE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_KEY \}\}/);
  assert.match(skipSteps, /run: node scripts\/scotus\/record-backup-skip\.js/);
  assert.match(guard, /permissions:\s*\n\s+actions: read\s*\n\s+contents: read/, 'guard can list runs, and checkout can read the repo');
}

// --- the guard's check step, run for real in bash with a fake `gh` (Codex P2, ADO-644): only a dispatch
//     run whose FETCH step succeeded counts. A manual run with skip_fetch also concludes success, and
//     if it were counted, a day where Netlify then failed would get no fetch at all.
{
  const guard = workflow.slice(workflow.indexOf('  backup_guard:'), workflow.indexOf('  scotus_pipeline:'));
  const check = guard.slice(guard.indexOf('id: check'));
  // the step names the fetch step it looks for; a renamed fetch step must break this test, not the guard
  const fetchStep = /FETCH_STEP: "([^"]+)"/.exec(check)?.[1];
  assert.ok(fetchStep, 'the check step names the fetch step');
  assert.ok(workflow.includes(`      - name: ${fetchStep}\n`), `scotus_pipeline has a step named exactly "${fetchStep}"`);
  assert.match(check, /shell: bash/, 'bash -eo pipefail, so a failed gh call in a pipe is seen');
  const lines = check.slice(check.indexOf('run: |\n') + 'run: |\n'.length).split('\n');
  const script = lines.slice(0, lines.findIndex((l) => l.trim() && !l.startsWith('          '))).map((l) => l.slice(10)).join('\n');

  // Git's bash on Windows (System32\bash.exe is WSL, which cannot see this temp folder); bash elsewhere
  const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
  const ready = (process.platform !== 'win32' || existsSync(bash))
    && spawnSync(bash, ['-c', 'command -v jq && date -u -d "20 hours ago"']).status === 0;
  if (!ready) {
    console.log('scotus-trigger: guard script run SKIPPED (needs bash, GNU date and jq)');
  } else {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'scotus-guard-'));
    // jq stand-in that calls the real one: Windows jq ends lines with \r\n, Linux (the runner) with \n
    const realJq = spawnSync(bash, ['-c', 'command -v jq'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(dir, 'jq'), `#!/usr/bin/env bash\nset -o pipefail\n"${realJq}" "$@" | tr -d '\\r'\n`, { mode: 0o755 });
    // gh stand-in: `run list` prints list.json, `run view <id>` prints view-<id>.json, each through
    // --jq when given (as gh does); a missing file is a failed call.
    writeFileSync(path.join(dir, 'gh'), [
      '#!/usr/bin/env bash',
      'jqexpr=""; prev=""',
      'for a in "$@"; do [ "$prev" = "--jq" ] && jqexpr="$a"; prev="$a"; done',
      'case "$1 $2" in "run list") f="$FAKE_GH/list.json" ;; "run view") f="$FAKE_GH/view-$3.json" ;; *) exit 2 ;; esac',
      '[ -f "$f" ] || { echo "gh: HTTP 502" >&2; exit 1; }',
      'if [ -n "$jqexpr" ]; then jq -r "$jqexpr" "$f"; else cat "$f"; fi',
      '',
    ].join('\n'), { mode: 0o755 });
    const run = (list, views = {}) => {
      for (const f of ['list.json', 'view-1.json', 'view-2.json', 'out.txt']) rmSync(path.join(dir, f), { force: true });
      if (list) writeFileSync(path.join(dir, 'list.json'), JSON.stringify(list));
      for (const [id, steps] of Object.entries(views)) {
        writeFileSync(path.join(dir, `view-${id}.json`), JSON.stringify({ jobs: [
          { name: 'Backup guard (skip a cron run after the Netlify run)', steps: [] },
          { name: 'SCOTUS pipeline', steps: [{ name: 'Checkout', conclusion: 'success' }, ...steps] },
        ] }));
      }
      const res = spawnSync(bash, ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, FAKE_GH: dir,
          FETCH_STEP: fetchStep, GITHUB_REPOSITORY: 'o/r', GITHUB_OUTPUT: path.join(dir, 'out.txt') },
      });
      assert.equal(res.status, 0, res.stderr);
      return Object.fromEntries(readFileSync(path.join(dir, 'out.txt'), 'utf8').trim().split('\n').map((l) => l.split('=')));
    };
    const fetchWas = (conclusion) => [{ name: fetchStep, conclusion }];
    try {
      const done = (databaseId) => ({ databaseId, status: 'completed' });
      // Netlify's run fetched: skip
      assert.equal(run([done(1)], { 1: fetchWas('success') }).run_pipeline, 'false');
      // Codex's case: a manual skip_fetch run finished (fetch step skipped), Netlify never ran: fetch
      assert.equal(run([done(1)], { 1: fetchWas('skipped') }).run_pipeline, 'true');
      // ...and next to it a run that did fetch: skip
      assert.equal(run([done(1), done(2)], { 1: fetchWas('skipped'), 2: fetchWas('success') }).run_pipeline, 'false');
      // a run that failed AT the fetch: fetch again
      assert.equal(run([done(1)], { 1: fetchWas('failure') }).run_pipeline, 'true');
      // a run whose fetch worked but a later step failed it still counts: its flag alert already posted
      // (code review, November 28, 2026; the fake view carries step conclusions only, as the guard reads)
      assert.equal(run([done(1)], { 1: [...fetchWas('success'), { name: 'Refresh Tracker main line + tally', conclusion: 'failure' }] }).run_pipeline, 'false');
      // a run still in progress does not count: its fetch could still fail
      assert.equal(run([{ databaseId: 1, status: 'in_progress' }], { 1: fetchWas('success') }).run_pipeline, 'true');
      // fails open: the run list or a run's details cannot be read
      assert.equal(run(null).run_pipeline, 'true');
      assert.equal(run([done(1)]).run_pipeline, 'true');
      assert.equal(run([]).run_pipeline, 'true');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

// --- the skip row: scotus_fetch / backup_run_skipped, naming the run; never throws
{
  const inserted = [];
  const supabase = { from: (table) => ({ insert: async (row) => { inserted.push({ table, row }); return { error: null }; } }) };
  const env = { GITHUB_RUN_ID: '42', SINCE: '2026-11-27T01:47:00Z', FETCHED: '1' };
  assert.equal(await recordBackupSkip({ env, supabase, log: () => {} }), true);
  assert.deepEqual(inserted, [{ table: 'pipeline_skips', row: {
    pipeline: 'scotus_fetch', reason: 'backup_run_skipped', entity_type: 'workflow_run', entity_id: '42',
    metadata: { since: '2026-11-27T01:47:00Z', fetched_runs: 1 },
  } }]);
  const broken = { from: () => ({ insert: async () => { throw new Error('down'); } }) };
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await recordBackupSkip({ env, supabase: broken, log: () => {} }), false, 'a failed insert resolves false');
  } finally {
    console.warn = realWarn;
  }
  const logged = [];
  assert.equal(await recordBackupSkip({ env: {}, log: (l) => logged.push(l) }), false, 'no credentials: warns, no throw');
  assert.match(logged[0], /::warning::.*not set/);
}

// --- request shape: POST to the SCOTUS workflow, main ref and NO inputs (skip_fetch keeps its default)
{
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { status: 204, body: { cancel: async () => {} } }; };
  assert.deepEqual(await dispatchScotusRun(TOKEN, fetchImpl), { ok: true, status: 204 });
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, DISPATCH_URL);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(init.headers['User-Agent'], 'ttracker-scotus-trigger');
  assert.deepEqual(JSON.parse(init.body), { ref: 'main' });
}

// --- handler: 204 on success; 500 + error log + a SCOTUS Discord alert on failure
{
  const HOOK = 'https://discord.test/webhook';
  const realFetch = globalThis.fetch;
  const realError = console.error;
  const logged = [];
  let calls = [];
  const route = (githubStatus) => async (url, init) => {
    calls.push({ url, init });
    if (url === HOOK) return { ok: true, status: 204, text: async () => '' };
    return { status: githubStatus, text: async () => `{"message":"Bad credentials ${TOKEN}"}` };
  };
  try {
    console.error = (...a) => logged.push(a.join(' '));
    globalThis.Netlify = { env: { get: (k) => ({ [TOKEN_ENV]: TOKEN, DISCORD_WEBHOOK_URL: HOOK })[k] } };

    // success: one GitHub call to the SCOTUS workflow, no alert
    globalThis.fetch = route(204);
    assert.equal((await fn(undefined, PROD)).status, 204);
    assert.deepEqual(calls.map((c) => c.url), [DISPATCH_URL]);
    assert.equal(logged.length, 0);

    // failure: logged and alerted, without the token or the response body
    calls = [];
    globalThis.fetch = route(401);
    assert.equal((await fn(undefined, PROD)).status, 500);
    assert.match(logged[0], /\[scotus-trigger\] dispatch failed.*401/);
    assert.ok(!logged[0].includes(TOKEN) && !logged[0].includes('Bad credentials'));
    assert.deepEqual(calls.map((c) => c.url), [DISPATCH_URL, HOOK]);
    const alert = JSON.parse(calls[1].init.body).embeds[0];
    assert.equal(alert.title, 'SCOTUS trigger (Netlify) failed');
    assert.match(alert.description, /GitHub did not start the daily SCOTUS fetch: 401 github_rejected/);
    assert.match(alert.description, /waits for GitHub's late backup run/);
    assert.match(alert.description, /rss-prod-external-trigger\.md/);
    assert.ok(!calls[1].init.body.includes(TOKEN) && !calls[1].init.body.includes('Bad credentials'));
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
    delete globalThis.Netlify;
  }
}

console.log('scotus-trigger: all tests passed');
