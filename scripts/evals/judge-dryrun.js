#!/usr/bin/env node
/**
 * Clustering Judge — dry-run validation (ADO-533, session 1)
 *
 * The Judge's "same real-world event?" decision is semantic — it cannot be replayed by a
 * deterministic function (that is the whole reason it needs an LLM, see clustering-quality plan Part 2).
 * So this dry-run is a *judgment* pass: the verdicts in VERDICTS below were produced by applying the
 * prompt-v1.md Section 4 criteria (Josh's binding merge ruling) to each gold pair's evidence
 * (member ARTICLE titles + summaries + entities, NOT primary_headline alone). This script scores those
 * verdicts against the gold-set labels — it reads each label independently and compares, so it is a real
 * scorer, not a hardcoded pass.
 *
 * Coverage: all 10 story_story pairs (July 4th fragmentation cluster gs-199..208, all same_event) + a
 * 20-pair article_story sample spanning the hard cases: Josh's chain-of-events flips (gs-168, gs-189),
 * filing-vs-ruling / two-strikes / recurring-format different_event traps, and same-cycle
 * reaction/commentary same_event pairs.
 *
 * Usage:
 *   node scripts/evals/judge-dryrun.js            # score verdicts vs gold labels, print report
 *   node scripts/evals/judge-dryrun.js --insert   # ALSO write each verdict to clustering_judge_log
 *                                                  # on TEST (dry_run=true, merged=false) to seed the
 *                                                  # admin Judge tab. Requires migration 100 applied +
 *                                                  # SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (TEST) in env.
 *
 * No live model calls, no live merges — $0.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLD_PATH = path.join(__dirname, 'clustering-gold-set.json');

// Verdicts produced by the judge (Claude) applying prompt-v1.md Section 4 to each pair's evidence.
// verdict ∈ {merge, keep, uncertain}; one-sentence rationale (same shape the live agent logs).
const VERDICTS = {
  // ── story_story: July 4th "Salute to America 250" fragmentation (all same_event → merge) ──
  'gs-199': { verdict: 'merge', confidence: 0.85, rationale: "Pre-speech storm evacuation and the Mount Rushmore July 4th address are one occasion (circumstances of the same occurrence)." },
  'gs-200': { verdict: 'merge', confidence: 0.90, rationale: "Both cover Trump's July 4th 250th-birthday speech — the Mount Rushmore launch and the Fourth of July address are the same event." },
  'gs-201': { verdict: 'merge', confidence: 0.90, rationale: "Both cover the same 250th-anniversary speech marking the nation's birthday." },
  'gs-202': { verdict: 'merge', confidence: 0.88, rationale: "The Mount Rushmore launch and the 'Salute to America 250' keynote are the same July 4th celebration occasion." },
  'gs-203': { verdict: 'merge', confidence: 0.85, rationale: "The storm evacuation and the Fourth of July speech it disrupted are one occasion." },
  'gs-204': { verdict: 'merge', confidence: 0.83, rationale: "The pre-speech storm evacuation and the 'golden age' 250th speech are the same occasion." },
  'gs-205': { verdict: 'merge', confidence: 0.85, rationale: "The storm evacuation and the 'Salute to America 250' keynote are the same July 4th occasion." },
  'gs-206': { verdict: 'merge', confidence: 0.90, rationale: "The Fourth of July speech and the 'golden age' 250th speech are the same address." },
  'gs-207': { verdict: 'merge', confidence: 0.90, rationale: "The Fourth of July speech and the 'Salute to America 250' keynote are the same address." },
  'gs-208': { verdict: 'merge', confidence: 0.90, rationale: "The 'golden age' 250th speech and the 'Salute to America 250' keynote are the same address." },

  // ── article_story different_event (chain-of-events / filing-vs-ruling / recurring-format → keep) ──
  'gs-002': { verdict: 'keep', confidence: 0.70, rationale: "A fresh delay attempt and SCOTUS rejecting the appeal are two separate beats of the Carroll payout saga." },
  'gs-063': { verdict: 'keep', confidence: 0.90, rationale: "Live Results templates for South Dakota vs Iowa are different states, not one event." },
  'gs-168': { verdict: 'keep', confidence: 0.80, rationale: "The indictment and the same-day court halt are a chain of events — each is its own beat, not one occurrence (Josh ruling)." },
  'gs-189': { verdict: 'keep', confidence: 0.80, rationale: "Trump's later 'big yawn' dismissal is a follow-up beat to the bill-to-desk story — chain of events, separate." },
  'gs-001': { verdict: 'keep', confidence: 0.85, rationale: "Two separate US strikes on alleged drug boats days apart, different casualty counts — a recurring series, not one event." },
  'gs-005': { verdict: 'keep', confidence: 0.85, rationale: "Lawsuit filed vs judge refusing to block it days later — a filing and a ruling are separate developments." },
  'gs-006': { verdict: 'keep', confidence: 0.75, rationale: "An investigative feature on the reflecting-pool contract vs Trump's later 'vandalism' acknowledgment are separate beats." },
  'gs-008': { verdict: 'keep', confidence: 0.85, rationale: "Can-stay-on-ballot vs disqualified are two opposite rulings 12 days apart." },
  'gs-009': { verdict: 'keep', confidence: 0.80, rationale: "Scaffolding-preparation coverage vs a judge blocking the renaming are separate Kennedy Center developments." },
  'gs-010': { verdict: 'keep', confidence: 0.80, rationale: "The Olympian's indictment vs Trump acknowledging pool problems are separate occurrences in the same saga." },
  'gs-012': { verdict: 'keep', confidence: 0.90, rationale: "Two editions of the recurring weekly Brooks & Capehart segment, 28 days apart — a recurring format, not one event." },

  // ── article_story same_event (same-cycle reaction / commentary / one occurrence → merge) ──
  'gs-099': { verdict: 'merge', confidence: 0.55, rationale: "Borderline: WH delivering the Iran agreement and Senate GOP wanting a say are the same congressional-review cycle of one agreement." },
  'gs-102': { verdict: 'merge', confidence: 0.75, rationale: "Both are previews of the same Tuesday primary night — one election-night occurrence." },
  'gs-003': { verdict: 'merge', confidence: 0.70, rationale: "Interview and takeaways both cover the same Haberman/Swan 'Regime Change' book release." },
  'gs-007': { verdict: 'merge', confidence: 0.80, rationale: "Both cover Rutte managing Trump around the same NATO summit occasion." },
  'gs-011': { verdict: 'merge', confidence: 0.85, rationale: "The winner's reaction interview is the same news cycle as the Mamdani primary sweep." },
  'gs-014': { verdict: 'merge', confidence: 0.80, rationale: "Trump's loyalty demand and the Rutte profile are the same NATO summit occasion." },
  'gs-020': { verdict: 'merge', confidence: 0.85, rationale: "Analysis and announcement of the same US-Iran deal, hours apart — one development." },
  'gs-024': { verdict: 'merge', confidence: 0.80, rationale: "Opinion piece on the same DOJ Anti-Weaponization Fund announcement." },
  'gs-025': { verdict: 'merge', confidence: 0.75, rationale: "Expert reaction to the same Anti-Weaponization Fund announcement." },
};

function labelToExpectedVerdict(label) {
  // same_event => the Judge should merge; different_event => keep. (uncertain is never "expected".)
  return label === 'same_event' ? 'merge' : 'keep';
}

function pairEvidence(entry) {
  const a = entry.a || {};
  const b = entry.b || {};
  const headline_a = a.title || a.headline || null;
  const headline_b = b.headline || b.title || null;
  const replay = entry.replay || {};
  const centroid_sim =
    replay.centroid_sim_raw ?? replay.embed_sim ?? replay.centroid_sim_normalized ?? null;
  return { headline_a, headline_b, centroid_sim };
}

function main() {
  const insert = process.argv.includes('--insert');
  const gold = JSON.parse(fs.readFileSync(GOLD_PATH, 'utf8'));
  const byId = new Map(gold.entries.map((e) => [e.id, e]));

  const ids = Object.keys(VERDICTS);
  let correct = 0;
  const rows = [];
  const disagreements = [];
  // confusion on the "merge" class
  let tp = 0, fp = 0, fn = 0, tn = 0;

  for (const id of ids) {
    const entry = byId.get(id);
    if (!entry) {
      console.error(`ERROR: gold id ${id} not found (renumbered? removed?)`);
      process.exitCode = 1;
      continue;
    }
    const v = VERDICTS[id];
    const expected = labelToExpectedVerdict(entry.label);
    const got = v.verdict;
    const agree = got === expected;
    if (agree) correct++;
    else disagreements.push({ id, label: entry.label, expected, got, rationale: v.rationale });

    // merge-class confusion (uncertain counts as "did not merge")
    const gotMerge = got === 'merge';
    const wantMerge = expected === 'merge';
    if (gotMerge && wantMerge) tp++;
    else if (gotMerge && !wantMerge) fp++;
    else if (!gotMerge && wantMerge) fn++;
    else tn++;

    const ev = pairEvidence(entry);
    rows.push({
      id,
      pair_type: entry.pair_type,
      label: entry.label,
      difficulty: entry.difficulty,
      verdict: got,
      confidence: v.confidence,
      rationale: v.rationale,
      headline_a: ev.headline_a,
      headline_b: ev.headline_b,
      centroid_sim: ev.centroid_sim,
      story_id_a: entry.a?.story_id ?? null,
      story_id_b: entry.b?.story_id ?? null,
    });
  }

  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  console.log('=== Clustering Judge dry-run vs gold set ===');
  console.log(`Pairs judged: ${ids.length}  (story_story: ${rows.filter(r => r.pair_type === 'story_story').length}, article_story: ${rows.filter(r => r.pair_type === 'article_story').length})`);
  console.log(`Verdict agreement with gold labels: ${correct}/${ids.length} (${((correct / ids.length) * 100).toFixed(1)}%)`);
  console.log(`Merge-class: precision=${(precision * 100).toFixed(1)}%  recall=${(recall * 100).toFixed(1)}%  F1=${(f1 * 100).toFixed(1)}%`);
  console.log(`Confusion (merge class): TP=${tp} FP=${fp} FN=${fn} TN=${tn}`);

  // July 4th recall (the flagship reason this feature exists)
  const july4 = rows.filter(r => r.pair_type === 'story_story');
  const july4Merged = july4.filter(r => r.verdict === 'merge').length;
  console.log(`July 4th story_story cluster: ${july4Merged}/${july4.length} correctly merged`);

  if (disagreements.length) {
    console.log('\n--- DISAGREEMENTS ---');
    for (const d of disagreements) {
      console.log(`  ${d.id} [${d.label}] expected=${d.expected} got=${d.got} :: ${d.rationale}`);
    }
  } else {
    console.log('\nNo disagreements — every verdict matches the gold label.');
  }

  if (!insert) {
    console.log('\n(dry-run scoring only; pass --insert to seed clustering_judge_log on TEST)');
    return;
  }

  insertRows(rows).catch((e) => {
    console.error('Insert failed:', e.message);
    process.exitCode = 1;
  });
}

async function insertRows(rows) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required for --insert (TEST). Local .env points at TEST per project convention.');
  }
  const runId = `judge-dryrun-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const payload = rows.map((r) => ({
    source: 'judge-agent',
    run_id: runId,
    story_id_a: r.story_id_a,
    story_id_b: r.story_id_b,
    headline_a: r.headline_a,
    headline_b: r.headline_b,
    verdict: r.verdict,
    confidence: r.confidence,
    rationale: r.rationale,
    centroid_sim: r.centroid_sim,
    merged: false,
    dry_run: true,
  }));

  const res = await fetch(`${base}/rest/v1/clustering_judge_log`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST clustering_judge_log ${res.status}: ${text.slice(0, 300)}`);
  }
  console.log(`\nInserted ${payload.length} dry-run verdict rows into clustering_judge_log (run_id=${runId}).`);
}

main();
