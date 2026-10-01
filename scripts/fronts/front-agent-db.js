// ADO-582 follow-up: the ONLY database door for the election front assignment agent
// (docs/features/fronts-claude-agent/prompt-v1.md).
//
// WHY a script instead of curl in the prompt: on October 1, 2026 the cloud auto-mode
// classifier denied the PROD routine's very first read ("Production Reads"), and the
// routine's auto_mode_* fields did not clear it. Narrow permissions.allow rules are
// resolved BEFORE the classifier (code.claude.com/docs/en/auto-mode-config, "Route all
// shell commands through the classifier"), and a single-repo cloud session reads the
// repo's committed .claude/settings.json. So the owner approves this one script with one
// exact rule - Bash(node scripts/fronts/front-agent-db.js *) - and the script can only do
// the agent's designed job: read its pool, assign to ONE front, record a decline, refresh
// the main line, post one Discord line. No other table, front, or verb is reachable.
//
// Usage (each call is its own Bash command, starting exactly with `node scripts/...`):
//   node scripts/fronts/front-agent-db.js candidates <limit 1-25>
//   node scripts/fronts/front-agent-db.js assign <story_id> <confidence> "<rationale>"
//   node scripts/fronts/front-agent-db.js decline <story_id> <confidence> <run_id> <uncertain true|false> "<rationale>"
//   node scripts/fronts/front-agent-db.js refresh
//   node scripts/fronts/front-agent-db.js notify "<message>"
//
// Output: one JSON object (candidates: the RPC's JSON array) on stdout. Writes always exit 0
// with a status so the agent moves on to the next story; usage errors exit 2; a failed
// candidates/refresh call exits 1. FRONTS_DRY_RUN=true makes every write a no-op.
// Dependency-free on purpose: the cloud sandbox has no npm install step.
import { PIPELINES, REASONS } from '../lib/skip-reasons.js';

const FRONT_SLUG = 'election-suppression';
const PROMPT_VERSION = 'fronts-v1';
const TIMEOUT_MS = 30_000;

const out = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

function fail(code, message) {
  out({ ok: false, error: message });
  process.exit(code);
}

function env() {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url.startsWith('https://') || !key) fail(2, 'SUPABASE_URL (https://) and SUPABASE_SERVICE_ROLE_KEY must be set');
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

function storyIdArg(raw) {
  if (!/^[1-9]\d{0,12}$/.test(raw || '')) fail(2, `story_id must be a positive integer, got "${raw}"`);
  return Number(raw);
}

function confidenceArg(raw) {
  const n = Number(raw);
  if (!/^\d(\.\d{1,2})?$/.test(raw || '') || n < 0.5 || n > 1) fail(2, `confidence must be 0.50-1.00, got "${raw}"`);
  return n;
}

function textArg(raw, name, max) {
  const s = (raw || '').trim();
  if (!s) fail(2, `${name} is required`);
  return s.slice(0, max);
}

async function frontEventId() {
  const r = await rest(`events?slug=eq.${FRONT_SLUG}&select=id`);
  return r.status === 200 && Array.isArray(r.json) && r.json[0]?.id ? r.json[0].id : null;
}

async function skipRow(storyId, reason, metadata) {
  return rest('pipeline_skips', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      pipeline: PIPELINES.FRONT_ASSIGNMENT,
      reason,
      entity_type: 'story',
      entity_id: String(storyId),
      metadata: { front: FRONT_SLUG, prompt_version: PROMPT_VERSION, ...metadata },
    },
  });
}

async function candidates([limitRaw]) {
  const limit = Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) fail(2, `limit must be 1-25, got "${limitRaw}"`);
  const r = await rest('rpc/front_agent_candidates', { method: 'POST', body: { p_slug: FRONT_SLUG, p_limit: limit } });
  if (r.status !== 200 || !Array.isArray(r.json)) fail(1, `front_agent_candidates failed: HTTP ${r.status} ${r.text.slice(0, 300)}`);
  process.stdout.write(`${JSON.stringify(r.json)}\n`);
}

async function assign([sid, conf, rationale]) {
  const storyId = storyIdArg(sid);
  const confidence = confidenceArg(conf);
  const note = `${PROMPT_VERSION}: ${textArg(rationale, 'rationale', 300)}`;
  if (confidence < 0.7) fail(2, 'an assign needs confidence >= 0.70; record a borderline decline instead');
  if (isDryRun()) return out({ ok: true, status: 'dry_run', story_id: storyId });

  // Every failure leaves an api_error skip row (ADO-466) and reports whether that row landed.
  const failed = async (detail) => {
    const s = await skipRow(storyId, REASONS.API_ERROR, { error: detail.slice(0, 300), confidence });
    return out({ ok: false, status: 'error', story_id: storyId, error: detail.slice(0, 300), skip_row_written: s.status === 201 });
  };

  const eventId = await frontEventId();
  if (!eventId) return failed(`front ${FRONT_SLUG} lookup failed`);

  const r = await rest('story_event', {
    method: 'POST',
    prefer: 'return=representation',
    body: { story_id: storyId, event_id: eventId, assigned_by: 'agent', confidence, note },
  });
  if (r.status === 201 && Array.isArray(r.json) && r.json[0]?.story_id) return out({ ok: true, status: 'assigned', story_id: storyId });
  // Only a unique violation means "already assigned"; a 409 can also be a foreign-key
  // violation (23503) when the story was merged away between read and write.
  if (r.json?.code === '23505') return out({ ok: true, status: 'already_assigned', story_id: storyId });
  return failed(`HTTP ${r.status} ${r.text}`);
}

async function decline([sid, conf, runId, uncertainRaw, rationale]) {
  const storyId = storyIdArg(sid);
  const confidence = confidenceArg(conf);
  if (!/^[\w.:-]{1,80}$/.test(runId || '')) fail(2, `run_id must be 1-80 chars of [A-Za-z0-9_.:-], got "${runId}"`);
  if (uncertainRaw !== 'true' && uncertainRaw !== 'false') fail(2, `uncertain must be true or false, got "${uncertainRaw}"`);
  const text = textArg(rationale, 'rationale', 300);
  if (isDryRun()) return out({ ok: true, status: 'dry_run', story_id: storyId });

  const r = await skipRow(storyId, REASONS.AGENT_DECLINED, {
    confidence, rationale: text, run_id: runId, uncertain: uncertainRaw === 'true',
  });
  if (r.status === 201) return out({ ok: true, status: 'declined', story_id: storyId });
  return out({ ok: false, status: 'error', story_id: storyId, error: `HTTP ${r.status} ${r.text}`.slice(0, 300) });
}

async function refresh() {
  if (isDryRun()) return out({ ok: true, status: 'dry_run' });
  const r = await rest('rpc/refresh_tracker_derived', { method: 'POST', body: {} });
  const row = Array.isArray(r.json) ? r.json[0] : r.json;
  if (r.status !== 200 || !row) fail(1, `refresh_tracker_derived failed: HTTP ${r.status} ${r.text.slice(0, 300)}`);
  return out({ ok: true, status: 'refreshed', rows_changed: row.rows_changed, took_ms: row.took_ms });
}

async function notify([message]) {
  const text = textArg(message, 'message', 1900);
  const hook = process.env.DISCORD_WEBHOOK_URL;
  if (isDryRun() || !hook) return out({ ok: true, status: 'skipped' });
  try {
    const res = await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return out({ ok: res.ok, status: res.ok ? 'posted' : `http_${res.status}` });
  } catch (err) {
    return out({ ok: false, status: 'error', error: String(err?.message || err).slice(0, 200) });
  }
}

const COMMANDS = { candidates, assign, decline, refresh, notify };
const [verb, ...args] = process.argv.slice(2);
if (!Object.hasOwn(COMMANDS, verb)) fail(2, `unknown command "${verb}"; expected one of ${Object.keys(COMMANDS).join(', ')}`);
await COMMANDS[verb](args);
