// Test preload for scripts/fronts/front-agent-db.js (node --import <this file>): replaces fetch
// with a fake PostgREST so the script's reads and writes can be checked without a database.
// Every request is appended as one JSON line to FRONT_AGENT_MOCK_LOG (when set).
//   GET  events?...                  -> the agent fronts below (FRONT_AGENT_MOCK_EVENTS=fail -> HTTP 500)
//   POST story_event                 -> 201; story 999 -> 409 unique violation; story 998 -> 500
//   POST pipeline_skips              -> 201
//   POST rpc/front_agent_candidates_all -> 200 []
//   POST rpc/refresh_tracker_derived -> 200 [{rows_changed: 2, took_ms: 5}]
import { appendFileSync } from 'node:fs';

const FRONTS = [
  { id: 14, slug: 'election-suppression', name: 'Election Suppression', sweep_priority: 50, agent_definition: 'Election definition' },
  { id: 18, slug: 'ice-deportations', name: 'ICE & Deportations', sweep_priority: 72, agent_definition: 'ICE definition' },
  { id: 17, slug: 'rfk-hhs', name: "RFK Jr.'s HHS", sweep_priority: 85, agent_definition: '   ' }, // blank: not an agent front
];

const reply = (status, json) => new Response(json === undefined ? '' : JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const path = u.pathname.replace(/^\/rest\/v1\//, '');
  const body = init.body ? JSON.parse(init.body) : undefined;
  const method = init.method || 'GET';
  if (process.env.FRONT_AGENT_MOCK_LOG) appendFileSync(process.env.FRONT_AGENT_MOCK_LOG, `${JSON.stringify({ method, path, query: u.search, body })}\n`);

  if (method === 'GET' && path === 'events') {
    return process.env.FRONT_AGENT_MOCK_EVENTS === 'fail' ? reply(500, { message: 'boom' }) : reply(200, FRONTS);
  }
  if (method === 'POST' && path === 'story_event') {
    if (body.story_id === 999) return reply(409, { code: '23505', message: 'duplicate key' });
    if (body.story_id === 998) return reply(500, { message: 'server error' });
    return reply(201, [{ story_id: body.story_id }]);
  }
  if (method === 'POST' && path === 'pipeline_skips') return reply(201, [{ id: 1 }]);
  if (method === 'POST' && path === 'rpc/front_agent_candidates_all') return reply(200, []);
  if (method === 'POST' && path === 'rpc/refresh_tracker_derived') return reply(200, [{ rows_changed: 2, took_ms: 5 }]);
  return reply(404, { message: `mock: no route for ${method} ${path}` });
};
