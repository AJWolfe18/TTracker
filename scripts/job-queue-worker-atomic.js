// Job Queue Worker with Atomic Claiming (Production-Grade)
// Uses server-side atomic functions to prevent race conditions
// Run with: node scripts/job-queue-worker-atomic.js

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { handleFetchFeed } from './rss/fetch_feed.js';
import { initializeEnvironment, safeLog } from './utils/security.js';
import { handlers as clusteringHandlers } from './story-cluster-handler.js';
import { fileURLToPath } from 'url';

// Validate environment variables immediately
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Initialize and validate environment on startup
const config = initializeEnvironment();

// Worker configuration
const workerConfig = {
  pollInterval: parseInt(process.env.WORKER_POLL_INTERVAL_MS || '5000', 10),
  maxConcurrent: parseInt(process.env.WORKER_MAX_CONCURRENT || '2', 10),
  rateLimit: parseInt(process.env.WORKER_RATE_LIMIT_MS || '500', 10),
  maxRetries: parseInt(process.env.WORKER_MAX_RETRIES || '3', 10),
  backoffBase: parseInt(process.env.WORKER_BACKOFF_BASE_MS || '2000', 10)
};

// Max empty polls before exit (for CI)
const MAX_EMPTY_POLLS = parseInt(process.env.MAX_EMPTY_POLLS || '30', 10);

// Initialize clients
const supabase = createClient(config.supabaseUrl, config.serviceRoleKey);
const openai = config.openaiKey ? new OpenAI({ apiKey: config.openaiKey }) : null;

// RPC helper for finishing jobs
async function finishJob(jobId, success, errorMsg = null) {
  // DB: finish_job(p_job_id BIGINT, p_success BOOLEAN, p_error_message TEXT)
  // NOTE: Supabase uses named parameters - order doesn't matter, names do!
  const { error } = await supabase.rpc('finish_job', {
    p_error_message: errorMsg || null,
    p_job_id: jobId,               // BIGINT in schema
    p_success: !!success
  });
  if (error) {
    throw new Error(`Failed to finish job ${jobId}: ${error.message}`);
  }
}

// Track active jobs
let activeJobs = 0;
let lastJobStart = 0;
let isRunning = true;
let consecutiveEmptyPolls = 0;

// Job processor class (handlers remain the same)
class JobProcessor {
  constructor() {
    this.handlers = {
      'fetch_feed': this.fetchFeed.bind(this),
      'fetch_all_feeds': this.fetchAllFeeds.bind(this),
      // Fix: Wrap clustering handlers to pass supabase correctly
      'story.cluster': async (payload) => {
        if (clusteringHandlers?.['story.cluster']) {
          return await clusteringHandlers['story.cluster']({ payload }, supabase);
        }
        return { status: 'skipped', reason: 'handler_not_available' };
      },
      'story.cluster.batch': async (payload) => {
        if (clusteringHandlers?.['story.cluster.batch']) {
          return await clusteringHandlers['story.cluster.batch']({ payload }, supabase);
        }
        return { status: 'skipped', reason: 'handler_not_available' };
      },
      'process_article': this.processArticle.bind(this),
      // Stub handler for enrichment (not implemented - see TTRC-148)
      'story.enrich': async (payload) => {
        const storyId = payload?.story_id;
        console.log('⏭️ Enrichment not implemented yet - skipping', { storyId });
        return { status: 'skipped', reason: 'not_implemented' };
      }
    };
  }

  async fetchFeed(payload) {
    return await handleFetchFeed({ payload }, supabase);
  }

  async processArticle(payload) {
    const { article_id, article_url, source_domain } = payload;
    console.log(`📄 Processing article: ${article_url} from ${source_domain}`);
    
    // Actually do the clustering - call the story.cluster handler
    if (clusteringHandlers && clusteringHandlers['story.cluster']) {
      // Fixed: Pass job object with payload property, not wrapped in another object
      return await clusteringHandlers['story.cluster']({ payload }, supabase);
    } else {
      console.warn('Story clustering handler not available');
      return { 
        article_id, 
        status: 'skipped',
        message: 'Clustering handler not available' 
      };
    }
  }

  async fetchAllFeeds(payload) {
    const { data: feeds, error } = await supabase
      .from('feed_registry')
      .select('*')
      .eq('is_active', true);

    if (error) throw error;

    const jobs = feeds.map(feed => ({
      job_type: 'fetch_feed',
      payload: {
        feed_id: feed.id,
        url: feed.feed_url,
        source_name: feed.feed_name
      },
      status: 'pending',
      run_at: new Date().toISOString()
    }));

    const { error: insertError } = await supabase
      .from('job_queue')
      .insert(jobs);

    if (insertError) throw insertError;
    return { feeds_scheduled: feeds.length };
  }

  async processJob(job) {
    const handler = this.handlers[job.job_type];
    
    if (!handler) {
      throw new Error(`No handler for job type: ${job.job_type}`);
    }

    safeLog('info', `Processing ${job.job_type} job`, { job_id: job.id });
    
    try {
      const result = await handler(job.payload);
      return result;
    } catch (error) {
      safeLog('error', `Job ${job.job_type} failed`, { 
        job_id: job.id,
        error: error.message 
      });
      throw error;
    }
  }
}

// Main worker loop with atomic claiming
async function runWorker() {
  const processor = new JobProcessor();
  
  console.log('🚀 Job Queue Worker (Atomic) started');
  console.log(`   Poll interval: ${workerConfig.pollInterval}ms`);
  console.log(`   Max concurrent: ${workerConfig.maxConcurrent}`);
  console.log(`   Rate limit: ${workerConfig.rateLimit}ms between jobs`);
  
  // Better environment display
  const host = (() => { try { return new URL(process.env.SUPABASE_URL).host; } catch { return 'unknown-host'; } })();
  console.log(`   Host: ${host}`);
  
  // Use server-side function to count runnable jobs (single source of truth)
  const { data: runnable, error: rcErr } = await supabase.rpc('count_runnable_fetch_jobs');
  if (rcErr) {
    console.error('⚠️  count_runnable_fetch_jobs error:', rcErr);
    console.log('   Note: Run migration 017 to add the count function');
  }
  console.log(`   Jobs available at start: ${runnable || 0}`);
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n📛 Shutting down gracefully...');
    isRunning = false;
  });

  // First, check if the atomic functions exist
  try {
    const { error: testError } = await supabase.rpc('claim_and_start_job', { p_job_type: null });
    if (testError && testError.message.includes('function') && testError.message.includes('does not exist')) {
      console.error('⚠️ Atomic claiming functions not found. Please run the required migrations');
      console.log('Falling back to legacy claiming mode...');
      // Fall back to legacy mode
      return runLegacyWorker();
    }
  } catch (e) {
    // Functions exist, continue
  }

  // Clean up any stuck jobs from previous runs
  try {
    const { data: resetCount, error } = await supabase.rpc('reset_stuck_jobs');
    if (resetCount && resetCount > 0) {
      console.log(`🧾 Reset ${resetCount} stuck jobs`);
    }
  } catch (e) {
    // If function doesn't exist, just continue
    console.log('⚠️ reset_stuck_jobs not available, continuing...');
  }

  while (isRunning) {
    try {
      // Check if we have capacity
      if (activeJobs >= workerConfig.maxConcurrent) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      // Rate limiting
      const timeSinceLastJob = Date.now() - lastJobStart;
      if (timeSinceLastJob < workerConfig.rateLimit) {
        await new Promise(resolve => setTimeout(resolve, workerConfig.rateLimit - timeSinceLastJob));
      }

      // ATOMIC CLAIM - race-safe job claiming for fetch_feed jobs
      console.log('🔍 Attempting to claim a fetch_feed job...');
      const { data, error: claimErr } = await supabase.rpc('claim_and_start_job', { 
        p_job_type: 'fetch_feed' 
      });
      
      if (claimErr) {
        console.error('❌ claim_and_start_job failed:', claimErr.message);
        await new Promise(resolve => setTimeout(resolve, workerConfig.pollInterval));
        continue;
      }

      // Treat null or null-shaped rows as "no job"
      const job = (data && data.id != null && data.job_type) ? data : null;
      if (!job) {
        consecutiveEmptyPolls++;
        if (consecutiveEmptyPolls >= MAX_EMPTY_POLLS) {
          console.log(`🛑 No jobs for ${MAX_EMPTY_POLLS} polls - exiting cleanly`);
          break;
        }
        if (consecutiveEmptyPolls % 10 === 0) {
          console.log(`⏳ No jobs available (checked ${consecutiveEmptyPolls} times)`);
        }
        await new Promise(resolve => setTimeout(resolve, workerConfig.pollInterval));
        continue;
      }

      // From here on we DEFINITELY have a job
      consecutiveEmptyPolls = 0;
      console.log(`✅ Claimed job #${job.id} (${job.job_type})`);

      // Process job asynchronously
      activeJobs++;
      lastJobStart = Date.now();
      
      processor.processJob(job)
        .then(async (result) => {
          // Treat 'skipped' status as success (non-error)
          const isSkipped = result?.status === 'skipped';
          
          // Mark job as done using new helper
          try {
            await finishJob(job.id, true, null);
            const emoji = isSkipped ? '⏭️' : '✅';
            safeLog('info', `${emoji} Job ${isSkipped ? 'skipped' : 'done'} successfully`, { 
              job_id: job.id,
              job_type: job.job_type,
              ...(isSkipped && { reason: result?.reason })
            });
          } catch (finishError) {
            console.error(`❌ Error finishing job ${job.id}:`, finishError);
          }
        })
        .catch(async (error) => {
          // Mark job as failed using new helper
          const errorMessage = error.message || 'Unknown error';
          try {
            await finishJob(job.id, false, errorMessage.slice(0, 1000));
            safeLog('error', `❌ Job failed`, {
              job_id: job.id,
              job_type: job.job_type,
              error: errorMessage,
              attempts: job.attempts
            });
          } catch (finishError) {
            console.error(`❌ Error marking job ${job.id} as failed:`, finishError);
          }
        })
        .finally(() => {
          activeJobs--;
        });

    } catch (error) {
      safeLog('error', 'Worker loop error', { error: error.message });
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  // Wait for active jobs to complete
  while (activeJobs > 0) {
    console.log(`⏳ Waiting for ${activeJobs} jobs to complete...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('👋 Worker shut down cleanly');
  process.exit(0);
}

// Legacy worker for fallback (uses the old claiming method)
async function runLegacyWorker() {
  console.log('⚠️ Running in LEGACY mode (not race-safe)');
  
  // Import and run the original worker
  const { runWorker: runOriginalWorker } = await import('./job-queue-worker.js');
  return runOriginalWorker();
}

// Export for testing
export { JobProcessor, runWorker };

// Check if this file is being run directly
const isMain = process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  console.log('🔧 Starting worker from command line...');
  runWorker().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  });
}
