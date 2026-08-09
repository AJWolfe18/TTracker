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
 * Coverage (re-scored under `judge-v1.1`, ADO-539): all 13 story_story pairs (July 4th fragmentation
 * cluster gs-199..208 + the three ADO-539 ground-truth pairs gs-209..211), the 9-pair same_event
 * article_story sample, and — as the precision gate — EVERY different_event pair in the gold set
 * (all 100). The full different_event sweep exists because that is where v1.1's new licensed-inference
 * and format-variant rules could bleed: a 33-pair sample cannot establish >=98% merge precision.
 *
 * Gates (each sets a failing exit code, not just a printed number — Codex PR #113):
 *   1. zero `merge` verdicts on different_event pairs (`keep`/`uncertain` both acceptable there,
 *      so agreement % is reported context — merge-class PRECISION is the primary gate);
 *   2. the July 4th fragmentation cluster merges in full (flagship recall case);
 *   3. the three ADO-539 hedge-pattern pairs (gs-209..211) are all `merge`;
 *   4. every keep trap holds as `keep`: gs-001, gs-002, gs-005, gs-006, gs-008, gs-009,
 *      gs-010, gs-012, gs-063 (recurring formats) and gs-168, gs-189 (Josh's chain-of-events flips).
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

  // ── story_story: ADO-539 ground truth — the v1.1 hedge patterns that must now flip to merge ──
  'gs-209': { verdict: 'merge', confidence: 0.80, rationale: "B is a timeline recap of the same Pirro reflecting-pool episode A reports; one plausible referent in the cycle, so vague framing is not doubt (v1.1 licensed inference)." },
  'gs-210': { verdict: 'merge', confidence: 0.78, rationale: "A's Black-voters analysis and B's final-push/results coverage are the same Aug 4 Michigan Senate primary — one occurrence, analysis genre withholds specifics (v1.1 licensed inference)." },
  'gs-211': { verdict: 'merge', confidence: 0.85, rationale: "A 'how to watch' guide and the 'WATCH LIVE' coverage of the same Graham funeral services are one occasion (v1.1 format variants)." },

  // ── different_event sweep (ADO-539 FP hunt): every remaining different_event gold pair judged
  //    under v1.1. None may come back `merge` — each merge here would be a precision regression. ──
  'gs-013': { verdict: 'keep', confidence: 0.75, rationale: "Alabama redistricting signal vs the earlier Louisiana VRA ruling — two SCOTUS decisions 26 days apart." },
  'gs-015': { verdict: 'keep', confidence: 0.85, rationale: "Judge declining to halt the UFC fight is the ruling on the lawsuit B reports being filed — filing vs ruling, chain of events." },
  'gs-016': { verdict: 'keep', confidence: 0.80, rationale: "Declining to re-bid the pool repair is a later decision, not the earlier 'vandalism' acknowledgment." },
  'gs-018': { verdict: 'keep', confidence: 0.85, rationale: "Imposing export controls and partially lifting them 13 days later are opposite actions — two occurrences." },
  'gs-019': { verdict: 'keep', confidence: 0.80, rationale: "China-policy analysis vs the earlier Trump-Xi summit coverage, 24 days apart — different cycles." },
  'gs-021': { verdict: 'keep', confidence: 0.80, rationale: "Experts doubting the vandalism claim vs a timelapse of the pool refilling — separate beats two weeks apart." },
  'gs-022': { verdict: 'keep', confidence: 0.75, rationale: "Two Infantino-Trump relationship profiles 26 days apart — thematic twins, no shared occurrence." },
  'gs-023': { verdict: 'keep', confidence: 0.80, rationale: "Two debt analyses pegged to different data (Treasury yields vs interest share of revenue)." },
  'gs-026': { verdict: 'keep', confidence: 0.85, rationale: "Biden suing to block the audio vs that bid failing 23 days later — filing vs outcome." },
  'gs-027': { verdict: 'keep', confidence: 0.85, rationale: "The judge rejecting the suit is the ruling on B's filing — chain of events." },
  'gs-029': { verdict: 'keep', confidence: 0.90, rationale: "New Jersey vs West Virginia primaries — a Live Results template repeating across different occasions (v1.1 explicitly keeps these)." },
  'gs-030': { verdict: 'keep', confidence: 0.75, rationale: "A human-interest birthday feature vs a Trump-centric 250th video — different angles, no single occurrence." },
  'gs-031': { verdict: 'keep', confidence: 0.80, rationale: "The AI-meeting profit fight vs the earlier postponed AI executive order — separate developments 16 days apart." },
  'gs-033': { verdict: 'keep', confidence: 0.85, rationale: "States suing over the Medicaid work rule vs the rule's announcement 29 days earlier — chain of events." },
  'gs-034': { verdict: 'keep', confidence: 0.85, rationale: "The runoff and the primary that triggered it are two election occurrences." },
  'gs-039': { verdict: 'keep', confidence: 0.85, rationale: "A pre-election polling piece vs an election-night concession 8 days later — different occurrences." },
  'gs-040': { verdict: 'keep', confidence: 0.75, rationale: "Two AI-and-voters features — thematic twins, no shared occurrence." },
  'gs-044': { verdict: 'keep', confidence: 0.80, rationale: "A tear-gassed protest vs a resort-scrutiny explainer 29 days earlier — separate occurrences." },
  'gs-045': { verdict: 'keep', confidence: 0.75, rationale: "Two immigration-policy analyses a week apart with different pegs — no single occurrence." },
  'gs-048': { verdict: 'keep', confidence: 0.65, rationale: "Same cycle and saga, but MTG's criticism targets the event itself while B is the court ruling — more than one plausible referent, so licensed inference does not apply." },
  'gs-049': { verdict: 'keep', confidence: 0.90, rationale: "What-to-Watch previews of two different primary nights — recurring format across different occasions, not a preview of one occasion." },
  'gs-052': { verdict: 'keep', confidence: 0.85, rationale: "The lead prosecutor withdrawing vs the second indictment 28 days earlier — separate beats." },
  'gs-053': { verdict: 'keep', confidence: 0.80, rationale: "A rally announcement vs musicians dropping out of a different event 16 days earlier." },
  'gs-054': { verdict: 'keep', confidence: 0.75, rationale: "Two 250th essays with different theses — no anchoring occurrence for either to be about." },
  'gs-056': { verdict: 'keep', confidence: 0.75, rationale: "A slush-fund persistence piece three weeks after the fund's announcement — a later phase, not commentary in the announcement cycle." },
  'gs-058': { verdict: 'keep', confidence: 0.85, rationale: "Gabbard's resignation and Pulte's appointment 10 days later — resignation vs replacement, explicitly separate." },
  'gs-059': { verdict: 'keep', confidence: 0.75, rationale: "Two 250th partisan-politics pieces 17 days apart with different pegs." },
  'gs-064': { verdict: 'keep', confidence: 0.70, rationale: "A private group routing legal funds vs the DOJ fund roundup — related theme, distinct subjects." },
  'gs-065': { verdict: 'keep', confidence: 0.70, rationale: "A campaign-event remark is its own occurrence, not commentary on the peace-deal announcement — chain of events, not licensed inference." },
  'gs-067': { verdict: 'keep', confidence: 0.75, rationale: "Two 2028-speculation pieces pegged to different remarks 17 days apart." },
  'gs-068': { verdict: 'keep', confidence: 0.90, rationale: "Montana vs Idaho Live Results — recurring per-state template across different occasions." },
  'gs-069': { verdict: 'keep', confidence: 0.80, rationale: "A historian remembrance vs partisan-battle reporting — thematically adjacent only." },
  'gs-072': { verdict: 'keep', confidence: 0.80, rationale: "The July 4th celebration and the June 25 kickoff rally are two scheduled occasions 8+ days apart, not format variants of one." },
  'gs-074': { verdict: 'keep', confidence: 0.80, rationale: "New York's funding suspension vs a Hawaii-as-warning analysis 25 days earlier — distinct developments." },
  'gs-078': { verdict: 'keep', confidence: 0.85, rationale: "A judge blocking sign removal vs an appeal allowing it 20 days later — opposite rulings." },
  'gs-080': { verdict: 'keep', confidence: 0.60, rationale: "Same cycle, but both sides are independent 250th essays; there is no single occurrence for either to be commentary on, so licensed inference does not apply." },
  'gs-081': { verdict: 'keep', confidence: 0.80, rationale: "A concrete policy win vs a how-they-got-allies backgrounder 16 days earlier." },
  'gs-082': { verdict: 'keep', confidence: 0.80, rationale: "Two cost-of-living features a week apart — thematic twins." },
  'gs-084': { verdict: 'keep', confidence: 0.80, rationale: "The July 4th golden-age speech vs the June 25 kickoff rally — two rallies 10 days apart." },
  'gs-085': { verdict: 'keep', confidence: 0.80, rationale: "Same hour, but a tech selloff and a quantum-stock surge are different market stories, not one occurrence." },
  'gs-086': { verdict: 'keep', confidence: 0.80, rationale: "An agenda-stall analysis vs the Iran-deal announcement — different subjects." },
  'gs-089': { verdict: 'keep', confidence: 0.80, rationale: "A 2028 contender ranking vs a specific Trump remark piece 20 days earlier." },
  'gs-098': { verdict: 'keep', confidence: 0.80, rationale: "A riff essay 17 days after the recurring algae story — the algae recurrence is not one occurrence." },
  'gs-103': { verdict: 'keep', confidence: 0.85, rationale: "A DHS statement vs a SCOTUS deportation ruling three days earlier — separate occurrences." },
  'gs-104': { verdict: 'keep', confidence: 0.85, rationale: "Two different court-blocks-firing rulings: intelligence officers vs Fed governor Cook." },
  'gs-106': { verdict: 'keep', confidence: 0.80, rationale: "Two 250th essays with different theses three days apart — no shared occurrence." },
  'gs-109': { verdict: 'keep', confidence: 0.80, rationale: "A SCOTUS detention development vs 5th Circuit history — separate court developments." },
  'gs-116': { verdict: 'keep', confidence: 0.75, rationale: "A congressional report is a new occurrence, not commentary on the earlier thematic video." },
  'gs-117': { verdict: 'keep', confidence: 0.85, rationale: "An FBI support-network feature vs surveillance-renewal doubt — different stories." },
  'gs-119': { verdict: 'keep', confidence: 0.80, rationale: "The challenger's messaging vs voters seeking answers 32 days earlier — separate beats." },
  'gs-120': { verdict: 'keep', confidence: 0.90, rationale: "Different candidates in different states dropping out — template collision 65 days apart." },
  'gs-121': { verdict: 'keep', confidence: 0.90, rationale: "Khamenei's death during the war vs a memorial prayer four months later." },
  'gs-122': { verdict: 'keep', confidence: 0.85, rationale: "Two Trump-NATO developments three months apart." },
  'gs-123': { verdict: 'keep', confidence: 0.85, rationale: "Different policy retreats four months apart." },
  'gs-124': { verdict: 'keep', confidence: 0.80, rationale: "The announced curtailment vs the actual rollback 66 days later — two phases." },
  'gs-125': { verdict: 'keep', confidence: 0.80, rationale: "The currency plan announcement vs the July 4th rollout 99 days later — one initiative, two events." },
  'gs-126': { verdict: 'keep', confidence: 0.85, rationale: "Fed-reshaping analysis vs the Powell inquiry 161 days earlier." },
  'gs-127': { verdict: 'keep', confidence: 0.85, rationale: "A parks-cuts feature vs a Yosemite feature 165 days earlier." },
  'gs-128': { verdict: 'keep', confidence: 0.80, rationale: "A party-like-1976 essay vs a Trump-centric analysis 31 days earlier." },
  'gs-129': { verdict: 'keep', confidence: 0.85, rationale: "Two losing-streak analyses 170 days apart — recurring-pattern trap." },
  'gs-130': { verdict: 'keep', confidence: 0.85, rationale: "A mass-pardons rumor vs the actual pardons 83 days later — rumor vs the act itself." },
  'gs-131': { verdict: 'keep', confidence: 0.85, rationale: "A district court ordering restoration vs an appeals court allowing removal 135 days later — opposite rulings." },
  'gs-132': { verdict: 'keep', confidence: 0.80, rationale: "A still-celebrating retrospective 111 days after the ruling — thread material, not the ruling's cycle." },
  'gs-133': { verdict: 'keep', confidence: 0.80, rationale: "The launch vs financial-advice commentary four months earlier." },
  'gs-134': { verdict: 'keep', confidence: 0.80, rationale: "A specific pardon batch vs a pattern analysis 107 days earlier." },
  'gs-135': { verdict: 'keep', confidence: 0.85, rationale: "A Georgia election-trust analysis vs an FBI-action explainer 154 days earlier." },
  'gs-136': { verdict: 'keep', confidence: 0.80, rationale: "Two phases of the same FBI investigation 154 days apart — a saga, not one event." },
  'gs-137': { verdict: 'keep', confidence: 0.85, rationale: "A July 4th speech vs an interview 105 days earlier." },
  'gs-138': { verdict: 'keep', confidence: 0.85, rationale: "New Fed-chair friction vs the Powell inquiry 160 days earlier." },
  'gs-139': { verdict: 'keep', confidence: 0.85, rationale: "Two Gen-Z-souring pieces 168 days apart." },
  'gs-140': { verdict: 'keep', confidence: 0.80, rationale: "Speculative if-they-win-the-House coverage vs probes taking shape 124 days apart — two phases." },
  'gs-141': { verdict: 'keep', confidence: 0.80, rationale: "Two separate Trump-NATO statements 92 days apart — recurring rhetoric, not one occurrence." },
  'gs-142': { verdict: 'keep', confidence: 0.85, rationale: "Thematic diplomacy pieces 135 days apart." },
  'gs-143': { verdict: 'keep', confidence: 0.85, rationale: "Two appeals-court ICE-detention rulings 65 days apart despite near-identical phrasing." },
  'gs-144': { verdict: 'keep', confidence: 0.85, rationale: "A parks-content ruling vs the climate-finding reversal — different subjects." },
  'gs-145': { verdict: 'keep', confidence: 0.85, rationale: "Two different Trump image posts 78 days apart — recurring behavior, not one occurrence." },
  'gs-146': { verdict: 'keep', confidence: 0.85, rationale: "A judge demanding answers vs the original golfers' suit 138 days earlier." },
  'gs-147': { verdict: 'keep', confidence: 0.80, rationale: "A later phase of the same Georgia investigation vs the initial explainer 153 days earlier." },
  'gs-148': { verdict: 'keep', confidence: 0.85, rationale: "A European-unity piece vs a specific Meloni attack 77 days earlier." },
  'gs-149': { verdict: 'keep', confidence: 0.85, rationale: "A legal-battles roundup vs a specific SCOTUS argument three months earlier." },
  'gs-150': { verdict: 'keep', confidence: 0.85, rationale: "Two jobs-data cycles 174 days apart — recurring economic-data trap." },
  'gs-151': { verdict: 'keep', confidence: 0.80, rationale: "Carlson's apology vs his third-party plan 71 days later — related but separate developments." },
  'gs-152': { verdict: 'keep', confidence: 0.80, rationale: "A birthright-citizenship argument vs a term-wrap analysis 90 days later." },
  'gs-153': { verdict: 'keep', confidence: 0.80, rationale: "Candidate super-PACs vs the party's $342M plan — different money stories." },
  'gs-154': { verdict: 'keep', confidence: 0.80, rationale: "Two phases of the SAVE America Act fight 114 days apart." },
  'gs-155': { verdict: 'keep', confidence: 0.80, rationale: "Two GOP-agenda-struggle pieces 113 days apart." },
  'gs-156': { verdict: 'keep', confidence: 0.80, rationale: "An arrest-surge report vs a quiet-arrests feature 144 days earlier." },
  'gs-157': { verdict: 'keep', confidence: 0.80, rationale: "A Senate vote vs a ruling analysis 102 days apart in the same subject area." },
  'gs-158': { verdict: 'keep', confidence: 0.85, rationale: "Signing the order vs a court blocking it 87 days later — order vs later court block." },
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
  // Recall/F1 here are NOT system properties. Every different_event pair is judged, so precision
  // is measured over the full negative set — but only a sample of same_event pairs is judged, so
  // recall is measured over that sample and will read ~100% by construction. Precision is the gate.
  const sameEventJudged = rows.filter((r) => r.label === 'same_event').length;
  const sameEventTotal = gold.entries.filter((e) => e.label === 'same_event').length;
  console.log(`  ^ recall/F1 are over the ${sameEventJudged}/${sameEventTotal} same_event pairs judged here, not the whole gold set — treat precision as the gate.`);
  console.log(`Confusion (merge class): TP=${tp} FP=${fp} FN=${fn} TN=${tn}`);

  // July 4th recall (the flagship reason this feature exists). Scope to the july4 source so the
  // ADO-539 story_story additions (gs-209..211) can't inflate this number.
  const july4 = rows.filter(r => byId.get(r.id)?.source === 'july4_fragmentation');
  const july4Merged = july4.filter(r => r.verdict === 'merge').length;
  console.log(`July 4th story_story cluster: ${july4Merged}/${july4.length} correctly merged`);
  if (july4Merged !== july4.length || july4.length === 0) {
    console.log('GATE FAILED — the July 4th fragmentation cluster must merge in full (the flagship recall case).');
    process.exitCode = 1;
  }

  // ADO-539 gate: the three hedge-pattern pairs must flip to merge under v1.1.
  const gate539 = rows.filter(r => byId.get(r.id)?.source === 'ado-539-ground-truth');
  const gate539Merged = gate539.filter(r => r.verdict === 'merge').length;
  console.log(`ADO-539 hedge-pattern pairs flipped to merge: ${gate539Merged}/${gate539.length}`);
  if (gate539Merged !== gate539.length || gate539.length === 0) {
    console.log('GATE FAILED — all ADO-539 hedge-pattern pairs (gs-209..211) must be merge verdicts.');
    process.exitCode = 1;
  }

  // The keep traps that must survive the v1.1 rule additions unchanged.
  const TRAPS = ['gs-001','gs-002','gs-005','gs-006','gs-008','gs-009','gs-010','gs-012','gs-063','gs-168','gs-189'];
  const trapsHeld = TRAPS.filter(id => VERDICTS[id]?.verdict === 'keep').length;
  console.log(`Keep traps holding as 'keep': ${trapsHeld}/${TRAPS.length}`);
  if (trapsHeld !== TRAPS.length) {
    console.log("GATE FAILED — every keep trap must hold as 'keep' (uncertain is a regression here too).");
    process.exitCode = 1;
  }

  const deMerges = rows.filter(r => r.label === 'different_event' && r.verdict === 'merge');
  console.log(`different_event pairs swept: ${rows.filter(r => r.label === 'different_event').length}  false merges: ${deMerges.length}`);
  if (deMerges.length) {
    console.log('GATE FAILED — false merges on different_event pairs:');
    for (const d of deMerges) console.log(`  ${d.id} :: ${d.rationale}`);
    process.exitCode = 1;
  }

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
