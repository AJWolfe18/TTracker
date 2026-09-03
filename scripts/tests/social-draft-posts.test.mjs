// ADO-572 AC 3 + AC 4 + AC 6: the drafter against a fake PostgREST.
// - inserts one row per candidate, advances per-type watermarks
// - 23505 on re-run -> pipeline_skips social_draft/already_drafted, no throw
// - Discord embed carries the draft count + admin link, only when created > 0
// - SOCIAL_AUTO_APPROVE_ALARM5=true creates rows as approved
// - --dry-run writes nothing
import assert from 'node:assert/strict';
import { runDraftPosts } from '../social/draft-posts.js';
import { PIPELINES, REASONS } from '../lib/skip-reasons.js';

const ENV = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', SITE_ORIGIN: 'https://test.example', DISCORD_WEBHOOK_URL: 'https://discord.test/hook' };

function fixture({ existing = new Set(), watermarks = {} } = {}) {
  const calls = { inserts: [], upserts: [], discord: [], skips: [] };
  const rowsFor = {
    '/stories': [{ id: 16879, primary_headline: 'Judges Fired', summary_spicy: 'They did it. Again.', alarm_level: 5, source_count: 4, last_updated_at: '2026-09-01T10:00:00Z' }],
    '/executive_orders': [{ id: 'eo_1', title: 'Order One', spicy_summary: 'Bad. Worse.', alarm_level: 5, updated_at: '2026-09-01T11:00:00Z' }],
    '/pardons': [],
  };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const path = u.pathname.replace('/rest/v1', '');
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (u.hostname === 'discord.test') { calls.discord.push(JSON.parse(init.body)); return new Response(null, { status: 204 }); }
    if (!init.method || init.method === 'GET') {
      if (path === '/social_state') return json(Object.entries(watermarks).map(([key, value]) => ({ key, value })));
      assert.ok(u.searchParams.get('select') && u.searchParams.get('select') !== '*', 'never select *');
      return json(rowsFor[path] ?? []);
    }
    if (init.method === 'POST' && path === '/social_posts') {
      const row = JSON.parse(init.body);
      const k = `${row.platform}/${row.entity_type}/${row.entity_id}`;
      if (existing.has(k)) return json({ code: '23505', message: 'duplicate key value violates unique constraint' }, 409);
      existing.add(k); calls.inserts.push(row);
      return new Response('', { status: 201 });
    }
    if (init.method === 'POST' && path === '/social_state') {
      assert.ok(init.headers.Prefer.includes('merge-duplicates'));
      calls.upserts.push(JSON.parse(init.body));
      return new Response('', { status: 201 });
    }
    throw new Error(`unexpected ${init.method} ${path}`);
  };
  const supabase = { from: (table) => ({ insert: async (row) => { calls.skips.push({ table, row }); return { error: null }; } }) };
  return { fetchImpl, supabase, calls, existing };
}

const silent = () => {};

// 1) fresh run: two drafts, two watermarks advanced, one Discord ping
{
  const f = fixture({ watermarks: { draft_watermark_story: '2026-08-01T00:00:00Z', draft_watermark_eo: '2026-08-01T00:00:00Z', draft_watermark_pardon: '2026-08-01T00:00:00Z' } });
  const r = await runDraftPosts({ env: ENV, argv: [], fetchImpl: f.fetchImpl, supabase: f.supabase, log: silent });
  assert.equal(r.created, 2);
  assert.equal(r.skipped, 0);
  assert.equal(f.calls.inserts.length, 2);
  const story = f.calls.inserts.find((x) => x.entity_type === 'story');
  assert.equal(story.status, 'draft');
  assert.equal(story.approved_at, null);
  assert.equal(story.entity_id, '16879');
  assert.equal(story.link_url, 'https://test.example/detail/16879?utm_source=facebook&utm_medium=social&utm_campaign=auto');
  assert.equal(story.image_url, 'https://test.example/api/og-image/detail/16879.png');
  assert.ok(story.copy.startsWith('Judges Fired\n\nThey did it.\n\nLEVEL 5 · CRISIS  |  4 sources\n'));
  const eo = f.calls.inserts.find((x) => x.entity_type === 'eo');
  assert.equal(eo.entity_id, 'eo_1');
  assert.equal(eo.image_url, 'https://test.example/api/og-image/eos/eo_1.png');
  // watermarks: story + eo advanced, pardon untouched (no rows)
  assert.deepEqual(f.calls.upserts.map((u) => [u.key, u.value]).sort(), [['draft_watermark_eo', '2026-09-01T11:00:00Z'], ['draft_watermark_story', '2026-09-01T10:00:00Z']]);
  // Discord: count + admin link
  assert.equal(f.calls.discord.length, 1);
  const embed = f.calls.discord[0].embeds[0];
  assert.equal(embed.title, '2 social drafts waiting for approval');
  assert.ok(embed.description.includes('https://test.example/admin.html'));
  assert.equal(f.calls.skips.length, 0);

  // 2) re-run: same candidates -> 23505 -> skips recorded, nothing created, no ping
  const r2 = await runDraftPosts({ env: ENV, argv: [], fetchImpl: f.fetchImpl, supabase: f.supabase, log: silent });
  assert.equal(r2.created, 0);
  assert.equal(r2.skipped, 2);
  assert.equal(f.calls.inserts.length, 2, 'no duplicate rows');
  assert.equal(f.calls.skips.length, 2);
  assert.equal(f.calls.skips[0].table, 'pipeline_skips');
  assert.equal(f.calls.skips[0].row.pipeline, PIPELINES.SOCIAL_DRAFT);
  assert.equal(f.calls.skips[0].row.reason, REASONS.ALREADY_DRAFTED);
  assert.equal(f.calls.discord.length, 1, 'no ping when nothing was created');
}

// 3) auto-approve switch (D8)
{
  const f = fixture();
  const r = await runDraftPosts({ env: { ...ENV, SOCIAL_AUTO_APPROVE_ALARM5: 'true' }, argv: [], fetchImpl: f.fetchImpl, supabase: f.supabase, log: silent });
  assert.equal(r.created, 2);
  for (const row of f.calls.inserts) {
    assert.equal(row.status, 'approved');
    assert.ok(row.approved_at, 'approved_at set');
  }
  assert.ok(f.calls.discord[0].embeds[0].description.includes('auto-approve on'));
}

// 4) dry run: prints, writes nothing, pings nothing; --since overrides watermarks
{
  const f = fixture({ watermarks: { draft_watermark_story: '2099-01-01T00:00:00Z' } });
  const seen = [];
  const r = await runDraftPosts({ env: ENV, argv: ['--dry-run', '--since', '2026-01-01T00:00:00Z'], fetchImpl: f.fetchImpl, supabase: f.supabase, log: (m) => seen.push(String(m)) });
  assert.equal(r.created, 0);
  assert.equal(r.drafts.length, 2, '--since beat the 2099 watermark');
  assert.equal(f.calls.inserts.length, 0);
  assert.equal(f.calls.upserts.length, 0);
  assert.equal(f.calls.discord.length, 0);
  assert.ok(seen.some((m) => m.includes('LEVEL 5 · CRISIS')), 'dry run prints the copy');
}

// 5) no webhook configured -> still succeeds
{
  const f = fixture();
  const { DISCORD_WEBHOOK_URL, ...noHook } = ENV;
  const r = await runDraftPosts({ env: noHook, argv: [], fetchImpl: f.fetchImpl, supabase: f.supabase, log: silent });
  assert.equal(r.created, 2);
  assert.equal(f.calls.discord.length, 0);
}

// 6) bad --since
await assert.rejects(() => runDraftPosts({ env: ENV, argv: ['--since', 'yesterday'], fetchImpl: async () => { throw new Error('unreachable'); }, log: silent }), /ISO timestamp/);

console.log('social-draft-posts: ok');
