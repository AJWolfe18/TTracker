#!/usr/bin/env node
/**
 * Clustering Judge inbox processor (ADO-583) - the TRUSTED half of the hand-off.
 *
 * The Judge routine pushes one verdict file on a judge-run/<env>/<run_id> branch. That branch is
 * untrusted input: whoever can push it (the routine's sandbox, a leaked push credential) controls
 * every file on it, including a copy of the executor and of the workflow. So nothing on an inbox
 * branch is ever checked out or executed. The "Clustering Judge Executor" workflow runs from the
 * default branch on a schedule, and this script (the default branch's copy):
 *
 *   collect <dir>        fetch the inbox branches as DATA and copy only
 *                        judge-inbox/<run_id>.json out of each one (git cat-file, no checkout)
 *                        into <dir>/<env>/<run_id>.json. Branch names are shape-checked; a file
 *                        over 1 MB is ignored.
 *   execute <dir> <env>  run execute-judge-verdicts.js (this checkout's copy) on each collected file
 *                        of one environment, with that environment's secrets in process.env:
 *                          exit 0 -> delete the inbox branch (processed)
 *                          exit 2 -> the file was rejected: park the branch under
 *                                    judge-rejected/<env>/<run_id> (alerts once, kept for a human)
 *                          exit 1 -> runtime failure: leave the branch, the next poll retries it
 *                                    (the executor is idempotent per run_id)
 *                        Exits 1 if anything failed or was rejected, so the workflow's alert fires.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RUN_ID_RE } from './execute-judge-verdicts.js';

export const MAX_FILE_BYTES = 1024 * 1024;
const INBOX_REMOTE_PREFIX = 'refs/remotes/inbox/';

/** judge-run/<test|prod>/<run_id> -> { env, runId }, anything else -> null. */
export function parseInboxBranch(branch) {
  const m = /^judge-run\/(test|prod)\/([^/]+)$/.exec(String(branch || ''));
  if (!m || !RUN_ID_RE.test(m[2])) return null;
  return { env: m[1], runId: m[2] };
}

/** What to do with an inbox branch after the executor ran on its file. */
export function actionForExit(code) {
  if (code === 0) return 'delete';
  if (code === 2) return 'park';
  return 'keep';
}

const git = (args, opts = {}) => spawnSync('git', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...opts });
const safe = (s) => String(s).replace(/[^A-Za-z0-9._/-]/g, '?'); // branch names go to the log sanitized

function collect(dir) {
  // Data only: the branches land under refs/remotes/inbox/, nothing is checked out.
  const heads = git(['ls-remote', '--heads', 'origin', 'refs/heads/judge-run/*']);
  if (heads.status !== 0) { console.error(`git ls-remote failed: ${heads.stderr}`); process.exit(1); }
  if (!heads.stdout.trim()) {
    console.log('0 verdict file(s) collected (no inbox branches)');
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'count=0\n');
    return;
  }
  // --depth=1 only in the (shallow) Actions checkout: one commit per branch is all that is read.
  const shallow = git(['rev-parse', '--is-shallow-repository']).stdout.trim() === 'true';
  const f = git(['fetch', '--no-tags', '--prune', ...(shallow ? ['--depth=1'] : []), 'origin', `+refs/heads/judge-run/*:${INBOX_REMOTE_PREFIX}judge-run/*`]);
  if (f.status !== 0) { console.error(`git fetch failed: ${f.stderr}`); process.exit(1); }
  const refs = git(['for-each-ref', '--format=%(refname)', `${INBOX_REMOTE_PREFIX}judge-run/`]).stdout.split('\n').filter(Boolean);
  let count = 0;
  for (const ref of refs) {
    const parsed = parseInboxBranch(ref.slice(INBOX_REMOTE_PREFIX.length));
    if (!parsed) { console.log(`ignoring branch with an unexpected name: ${safe(ref)}`); continue; }
    const blob = `${ref}:judge-inbox/${parsed.runId}.json`;
    const size = git(['cat-file', '-s', blob]);
    if (size.status !== 0) { console.log(`no verdict file on ${safe(ref)} - ignoring`); continue; }
    if (Number(size.stdout.trim()) > MAX_FILE_BYTES) { console.log(`verdict file on ${safe(ref)} is over ${MAX_FILE_BYTES} bytes - ignoring`); continue; }
    const out = path.join(dir, parsed.env, `${parsed.runId}.json`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, git(['cat-file', 'blob', blob], { encoding: 'buffer' }).stdout);
    console.log(`collected ${parsed.env}/${parsed.runId}`);
    count++;
  }
  console.log(`${count} verdict file(s) collected`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `count=${count}\n`);
}

function execute(dir, env) {
  if (env !== 'test' && env !== 'prod') { console.error('env must be test or prod'); process.exit(1); }
  const envDir = path.join(dir, env);
  const files = fs.existsSync(envDir) ? fs.readdirSync(envDir).filter((n) => n.endsWith('.json')).sort() : [];
  if (!files.length) { console.log(`no ${env} verdict files`); return; }
  const executor = fileURLToPath(new URL('./execute-judge-verdicts.js', import.meta.url)); // THIS checkout's copy
  let bad = 0;
  for (const name of files) {
    const runId = name.replace(/\.json$/, '');
    const branch = `judge-run/${env}/${runId}`;
    if (!parseInboxBranch(branch)) { console.log(`skipping unexpected file ${safe(name)}`); continue; }
    console.log(`--- ${branch}`);
    const r = spawnSync(process.execPath, [executor, path.join(envDir, name)], { stdio: 'inherit', env: { ...process.env, JUDGE_EXPECTED_ENV: env } });
    const action = actionForExit(r.status);
    if (action === 'delete') {
      const d = git(['push', 'origin', '--delete', `refs/heads/${branch}`]);
      console.log(d.status === 0 ? `processed - deleted ${branch}` : `processed - branch already gone or not deletable (non-blocking): ${d.stderr.trim()}`);
    } else if (action === 'park') {
      bad++;
      const parked = `refs/heads/judge-rejected/${env}/${runId}`;
      const p = git(['push', 'origin', `${INBOX_REMOTE_PREFIX}${branch}:${parked}`]);
      if (p.status === 0) git(['push', 'origin', '--delete', `refs/heads/${branch}`]);
      console.log(p.status === 0 ? `REJECTED - parked as judge-rejected/${env}/${runId}` : `REJECTED - could not park (${p.stderr.trim()}); branch left in place`);
    } else {
      bad++;
      console.log(`FAILED (exit ${r.status}) - ${branch} left in place, the next poll retries it`);
    }
  }
  if (bad) process.exit(1);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const [cmd, dir, env] = process.argv.slice(2);
  if (cmd === 'collect' && dir) collect(dir);
  else if (cmd === 'execute' && dir && env) execute(dir, env);
  else { console.error('usage: process-judge-inbox.js collect <dir> | execute <dir> <test|prod>'); process.exit(1); }
}
