// Job Queue Worker for RSS System with P1 Production Fixes
// Handles enrichment tasks with rate limiting and retries
// Run with: node scripts/job-queue-worker.js

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { handleFetchFeed } from './rss/fetch_feed.js';
import { initializeEnvironment, safeLog } from './utils/security.js';
import { handlers as clusteringHandlers } from './story-cluster-handler.js';
import { updateLifecycleStates } from './rss/lifecycle.js';
import { checkAndSplitStory } from './rss/auto-split.js';
import { runMergeDetection } from './rss/periodic-merge.js';
import { SYSTEM_PROMPT, buildUserPayload } from './enrichment/prompts.js';
import { enrichArticlesForSummary } from './enrichment/scraper.js';
import { fileURLToPath } from 'url';
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

// Initialize clients
const supabase = createClient(config.supabaseUrl, config.serviceRoleKey);
const openai = config.openaiKey ? new OpenAI({ apiKey: config.openaiKey }) : null;

// Category mapping: UI labels → DB enum values
const UI_TO_DB = {
  'Corruption & Scandals': 'corruption_scandals',
  'Democracy & Elections': 'democracy_elections',
  'Policy & Legislation': 'policy_legislation',
  'Justice & Legal': 'justice_legal',
  'Executive Actions': 'executive_actions',
  'Foreign Policy': 'foreign_policy',
  'Corporate & Financial': 'corporate_financial',
  'Civil Liberties': 'civil_liberties',
  'Media & Disinformation': 'media_disinformation',
  'Epstein & Associates': 'epstein_associates',
  'Other': 'other',
};

const toDbCategory = (label) => UI_TO_DB[label] || 'other';

// Track active jobs
let activeJobs = 0;
let lastJobStart = 0;
let isRunning = true;

// Job processor class
class JobProcessor {
  constructor() {
    // Use spread operator to preserve existing handlers
    this.handlers = {
      ...(this.handlers || {}),
      'fetch_feed': this.fetchFeed.bind(this),
      'fetch_all_feeds': this.fetchAllFeeds.bind(this),
      // Methods not yet implemented:
      // 'story.summarize': this.summarizeStory.bind(this),
      // 'story.classify': this.classifyStory.bind(this),
      // 'story.rescore': this.rescoreStory.bind(this),
      // 'story.close_old': this.closeOldStories.bind(this),
      // 'story.archive': this.archiveOldStories.bind(this),
      'story.cluster': (payload) => clusteringHandlers['story.cluster'](payload, supabase),
      'story.cluster.batch': (payload) => clusteringHandlers['story.cluster.batch'](payload, supabase),
      'story.enrich': this.enrichStory.bind(this),
      'story.lifecycle': this.updateLifecycle.bind(this),
      'story.split': this.splitStory.bind(this),
      'story.merge': this.mergeStories.bind(this),
      'article.enrich': this.enrichArticle.bind(this), // TTRC-234: Article embedding generation
      'process_article': this.processArticle.bind(this)
    };
  }

  async fetchFeed(payload) {
    // Delegate to the RSS fetcher module
    return await handleFetchFeed({ payload }, supabase);
  }

  async processArticle(payload) {
    const { article_id, article_url, source_domain } = payload;
    
    // This is a placeholder for future article processing (clustering, etc.)
    // For now, just log the article for processing
    console.log(`📄 Processing article: ${article_url} from ${source_domain}`);
    
    // Future: This would trigger clustering algorithm, entity extraction, etc.
    return { 
      article_id, 
      status: 'processed',
      message: 'Article queued for clustering' 
    };
  }

  async summarizeStory(payload) {
    const { story_id, mode = 'neutral' } = payload;
    
    if (!openai) {
      throw new Error('OpenAI not configured');
    }
    
    // Fetch story with articles
    const { data: story, error } = await supabase
      .from('stories')
      .select(`
        *,
        article_story!inner(
          articles!inner(*)
        )
      `)
      .eq('id', story_id)
      .single();

    if (error) throw new Error(`Failed to fetch story: ${error.message}`);
    
    // Prepare article texts
    const articleTexts = story.article_story
      .map(as => as.articles)
      .map(a => `Title: ${a.title}\nSource: ${a.source_name}\n${a.content || a.excerpt || ''}`)
      .join('\n\n---\n\n');

    // Generate summary based on mode
    const systemPrompt = mode === 'spicy' 
      ? "You are a political analyst writing engaging, opinionated summaries. Be provocative but factual."
      : "You are a neutral news summarizer. Present facts without bias or opinion.";

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Summarize this story:\n\n${articleTexts}` }
      ],
      max_tokens: 500,
      temperature: mode === 'spicy' ? 0.8 : 0.3
    });

    const summary = completion.choices[0].message.content;

    // Update story with summary
    const summaryField = mode === 'spicy' ? 'summary_spicy' : 'summary_neutral';
    await supabase
      .from('stories')
      .update({ [summaryField]: summary })
      .eq('id', story_id);

    return { story_id, mode, summary };
  }

  async classifyStory(payload) {
    // Placeholder for story classification
    return { message: 'Classification not yet implemented' };
  }

  async rescoreStory(payload) {
    // Placeholder for story rescoring
    return { message: 'Rescoring not yet implemented' };
  }

  async closeOldStories(payload) {
    // Close stories older than 72 hours
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - 72);

    const { data, error } = await supabase
      .from('stories')
      .update({ status: 'closed' })
      .eq('status', 'active')
      .lt('first_seen_at', cutoffDate.toISOString());

    if (error) throw error;
    return { closed: data?.length || 0 };
  }

  async archiveOldStories(payload) {
    // Archive closed stories older than 1 week
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);

    const { data, error } = await supabase
      .from('stories')
      .update({ status: 'archived' })
      .eq('status', 'closed')
      .lt('first_seen_at', cutoffDate.toISOString());

    if (error) throw error;
    return { archived: data?.length || 0 };
  }

  /**
   * TTRC-234: Article Embedding Generation
   * Generates semantic embeddings for articles using OpenAI text-embedding-3-small
   * Cost: ~$0.0002 per article
   */
  async enrichArticle(payload) {
    const { article_id } = payload;

    if (!openai) {
      throw new Error('OpenAI not configured');
    }

    // 1. Fetch article
    const { data: article, error } = await supabase
      .from('articles')
      .select('id, title, content, excerpt, embedding_v1')
      .eq('id', article_id)
      .single();

    if (error) throw new Error(`Failed to fetch article: ${error.message}`);

    // Skip if already has embedding (idempotency)
    if (article.embedding_v1 && article.embedding_v1.length > 0) {
      console.log(`ℹ️ Article ${article_id} already has embedding, skipping`);
      return {
        article_id,
        embedding_dimensions: article.embedding_v1.length,
        tokens: 0,
        cost: 0,
        skipped: true
      };
    }

    // 2. Build embedding input (title + first 2000 chars of content)
    const content = article.content || article.excerpt || '';
    if (!content.trim()) {
      console.warn(`⚠️ Article ${article_id} has no content, using title only for embedding`);
    }
    const embeddingInput = `${article.title}\n\n${content.slice(0, 2000)}`;

    // 3. Generate embedding using OpenAI text-embedding-3-small
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: embeddingInput
    });

    const embedding = embeddingResponse.data[0].embedding;

    // 4. Update article with embedding
    const { error: updateError } = await supabase
      .from('articles')
      .update({ embedding_v1: embedding })
      .eq('id', article_id);

    if (updateError) throw new Error(`Failed to update article: ${updateError.message}`);

    // 5. Cost tracking
    const usage = embeddingResponse.usage || { prompt_tokens: 0, total_tokens: 0 };
    const cost = (usage.total_tokens / 1000000) * 0.02; // $0.02 per 1M tokens

    console.log(`✅ Generated embedding for article ${article_id}:`, {
      tokens: usage.total_tokens,
      cost: `$${cost.toFixed(6)}`,
      dimensions: embedding.length
    });

    return {
      article_id,
      embedding_dimensions: embedding.length,
      tokens: usage.total_tokens,
      cost
    };
  }

  /**
   * TTRC-231: Update story lifecycle states
   * Calls updateLifecycleStates() which uses SQL function
   */
  async updateLifecycle(payload) {
    console.log('[job-queue-worker] Running lifecycle update...');
    const result = await updateLifecycleStates();

    if (!result.success) {
      throw new Error(result.error || 'Lifecycle update failed');
    }

    return result;
  }

  /**
   * TTRC-231: Auto-split story detection
   * Checks if story has low coherence and splits if needed
   */
  async splitStory(payload) {
    const { story_id, threshold } = payload || {};
    if (!story_id) throw new Error('story_id required');

    console.log(`[job-queue-worker] Checking split for story ${story_id}...`);
    const result = await checkAndSplitStory(story_id, threshold);

    if (!result.success) {
      throw new Error(result.error || 'Split check failed');
    }

    return result;
  }

  /**
   * TTRC-231: Periodic merge detection
   * Finds and merges duplicate stories
   */
  async mergeStories(payload) {
    const { limit, threshold } = payload || {};

    console.log('[job-queue-worker] Running merge detection...');
    const result = await runMergeDetection(limit, threshold);

    if (!result.success) {
      throw new Error(result.error || 'Merge detection failed');
    }

    return result;
  }

  /**
   * TTRC-235: Build entity counter from entities array
   * Creates jsonb {id: count} map for tracking entity frequency
   */
  buildEntityCounter(entities) {
    const counts = {};
    for (const e of entities || []) {
      if (!e?.id) continue;
      counts[e.id] = (counts[e.id] || 0) + 1;
    }
    return counts; // jsonb
  }

  /**
   * TTRC-235: Convert entities to top_entities text[] of canonical IDs
   * Sorts by confidence desc, then by id for deterministic ordering
   * Deduplicates and caps at max entities
   */
  toTopEntities(entities, max = 8) {
    // Sort by confidence desc, then by id for determinism
    const ids = (entities || [])
      .filter(e => e?.id)
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0) || a.id.localeCompare(b.id))
      .map(e => e.id);

    // Stable dedupe
    const seen = new Set();
    const out = [];
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out.slice(0, max); // text[]
  }

  /**
   * Fetch up to 6 articles for a story, ordered by relevance
   */
  async fetchStoryArticles(story_id) {
    const { data, error } = await supabase
      .from('article_story')
      .select('is_primary_source, similarity_score, matched_at, articles(*)')
      .eq('story_id', story_id)
      .order('is_primary_source', { ascending: false })
      .order('similarity_score', { ascending: false })
      .order('matched_at', { ascending: false })
      .limit(6);
      
    if (error) throw new Error(`Failed to fetch articles: ${error.message}`);
    return (data || []).filter(r => r.articles);
  }

  /**
   * Phase 1: Story Enrichment Handler
   * Generates summaries, categorizes, and updates story
   */
  async enrichStory(payload) {
    const { story_id } = payload || {};
    if (!story_id) throw new Error('story_id required');

    if (!openai) {
      throw new Error('OpenAI not configured');
    }

    // ========================================
    // 1. COOLDOWN CHECK (12 hours)
    // ========================================
    const { data: story, error: sErr } = await supabase
      .from('stories')
      .select('id, primary_headline, last_enriched_at')
      .eq('id', story_id)
      .single();
      
    if (sErr) throw new Error(`Failed to fetch story: ${sErr.message}`);
    
    const cooldownMs = 12 * 60 * 60 * 1000; // 12 hours
    if (story.last_enriched_at) {
      const elapsed = Date.now() - new Date(story.last_enriched_at).getTime();
      if (elapsed < cooldownMs) {
        return { 
          status: 429, 
          message: 'Cooldown active',
          retry_after: cooldownMs - elapsed 
        };
      }
    }

    // ========================================
    // 2. BUDGET CHECK (Optional - Phase 2)
    // ========================================
    // TODO: Add budget soft/hard stop once migration 008 is deployed

    // ========================================
    // 3. FETCH ARTICLES & BUILD CONTEXT
    // ========================================
    const links = await this.fetchStoryArticles(story_id);
    if (!links.length) {
      console.error(`❌ No articles found for story ${story_id}`);
      throw new Error('No articles found for story');
    }

    // Prepare articles for enrichment (with scraping where allowed)
    const articlesForEnrichment = links.map(({ articles }) => ({
      url: articles.url,
      source_domain: articles.source_domain,
      title: articles.title || '',
      source_name: articles.source_name || '',
      description: articles.content || articles.excerpt || ''
    }));

    // TTRC-258: Enrich with article scraping (max 2 articles from allow-list)
    const enriched = await enrichArticlesForSummary(articlesForEnrichment);

    // Build final article context for OpenAI
    const articles = enriched.map(a => ({
      title: a.title,
      source_name: a.source_name,
      excerpt: a.excerpt
        .replace(/<[^>]+>/g, ' ')    // strip any remaining HTML tags
        .replace(/\s+/g, ' ')         // collapse whitespace
        .trim()
    }));

    const userPayload = buildUserPayload({
      primary_headline: story.primary_headline || '',
      articles
    });

    // ========================================
    // 4. OPENAI CALL (JSON MODE)
    // ========================================
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPayload }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 500,
      temperature: 0.7
    });

    // ========================================
    // 5. PARSE & VALIDATE JSON
    // ========================================
    const text = completion.choices?.[0]?.message?.content || '{}';
    let obj;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      console.error('❌ JSON parse failed. Raw response:', text.slice(0, 500));
      throw new Error('Model did not return valid JSON');
    }

    // Extract and validate fields
    const summary_neutral = obj.summary_neutral?.trim();
    const summary_spicy = (obj.summary_spicy || summary_neutral || '').trim();
    const category_db = obj.category ? toDbCategory(obj.category) : null;
    const severity = ['critical', 'severe', 'moderate', 'minor'].includes(obj.severity)
      ? obj.severity
      : 'moderate';
    const primary_actor = (obj.primary_actor || '').trim() || null;

    // TTRC-235: Extract entities and format correctly
    const entities = obj.entities || [];
    const top_entities = this.toTopEntities(entities);  // text[] of IDs
    const entity_counter = this.buildEntityCounter(entities);  // jsonb {id: count}

    if (!summary_neutral) {
      throw new Error('Missing summary_neutral in response');
    }

    // ========================================
    // 6. UPDATE STORY
    // ========================================
    const { error: uErr } = await supabase
      .from('stories')
      .update({
        summary_neutral,
        summary_spicy,
        category: category_db,
        severity,
        primary_actor,
        top_entities,        // TTRC-235: text[] of canonical IDs
        entity_counter,      // TTRC-235: jsonb {id: count}
        last_enriched_at: new Date().toISOString()
      })
      .eq('id', story_id);

    if (uErr) throw new Error(`Failed to update story: ${uErr.message}`);

    // ========================================
    // 7. COST TRACKING (with guards)
    // ========================================
    const usage = completion.usage || { prompt_tokens: 0, completion_tokens: 0 };
    const costInput = (usage.prompt_tokens / 1000) * 0.00015;  // GPT-4o-mini input
    const costOutput = (usage.completion_tokens / 1000) * 0.0006; // GPT-4o-mini output
    const totalCost = costInput + costOutput;

    // Optional: Track in budgets table (Phase 2)
    // if (Phase 2 RPC exists) {
    //   const today = new Date().toISOString().slice(0, 10);
    //   await supabase.rpc('increment_budget', {
    //     p_day: today,
    //     p_cost: totalCost,
    //     p_calls: 1
    //   });
    // }

    console.log(`✅ Enriched story ${story_id}:`, {
      tokens: usage,
      cost: `$${totalCost.toFixed(6)}`,
      category: category_db,
      severity
    });

    return { 
      story_id, 
      tokens: usage, 
      cost: totalCost,
      summary_neutral,
      summary_spicy,
      category: category_db,
      severity,
      primary_actor
    };
  }

  async fetchAllFeeds(payload) {
    // Get all active feeds
    const { data: feeds, error } = await supabase
      .from('feed_registry')
      .select('*')
      .eq('is_active', true);

    if (error) throw error;

    // Create fetch_feed jobs for each
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

// Main worker loop
async function runWorker() {
  const processor = new JobProcessor();
  
  console.log('🚀 Job Queue Worker started');
  console.log(`   Poll interval: ${workerConfig.pollInterval}ms`);
  console.log(`   Max concurrent: ${workerConfig.maxConcurrent}`);
  console.log(`   Rate limit: ${workerConfig.rateLimit}ms between jobs`);
  
  // Verify database connection
  const { count, error: countError } = await supabase
    .from('job_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');
  
  if (countError) {
    console.error('❌ Database connection error:', countError.message);
    process.exit(1);
  }
  console.log(`   Database connected - ${count} pending jobs found\n`);
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n📛 Shutting down gracefully...');
    isRunning = false;
  });

  let loopCount = 0;
  while (isRunning) {
    loopCount++;
    if (loopCount % 12 === 0) {
      console.log(`💓 Worker alive - ${loopCount} loops, ${activeJobs} active jobs`);
    }
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

      // Claim next job - First SELECT to find it, then UPDATE to claim it
      console.log('🔍 Polling for jobs...');
      
      // Step 1: Find next available job
      const { data: candidateJobs, error: findError } = await supabase
        .from('job_queue')
        .select('*')
        .eq('status', 'pending')
        .lte('run_at', new Date().toISOString())
        .order('created_at', { ascending: true })
        .limit(1);
      
      if (findError || !candidateJobs?.length) {
        // No jobs available
        await new Promise(resolve => setTimeout(resolve, workerConfig.pollInterval));
        continue;
      }
      
      const candidate = candidateJobs[0];
      
      // Step 2: Try to claim it (race condition possible, but acceptable)
      const { data: claimedJobs, error: claimError } = await supabase
        .from('job_queue')
        .update({ 
          status: 'processing',
          started_at: new Date().toISOString()
        })
        .eq('id', candidate.id)
        .eq('status', 'pending')  // Double-check it's still pending
        .select();
      
      const job = claimedJobs?.[0] || null;

      if (job) {
        console.log(`✅ Claimed job ${job.id} - ${job.job_type}`);
      }

      if (claimError || !job) {
        // No jobs available, wait
        if (claimError && claimError.code !== 'PGRST116') {
          // PGRST116 = no rows returned (expected when no jobs)
          console.log('⚠️  Job claim error:', claimError.message, claimError.code);
        }
        await new Promise(resolve => setTimeout(resolve, workerConfig.pollInterval));
        continue;
      }

      // Process job
      activeJobs++;
      lastJobStart = Date.now();
      
      processor.processJob(job)
        .then(async (result) => {
          // Mark job as completed
          await supabase
            .from('job_queue')
            .update({ 
              status: 'completed',
              completed_at: new Date().toISOString()
            })
            .eq('id', job.id);
            
          safeLog('info', `Job completed successfully`, { 
            job_id: job.id,
            job_type: job.job_type 
          });
        })
        .catch(async (error) => {
          // Mark job as failed
          const attempts = (job.attempts || 0) + 1;
          const maxAttempts = job.max_attempts || workerConfig.maxRetries;
          
          if (attempts >= maxAttempts) {
            await supabase
              .from('job_queue')
              .update({ 
                status: 'failed',
                error: error.message,
                completed_at: new Date().toISOString()
              })
              .eq('id', job.id);
              
            safeLog('error', `Job failed after ${attempts} attempts`, {
              job_id: job.id,
              job_type: job.job_type,
              error: error.message
            });
          } else {
            // Exponential backoff for retry
            const backoffMs = workerConfig.backoffBase * Math.pow(2, attempts - 1);
            const nextRun = new Date(Date.now() + backoffMs);
            
            await supabase
              .from('job_queue')
              .update({ 
                status: 'pending',
                attempts: attempts,
                run_at: nextRun.toISOString(),
                error: error.message
              })
              .eq('id', job.id);
              
            safeLog('warn', `Job failed, will retry`, {
              job_id: job.id,
              job_type: job.job_type,
              attempt: attempts,
              next_run: nextRun.toISOString()
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
    console.log(`Waiting for ${activeJobs} jobs to complete...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('👋 Worker shut down');
  process.exit(0);
}

// Export for testing
export { JobProcessor, runWorker };

// Start worker if run directly
// Fixed for Windows compatibility
const __filename = fileURLToPath(import.meta.url);

if (process.argv[1]?.includes('job-queue-worker.js')) {
  runWorker().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
