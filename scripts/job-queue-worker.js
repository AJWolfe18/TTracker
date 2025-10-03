// Job Queue Worker for RSS System with P1 Production Fixes
// Handles enrichment tasks with rate limiting and retries
// Run with: node scripts/job-queue-worker.js

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { handleFetchFeed } from './rss/fetch_feed.js';
import { initializeEnvironment, safeLog } from './utils/security.js';
import { handlers as clusteringHandlers } from './story-cluster-handler.js';
import { SYSTEM_PROMPT, buildUserPayload } from './enrichment/prompts.js';
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
      'story.cluster': clusteringHandlers['story.cluster'],
      'story.cluster.batch': clusteringHandlers['story.cluster.batch'],
      'story.enrich': this.enrichStory.bind(this),
      // 'article.enrich': this.enrichArticle.bind(this), 
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
      .map(a => `Title: ${a.headline}\nSource: ${a.source_name}\n${a.content || ''}`)
      .join('\n\n---\n\n');

    // Generate summary based on mode
    const systemPrompt = mode === 'spicy' 
      ? "You are a political analyst writing engaging, opinionated summaries. Be provocative but factual."
      : "You are a neutral news summarizer. Present facts without bias or opinion.";

    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Summarize this story:\n\n${articleTexts}` }
      ],
      max_tokens: 500,
      temperature: mode === 'spicy' ? 0.8 : 0.3
    });

    const summary = completion.choices[0].message.content;

    // Update story with summary
    const summaryField = mode === 'spicy' ? 'spicy_summary' : 'neutral_summary';
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
      .lt('created_at', cutoffDate.toISOString());

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
      .lt('created_at', cutoffDate.toISOString());

    if (error) throw error;
    return { archived: data?.length || 0 };
  }

  async enrichArticle(payload) {
    const { article_id } = payload;
    
    if (!openai) {
      throw new Error('OpenAI not configured');
    }

    // Fetch article
    const { data: article, error } = await supabase
      .from('articles')
      .select('*')
      .eq('id', article_id)
      .single();

    if (error) throw new Error(`Failed to fetch article: ${error.message}`);

    // Extract entities and topics
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { 
          role: 'system', 
          content: 'Extract key entities and topics from this article. Return JSON with: entities (array of people/orgs), topics (array of themes), sentiment (positive/negative/neutral)'
        },
        { 
          role: 'user', 
          content: `Title: ${article.title}\n\nContent: ${article.content || article.description || ''}` 
        }
      ],
      max_tokens: 200,
      temperature: 0.3
    });

    let enrichment;
    try {
      enrichment = JSON.parse(completion.choices[0].message.content);
    } catch (e) {
      enrichment = { error: 'Failed to parse enrichment' };
    }

    // Update article with enrichment
    await supabase
      .from('articles')
      .update({ 
        entities: enrichment.entities || [],
        topics: enrichment.topics || [],
        sentiment: enrichment.sentiment || 'neutral'
      })
      .eq('id', article_id);

    return { article_id, enrichment };
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

    // Build article snippets (strip HTML, truncate to ~300 chars)
    const articles = links.map(({ articles }) => ({
      title: articles.title || '',
      source_name: articles.source_name || '',
      excerpt: (articles.content || articles.excerpt || '')
        .replace(/<[^>]+>/g, ' ')    // strip HTML tags
        .replace(/\s+/g, ' ')         // collapse whitespace
        .trim()
        .slice(0, 300)
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

      // Claim next job
      console.log('🔍 Polling for jobs...');
      const { data: job, error: claimError } = await supabase
        .from('job_queue')
        .update({ 
          status: 'processing',
          started_at: new Date().toISOString()
        })
        .eq('status', 'pending')
        .lte('run_at', new Date().toISOString())
        .order('created_at', { ascending: true })
        .limit(1)
        .select()
        .single();

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
