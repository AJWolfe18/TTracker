/**
 * Shared Perplexity API Client
 *
 * Extracted from perplexity-research.js (ADO-253) for reuse by:
 * - Pardon research (perplexity-research.js)
 * - SCOTUS Scout fact extraction (scotus-scout.js)
 *
 * Provides:
 * - PerplexityClient class (API wrapper, retries, rate-limit handling)
 * - sanitizeForPrompt() for input safety
 * - sanitizeErrorBody() for safe error logging
 */

// ============================================================
// Constants
// ============================================================

const PERPLEXITY_MODEL = 'sonar';
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 5000;
const MAX_RETRY_DELAY_MS = 15000;

// ============================================================
// Security Helpers
// ============================================================

/**
 * Sanitize text for prompt injection protection
 * Removes control characters, limits length, escapes special patterns
 */
export function sanitizeForPrompt(text, maxLength = 500) {
  if (text == null) return '';
  return String(text)
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/```/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/**
 * Sanitize error response body to prevent API key/secret exposure
 */
export function sanitizeErrorBody(body, maxLength = 500) {
  if (!body) return null;
  return String(body)
    .replace(/["']?\s*authorization\s*["']?\s*[:=]\s*["']?Bearer\s+[^\s'"]+/gi, 'Authorization: Bearer [REDACTED]')
    .replace(/["']?\s*authorization\s*["']?\s*[:=]\s*["']?Basic\s+[^\s'"]+/gi, 'Authorization: Basic [REDACTED]')
    .replace(/Bearer\s+[^\s'"]+/gi, 'Bearer [REDACTED]')
    .replace(/api[_-]?key["\s:=]+[A-Za-z0-9._-]{20,}/gi, 'api_key: [REDACTED]')
    .replace(/["']?\s*x[-_]?api[-_]?key["']?\s*[:=]\s*["']?[^"'\s]+/gi, 'x-api-key: [REDACTED]')
    .replace(/\b(access|refresh)_token["\s:=]+[A-Za-z0-9._-]{20,}/gi, '$1_token: [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9._-]{20,}\b/gi, '[REDACTED_KEY]')
    .replace(/\bpplx-[A-Za-z0-9._-]{20,}\b/gi, '[REDACTED_KEY]')
    .replace(/[A-Za-z0-9._-]{32,}/g, '[LONG_STRING_REDACTED]')
    .slice(0, maxLength);
}

// ============================================================
// Perplexity Client
// ============================================================

export class PerplexityClient {
  constructor(apiKey, options = {}) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.perplexity.ai';
    this.model = options.model || PERPLEXITY_MODEL;
    this.maxRetries = options.maxRetries ?? MAX_RETRIES;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? RETRY_BASE_DELAY_MS;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? MAX_RETRY_DELAY_MS;
  }

  async research(query, options = {}, retryCount = 0) {
    const systemPrompt = options.systemPrompt || 'You are a research assistant. Return ONLY valid JSON. Do not include markdown formatting or code blocks.';
    const temperature = options.temperature ?? 0.3;
    const maxTokens = options.maxTokens ?? 1500;

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query }
        ],
        temperature,
        max_tokens: maxTokens
      })
    });

    // Handle rate limiting (429) with exponential backoff
    if (response.status === 429 && retryCount < this.maxRetries) {
      const retryAfterSec = parseInt(response.headers.get('retry-after') || '0', 10);
      const baseDelay = retryAfterSec ? retryAfterSec * 1000 : this.retryBaseDelayMs * Math.pow(2, retryCount);
      const delay = Math.min(baseDelay, this.maxRetryDelayMs);
      console.log(`   ⏳ Rate limited (429). Retry ${retryCount + 1}/${this.maxRetries} after ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
      return this.research(query, options, retryCount + 1);
    }

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`Perplexity API error: ${response.status}`);
      error.status = response.status;
      error.body = sanitizeErrorBody(errorText, 1000);
      throw error;
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content || '';
    const usage = data.usage || { prompt_tokens: 0, completion_tokens: 0 };
    const citations = data.citations || [];

    return { content, usage, citations };
  }

  calculateCost(usage) {
    // Perplexity Sonar pricing (approximate)
    // $5 per 1M input tokens, $15 per 1M output tokens
    const inputCost = (usage.prompt_tokens / 1_000_000) * 5;
    const outputCost = (usage.completion_tokens / 1_000_000) * 15;
    return inputCost + outputCost;
  }
}
