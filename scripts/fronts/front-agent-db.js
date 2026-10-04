// ADO-582 follow-up, generalized to every front by ADO-592: the ONLY database door for the
// front assignment agent (docs/features/fronts-claude-agent/prompt-v1.md).
//
// WHY a script instead of curl in the prompt: on October 1, 2026 the cloud auto-mode
// classifier denied the PROD routine's very first read ("Production Reads"), and the
// routine's auto_mode_* fields did not clear it. Narrow permissions.allow rules are
// resolved BEFORE the classifier (code.claude.com/docs/en/auto-mode-config, "Route all
// shell commands through the classifier"), and a single-repo cloud session reads the
// repo's committed .claude/settings.json. So the owner approves this one script with one
// exact rule - Bash(node scripts/fronts/front-agent-db.js *) - and the script can only do
// the agent's designed job: read the agent fronts and the pool, assign a story to ONE of
// those fronts, record a "fits no front" decline, refresh the main line, post one Discord
// line. No other table, front, or verb is reachable.
//
// Agent fronts (ADO-592, migration 127): published events with agent_pattern AND
// agent_definition set - the same rule front_agent_candidates_all() uses for the pool.
// Every assign names its front by slug; the script looks the slug up among the agent
// fronts and refuses any other (never an id passed in).
//
// Usage (each call is its own Bash command, starting exactly with `node scripts/...`):
//   node scripts/fronts/front-agent-db.js fronts
//   node scripts/fronts/front-agent-db.js candidates <limit 1-25>
//   node scripts/fronts/front-agent-db.js record <file.json>
//   node scripts/fronts/front-agent-db.js assign <story_id> <front_slug> <confidence> "<rationale>"
//   node scripts/fronts/front-agent-db.js decline <story_id> <confidence> <run_id> <uncertain true|false> "<rationale>"
//   node scripts/fronts/front-agent-db.js refresh
//   node scripts/fronts/front-agent-db.js notify "<message>"
//
// `record` (September 30, 2026) writes one page of decisions per call instead of one call
// per story - the first PROD run spent ~90 tool calls on 80 stories. The file is
//   {"run_id": "...", "decisions": [{"story_id": 1, "decision": "assign"|"decline",
//     "front": "<slug, assign only>", "confidence": 0.85, "uncertain": false,
//     "rationale": "..."}, ...]}   (1-25 decisions)
// Every entry is validated before anything is written, including each assign's front
// against the agent fronts: one bad entry refuses the whole file (exit 2, nothing written)
// so the agent fixes it and calls again. Each decision is then written exactly as
// `assign` / `decline` would write it, and the output lists a status per story.
// `assign` / `decline` stay for retrying a single story.
//
// A decline means "fits no front": one pipeline_skips row with metadata.front = 'none' and
// metadata.judged_fronts = the agent fronts of this run. Migration 127 hides the story from
// exactly those fronts until it changes, so a front that gets its definition later still
// sees it. Old ADO-582 declines carry metadata.front = 'election-suppression' and hide it
// from that front only.
//
// Output: one JSON object (candidates: the RPC's JSON array) on stdout. Writes always exit 0
// with a status so the agent moves on to the next story; usage errors exit 2; a failed
// fronts/candidates/refresh call (or a failed front lookup before a write) exits 1.
// FRONTS_DRY_RUN=true makes every write a no-op (reads still run).
// Dependency-free on purpose: the cloud sandbox has no npm install step.
import { readFileSync, statSync } from 'node:fs';
import { PIPELINES, REASONS } from '../lib/skip-reasons.js';

const NO_FRONT = 'none';
const PROMPT_VERSION = 'fronts-v2';
const TIMEOUT_MS = 30_000;
const MAX_PAGE = 25;
const MAX_FILE_BYTES = 64 * 1024;

const out = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

function fail(code, message) {
  out({ ok: false, error: message });
  process.exit(code);
}

// Argument and file validation throw this; the dispatcher turns it into exit 2.
class UsageError extends Error {}
const usage = (message) => { throw new UsageError(message); };

function env() {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url.startsWith('https://') || !key) usage('SUPABASE_URL (https://) and SUPABASE_SERVICE_ROLE_KEY must be set');
  return { api: `${url.replace(/\/+$/, '')}/rest/v1`, key };
}

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const { api, key } = env();
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  try {
    const res = await fetch(`${api}/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body: keep text */ }
    return { status: res.status, json, text };
  } catch (err) {
    return { status: 0, json: null, text: String(err?.message || err) };
  }
}

const isDryRun = () => process.env.FRONTS_DRY_RUN === 'true';

// --- agent fronts: read once per process ----------------------------------------------

let frontsCache;
async function agentFronts() {
  if (frontsCache) return frontsCache;
  const r = await rest('events?publish_state=eq.published&agent_pattern=not.is.null&agent_definition=not.is.null'
    + '&select=id,slug,name,sweep_priority,agent_definition&order=sweep_priority.asc,id.asc');
  if (r.status !== 200 || !Array.isArray(r.json)) fail(1, `agent fronts lookup failed: HTTP ${r.status} ${r.text.slice(0, 300)}`);
  // A blank definition is no definition (the RPC uses NULLIF(btrim(...), '') the same way).
  frontsCache = r.json.filter((f) => typeof f.agent_definition === 'string' && f.agent_definition.trim());
  return frontsCache;
}

async function frontBySlug(slug) {
  const f = (await agentFronts()).find((x) => x.slug === slug);
  if (!f) usage(`front "${slug}" is not an agent front (published, with agent_pattern and agent_definition); run the fronts command for the list`);
  return f;
}

// --- validators: CLI args arrive as strings, record-file values as JSON values ---------

function storyId(raw) {
  const s = typeof raw === 'number' ? String(raw) : raw;
  if (typeof s !== 'string' || !/^[1-9]\d{0,12}$/.test(s)) usage(`story_id must be a positive integer, got "${raw}"`);
  return Number(s);
}

function frontSlug(raw) {
  if (typeof raw !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(raw) || raw === NO_FRONT) {
    usage(`front must be an agent front's slug (lowercase letters, digits, hyphens), got "${raw}"`);
  }
  return raw;
}

function confidence(raw) {
  const s = typeof raw === 'number' ? String(raw) : raw;
  const n = Number(s);
  if (typeof s !== 'string' || !/^(0(\.\d{1,2})?|1(\.0{1,2})?)$/.test(s) || n < 0.5 || n > 1) {
    usage(`confidence must be 0.50-1.00 with at most two decimals, got "${raw}"`);
  }
  return n;
}

function runIdArg(raw) {
  if (typeof raw !== 'string' || !/^[\w.:-]{1,80}$/.test(raw)) usage(`run_id must be 1-80 chars of [A-Za-z0-9_.:-], got "${raw}"`);
  return raw;
}

function text(raw, name, max) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) usage(`${name} is required`);
  return s.slice(0, max);
}

function assignDecision(sid, front, conf, rationale) {
  const d = { decision: 'assign', storyId: storyId(sid), front: frontSlug(front), confidence: confidence(conf), rationale: text(rationale, 'rationale', 300) };
  if (d.confidence < 0.7) usage('an assign needs confidence >= 0.70; record a borderline decline instead');
  return d;
}

function declineDecision(sid, conf, runId, uncertain, rationale) {
  return {
    decision: 'decline',
    storyId: storyId(sid),
    confidence: confidence(conf),
    runId: runIdArg(runId),
    uncertain,
    rationale: text(rationale, 'rationale', 300),
  };
}

// --- writes: return a result object; the verbs print it -------------------------------

async function skipRow(id, reason, front, metadata) {
  return rest('pipeline_skips', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      pipeline: PIPELINES.FRONT_ASSIGNMENT,
      reason,
      entity_type: 'story',
      entity_id: String(id),
      metadata: { front, prompt_version: PROMPT_VERSION, ...metadata },
    },
  });
}

// Callers resolve the front first (frontBySlug), so an unknown slug never reaches a write.
async function writeAssign({ storyId: id, front, confidence: conf, rationale }) {
  if (isDryRun()) return { ok: true, status: 'dry_run', story_id: id, front };
  const eventId = (await frontBySlug(front)).id;

  const r = await rest('story_event', {
    method: 'POST',
    prefer: 'return=representation',
    body: { story_id: id, event_id: eventId, assigned_by: 'agent', confidence: conf, note: `${PROMPT_VERSION}: ${front}: ${rationale}` },
  });
  if (r.status === 201 && Array.isArray(r.json) && r.json[0]?.story_id) return { ok: true, status: 'assigned', story_id: id, front };
  // Only a unique violation means "already assigned"; a 409 can also be a foreign-key
  // violation (23503) when the story was merged away between read and write.
  if (r.json?.code === '23505') return { ok: true, status: 'already_assigned', story_id: id, front };
  // Every other failure leaves an api_error skip row (ADO-466) and reports whether it landed.
  const detail = `HTTP ${r.status} ${r.text}`.slice(0, 300);
  const s = await skipRow(id, REASONS.API_ERROR, front, { error: detail, confidence: conf });
  return { ok: false, status: 'error', story_id: id, front, error: detail, skip_row_written: s.status === 201 };
}

async function writeDecline({ storyId: id, confidence: conf, runId, uncertain, rationale }) {
  if (isDryRun()) return { ok: true, status: 'dry_run', story_id: id };
  const judged = (await agentFronts()).map((f) => f.slug);
  const r = await skipRow(id, REASONS.AGENT_DECLINED, NO_FRONT, { confidence: conf, rationale, run_id: runId, uncertain, judged_fronts: judged });
  if (r.status === 201) return { ok: true, status: 'declined', story_id: id };
  return { ok: false, status: 'error', story_id: id, error: `HTTP ${r.status} ${r.text}`.slice(0, 300) };
}

const write = (d) => (d.decision === 'assign' ? writeAssign(d) : writeDecline(d));

// --- verbs ----------------------------------------------------------------------------

async function fronts() {
  env();
  const list = await agentFronts();
  out({
    ok: true,
    fronts: list.map((f) => ({ slug: f.slug, name: f.name, sweep_priority: f.sweep_priority, definition: f.agent_definition })),
  });
}

async function candidates([limitRaw]) {
  const limit = Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) usage(`limit must be 1-${MAX_PAGE}, got "${limitRaw}"`);
  const r = await rest('rpc/front_agent_candidates_all', { method: 'POST', body: { p_limit: limit } });
  if (r.status !== 200 || !Array.isArray(r.json)) fail(1, `front_agent_candidates_all failed: HTTP ${r.status} ${r.text.slice(0, 300)}`);
  process.stdout.write(`${JSON.stringify(r.json)}\n`);
}

async function assign([sid, front, conf, rationale]) {
  const d = assignDecision(sid, front, conf, rationale);
  env();
  await frontBySlug(d.front);
  out(await writeAssign(d));
}

async function decline([sid, conf, runId, uncertainRaw, rationale]) {
  if (uncertainRaw !== 'true' && uncertainRaw !== 'false') usage(`uncertain must be true or false, got "${uncertainRaw}"`);
  const d = declineDecision(sid, conf, runId, uncertainRaw === 'true', rationale);
  env();
  out(await writeDecline(d));
}

function readDecisionFile(path) {
  // Relative or absolute, plain characters only, .json, never a parent-directory hop.
  if (typeof path !== 'string' || !/^[\w./-]{1,200}\.json$/.test(path) || path.split('/').includes('..')) {
    usage(`file must be a .json path of [A-Za-z0-9_./-] without "..", got "${path}"`);
  }
  let size;
  try { size = statSync(path).size; } catch { usage(`cannot read ${path}`); }
  if (size > MAX_FILE_BYTES) usage(`${path} is ${size} bytes; the limit is ${MAX_FILE_BYTES}`);
  let doc;
  try { doc = JSON.parse(readFileSync(path, 'utf8')); } catch (err) { usage(`${path} is not valid JSON: ${err.message}`); }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) usage('the file must be a JSON object {"run_id": ..., "decisions": [...]}');
  const runId = runIdArg(doc.run_id);
  const list = doc.decisions;
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_PAGE) usage(`decisions must be an array of 1-${MAX_PAGE} entries`);

  const seen = new Set();
  return list.map((e, i) => {
    try {
      if (!e || typeof e !== 'object' || Array.isArray(e)) usage('each decision must be an object');
      let d;
      if (e.decision === 'assign') d = assignDecision(e.story_id, e.front, e.confidence, e.rationale);
      else if (e.decision === 'decline') {
        if (e.front !== undefined && e.front !== null) usage('a decline means "fits no front" and takes no front');
        if (typeof e.uncertain !== 'boolean') usage(`uncertain must be true or false, got "${e.uncertain}"`);
        d = declineDecision(e.story_id, e.confidence, runId, e.uncertain, e.rationale);
      } else usage(`decision must be "assign" or "decline", got "${e.decision}"`);
      if (seen.has(d.storyId)) usage(`story ${d.storyId} appears twice`);
      seen.add(d.storyId);
      return d;
    } catch (err) {
      if (err instanceof UsageError) usage(`decisions[${i}]: ${err.message}`);
      throw err;
    }
  });
}

async function record([path]) {
  const decisions = readDecisionFile(path);
  env();
  // Second pass, still before any write: read the agent fronts (declines record them too)
  // and check that every assign names one of them.
  await agentFronts();
  for (const [i, d] of decisions.entries()) {
    if (d.decision !== 'assign') continue;
    try { await frontBySlug(d.front); } catch (err) {
      if (err instanceof UsageError) usage(`decisions[${i}]: ${err.message}`);
      throw err;
    }
  }
  const results = [];
  for (const d of decisions) results.push({ decision: d.decision, ...(await write(d)) }); // sequential: one row at a time
  const count = (s) => results.filter((r) => r.status === s).length;
  const byFront = {};
  for (const r of results) if (r.status === 'assigned') byFront[r.front] = (byFront[r.front] || 0) + 1;
  out({
    ok: results.every((r) => r.ok),
    status: isDryRun() ? 'dry_run' : 'recorded',
    judged: results.length,
    assigned: count('assigned'),
    assigned_by_front: byFront,
    already_assigned: count('already_assigned'),
    declined: count('declined'),
    uncertain: decisions.filter((d) => d.decision === 'decline' && d.uncertain).length,
    errors: count('error'),
    results,
  });
}

async function refresh() {
  env();
  if (isDryRun()) return out({ ok: true, status: 'dry_run' });
  const r = await rest('rpc/refresh_tracker_derived', { method: 'POST', body: {} });
  const row = Array.isArray(r.json) ? r.json[0] : r.json;
  if (r.status !== 200 || !row) fail(1, `refresh_tracker_derived failed: HTTP ${r.status} ${r.text.slice(0, 300)}`);
  return out({ ok: true, status: 'refreshed', rows_changed: row.rows_changed, took_ms: row.took_ms });
}

async function notify([message]) {
  const msg = text(message, 'message', 1900);
  const hook = process.env.DISCORD_WEBHOOK_URL;
  if (isDryRun() || !hook) return out({ ok: true, status: 'skipped' });
  try {
    const res = await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: msg }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return out({ ok: res.ok, status: res.ok ? 'posted' : `http_${res.status}` });
  } catch (err) {
    return out({ ok: false, status: 'error', error: String(err?.message || err).slice(0, 200) });
  }
}

const COMMANDS = { fronts, candidates, record, assign, decline, refresh, notify };
const [verb, ...args] = process.argv.slice(2);
if (!Object.hasOwn(COMMANDS, verb)) fail(2, `unknown command "${verb}"; expected one of ${Object.keys(COMMANDS).join(', ')}`);
try {
  await COMMANDS[verb](args);
} catch (err) {
  if (err instanceof UsageError) fail(2, err.message);
  throw err;
}
