/**
 * TTRC-142: Story Clustering Job Handler (ESM)
 *
 * Handles 'story.cluster' jobs from the queue
 * Integrates with the clustering algorithm and database function
 *
 * Test: Verify TTRC-198 expert hardening works with GPT-5
 */

import { extractPrimaryActor } from './rss/clustering.js';
import { withDatabaseRetry } from './utils/retry.js';
import { enqueueStoryEnrichment } from './utils/job-helpers.js';

/**
 * Process a story clustering job
 * @param {Object} job - Job from the queue
 * @param {Object} supabase - Supabase client instance
 */
export async function processStoryClusterJob(job, supabase) {
  // Defensive: handle if called with just payload or with job object
  const payload = job?.payload || job;
  const { article_id } = payload;
  
  if (!article_id) {
    console.log('[story.cluster] Skipping job with missing article_id');
    return { status: 'skipped', reason: 'missing_article_id' };
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
    const { story_id, created_new, reopened, similarity_score, status } = result;

    console.log(`[story.cluster] Article ${article_id} ${status}:`, {
      story_id,
      created_new,
      reopened,
      similarity_score,
      status
    });
    
    // 5. Trigger enrichment for new or reopened stories
    
    if ((created_new || reopened) && story_id) {
      try {
        const enrichResult = await enqueueStoryEnrichment(supabase, story_id, 5000);
        
        if (enrichResult.status === 'queued') {
          const action = created_new ? 'new' : 'reopened';
          console.log(`[story.cluster] ✅ Enqueued enrichment for ${action} story ${story_id}`);
        } else if (enrichResult.status === 'duplicate') {
          console.log(`[story.cluster] ℹ️ Enrichment already queued for story ${story_id}`);
        }
      } catch (enrichError) {
        console.error(`[story.cluster] ⚠️ Failed to enqueue enrichment for story ${story_id}:`, enrichError);
        // Don't fail the clustering job if enrichment enqueue fails
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
