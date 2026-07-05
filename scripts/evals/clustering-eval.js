/**
 * Clustering Eval (ADO-532)
 *
 * Replays the deterministic clustering attach decision offline against the
 * labeled gold set (clustering-gold-set.json) and reports precision/recall/F1
 * for the attach class. Runs fully offline: similarities and pair features are
 * precomputed in the gold-set file at build time — no DB, no embedding
 * fetches (egress rule #11), no LLM calls.
 *
 * What is replayed (mirrors scripts/rss/hybrid-clustering.js clusterArticle):
 *   1. Normal attach: calculateHybridScore total >= getThreshold + guardrail
 *      (+ stale-reopen check)
 *   2. Cross-run Tier A override (embed >= 0.90/0.92, <=48h, margin/bypass,
 *      guardrail)
 *   3. Cross-run Tier B override (embed >= 0.88, <=72h, margin/bypass,
 *      guardrail, corroboration)
 *
 * NOT replayed (impossible for a static pair benchmark, both are same-run-only
 * paths): exact-title dedup and the TTRC-321 same-run override. Gold pairs are
 * cross-run by construction (near-miss + cross-run override log events).
 *
 * KEEP IN SYNC: the Tier A/B cascade below is a transcription of
 * hybrid-clustering.js (TTRC-324 v2 section). It is duplicated because the
 * live code inlines the cascade inside clusterArticle; extracting it into a
 * shared pure function is scoring-rework territory (ADO-534) and must itself
 * be gated on this gold set. If you change the live cascade, change this too.
 *
 * Positive class = attach (label same_event). Reported metrics:
 *   precision = TP / (TP + FP)   — FP = false merge (worst failure mode)
 *   recall    = TP / (TP + FN)   — FN = fragmentation (missed merge)
 *
 * Also reports replay-vs-live agreement: near_miss pairs were CREATE live,
 * tier_ab_live_attach pairs were ATTACH live. Divergence indicates feature
 * drift (features are a current-state snapshot) or flag differences (the Tier
 * B margin bypass was OFF during most of the log sample window; it defaults
 * ON here to match current PROD — override with TIERB_BYPASS=off).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  calculateHybridScore,
  getThreshold,
  canReopenStaleStory,
  slugTokenSimilarity,
} from '../rss/scoring.js';
import {
  passesClusteringGuardrail,
  getTitleTokenOverlap,
} from '../rss/hybrid-clustering.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLD_SET_PATH = join(__dirname, 'clustering-gold-set.json');

// Matches current PROD default (ADO-529: repo-variable kill switch defaults true)
const TIERB_BYPASS_ENABLED = process.env.TIERB_BYPASS !== 'off';

// ============================================================================
// Pair reconstruction
// ============================================================================

/**
 * Rebuild the article/story objects the live scorer sees, from stored features.
 * Story timestamps: timeScore uses last_updated_at, but the only decision-time
 * temporal fact we have is time_diff_hours from the log — so reconstruct a
 * story timestamp at that offset from the article. This reproduces the
 * decision-time time signal instead of today's drifted last_updated_at.
 */
function reconstructPair(entry) {
  const r = entry.replay;

  const article = {
    id: entry.a.article_id,
    title: entry.a.title,
    entities: (entry.a.entities ?? []).map(id => ({ id })),
    published_at: entry.a.published_at,
    topic_slug: entry.a.topic_slug,
    source_domain: r.article?.source_domain ?? null,
    geo: r.article?.geo ?? null,
    opinion_flag: r.article?.opinion_flag ?? false,
    artifact_urls: r.article?.artifact_urls ?? null,
    quote_hashes: r.article?.quote_hashes ?? null,
  };

  const timeDiffH = r.time_diff_hours;
  let reconstructedStoryTime = null;
  if (Number.isFinite(timeDiffH) && article.published_at) {
    reconstructedStoryTime = new Date(
      new Date(article.published_at).getTime() - timeDiffH * 3600 * 1000
    ).toISOString();
  }

  const story = {
    id: entry.b.story_id,
    primary_headline: entry.b.headline,
    entity_counter: r.story?.entity_counter ?? {},
    top_entities: entry.b.top_entities ?? [],
    topic_slugs: r.story?.topic_slugs ?? [],
    // Decision-time reconstruction (see docstring); fall back to snapshot
    last_updated_at: reconstructedStoryTime ?? r.story?.last_updated_at ?? null,
    latest_article_published_at: reconstructedStoryTime ?? r.story?.latest_article_published_at ?? null,
    first_seen_at: r.story?.first_seen_at ?? null,
    primary_source_domain: r.story?.primary_source_domain ?? null,
    lifecycle_state: r.story?.lifecycle_state ?? 'active',
  };

  return { article, story };
}

// ============================================================================
// Decision replay (mirror of clusterArticle's cross-run decision order)
// ============================================================================

function replayDecision(entry) {
  const { article, story } = reconstructPair(entry);
  const r = entry.replay;

  const embedSim = r.embed_sim;
  if (!Number.isFinite(embedSim)) {
    return { predicted: null, reason: 'no_precomputed_similarity' };
  }

  const scoreResult = calculateHybridScore(article, story, embedSim);
  const threshold = getThreshold(article);
  const guardrail = passesClusteringGuardrail(article, story, scoreResult);

  const embedBest = scoreResult.embeddingScore;
  const embedSecond = Number.isFinite(r.embed_second) ? r.embed_second : null;
  // Fallback for log entries predating candidate_count: a present embed_second
  // implies >=2 candidates, which is all the Tier A threshold branch needs
  const candidateCount = r.candidate_count ?? (embedSecond !== null ? 2 : 1);
  const marginVacuous = r.margin_vacuous ?? (candidateCount < 2 || embedSecond === null);
  const margin = embedSecond !== null ? embedBest - embedSecond : null;
  const timeDiffHours = Number.isFinite(r.time_diff_hours) ? r.time_diff_hours : Infinity;

  // --- Path 1: normal attach (total >= adaptive threshold + guardrail) ---
  if (scoreResult.total >= threshold && guardrail) {
    const slugsMatch = article.topic_slug && story.topic_slugs?.includes(article.topic_slug);
    const finalScore = slugsMatch ? Math.min(scoreResult.total + 0.08, 1.0) : scoreResult.total;
    const isStale = story.lifecycle_state === 'stale';
    if (!isStale || canReopenStaleStory(finalScore, article, story)) {
      return { predicted: 'attach', path: 'normal', scoreResult, threshold, guardrail };
    }
  }

  // --- Corroboration signals (shared by Tier A bypass + Tier B) ---
  const slugTok = slugTokenSimilarity(article.topic_slug || '', story.topic_slugs || []);
  const entityOverlap = scoreResult.nonStopwordEntityOverlapCount ?? 0;
  const titleTokenOverlap = getTitleTokenOverlap(article.title, story.primary_headline || '');

  // --- Path 2: Tier A cross-run override ---
  const tierAEmbedThreshold = candidateCount < 2 ? 0.92 : 0.90;
  let marginOkTierA = marginVacuous ? true : margin >= 0.04;
  if (!marginOkTierA && embedBest >= tierAEmbedThreshold && timeDiffHours <= 48 && guardrail) {
    if (entityOverlap >= 1) marginOkTierA = true;
    else if (slugTok.passes) marginOkTierA = true;
    else if (titleTokenOverlap >= 1 && embedBest >= 0.905) marginOkTierA = true;
  }
  if (embedBest >= tierAEmbedThreshold && timeDiffHours <= 48 && marginOkTierA && guardrail) {
    return { predicted: 'attach', path: 'cross_run_tier_a', scoreResult, threshold, guardrail };
  }

  // --- Path 3: Tier B cross-run override ---
  const hasMeaningfulMargin = !marginVacuous && margin !== null && margin >= 0.04;
  let tierBMarginOk = hasMeaningfulMargin || marginVacuous;
  if (
    !tierBMarginOk && embedBest >= 0.88 && timeDiffHours <= 48 && guardrail &&
    TIERB_BYPASS_ENABLED
  ) {
    if (slugTok.passes) tierBMarginOk = true;
    else if (entityOverlap >= 2) tierBMarginOk = true;
    else if (titleTokenOverlap >= 1) tierBMarginOk = true;
  }
  if (embedBest >= 0.88 && timeDiffHours <= 72 && tierBMarginOk && guardrail) {
    if (slugTok.passes || entityOverlap >= 1 || titleTokenOverlap >= 1) {
      return { predicted: 'attach', path: 'cross_run_tier_b', scoreResult, threshold, guardrail };
    }
  }

  return { predicted: 'create', path: 'none', scoreResult, threshold, guardrail };
}

// ============================================================================
// Runner (harness contract: runEval({ runId, args }) → { results, stats, printSummary })
// ============================================================================

export async function runEval({ runId, args = {} }) {
  const goldSet = JSON.parse(readFileSync(GOLD_SET_PATH, 'utf-8'));
  let entries = goldSet.entries;
  if (args.ids?.length) {
    entries = entries.filter(e => args.ids.includes(e.id));
  }

  const results = [];
  let tp = 0, fp = 0, fn = 0, tn = 0;
  const byDifficulty = { easy: { correct: 0, total: 0 }, hard: { correct: 0, total: 0 } };
  const bySource = {};
  let liveAgree = 0, liveTotal = 0;
  let skippedStoryStory = 0, skippedNoSim = 0;

  for (const entry of entries) {
    if (entry.pair_type !== 'article_story') {
      skippedStoryStory++;
      continue; // story_story pairs are Judge-agent material (ADO-533), not replayable by the article scorer
    }

    const decision = replayDecision(entry);
    if (!decision.predicted) {
      skippedNoSim++;
      continue;
    }

    const actualSame = entry.label === 'same_event';
    const predictedAttach = decision.predicted === 'attach';
    const correct = predictedAttach === actualSame;

    if (predictedAttach && actualSame) tp++;
    else if (predictedAttach && !actualSame) fp++;
    else if (!predictedAttach && actualSame) fn++;
    else tn++;

    byDifficulty[entry.difficulty].total++;
    if (correct) byDifficulty[entry.difficulty].correct++;

    bySource[entry.source] ??= { correct: 0, total: 0 };
    bySource[entry.source].total++;
    if (correct) bySource[entry.source].correct++;

    // Replay-vs-live fidelity: what did PROD actually do with this pair?
    const liveAttach = entry.source === 'tier_ab_live_attach';
    const liveCreate = entry.source === 'near_miss' || entry.source === 'generic_collision';
    if (liveAttach || liveCreate) {
      liveTotal++;
      if (predictedAttach === liveAttach) liveAgree++;
    }

    results.push({
      content_type: 'clustering',
      content_id: entry.id,
      run_id: runId,
      timestamp: new Date().toISOString(),
      label: entry.label,
      difficulty: entry.difficulty,
      source: entry.source,
      predicted: decision.predicted,
      path: decision.path,
      correct,
      total_score: decision.scoreResult ? Number(decision.scoreResult.total.toFixed(4)) : null,
      embed_sim: entry.replay.embed_sim,
      threshold: decision.threshold,
      guardrail: decision.guardrail,
      title_a: entry.a.title,
      headline_b: entry.b.headline,
    });
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const f1 = precision != null && recall != null && precision + recall > 0
    ? (2 * precision * recall) / (precision + recall) : null;

  const pct = x => x == null ? 'n/a' : (100 * x).toFixed(1) + '%';

  const stats = {
    tierb_bypass_enabled: TIERB_BYPASS_ENABLED,
    evaluated: results.length,
    skipped_story_story: skippedStoryStory,
    skipped_no_similarity: skippedNoSim,
    confusion: { tp, fp, fn, tn },
    precision, recall, f1,
    accuracy_by_difficulty: Object.fromEntries(
      Object.entries(byDifficulty).map(([k, v]) => [k, v.total ? v.correct / v.total : null])
    ),
    accuracy_by_source: Object.fromEntries(
      Object.entries(bySource).map(([k, v]) => [k, v.total ? v.correct / v.total : null])
    ),
    replay_vs_live_agreement: liveTotal ? liveAgree / liveTotal : null,
  };

  function printSummary() {
    console.log('\n' + '='.repeat(70));
    console.log('CLUSTERING GOLD-SET BASELINE (deterministic system)');
    console.log('='.repeat(70));
    console.log(`Tier B margin bypass: ${TIERB_BYPASS_ENABLED ? 'ON (current PROD)' : 'OFF'}`);
    console.log(`Pairs evaluated: ${results.length} (skipped: ${skippedStoryStory} story_story, ${skippedNoSim} no-sim)`);
    console.log(`\nConfusion (positive = attach/same_event):`);
    console.log(`  TP=${tp}  FP=${fp}  FN=${fn}  TN=${tn}`);
    console.log(`\nPrecision: ${pct(precision)}   (FP = false merges — the failure mode Layer 1 must avoid)`);
    console.log(`Recall:    ${pct(recall)}   (FN = fragmentation — repaired later by the Judge)`);
    console.log(`F1:        ${pct(f1)}`);
    console.log(`\nAccuracy by difficulty: easy=${pct(stats.accuracy_by_difficulty.easy)} hard=${pct(stats.accuracy_by_difficulty.hard)}`);
    console.log(`Accuracy by source:`);
    for (const [src, acc] of Object.entries(stats.accuracy_by_source)) {
      console.log(`  ${src.padEnd(22)} ${pct(acc)}`);
    }
    console.log(`\nReplay-vs-live agreement: ${pct(stats.replay_vs_live_agreement)} (fidelity check — divergence = feature drift or flag delta)`);

    const show = args.disagreementsOnly
      ? results.filter(x => !x.correct)
      : (args.verbose ? results : []);
    if (show.length) {
      console.log('\n--- ' + (args.disagreementsOnly ? 'DISAGREEMENTS' : 'DETAIL') + ' ---');
      for (const x of show) {
        const kind = x.predicted === 'attach' && x.label === 'different_event' ? 'FALSE-MERGE'
          : x.predicted === 'create' && x.label === 'same_event' ? 'MISSED-MERGE'
          : 'OK';
        console.log(`[${kind}] ${x.content_id} (${x.source}, ${x.difficulty}) pred=${x.predicted} via ${x.path} total=${x.total_score} sim=${x.embed_sim?.toFixed(3)}`);
        console.log(`   A: ${x.title_a}`);
        console.log(`   B: ${x.headline_b}`);
      }
    }
    console.log('='.repeat(70));
  }

  return { results, stats, printSummary };
}
