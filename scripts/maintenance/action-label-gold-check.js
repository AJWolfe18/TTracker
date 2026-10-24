#!/usr/bin/env node
/**
 * Compare action labels against the 40-story gold set (ADO-594, PRD 14.3 / 14.7 / 14.8).
 *
 * The gate for S2 (Stories agent gold check) and S3 (label backfill TEST run): at least 90% of the
 * 40 gold stories must agree. A story agrees when its action_label matches AND its actor lands on
 * the same side (trump/administration = his side, ally/other = not). The side is what the main-line
 * rule reads (PRD 14.4), so trump-vs-administration slips are reported but do not fail the gate.
 *
 * Input, one of:
 *   --file <results.json>  an array of { id, action_label, action_actor } (S2 gold-check output)
 *   --db                   read the 40 gold ids from stories (S3 backfill, after a TEST run).
 *                          Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (TEST). Selects 4 tiny columns.
 *
 * Exit 0 = gate passed, 1 = failed, 2 = bad input.
 * Usage: node scripts/maintenance/action-label-gold-check.js --file results.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const GOLD_PATH = path.join(here, '..', 'tests', 'fixtures', 'action-label-gold.json');
export const GATE = 0.9;
// Gold rows shown as worked examples in the Stories and backfill prompts (PRD 14.7).
const CALIBRATION_IDS = new Set([17240, 17216, 17248, 17233, 17231, 17246]);

const ACTORS = new Set(['trump', 'administration', 'ally', 'other']);
const side = (actor) => (actor === 'trump' || actor === 'administration' ? 'his' : 'not');

export function compareToGold(gold, results) {
  const byId = new Map(results.map((r) => [Number(r.id), r]));
  const rows = gold.map((g) => {
    const r = byId.get(g.id);
    if (!r || !r.action_label) return { ...g, got: null, agree: false, exact: false, why: 'missing' };
    const labelOk = r.action_label === g.action_label;
    if (!ACTORS.has(r.action_actor)) {
      return { ...g, got: `${r.action_label}/${r.action_actor ?? '-'}`, agree: false, exact: false, why: 'actor missing or invalid' };
    }
    const sideOk = side(r.action_actor) === side(g.action_actor);
    return {
      ...g,
      got: `${r.action_label}/${r.action_actor}`,
      agree: labelOk && sideOk,
      exact: labelOk && r.action_actor === g.action_actor,
      why: !labelOk ? 'label' : !sideOk ? 'actor side' : '',
    };
  });
  const agree = rows.filter((r) => r.agree).length;
  const exact = rows.filter((r) => r.exact).length;
  return { rows, agree, exact, total: gold.length, rate: agree / gold.length, pass: agree / gold.length >= GATE };
}

async function readDb(ids) {
  const { createClient } = await import('@supabase/supabase-js');
  await import('dotenv/config');
  const url = process.env.SUPABASE_URL || process.env.SUPABASE_TEST_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_TEST_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --db');
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from('stories')
    .select('id,action_label,action_actor,action_label_source')
    .in('id', ids)
    .limit(ids.length);
  if (error) throw new Error(error.message);
  return data;
}

async function main() {
  const args = process.argv.slice(2);
  const gold = JSON.parse(fs.readFileSync(GOLD_PATH, 'utf8')).stories;
  let results;
  if (args[0] === '--file' && args[1]) results = JSON.parse(fs.readFileSync(args[1], 'utf8'));
  else if (args[0] === '--db') results = await readDb(gold.map((g) => g.id));
  else {
    console.error('Usage: action-label-gold-check.js --file <results.json> | --db');
    process.exit(2);
  }
  if (!Array.isArray(results)) {
    console.error('Results must be a JSON array of { id, action_label, action_actor }');
    process.exit(2);
  }
  const res = compareToGold(gold, results);
  for (const r of res.rows.filter((x) => !x.agree)) {
    console.log(`  MISS ${r.id} want ${r.action_label}/${r.action_actor} got ${r.got ?? '-'} (${r.why}) ${r.headline}`);
  }
  // The six calibration examples in both prompts are gold rows too, so also
  // report the 34 the agent never saw an answer for.
  const held = res.rows.filter((r) => !CALIBRATION_IDS.has(r.id));
  const heldAgree = held.filter((r) => r.agree).length;
  console.log(`agree ${res.agree}/${res.total} (${Math.round(res.rate * 100)}%), exact actor ${res.exact}/${res.total}, held-out ${heldAgree}/${held.length}, gate ${GATE * 100}%: ${res.pass ? 'PASS' : 'FAIL'}`);
  process.exit(res.pass ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(2); });
}
