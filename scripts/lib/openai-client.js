/**
 * OpenAI Client Wrapper (TTRC-225)
 *
 * Production-grade OpenAI integration with:
 * - Rate limiting (60 req/min default)
 * - Cost tracking and budget enforcement ($50/day cap)
 * - Idempotency (prevents duplicate processing)
 * - Exponential backoff retry logic
 * - Request batching for efficiency
 *
 * Usage:
 *   import { openaiClient } from './lib/openai-client.js';
 *   const entities = await openaiClient.extractEntities(article);
 *   const embedding = await openaiClient.generateEmbedding(article);
 */

import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables from .env
dotenv.config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Initialize Supabase client for cost tracking
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  DAILY_CAP_USD: 50.0,           // Maximum daily spend (global)
  PIPELINE_CAP_USD: 5.0,         // Maximum daily spend for clustering pipeline
  PER_MINUTE_LIMIT: 60,          // Max requests per minute
  MAX_RETRIES: 3,                // Exponential backoff retries
  INITIAL_BACKOFF_MS: 1000,      // 1 second initial delay
  BATCH_SIZE: 25,                // Articles per batch
  MAX_CONSECUTIVE_FAILURES: 3,   // Halt after N failures

  // Model pricing (per 1K tokens)
  PRICING: {
    'gpt-4o-mini': {
      input: 0.00015,   // $0.15 per 1M input tokens
      output: 0.00060   // $0.60 per 1M output tokens
    },
    'text-embedding-ada-002': {
      input: 0.0001,    // $0.10 per 1M tokens
      output: 0         // No output tokens for embeddings
    }
  }
};

// ============================================================================
// Rate Limiter (Simple Token Bucket)
// ============================================================================

class RateLimiter {
  constructor(tokensPerMinute) {
    this.tokensPerMinute = tokensPerMinute;
    this.availableTokens = tokensPerMinute;
    this.lastRefill = Date.now();
  }

  async wait() {
    // Refill tokens based on time elapsed
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const refillAmount = (elapsed / 60000) * this.tokensPerMinute;
    this.availableTokens = Math.min(
      this.tokensPerMinute,
      this.availableTokens + refillAmount
    );
    this.lastRefill = now;

    // Wait if no tokens available
    if (this.availableTokens < 1) {
      const waitTime = (1 - this.availableTokens) * (60000 / this.tokensPerMinute);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.availableTokens = 1;
    }

    this.availableTokens -= 1;
  }
}

// ============================================================================
// OpenAI Client Class
// ============================================================================

class OpenAIClient {
  constructor() {
    this.rateLimiter = new RateLimiter(CONFIG.PER_MINUTE_LIMIT);
    this.cache = new Map();  // In-memory cache for idempotency
    this.consecutiveFailures = 0;  // Track consecutive failures for halt logic
  }

  /**
   * Check daily budget before making API call
   * Enforces both global cap ($50/day) and pipeline cap ($5/day)
   */
  async checkBudget() {
    const { data, error } = await supabase
      .rpc('get_daily_openai_spend');

    if (error) {
      console.error('[openai-client] Failed to check budget:', error);
      return true;  // Allow on error (don't block)
    }

    const dailySpend = parseFloat(data || 0);

    // Check global cap
    if (dailySpend >= CONFIG.DAILY_CAP_USD) {
      throw new Error(
        `Daily OpenAI budget exceeded (global): $${dailySpend.toFixed(2)} / $${CONFIG.DAILY_CAP_USD}`
      );
    }

    // Check pipeline-specific cap (for clustering metadata)
    if (dailySpend >= CONFIG.PIPELINE_CAP_USD) {
      throw new Error(
        `Daily OpenAI budget exceeded (pipeline): $${dailySpend.toFixed(2)} / $${CONFIG.PIPELINE_CAP_USD}. Manual resume required.`
      );
    }

    return true;
  }

  /**
   * Record API usage and cost to database
   */
  async recordCost(operation, articleId, model, tokensUsed, costUSD) {
    const { error } = await supabase
      .from('openai_usage')
      .insert({
        operation,
        article_id: articleId,
        model,
        tokens_used: tokensUsed,
        cost_usd: costUSD
      });

    if (error) {
      console.error('[openai-client] Failed to record cost:', error);
    }
  }

  /**
   * Calculate cost based on tokens and model
   */
  calculateCost(model, inputTokens, outputTokens = 0) {
    const pricing = CONFIG.PRICING[model];
    if (!pricing) {
      console.warn(`[openai-client] Unknown model: ${model}, using default pricing`);
      return 0;
    }

    const inputCost = (inputTokens / 1000) * pricing.input;
    const outputCost = (outputTokens / 1000) * pricing.output;
    return inputCost + outputCost;
  }

  /**
   * Exponential backoff retry wrapper
   */
  async retryWithBackoff(fn, retries = CONFIG.MAX_RETRIES) {
    let lastError;

    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        // Don't retry on budget errors
        if (error.message?.includes('budget exceeded')) {
          throw error;
        }

        // Retry on rate limit or transient errors
        if (error.status === 429 || error.status >= 500) {
          const delay = CONFIG.INITIAL_BACKOFF_MS * Math.pow(2, i);
          console.log(`[openai-client] Retry ${i + 1}/${retries} after ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // Don't retry on other errors
        throw error;
      }
    }

    throw lastError;
  }

  /**
   * Extract entities from article text
   * Returns: {entities: [{id, name, type, confidence}], primaryActor: string}
   */
  async extractEntities(article) {
    // Idempotency check
    const cacheKey = `entities:v1:${article.id}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // Budget check
    await this.checkBudget();

    // Rate limit
    await this.rateLimiter.wait();

    // Prepare prompt
    const text = `${article.title}\n\n${article.content?.substring(0, 1000) || ''}`;

    let result;
    try {
      result = await this.retryWithBackoff(async () => {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are an expert at extracting political entities from news articles.
Extract the top 5 most important entities, categorized as:
- PERSON: Politicians, officials, public figures
- ORG: Government agencies, companies, organizations
- LAW: Laws, executive orders, policies
- PLACE: Countries, states, cities

Also identify the PRIMARY ACTOR (main person the story is about).

Return JSON only: {
  "primary_actor": "Name",
  "entities": [
    {"id": "US-TRUMP", "name": "Donald Trump", "type": "PERSON", "confidence": 0.95},
    ...
  ]
}

Use canonical IDs like: US-TRUMP, US-DOD, US-CONGRESS, etc.`
          },
          {
            role: 'user',
            content: text
          }
        ],
        temperature: 0.1,
        max_tokens: 500
      });

      return response;
      });

      // Reset failure counter on success
      this.consecutiveFailures = 0;
    } catch (error) {
      // Increment failure counter
      this.consecutiveFailures++;

      // Halt if max consecutive failures reached
      if (this.consecutiveFailures >= CONFIG.MAX_CONSECUTIVE_FAILURES) {
        throw new Error(
          `OpenAI pipeline halted after ${CONFIG.MAX_CONSECUTIVE_FAILURES} consecutive failures. Manual resume required. Last error: ${error.message}`
        );
      }

      throw error;
    }

    // Parse response (strip markdown code fences if present)
    let content = result.choices[0].message.content.trim();

    // Remove markdown code fences
    if (content.startsWith('```')) {
      content = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.error('[openai-client] Failed to parse entity extraction:', content);
      parsed = { primary_actor: null, entities: [] };
    }

    // Calculate cost
    const tokensUsed = result.usage.total_tokens;
    const cost = this.calculateCost(
      'gpt-4o-mini',
      result.usage.prompt_tokens,
      result.usage.completion_tokens
    );

    // Record cost
    await this.recordCost('entity_extraction', article.id, 'gpt-4o-mini', tokensUsed, cost);

    // Cache result
    this.cache.set(cacheKey, parsed);

    return parsed;
  }

  /**
   * Generate embedding for article
   * Returns: Float32Array of length 1536
   */
  async generateEmbedding(article) {
    // Idempotency check
    const cacheKey = `embedding:v1:${article.id}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // Budget check
    await this.checkBudget();

    // Rate limit
    await this.rateLimiter.wait();

    // Prepare text (title + first 3 sentences, ~200 tokens)
    const sentences = article.content?.split(/[.!?]+/).slice(0, 3).join('. ') || '';
    const text = `${article.title}\n\n${sentences}`.substring(0, 2000);

    let result;
    try {
      result = await this.retryWithBackoff(async () => {
      const response = await openai.embeddings.create({
        model: 'text-embedding-ada-002',
        input: text
      });

      return response;
      });

      // Reset failure counter on success
      this.consecutiveFailures = 0;
    } catch (error) {
      // Increment failure counter
      this.consecutiveFailures++;

      // Halt if max consecutive failures reached
      if (this.consecutiveFailures >= CONFIG.MAX_CONSECUTIVE_FAILURES) {
        throw new Error(
          `OpenAI pipeline halted after ${CONFIG.MAX_CONSECUTIVE_FAILURES} consecutive failures. Manual resume required. Last error: ${error.message}`
        );
      }

      throw error;
    }

    // Extract embedding
    const embedding = result.data[0].embedding;

    // Calculate cost
    const tokensUsed = result.usage.total_tokens;
    const cost = this.calculateCost('text-embedding-ada-002', tokensUsed);

    // Record cost
    await this.recordCost('embedding', article.id, 'text-embedding-ada-002', tokensUsed, cost);

    // Cache result
    this.cache.set(cacheKey, embedding);

    return embedding;
  }

  /**
   * Extract quotes from article content
   * Returns: Array of SimHash values (bigint)
   */
  extractQuotes(content) {
    if (!content) return [];

    // Find quoted text
    const quoteRegex = /"([^"]{12,})"/g;
    const quotes = [];
    let match;

    while ((match = quoteRegex.exec(content)) !== null) {
      const quote = match[1];

      // Normalize quote
      const normalized = quote
        .toLowerCase()
        .replace(/['']/g, "'")  // Normalize apostrophes
        .replace(/[""]/g, '"')  // Normalize quotes
        .replace(/—/g, '-')     // Normalize dashes
        .replace(/\s+/g, ' ')   // Collapse whitespace
        .trim();

      if (normalized.split(' ').length >= 12) {
        // Simple hash (for now - can upgrade to proper SimHash later)
        const hash = this.simpleHash(normalized);
        quotes.push(hash);
      }
    }

    return quotes;
  }

  /**
   * Simple string hash (64-bit) - placeholder for proper SimHash
   */
  simpleHash(str) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;

    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }

    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    return BigInt(4294967296) * BigInt(h2) + BigInt(h1);
  }

  /**
   * Process batch of articles (rate-limited)
   */
  async processBatch(articles, operation) {
    const results = [];

    for (const article of articles) {
      try {
        let result;

        if (operation === 'entities') {
          result = await this.extractEntities(article);
        } else if (operation === 'embedding') {
          result = await this.generateEmbedding(article);
        }

        results.push({ articleId: article.id, result, error: null });
      } catch (error) {
        console.error(`[openai-client] Failed to process article ${article.id}:`, error.message);
        results.push({ articleId: article.id, result: null, error: error.message });
      }
    }

    return results;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const openaiClient = new OpenAIClient();

// Export config for testing
export { CONFIG };
