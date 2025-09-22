/**
 * TTRC-142: Story Clustering Job Handler (ESM)
 * 
 * Handles 'story.cluster' jobs from the queue
 * Integrates with the clustering algorithm and database function
 */

import { extractPrimaryActor } from './rss/clustering.js';
import { withDatabaseRetry } from './utils/retry.js';

/**
 * Process a story clustering job
 * @param {Object} job - Job from the queue
 * @param {Object} supabase - Supabase client instance
 */
export async function processStoryClusterJob(job, supabase) {
  const { article_id } = job.payload;
  
  if (!article_id) {
    throw new Error('Missing article_id in job payload');
  }
  
  console.log(`[story.cluster] Processing clustering for article: ${article_id}`);
  
  try {
    // 1. Fetch the article details with retry
    const { data: article, error: fetchError } = await withDatabaseRetry(() => 
      supabase
        .from('articles')
        .select('*')
        .eq('id', article_id)
        .single()
    );
    
    if (fetchError || !article) {
      throw new Error(`Failed to fetch article ${article_id}: ${fetchError?.message || 'Not found'}`);
    }
    
    // 2. Extract primary actor if not already present
    let primaryActor = article.primary_actor;
    if (!primaryActor && article.title) {
      primaryActor = extractPrimaryActor(article.title);
      
      // Update article with extracted actor
      if (primaryActor) {
        await supabase
          .from('articles')
          .update({ primary_actor: primaryActor })
          .eq('id', article_id);
      }
    }
    
    // 3. Call the database clustering function (defensive nulls) with retry
    const { data: result, error: clusterError } = await withDatabaseRetry(() => 
      supabase.rpc('attach_or_create_story', {
        _article_id: article.id,
        _title: article.title || null,
        _url: article.url || null,
        _url_canonical: article.url_canonical || null,
        _url_hash: article.url_hash || null,
        _published_at: article.published_at || null,
        _source_name: article.source_name || null,
        _source_domain: article.source_domain || null,
        _primary_actor: primaryActor || null,
        _categories: article.categories || null
      })
    );
    
    if (clusterError) {
      throw new Error(`Clustering failed: ${clusterError.message}`);
    }
    
    // 4. Log the result
    const { story_id, created_new, score, status } = result;
    
    console.log(`[story.cluster] Article ${article_id} ${status}:`, {
      story_id,
      created_new,
      score,
      status
    });
    
    // 5. If this created a new story, we might want to enqueue enrichment (idempotent)
    if (created_new && story_id) {
      // Optional: Enqueue enrichment job for the new story
      // Using upsert to prevent duplicate jobs
      const { error: enrichError } = await supabase
        .from('job_queue')
        .upsert({
          job_type: 'story.enrich',
          payload: { story_id },
          status: 'pending',
          run_at: new Date(Date.now() + 5000).toISOString() // Delay 5 seconds
        }, {
          onConflict: 'job_type,payload_hash'
        });
      
      if (!enrichError) {
        console.log(`[story.cluster] Enqueued enrichment for new story ${story_id}`);
      }
    }
    
    return result;
    
  } catch (error) {
    console.error(`[story.cluster] Error processing article ${article_id}:`, error);
    throw error;
  }
}

/**
 * Batch clustering handler for processing multiple articles
 * More efficient for initial backfill or bulk operations
 */
export async function processBatchClusterJob(job, supabase) {
  const { limit = 50 } = job.payload;
  
  console.log(`[story.cluster.batch] Processing batch clustering for up to ${limit} articles`);
  
  try {
    // Get unclustered articles
    const { data: articles, error: fetchError } = await supabase
      .rpc('get_unclustered_articles', { _limit: limit });
    
    if (fetchError) {
      throw new Error(`Failed to fetch unclustered articles: ${fetchError.message}`);
    }
    
    if (!articles || articles.length === 0) {
      console.log('[story.cluster.batch] No unclustered articles found');
      return { processed: 0, message: 'No articles to cluster' };
    }
    
    console.log(`[story.cluster.batch] Found ${articles.length} unclustered articles`);
    
    const results = {
      processed: 0,
      attached: 0,
      created: 0,
      errors: 0
    };
    
    // Process each article
    for (const article of articles) {
      try {
        // Extract actor if needed
        let primaryActor = article.primary_actor;
        if (!primaryActor && article.title) {
          primaryActor = extractPrimaryActor(article.title);
        }
        
        // Call clustering function with defensive nulls
        const { data: result, error } = await supabase
          .rpc('attach_or_create_story', {
            _article_id: article.id,
            _title: article.title || null,
            _url: article.url || null,
            _url_canonical: article.url_canonical || null,
            _url_hash: article.url_hash || null,
            _published_at: article.published_at || null,
            _source_name: article.source_name || null,
            _source_domain: article.source_domain || null,
            _primary_actor: primaryActor || null,
            _categories: article.categories || null
          });
        
        if (error) {
          console.error(`[story.cluster.batch] Error clustering article ${article.id}:`, error);
          results.errors++;
        } else {
          results.processed++;
          if (result.created_new) {
            results.created++;
          } else {
            results.attached++;
          }
        }
        
      } catch (err) {
        console.error(`[story.cluster.batch] Exception for article ${article.id}:`, err);
        results.errors++;
      }
    }
    
    console.log('[story.cluster.batch] Batch clustering complete:', results);
    return results;
    
  } catch (error) {
    console.error('[story.cluster.batch] Batch processing failed:', error);
    throw error;
  }
}

// Export handlers
export const handlers = {
  'story.cluster': processStoryClusterJob,
  'story.cluster.batch': processBatchClusterJob
};
