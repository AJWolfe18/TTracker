/**
 * Clustering eval replay-fidelity tripwire (ADO-532, pass-2 review item)
 *
 * With the Tier B margin bypass OFF (the config in effect when the gold-set
 * log sample was captured), the offline replay in scripts/evals/clustering-eval.js
 * must reproduce the live PROD attach/create decision for EVERY gold-set pair —
 * 100% replay-vs-live agreement. The Tier A/B cascade is transcribed there
 * (the live code inlines it in clusterArticle), so this is the drift canary:
 * if a future change to hybrid-clustering.js's cascade (ADO-534 territory)
 * isn't mirrored in the eval, this test fails instead of the baseline
 * silently degrading.
 *
 * Runs fully offline (no DB, no network) — safe for qa:smoke.
 */

// Must be set BEFORE the module is imported (read at module load)
process.env.TIERB_BYPASS = 'off';

const { runEval } = await import('../evals/clustering-eval.js');

const { stats } = await runEval({ runId: 'fidelity-test', args: {} });

let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name} — ${detail}`);
  }
}

console.log('clustering-eval-fidelity:');
check(
  'gold set evaluated (>=150 article_story pairs)',
  stats.evaluated >= 150,
  `evaluated=${stats.evaluated}`
);
check(
  'no pairs skipped for missing similarity',
  stats.skipped_no_similarity === 0,
  `skipped_no_similarity=${stats.skipped_no_similarity}`
);
check(
  'replay-vs-live agreement is 100% with Tier B bypass off',
  stats.replay_vs_live_agreement === 1,
  `agreement=${(stats.replay_vs_live_agreement * 100).toFixed(1)}% — the transcribed Tier A/B cascade in clustering-eval.js has drifted from hybrid-clustering.js (or the gold set changed); re-sync them`
);

if (failed > 0) {
  console.error(`clustering-eval-fidelity: ${failed} failed`);
  process.exit(1);
}
console.log('clustering-eval-fidelity: all passed');
