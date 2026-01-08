// Deno Edge Function skeleton for RSS worker (copy into Supabase Edge Functions)
// Build: deno.json should allow "dom" libs for fetch/Request

import { chooseNextIntervalSeconds } from './schedulerHeuristic.ts';
import { deliverAlertIFTTT } from './deliverAlertIFTTT.ts';

/**
 * Pseudocode: wire your Supabase client as `supabase` and call this from your job runner.
 * This handler expects enqueue_fetch_job( feed_id, job_type, payload, run_at, payload_hash? )
 * and the metrics RPCs created in migration 028.
 */
export async function handleJob(supabase: any, job: any) {
  switch (job.job_type) {
    case 'rss_fetch_feed': {
      const feedId = Number(job?.payload?.feed_id);
      if (!feedId) return;

      // 1) TODO: Perform conditional GET, parse RSS, apply compliance, upsert via RPC
      // 2) Decide next interval from activity hints or local signals
      const interval = chooseNextIntervalSeconds({
        itemsLastFetch: job.items_last_fetch ?? 0,
        notModifiedStreak: job.not_modified_streak ?? 0,
        articles24h: job.articles_24h ?? 0
      });

      // 3) Schedule next run
      await supabase.rpc('enqueue_fetch_job', {
        p_feed_id: feedId,
        p_job_type: 'rss_fetch_feed',
        p_payload: { feed_id: feedId },
        p_run_at: new Date(Date.now() + interval * 1000).toISOString()
      });
      break;
    }
    case 'send_alert':
      await deliverAlertIFTTT(job.payload);
      break;
    default:
      break;
  }
}
