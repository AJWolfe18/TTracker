#!/usr/bin/env node
// Runs Josh's local Codex review on the working tree, from a brief file (Josh, November 28, 2026:
// Claude runs Codex itself instead of handing him the brief).
//
// The Codex desktop app bundles its CLI at %LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe; the
// hash folder changes when the app updates, so this picks the newest codex.exe each time. It runs
// with Josh's signed-in account and ~/.codex/config.toml (his model and effort), read-only, in this
// repo, so it sees the uncommitted changes. (`codex review --uncommitted` cannot take a brief.)
//
// Usage: npm run codex:review -- <brief.md> [out.md]
//   The brief must tell Codex to run `git status` first and stop if it cannot see the working tree
//   (checked below). The final answer is written to out.md (default: <brief>.result.md) and printed.
//   Exit 0 = a fresh, non-empty answer was printed; 1 = Codex failed; 2 = bad arguments or no codex.exe.

import { existsSync, readdirSync, statSync, readFileSync, openSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TIMEOUT_MS = 20 * 60 * 1000; // a stuck run (expired login, network) must not hang the session

const fail = (code, message) => {
  process.stderr.write(`[codex-review] ${message}\n`);
  process.exit(code);
};

function newestCodex() {
  const bin = path.join(process.env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin');
  if (!existsSync(bin)) return null;
  const found = readdirSync(bin)
    .map((d) => path.join(bin, d, 'codex.exe'))
    .filter((f) => existsSync(f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return found[0] ?? null;
}

// npm runs scripts from the repo root; INIT_CWD is where the command was typed
const callerDir = process.env.INIT_CWD || process.cwd();
const [briefArg, outArg] = process.argv.slice(2);
if (!briefArg) fail(2, 'Usage: npm run codex:review -- <brief.md> [out.md]');
const brief = path.resolve(callerDir, briefArg);
if (!existsSync(brief)) fail(2, `brief not found: ${brief}`);
const opening = readFileSync(brief, 'utf8').split('\n').filter((l) => l.trim()).slice(0, 5).join('\n');
if (!/git status/i.test(opening)) {
  fail(2, 'the brief must open by telling Codex to run `git status` and stop if it cannot see the working tree');
}
const out = path.resolve(callerDir, outArg || brief.replace(/\.md$/, '') + '.result.md');
// out is deleted before the run, so it must never be the brief (Windows paths ignore case)
if (out.toLowerCase() === brief.toLowerCase()) fail(2, 'the output file cannot be the brief itself');
const codex = newestCodex();
if (!codex) fail(2, 'codex.exe not found under %LOCALAPPDATA%\\OpenAI\\Codex\\bin: is the Codex desktop app installed?');

// A leftover answer from an earlier run must never pass for this run's
rmSync(out, { force: true });
process.stdout.write(`[codex-review] ${codex}\n[codex-review] brief ${brief} -> ${out}\n`);
const res = spawnSync(codex, ['exec', '-s', 'read-only', '-C', repo, '-o', out, '-'], {
  stdio: [openSync(brief, 'r'), 'ignore', 'inherit'],
  timeout: TIMEOUT_MS,
});
if (res.error?.code === 'ETIMEDOUT') fail(1, `codex did not finish within ${TIMEOUT_MS / 60000} minutes (login expired? network?)`);
if (res.signal) fail(1, `codex was stopped by ${res.signal}`);
if (res.status !== 0) fail(1, `codex exited ${res.status ?? res.error?.message}`);
const answer = existsSync(out) ? readFileSync(out, 'utf8').trim() : '';
if (!answer) fail(1, 'codex exited 0 but wrote no answer: treat this as NO review, not a clean one');
process.stdout.write(`\n${answer}\n`);
