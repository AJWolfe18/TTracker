// ADO-603: a new decision on an existing docket re-queues the enrichment; an older one is skipped.
import assert from 'node:assert/strict';
import { classifyRefetch, REQUEUE_COLUMNS } from '../scotus/refetch-guard.js';

// Louisiana v. Callais, row 1678: enriched from the June 27, 2025 reargument order
const callais = { courtlistener_cluster_id: 111, decided_at: '2025-06-27T00:00:00+00:00' };

// the daily re-fetch of the same cluster (how a text-less case gets its syllabus later)
assert.equal(classifyRefetch(callais, { clusterId: 111, dateFiled: '2025-06-27' }), 'refresh');
assert.equal(classifyRefetch(callais, { clusterId: 111, dateFiled: '2026-04-29' }), 'refresh',
  'same cluster with a corrected date is a refresh, not a new decision');

// a CourtListener revision: new cluster id, same decision date
assert.equal(classifyRefetch(callais, { clusterId: 222, dateFiled: '2025-06-27' }), 'refresh');

// the April 29, 2026 merits opinion lands on the same docket
assert.equal(classifyRefetch(callais, { clusterId: 10852760, dateFiled: '2026-04-29' }), 'new_decision');

// an older order on a docket that already holds the merits opinion
const merits = { courtlistener_cluster_id: 10852760, decided_at: '2026-04-29T00:00:00+00:00' };
assert.equal(classifyRefetch(merits, { clusterId: 111, dateFiled: '2025-06-27' }), 'older_decision');

// missing dates never trigger a re-queue or a skip
assert.equal(classifyRefetch({ courtlistener_cluster_id: 1, decided_at: null }, { clusterId: 2, dateFiled: '2026-04-29' }), 'refresh');
assert.equal(classifyRefetch(callais, { clusterId: 2, dateFiled: null }), 'refresh');

// row from before cluster ids were stored
assert.equal(classifyRefetch({ courtlistener_cluster_id: null, decided_at: '2025-06-27' }, { clusterId: 5, dateFiled: '2026-01-05' }), 'new_decision');

assert.deepEqual({ ...REQUEUE_COLUMNS }, { enrichment_status: 'pending', enriched_at: null, prompt_version: null });
assert.ok(Object.isFrozen(REQUEUE_COLUMNS));

process.stdout.write('scotus-refetch-guard: ok\n');
