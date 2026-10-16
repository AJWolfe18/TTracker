#!/usr/bin/env node
// ADO-634: the Clustering Judge agent's only door for fetching its candidate pairs and publishing its
// verdict file (docs/features/clustering-judge/prompt-v1.md, Steps 2, 6 and 7).
//
// WHY a script instead of improvised Bash: from October 2 to October 15, 2026 the cloud auto-mode
// classifier denied 6 of about 42 PROD Judge runs ("Modify Shared Resources", "Blind Apply"). Every
// denial hit a one-off heredoc or node snippet the agent wrote to turn its 30 verdicts into the
// verdict file; the judging itself was finished each time and nothing was published. The routine's
// auto_mode_* fields (playbook option 1) stopped being enough. Narrow permissions.allow rules are
// resolved BEFORE the classifier, so the owner approves this one committed script with one exact rule
// - Bash(node scripts/clustering/judge-publish.js *) - the same fix that has kept the election front
// routine clean since October 1 (docs/reference/cloud-classifier-playbook.md, option 2).
//
// The script can only do the agent's designed job: read the candidate RPC with the fixed production
// knobs, and publish ONE verdict file on a judge-run/<env>/<run_id> branch. It never writes to the
// database; the executor workflow on main still does every write (ADO-583).
//
// Usage (each call is its own Bash command, starting exactly with `node scripts/...`):
//   node scripts/clustering/judge-publish.js candidates
//   node scripts/clustering/judge-publish.js publish <decisions.json>
//
// `candidates` generates the run id, calls get_clustering_judge_candidates(0.83, 7, 30), saves the raw
// RPC rows next to the decisions path it prints, and prints the pairs (without membership_seen_at,
// which the script echoes into the verdict file itself, verbatim).
//
// `publish` reads the agent's decisions file (written with the Write tool, so no shell quoting):
//   {"run_id": "<from candidates>", "decisions": [{"story_id_a": 1, "story_id_b": 2,
//     "verdict": "merge"|"keep"|"uncertain", "confidence": 0.9, "rationale": "...",
//     "survivor_id": 1, "loser_id": 2}, ...]}       (survivor/loser on merge verdicts only)
// It builds judge-inbox/<run_id>.json in the executor's schema (headlines, centroid_sim and
// evidence_as_of come from the saved candidates, never from the agent), runs the executor's own
// validateVerdictFile, then commits the file alone on judge-run/<env>/<run_id> and pushes it (one
// retry). Calling it again for the same run is safe: an existing branch is reused, and an unchanged
// file is not committed twice.
//
// Output: one JSON object on stdout. Exit 0 = done; 2 = the decisions file is wrong (nothing
// written; fix the file and call again); 1 = a runtime failure (RPC, git or push).
// Dependency-free on purpose: the cloud sandbox has no npm install step.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SCHEMA, RUN_ID_RE, pairKey, validateVerdictFile, envFromSupabaseUrl } from './execute-judge-verdicts.js';
import { MAX_FILE_BYTES } from './process-judge-inbox.js';

export const PROMPT_VERSION = 'judge-v1.3';
export const RPC_ARGS = Object.freeze({ p_min_sim: 0.83, p_days: 7, p_max_pairs: 30 });
const TIMEOUT_MS = 30_000;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const out = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const isPosInt = (n) => Number.isInteger(n) && n > 0;

class UsageError extends Error {}

// Scratch lives INSIDE the repo working tree (gitignored), not in /tmp: the agent writes the
// decisions file there with the Write tool, and a write inside the project is not the kind of
// out-of-tree write the cloud classifier screens. Only judge-inbox/<run_id>.json is ever committed.
export const runDir = (runId, base = join(REPO_ROOT, '.judge-work')) => join(base, runId);
export const newRunId = (now = new Date()) => `judge-${now.toISOString().replace(/:/g, '-')}`;

/**
 * Build the executor's verdict file from the saved candidate rows and the agent's decisions.
 * Returns { doc, problems } - a non-empty problems list means nothing may be published.
 * Merge verdicts go first, highest confidence first (the executor runs merges in file order under
 * its cap of 10); everything else keeps the candidate RPC's order.
 */
export function buildVerdictFile(candidates, decisionsDoc, { supabaseUrl, judgeDryRun }) {
  const problems = [];
  if (!Array.isArray(candidates)) return { doc: null, problems: ['saved candidates are not an array'] };
  if (!decisionsDoc || typeof decisionsDoc !== 'object' || !Array.isArray(decisionsDoc.decisions)) {
    return { doc: null, problems: ['decisions file must be {"run_id": "...", "decisions": [...]}'] };
  }

  const byPair = new Map();
  candidates.forEach((c, order) => byPair.set(pairKey(c.story_id_a, c.story_id_b), { c, order }));

  const seen = new Set();
  const verdicts = [];
  decisionsDoc.decisions.forEach((d, i) => {
    const at = `decisions[${i}]`;
    if (!d || typeof d !== 'object') { problems.push(`${at} is not an object`); return; }
    if (!isPosInt(d.story_id_a) || !isPosInt(d.story_id_b)) { problems.push(`${at}: story_id_a/story_id_b must be integers (JSON numbers, not strings)`); return; }
    const key = pairKey(d.story_id_a, d.story_id_b);
    const hit = byPair.get(key);
    if (!hit) { problems.push(`${at}: pair ${key} is not one of this run's candidates`); return; }
    if (seen.has(key)) { problems.push(`${at}: pair ${key} has more than one decision`); return; }
    seen.add(key);
    const { c, order } = hit;
    const v = {
      story_id_a: c.story_id_a, story_id_b: c.story_id_b,
      headline_a: c.headline_a ?? '', headline_b: c.headline_b ?? '',
      verdict: d.verdict,
      confidence: d.confidence,
      rationale: d.rationale,
      centroid_sim: c.centroid_sim ?? null,
    };
    // Echoed verbatim from the RPC; omitted when the RPC did not return it (NULL degrades safely).
    if (c.membership_seen_at != null) v.evidence_as_of = String(c.membership_seen_at);
    if (d.verdict === 'merge') { v.survivor_id = d.survivor_id; v.loser_id = d.loser_id; }
    verdicts.push({ v, order });
  });

  const missing = candidates
    .map((c) => pairKey(c.story_id_a, c.story_id_b))
    .filter((k) => !seen.has(k));
  if (missing.length) problems.push(`no decision for ${missing.length} candidate pair(s): ${missing.join(', ')}`);

  const conf = (x) => (typeof x.v.confidence === 'number' ? x.v.confidence : 0);
  verdicts.sort((x, y) => {
    const mx = x.v.verdict === 'merge', my = y.v.verdict === 'merge';
    if (mx !== my) return mx ? -1 : 1;
    if (mx && conf(y) !== conf(x)) return conf(y) - conf(x);
    return x.order - y.order;
  });

  const doc = {
    schema: SCHEMA,
    run_id: decisionsDoc.run_id,
    environment: envFromSupabaseUrl(supabaseUrl),
    dry_run: judgeDryRun !== 'false',
    prompt_version: PROMPT_VERSION,
    candidates: candidates.length,
    verdicts: verdicts.map((x) => x.v),
  };
  // The validator numbers verdicts in the sorted file; name the pair instead so the agent can find
  // the entry in its own decisions file.
  problems.push(...validateVerdictFile(doc, { supabaseUrl }).map((p) => p.replace(/^verdicts\[(\d+)\]/, (m, i) => {
    const v = doc.verdicts[Number(i)];
    return v ? `pair ${pairKey(v.story_id_a, v.story_id_b)}` : m;
  })));
  return { doc, problems };
}

function env() {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url.startsWith('https://') || !key) throw new UsageError('SUPABASE_URL (https://) and SUPABASE_SERVICE_ROLE_KEY must be set');
  return { url: url.replace(/\/+$/, ''), key };
}

async function cmdCandidates() {
  const { url, key } = env();
  const runId = newRunId();
  let res;
  try {
    res = await fetch(`${url}/rest/v1/rpc/get_clustering_judge_candidates`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(RPC_ARGS),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    out({ ok: false, error: `candidate RPC unreachable: ${e.message}` });
    return 1;
  }
  const text = await res.text();
  if (!res.ok) { out({ ok: false, error: `candidate RPC HTTP ${res.status}: ${text.slice(0, 300)}` }); return 1; }
  let rows;
  try { rows = JSON.parse(text); } catch { rows = null; }
  if (!Array.isArray(rows)) { out({ ok: false, error: 'candidate RPC did not return a JSON array' }); return 1; }

  const dir = runDir(runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'candidates.json'), JSON.stringify(rows));
  out({
    ok: true,
    run_id: runId,
    environment: envFromSupabaseUrl(url),
    dry_run: process.env.JUDGE_DRY_RUN !== 'false',
    decisions_path: join(dir, 'decisions.json'),
    count: rows.length,
    pairs: rows.map((r) => ({
      story_id_a: r.story_id_a, story_id_b: r.story_id_b,
      headline_a: r.headline_a, headline_b: r.headline_b,
      centroid_sim: r.centroid_sim, shared_entities: r.shared_entities, shared_slugs: r.shared_slugs,
    })),
  });
  return 0;
}

const git = (args) => spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const gitErr = (r) => `${(r.stderr || r.stdout || r.error?.message || '').trim().slice(0, 400)}`;

function cmdPublish(decisionsPath) {
  if (!decisionsPath) throw new UsageError('usage: publish <decisions.json>');
  const { url } = env();
  let raw;
  try { raw = readFileSync(decisionsPath, 'utf8'); } catch (e) { throw new UsageError(`cannot read ${decisionsPath}: ${e.message}`); }
  if (Buffer.byteLength(raw) > MAX_FILE_BYTES) throw new UsageError(`decisions file is over ${MAX_FILE_BYTES} bytes`);
  let decisionsDoc;
  try { decisionsDoc = JSON.parse(raw); } catch (e) { throw new UsageError(`decisions file is not valid JSON: ${e.message}`); }
  const runId = decisionsDoc?.run_id;
  if (typeof runId !== 'string' || !RUN_ID_RE.test(runId)) throw new UsageError('decisions run_id must be the run_id printed by `candidates`');
  const candPath = join(runDir(runId), 'candidates.json');
  if (!existsSync(candPath)) throw new UsageError(`no saved candidates for ${runId}: run \`candidates\` first and use its run_id`);
  let candidates;
  try { candidates = JSON.parse(readFileSync(candPath, 'utf8')); } catch (e) {
    out({ ok: false, error: `saved candidates for ${runId} are unreadable (${e.message}); nothing was published - run \`candidates\` again and re-judge` });
    return 1;
  }

  const { doc, problems } = buildVerdictFile(candidates, decisionsDoc, { supabaseUrl: url, judgeDryRun: process.env.JUDGE_DRY_RUN });
  if (problems.length) { out({ ok: false, error: 'decisions rejected, nothing written', problems }); return 2; }

  const rel = `judge-inbox/${runId}.json`;
  const branch = `judge-run/${doc.environment}/${runId}`;
  // Reuse the branch on a second call for the same run (e.g. after a failed push).
  const onBranch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout?.trim() === branch;
  if (!onBranch) {
    const exists = git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).status === 0;
    const co = git(exists ? ['checkout', '-q', branch] : ['checkout', '-q', '-b', branch]);
    if (co.status !== 0) { out({ ok: false, error: `git checkout failed: ${gitErr(co)}` }); return 1; }
  }
  mkdirSync(join(REPO_ROOT, 'judge-inbox'), { recursive: true });
  writeFileSync(join(REPO_ROOT, rel), `${JSON.stringify(doc, null, 2)}\n`);
  const add = git(['add', '--', rel]);
  if (add.status !== 0) { out({ ok: false, error: `git add failed: ${gitErr(add)}` }); return 1; }
  const staged = git(['diff', '--cached', '--quiet', '--', rel]).status !== 0;
  if (staged) {
    const commit = git(['-c', 'user.name=Clustering Judge', '-c', 'user.email=judge@trumpytracker.local',
      'commit', '-q', '-m', `judge: verdicts ${runId} (${doc.environment})`, '--', rel]);
    if (commit.status !== 0) { out({ ok: false, error: `git commit failed: ${gitErr(commit)}` }); return 1; }
  }
  let push = git(['push', '-q', 'origin', branch]);
  if (push.status !== 0) push = git(['push', '-q', 'origin', branch]);
  if (push.status !== 0) { out({ ok: false, error: `git push failed twice: ${gitErr(push)}`, branch }); return 1; }

  const count = (name) => doc.verdicts.filter((v) => v.verdict === name).length;
  out({ ok: true, published: branch, file: rel, dry_run: doc.dry_run, verdicts: doc.verdicts.length,
    merge: count('merge'), keep: count('keep'), uncertain: count('uncertain') });
  return 0;
}

async function main(argv) {
  const [verb, arg] = argv;
  if (verb === 'candidates') return cmdCandidates();
  if (verb === 'publish') return cmdPublish(arg);
  throw new UsageError('usage: candidates | publish <decisions.json>');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  // exitCode, not process.exit(): let a large `candidates` payload drain from a piped stdout.
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e) => {
      out({ ok: false, error: e.message });
      process.exitCode = e instanceof UsageError ? 2 : 1;
    });
}
