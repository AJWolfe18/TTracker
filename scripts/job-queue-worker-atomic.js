// Job Queue Worker with Atomic Claiming (Production-Grade)
// Uses server-side atomic functions to prevent race conditions
// Run with: node scripts/job-queue-worker-atomic.js

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { handleFetchFeed } from './rss/fetch_feed.js';
import { initializeEnvironment, safeLog } from './utils/security.js';
import { handlers as clusteringHandlers } from './story-cluster-handler.js';
import dotenv from 'dotenv';
dotenv.config();

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
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n📛 Shutting down gracefully...');
    isRunning = false;
  });

  // First, check if the atomic functions exist
  try {
    const { error: testError } = await supabase.rpc('claim_next_job', { p_job_type: null });
    if (testError && testError.message.includes('function') && testError.message.includes('does not exist')) {
      console.error('⚠️ Atomic claiming functions not found. Please run migration 009_atomic_job_claiming.sql');
      console.log('Falling back to legacy claiming mode...');
      // Fall back to legacy mode
      return runLegacyWorker();
    }
  } catch (e) {
    // Functions exist, continue
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

      // ATOMIC CLAIM - race-safe job claiming
      const { data: job, error: claimError } = await supabase.rpc('claim_next_job', {
        p_job_type: null  // null means claim any job type
      });

      if (claimError) {
        console.error('❌ Error claiming job:', claimError);
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }

      if (!job || !job.id) {
        // No jobs available
        consecutiveEmptyPolls++;
        
        // Check if we should exit due to idle timeout (for CI)
        if (consecutiveEmptyPolls >= MAX_EMPTY_POLLS) {
          console.log(`🛑 No jobs for ${MAX_EMPTY_POLLS} polls - exiting cleanly`);
          break;
        }
        
        // Log occasionally to show worker is alive
        if (consecutiveEmptyPolls % 10 === 0) {
          console.log(`⏳ No jobs available (checked ${consecutiveEmptyPolls} times)`);
        }
        
        await new Promise(resolve => setTimeout(resolve, workerConfig.pollInterval));
        continue;
      }

      // Reset empty poll counter
      consecutiveEmptyPolls = 0;
      
      console.log(`✅ Claimed job #${job.id} (${job.job_type})`);

      // Process job asynchronously
      activeJobs++;
      lastJobStart = Date.now();
      
      processor.processJob(job)
        .then(async (result) => {
          // Treat 'skipped' status as success (non-error)
          const isSkipped = result?.status === 'skipped';
          
          // Mark job as done using atomic function
          const { error: finishError } = await supabase.rpc('finish_job', {
            p_id: job.id,
            p_success: true,  // Always true for successful processing (including skipped)
            p_error: isSkipped ? `Skipped: ${result?.reason || 'not_implemented'}` : null
          });

          if (finishError) {
            console.error(`❌ Error finishing job ${job.id}:`, finishError);
          } else {
            const emoji = isSkipped ? '⏭️' : '✅';
            safeLog('info', `${emoji} Job ${isSkipped ? 'skipped' : 'done'} successfully`, { 
              job_id: job.id,
              job_type: job.job_type,
              ...(isSkipped && { reason: result?.reason })
            });
          }
        })
        .catch(async (error) => {
          // Mark job as failed using atomic function
          const errorMessage = error.message || 'Unknown error';
          const { error: finishError } = await supabase.rpc('finish_job', {
            p_id: job.id,
            p_success: false,
            p_error: errorMessage.slice(0, 1000)  // Truncate to 1000 chars
          });

          if (finishError) {
            console.error(`❌ Error marking job ${job.id} as failed:`, finishError);
          } else {
            safeLog('error', `❌ Job failed`, {
              job_id: job.id,
              job_type: job.job_type,
              error: errorMessage,
              attempts: job.attempts
            });
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

// Start worker if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runWorker().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
