// Job Queue Worker for RSS System
// Handles enrichment tasks with rate limiting and retries
// Run with: node scripts/job-queue-worker.js

const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
require('dotenv').config();

// Configuration
const config = {
  supabase: {
    url: process.env.SUPABASE_URL || 'https://wnrjrywpcadwutfykflu.supabase.co', // Default to TEST
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY
  },
  worker: {
    pollInterval: 5000, // Check for jobs every 5 seconds
    maxConcurrent: 2,   // Process 2 jobs at a time
    rateLimit: 500,     // Min 500ms between job starts (2/second)
    maxRetries: 3,
    backoffBase: 2000   // Base backoff in ms
  }
};

// Initialize clients
const supabase = createClient(config.supabase.url, config.supabase.serviceKey);
const openai = new OpenAI({ apiKey: config.openai.apiKey });

// Track active jobs
let activeJobs = 0;
let lastJobStart = 0;
let isRunning = true;

// Job processor class
class JobProcessor {
  constructor() {
    this.handlers = {
      'story.summarize': this.summarizeStory.bind(this),
      'story.classify': this.classifyStory.bind(this),
      'story.rescore': this.rescoreStory.bind(this),
      'article.enrich': this.enrichArticle.bind(this)
    };
  }

  async summarizeStory(payload) {
    const { story_id, mode = 'neutral' } = payload;
    
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
        { 
          role: 'user', 
          content: `Summarize this political story in 2-3 paragraphs:\n\n${articleTexts}`
        }
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

    return { story_id, mode, summary_length: summary.length };
  }

  async classifyStory(payload) {
    const { story_id } = payload;
    
    // Fetch story
    const { data: story, error } = await supabase
      .from('stories')
      .select('headline, neutral_summary')
      .eq('id', story_id)
      .single();

    if (error) throw new Error(`Failed to fetch story: ${error.message}`);

    // Classify using OpenAI
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { 
          role: 'system', 
          content: 'Classify political news into categories and severity levels. Respond in JSON format.'
        },
        {
          role: 'user',
          content: `Classify this story:
Title: ${story.headline}
Summary: ${story.neutral_summary || 'No summary yet'}

Return JSON with:
- category: one of [policy, scandal, election, executive_order, international, other]
- severity: 1-10 (10 being most impactful)
- confidence: 0-100 (your confidence in the classification)`
        }
      ],
      response_format: { type: 'json_object' }
    });

    const classification = JSON.parse(completion.choices[0].message.content);
    
    // Update story
    await supabase
      .from('stories')
      .update({
        category: classification.category,
        severity_level: classification.severity,
        confidence_score: classification.confidence / 100
      })
      .eq('id', story_id);

    return { story_id, ...classification };
  }

  async rescoreStory(payload) {
    const { story_id } = payload;
    
    // Simple rescoring based on article count and recency
    const { data: story, error } = await supabase
      .from('stories')
      .select(`
        created_at,
        article_story(count)
      `)
      .eq('id', story_id)
      .single();

    if (error) throw new Error(`Failed to fetch story: ${error.message}`);

    // Calculate new confidence score
    const articleCount = story.article_story[0].count;
    const hoursOld = (Date.now() - new Date(story.created_at).getTime()) / (1000 * 60 * 60);
    
    let confidence = 0.5; // Base confidence
    confidence += Math.min(articleCount * 0.1, 0.3); // Up to +30% for multiple articles
    confidence -= Math.min(hoursOld * 0.01, 0.2); // Decay over time
    confidence = Math.max(0.3, Math.min(1.0, confidence)); // Clamp between 30-100%

    await supabase
      .from('stories')
      .update({ confidence_score: confidence })
      .eq('id', story_id);

    return { story_id, new_confidence: confidence };
  }

  async enrichArticle(payload) {
    const { article_id } = payload;
    
    // Fetch article
    const { data: article, error } = await supabase
      .from('articles')
      .select('*')
      .eq('id', article_id)
      .single();

    if (error) throw new Error(`Failed to fetch article: ${error.message}`);

    // Extract key entities using OpenAI
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'Extract key entities from political news articles. Return JSON.'
        },
        {
          role: 'user',
          content: `Extract entities from:
Title: ${article.headline}
Content: ${article.content || 'No content'}

Return JSON with:
- people: array of person names mentioned
- organizations: array of organizations
- locations: array of locations
- topics: array of main topics`
        }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 200
    });

    const entities = JSON.parse(completion.choices[0].message.content);
    
    // Update article metadata
    await supabase
      .from('articles')
      .update({
        metadata: {
          ...article.metadata,
          entities,
          enriched_at: new Date().toISOString()
        }
      })
      .eq('id', article_id);

    return { article_id, entities };
  }
}

// Main worker loop
async function runWorker() {
  const processor = new JobProcessor();
  
  console.log('🚀 Job Queue Worker started');
  console.log(`   Poll interval: ${config.worker.pollInterval}ms`);
  console.log(`   Max concurrent: ${config.worker.maxConcurrent}`);
  console.log(`   Rate limit: ${config.worker.rateLimit}ms between jobs\n`);

  while (isRunning) {
    try {
      // Check if we can process more jobs
      if (activeJobs >= config.worker.maxConcurrent) {
        await sleep(1000);
        continue;
      }

      // Rate limiting
      const timeSinceLastJob = Date.now() - lastJobStart;
      if (timeSinceLastJob < config.worker.rateLimit) {
        await sleep(config.worker.rateLimit - timeSinceLastJob);
      }

      // Fetch next job using advisory lock
      const { data: job, error } = await supabase.rpc('claim_next_job', {
        job_types: Object.keys(processor.handlers)
      });

      if (error) {
        console.error('Error claiming job:', error);
        await sleep(5000);
        continue;
      }

      if (!job) {
        // No jobs available
        await sleep(config.worker.pollInterval);
        continue;
      }

      // Process job asynchronously
      activeJobs++;
      lastJobStart = Date.now();
      
      processJob(job, processor).catch(err => {
        console.error(`Job ${job.id} failed:`, err);
      }).finally(() => {
        activeJobs--;
      });

    } catch (error) {
      console.error('Worker loop error:', error);
      await sleep(5000);
    }
  }
}

// Process individual job
async function processJob(job, processor) {
  const startTime = Date.now();
  console.log(`📋 Processing job ${job.id} (${job.type})`);

  try {
    // Get handler for job type
    const handler = processor.handlers[job.type];
    if (!handler) {
      throw new Error(`Unknown job type: ${job.type}`);
    }

    // Execute job
    const result = await handler(job.payload);
    
    // Mark as completed
    await supabase
      .from('job_queue')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        result: result
      })
      .eq('id', job.id);

    const duration = Date.now() - startTime;
    console.log(`✅ Job ${job.id} completed in ${duration}ms`);

  } catch (error) {
    console.error(`❌ Job ${job.id} failed:`, error.message);
    
    // Calculate retry delay with exponential backoff
    const retryDelay = config.worker.backoffBase * Math.pow(2, job.attempts);
    
    // Update job with error
    await supabase
      .from('job_queue')
      .update({
        status: job.attempts >= config.worker.maxRetries - 1 ? 'failed' : 'pending',
        attempts: job.attempts + 1,
        error: error.message,
        next_retry_at: new Date(Date.now() + retryDelay).toISOString()
      })
      .eq('id', job.id);
  }
}

// Helper function for delays
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⏹️  Shutting down worker...');
  isRunning = false;
  
  // Wait for active jobs to complete
  const checkInterval = setInterval(() => {
    if (activeJobs === 0) {
      clearInterval(checkInterval);
      console.log('✅ All jobs completed. Goodbye!');
      process.exit(0);
    } else {
      console.log(`   Waiting for ${activeJobs} job(s) to complete...`);
    }
  }, 1000);
});

// Database function for claiming jobs
const claimJobFunction = `
-- This function needs to be created in Supabase
CREATE OR REPLACE FUNCTION claim_next_job(job_types text[])
RETURNS TABLE (
  id bigint,
  type text,
  payload jsonb,
  attempts int
) AS $$
DECLARE
  v_job_id bigint;
BEGIN
  -- Select and lock the next available job
  SELECT jq.id INTO v_job_id
  FROM job_queue jq
  WHERE jq.status = 'pending'
    AND jq.type = ANY(job_types)
    AND (jq.next_retry_at IS NULL OR jq.next_retry_at <= NOW())
  ORDER BY jq.created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  
  IF v_job_id IS NULL THEN
    RETURN;
  END IF;
  
  -- Update job status
  UPDATE job_queue
  SET status = 'processing',
      started_at = NOW()
  WHERE job_queue.id = v_job_id;
  
  -- Return job details
  RETURN QUERY
  SELECT jq.id, jq.type, jq.payload, jq.attempts
  FROM job_queue jq
  WHERE jq.id = v_job_id;
END;
$$ LANGUAGE plpgsql;
`;

// Start worker if run directly
if (require.main === module) {
  // Check for required environment variables
  if (!config.supabase.serviceKey) {
    console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
    process.exit(1);
  }
  
  if (!config.openai.apiKey) {
    console.error('❌ Missing OPENAI_API_KEY environment variable');
    process.exit(1);
  }

  console.log('📝 Note: Make sure to create the claim_next_job function in Supabase:');
  console.log(claimJobFunction);
  console.log('\n');
  
  runWorker().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { JobProcessor, runWorker };
