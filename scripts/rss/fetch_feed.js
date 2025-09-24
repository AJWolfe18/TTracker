// RSS Feed Fetcher with P1 Production Fixes
// Uses atomic DB operations, proper timeouts, and size limits
// Part of TTRC-140 RSS Fetcher implementation

import Parser from 'rss-parser';
import crypto from 'node:crypto';
import { fetchWithTimeout, readLimitedResponse, withRetry, getNetworkConfig } from '../utils/network.js';
import { safeLog } from '../utils/security.js';

const parser = new Parser({
  timeout: 15000,
  maxRedirects: 3,
  customFields: {
    item: [
      ['content:encoded', 'contentEncoded'],
      ['description', 'description'],
      ['summary', 'summary']
    ]
  }
});

/**
 * Handle fetch_feed job from the job queue with P1 production fixes
 * @param {Object} job - Job payload with { feed_id, url, source_name }
 * @param {Object} db - Database client (Supabase)
 * @returns {Object} - Processing results
 */
async function handleFetchFeed(job, db) {
  const { feed_id, url, source_name } = job.payload;
  const startTime = Date.now();
  const networkConfig = getNetworkConfig();
  
  safeLog('info', 'Starting RSS feed fetch', {
    feed_id,
    source_name,
    url_domain: new URL(url).hostname
  });

  try {
    // 1) Read ETag/Last-Modified from feed_registry for conditional GET
    const { data: feedRecord, error: feedError } = await db
      .from('feed_registry')
      .select('etag, last_modified, failure_count')
      .eq('feed_url', url)
      .single();

    if (feedError) {
      throw new Error(`Failed to fetch feed record: ${feedError.message}`);
    }

    // 2) Build conditional headers
    const headers = {
      'User-Agent': 'TrumpyTracker/1.0 RSS Fetcher',
      'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml'
    };

    if (feedRecord?.etag) {
      headers['If-None-Match'] = feedRecord.etag;
    }
    if (feedRecord?.last_modified) {
      headers['If-Modified-Since'] = feedRecord.last_modified;
    }

    // 3) Fetch the feed with proper timeout and retry logic
    const response = await withRetry(async () => {
      return await fetchWithTimeout(url, { headers }, networkConfig.timeoutMs);
    }, networkConfig.maxRetries, networkConfig.baseDelay);

    // 4) Handle 304 Not Modified (no new content)
    if (response.status === 304) {
      safeLog('info', 'RSS feed not modified', {
        feed_id,
        source_name,
        status: 304,
        duration_ms: Date.now() - startTime
      });
      
      // Update last_304_at and reset failure count
      await db
        .from('feed_registry')
        .update({
          failure_count: 0,
          last_304_at: new Date().toISOString()
        })
        .eq('feed_url', url);

      return {
        feed_id,
        source_name,
        status: '304_not_modified',
        articles_processed: 0,
        duration_ms: Date.now() - startTime
      };
    }

    // 5) Handle fetch errors
    if (!response.ok) {
      await incrementFailureCount(db, url, feedRecord?.failure_count || 0);
      throw new Error(`Feed fetch failed: ${response.status} ${response.statusText}`);
    }

    // 6) Read response with size limits and streaming
    const xmlContent = await readLimitedResponse(response, networkConfig.maxBytes);

    // 7) Update ETag/Last-Modified on successful fetch
    const newEtag = response.headers.get('etag');
    const newLastModified = response.headers.get('last-modified');
    
    await db
      .from('feed_registry')
      .update({
        etag: newEtag || feedRecord?.etag,
        last_modified: newLastModified || feedRecord?.last_modified,
        failure_count: 0,
        last_fetched: new Date().toISOString()
      })
      .eq('feed_url', url);

    // 8) Parse RSS/Atom content
    const feed = await parser.parseString(xmlContent);

    safeLog('info', 'RSS feed parsed successfully', {
      feed_id,
      source_name,
      feed_title: feed.title,
      total_items: feed.items?.length || 0,
      content_size_bytes: xmlContent.length
    });

    // 9) Apply RSS item limit protection (P1 requirement)
    const maxItems = parseInt(process.env.RSS_MAX_ITEMS || '500', 10);
    const items = (feed.items ?? []).slice(0, maxItems);
    
    if (items.length < (feed.items?.length || 0)) {
      safeLog('warn', 'RSS feed truncated due to item limit', {
        feed_id,
        source_name,
        original_items: feed.items?.length || 0,
        limited_items: items.length,
        max_items: maxItems
      });
    }

    // 10) Process articles using atomic database function
    let articlesProcessed = 0;
    let articlesCreated = 0;
    let articlesUpdated = 0;

    if (items && items.length > 0) {
      for (const item of items) {
        try {
          const result = await processArticleItemAtomic(item, url, source_name, feed_id, db);
          articlesProcessed++;
          if (result.is_new) {
            articlesCreated++;
          } else if (result.enqueued) {
            articlesUpdated++;
          }
        } catch (error) {
          safeLog('error', 'Failed to process article', {
            feed_id,
            source_name,
            article_url: item.link,
            error: error.message
          });
          // Continue processing other articles even if one fails
        }
      }
    }

    const duration = Date.now() - startTime;

    safeLog('info', 'RSS feed processing completed', {
      feed_id,
      source_name,
      articles_processed: articlesProcessed,
      articles_created: articlesCreated,
      articles_updated: articlesUpdated,
      duration_ms: duration
    });

    return {
      feed_id,
      source_name,
      status: 'success',
      articles_processed: articlesProcessed,
      articles_created: articlesCreated,
      articles_updated: articlesUpdated,
      feed_title: feed.title,
      duration_ms: duration
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    
    safeLog('error', 'RSS feed processing failed', {
      feed_id,
      source_name,
      error: error.message,
      duration_ms: duration
    });
    
    // Increment failure count in database
    await incrementFailureCount(db, url, feedRecord?.failure_count || 0);

    throw error;
  }
}

/**
 * Process individual RSS/Atom item using atomic database function
 * @param {Object} item - RSS item
 * @param {string} feedUrl - Original feed URL
 * @param {string} sourceName - Source name
 * @param {Object} db - Database client
 * @returns {Object} - Processing result
 */
async function processArticleItemAtomic(item, feedUrl, sourceName, feedId, db) {
  const articleUrl = item.link || item.guid;
  const title = item.title || '(untitled)';
  
  if (!articleUrl) {
    throw new Error('Article has no URL');
  }

  // Parse published date (try multiple formats)
  let publishedAt;
  try {
    publishedAt = item.isoDate || item.pubDate || new Date().toISOString();
    publishedAt = new Date(publishedAt).toISOString();
  } catch (error) {
    publishedAt = new Date().toISOString();
  }

  // Check if article is within freshness window (3 days)
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const articleDate = new Date(publishedAt);
  
  if (articleDate < threeDaysAgo) {
    safeLog('info', 'Skipping old article', {
      article_url: articleUrl,
      published_at: publishedAt,
      age_hours: Math.round((Date.now() - articleDate.getTime()) / (1000 * 60 * 60))
    });
    return { is_new: false, skipped: true, reason: 'too_old' };
  }

  // Extract source domain from feed URL
  const sourceDomain = new URL(feedUrl).hostname.replace(/^www\./, '');
  
  // Generate URL hash for deduplication
  const urlHash = crypto.createHash('sha256').update(articleUrl).digest('hex');

  // Extract content/description
  const content = item.contentEncoded || item.description || item.summary || '';
  
  // Detect opinion content based on URL patterns
  const isOpinion = detectOpinionContent(articleUrl, content, title);

  // Build metadata object
  const metadata = {
    feed_url: feedUrl,
    original_guid: item.guid,
    author: item.creator || item.author,
    categories: item.categories || [],
    processed_at: new Date().toISOString()
  };

  // Use atomic database function for upsert + enqueue
  const { data: result, error } = await db
    .rpc('upsert_article_and_enqueue_jobs', {
      p_url: articleUrl,
      p_title: title.substring(0, 500), // Limit headline length
      p_content: content.substring(0, 5000), // Limit content length
      p_published_at: publishedAt,
      p_feed_id: feedId,
      p_source_name: sourceName,
      p_source_domain: sourceDomain,
      p_content_type: isOpinion ? 'opinion' : 'news_report',
      p_is_opinion: isOpinion,
      p_metadata: metadata
    });

  if (error) {
    throw new Error(`Failed to upsert article atomically: ${error.message}`);
  }

  if (!result) {
    throw new Error('Atomic upsert returned no result');
  }

  // Result is now a JSONB object, not an array
  const { article_id, is_new, job_enqueued, job_id } = result;

  return {
    is_new,
    enqueued: job_enqueued,
    article_id,
    url: articleUrl,
    title: title,
    job_id: job_id
  };
}

/**
 * Increment failure count for a feed
 * @param {Object} db - Database client
 * @param {string} url - Feed URL
 * @param {number} currentCount - Current failure count
 */
async function incrementFailureCount(db, url, currentCount = 0) {
  const newCount = currentCount + 1;
  
  await db
    .from('feed_registry')
    .update({
      failure_count: newCount
    })
    .eq('feed_url', url);

  if (newCount >= 5) {
    safeLog('warn', 'Feed failure threshold reached', {
      feed_url: new URL(url).hostname,
      failure_count: newCount,
      status: 'will_be_skipped'
    });
  }
}

/**
 * Detect if content is opinion/editorial based on URL patterns and content
 * @param {string} url - Article URL
 * @param {string} content - Article content
 * @param {string} title - Article title
 * @returns {boolean} - True if likely opinion content
 */
function detectOpinionContent(url, content, title) {
  const opinionPatterns = [
    /\/opinion\//i,
    /\/editorial\//i,
    /\/commentary\//i,
    /\/analysis\//i,
    /\/op-ed\//i,
    /\/blogs?\//i
  ];

  // Check URL patterns
  const urlHasOpinionPattern = opinionPatterns.some(pattern => pattern.test(url));
  
  // Check title patterns
  const titlePatterns = [
    /^opinion:/i,
    /^editorial:/i,
    /^commentary:/i,
    /^analysis:/i
  ];
  const titleHasOpinionPattern = titlePatterns.some(pattern => pattern.test(title));

  return urlHasOpinionPattern || titleHasOpinionPattern;
}

export {
  handleFetchFeed
};
