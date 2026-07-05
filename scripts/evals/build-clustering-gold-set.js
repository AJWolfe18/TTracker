#!/usr/bin/env node

/**
 * Clustering Gold Set Builder (ADO-532)
 *
 * One-time (re-runnable) builder that turns PROD clustering log extracts into
 * a DRAFT gold-set file for hand-labeling. The published gold set
 * (clustering-gold-set.json) is produced by labeling the draft — this script
 * never overwrites the published file.
 *
 * Pipeline:
 *   1. Parse log extracts (CROSS_RUN_NEAR_MISS / CROSS_RUN_OVERRIDE /
 *      SAME_RUN_OVERRIDE / EXACT_TITLE_DEDUP_ATTACH lines pulled via
 *      `gh run view <id> --log | grep -o '"type":"..."...'`).
 *      NOTE the JSON.parse gotcha: extracted lines start mid-object (no opening
 *      brace) but DO include the closing brace — prepend "{" only.
 *   2. Fetch pair features from PROD via anon-key PostgREST (read-only,
 *      minimal select= field lists, batched id=in.() — egress rule #11).
 *      NEVER fetches embedding/content fields; similarities come from the log
 *      entries themselves (embed_best), computed at decision time.
 *   3. Emit draft entries with suggested labels for obvious categories;
 *      everything ships as label:null or suggested_label until hand-verified.
 *
 * PROD credentials are parsed from public/supabase-browser-config.js at
 * runtime (intentionally browser-public anon key) so no PROD reference is
 * hardcoded here (lint-prod-refs).
 *
 * Usage:
 *   node scripts/evals/build-clustering-gold-set.js \
 *     --extracts=<path to clustering-log-extracts.txt> \
 *     --out=<path to draft json>
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

// ============================================================================
// CLI
// ============================================================================

function parseArgs() {
  const config = { extracts: null, out: null, maxPerCategory: 120 };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--extracts=')) config.extracts = arg.split('=')[1];
    else if (arg.startsWith('--out=')) config.out = arg.split('=')[1];
    else if (arg.startsWith('--max-per-category=')) config.maxPerCategory = Number(arg.split('=')[1]);
  }
  if (!config.extracts || !config.out) {
    console.error('Usage: node build-clustering-gold-set.js --extracts=<file> --out=<draft.json>');
    process.exit(1);
  }
  return config;
}

// ============================================================================
// PROD read-only client (anon key parsed from browser config)
// ============================================================================

function getProdConfig() {
  const src = readFileSync(join(REPO_ROOT, 'public', 'supabase-browser-config.js'), 'utf-8');
  const block = src.match(/PRODUCTION_CONFIG\s*=\s*\{([\s\S]*?)\}/);
  if (!block) throw new Error('Could not find PRODUCTION_CONFIG in supabase-browser-config.js');
  const url = block[1].match(/SUPABASE_URL:\s*'([^']+)'/)?.[1];
  const key = block[1].match(/SUPABASE_ANON_KEY:\s*'([^']+)'/)?.[1];
  if (!url || !key) throw new Error('Could not parse PROD url/anon key');
  return { url, key };
}

const PROD = getProdConfig();

async function pgGet(pathAndQuery) {
  const res = await fetch(`${PROD.url}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: PROD.key, Authorization: `Bearer ${PROD.key}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PostgREST ${res.status} on ${pathAndQuery.slice(0, 120)}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

/** Batched IN-list fetch (URL length safety: chunks of 40 ids) */
async function fetchByIds(table, select, idField, ids, extra = '') {
  const out = [];
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 40) {
    const chunk = uniq.slice(i, i + 40);
    const inList = chunk.map(id => `"${id}"`).join(',');
    const rows = await pgGet(`${table}?select=${select}&${idField}=in.(${encodeURIComponent(inList)})${extra}`);
    out.push(...rows);
  }
  return out;
}

// ============================================================================
// Phase 1: parse log extracts
// ============================================================================

function parseExtracts(path) {
  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
  const events = [];
  for (const line of lines) {
    // Format: RUN <databaseId> <createdAt> "type":"..."...
    const m = line.match(/^RUN (\d+) (\S+) (.*)$/);
    if (!m) continue;
    const [, runId, runCreatedAt, jsonTail] = m;
    let evt;
    try {
      // Gotcha (Part 1 appendix): prepend "{" ONLY — the tail already has the
      // real closing brace. Appending another "}" breaks JSON.parse.
      evt = JSON.parse('{' + jsonTail);
    } catch {
      continue; // truncated/garbled line — skip
    }
    evt.__run_id = runId;
    evt.__run_created_at = runCreatedAt;
    events.push(evt);
  }
  return events;
}

// ============================================================================
// Phase 2/3: build draft entries
// ============================================================================

function dedupeByPair(events) {
  // Keep the FIRST occurrence of each (article_id, story_id) pair
  const seen = new Set();
  const out = [];
  for (const e of events) {
    const key = `${e.article_id}|${e.story_id ?? e.target_story_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

async function main() {
  const config = parseArgs();
  const events = parseExtracts(config.extracts);
  console.log(`Parsed ${events.length} events from extracts`);

  const byType = {};
  for (const e of events) (byType[e.type] ??= []).push(e);
  for (const [t, arr] of Object.entries(byType)) console.log(`  ${t}: ${arr.length}`);

  const nearMisses = dedupeByPair(byType.CROSS_RUN_NEAR_MISS ?? []);
  const crossRunOverrides = dedupeByPair(byType.CROSS_RUN_OVERRIDE ?? []);
  const sameRunOverrides = dedupeByPair(byType.SAME_RUN_OVERRIDE ?? []);
  const exactTitle = dedupeByPair(
    (byType.EXACT_TITLE_DEDUP_ATTACH ?? []).map(e => ({ ...e, story_id: e.target_story_id }))
  );

  console.log(`\nDeduped pairs: near_miss=${nearMisses.length}, cross_run_override=${crossRunOverrides.length}, same_run_override=${sameRunOverrides.length}, exact_title=${exactTitle.length}`);

  // Cap categories to keep fetch + labeling tractable.
  // Near-misses are the core of the set (hard cases + generic collisions) —
  // sort by embed_best descending so the hardest (highest-similarity) cases
  // are kept, then interleave long-gap collisions explicitly below.
  const cap = config.maxPerCategory;
  const longGap = nearMisses.filter(e => e.time_diff_hours > 30 * 24);
  const inWindow = nearMisses.filter(e => e.time_diff_hours <= 30 * 24)
    .sort((a, b) => (b.embed_best ?? 0) - (a.embed_best ?? 0));

  const picked = {
    near_miss: inWindow.slice(0, cap),
    generic_collision: longGap.slice(0, 40),
    cross_run_override: crossRunOverrides.slice(0, 40),
    same_run_override: sameRunOverrides.slice(0, 15),
    exact_title: exactTitle.slice(0, 10),
  };

  // ---- Fetch features ----
  const allEvents = Object.values(picked).flat();
  const articleIds = [...new Set(allEvents.map(e => e.article_id).filter(Boolean))];
  const storyIds = [...new Set(allEvents.map(e => e.story_id).filter(Boolean))];

  console.log(`\nFetching features: ${articleIds.length} articles, ${storyIds.length} stories (minimal selects, no embeddings/content)`);

  const articles = await fetchByIds(
    'articles',
    'id,title,entities,published_at,topic_slug,source_domain,geo,opinion_flag,artifact_urls,quote_hashes',
    'id', articleIds
  );
  // Mirror the LIVE candidate select exactly (candidate-generation.js):
  // candidate stories never carry geography/artifact_urls/quote_hashes, so the
  // replay must not either — geo score + artifact/quote bonuses are
  // structurally 0 on the story side in live cross-run scoring.
  const stories = await fetchByIds(
    'stories',
    'id,primary_headline,entity_counter,top_entities,topic_slugs,last_updated_at,first_seen_at,latest_article_published_at,primary_source_domain,lifecycle_state,source_count',
    'id', storyIds
  );

  // Member article titles per story (for labeling context + future judge eval)
  const memberRows = await fetchByIds(
    'article_story',
    'story_id,articles(title,published_at)',
    'story_id', storyIds
  );
  const memberTitles = new Map();
  for (const row of memberRows) {
    if (!row.articles) continue;
    const list = memberTitles.get(row.story_id) ?? [];
    if (list.length < 6) list.push(row.articles.title);
    memberTitles.set(row.story_id, list);
  }

  const articleMap = new Map(articles.map(a => [a.id, a]));
  const storyMap = new Map(stories.map(s => [s.id, s]));

  // ---- Emit draft entries ----
  const draft = [];
  let n = 0;

  for (const [category, evts] of Object.entries(picked)) {
    for (const e of evts) {
      const art = articleMap.get(e.article_id);
      const story = storyMap.get(e.story_id);
      if (!art || !story) continue; // deleted since — skip

      n++;
      const suggested =
        category === 'exact_title' ? 'same_event'
        : category === 'generic_collision' ? 'different_event'
        : (category === 'cross_run_override' || category === 'same_run_override') ? 'same_event'
        : null; // near_miss: no suggestion — hand-label

      draft.push({
        id: `draft-${String(n).padStart(3, '0')}`,
        pair_type: 'article_story',
        a: {
          article_id: art.id,
          title: art.title,
          entities: (art.entities ?? []).map(x => x?.id).filter(Boolean),
          published_at: art.published_at,
          topic_slug: art.topic_slug,
        },
        b: {
          story_id: story.id,
          headline: story.primary_headline,
          top_entities: story.top_entities ?? Object.keys(story.entity_counter ?? {}),
          article_titles: memberTitles.get(story.id) ?? [],
          date_range: `${story.first_seen_at ?? '?'} → ${story.latest_article_published_at ?? story.last_updated_at ?? '?'}`,
        },
        label: null,
        suggested_label: suggested,
        difficulty: null,
        source: category === 'generic_collision' ? 'generic_collision'
          : category === 'near_miss' ? 'near_miss'
          : category === 'cross_run_override' ? 'tier_ab_live_attach'
          : category === 'same_run_override' ? 'same_run_attach'
          : 'exact_title_attach',
        notes: '',
        // Everything the offline replay needs, captured at build time so the
        // eval never refetches embeddings (egress rule #11).
        replay: {
          // Decision-time similarity from the log (embed space, [0,1] normalized)
          embed_sim: e.embed_best ?? (e.embeddingSim ? Number(e.embeddingSim) : null),
          embed_second: e.embed_second ?? (e.secondBestEmbedding ? Number(e.secondBestEmbedding) : null),
          margin_vacuous: e.margin_vacuous ?? null,
          candidate_count: e.candidate_count ?? null,
          time_diff_hours: e.time_diff_hours ?? null,
          article: {
            source_domain: art.source_domain,
            geo: art.geo,
            opinion_flag: art.opinion_flag,
            artifact_urls: art.artifact_urls,
            quote_hashes: art.quote_hashes,
          },
          story: {
            entity_counter: story.entity_counter,
            topic_slugs: story.topic_slugs,
            lifecycle_state: story.lifecycle_state,
            primary_source_domain: story.primary_source_domain,
            first_seen_at: story.first_seen_at,
            latest_article_published_at: story.latest_article_published_at,
            last_updated_at: story.last_updated_at,
          },
          log_event_type: e.type,
          log_tier: e.tier ?? null,
          run_id: e.__run_id,
          run_created_at: e.__run_created_at,
        },
      });
    }
  }

  writeFileSync(config.out, JSON.stringify({ generated_at: new Date().toISOString(), entries: draft }, null, 2), 'utf-8');
  console.log(`\nDraft written: ${config.out} (${draft.length} entries)`);
  console.log('Next: hand-label (label, difficulty, notes) and merge into scripts/evals/clustering-gold-set.json');
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
