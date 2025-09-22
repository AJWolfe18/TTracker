/**
 * Utility functions for retry logic and error handling
 */

/**
 * Retry a function with exponential backoff and jitter
 * @param {Function} fn - Async function to retry
 * @param {number} tries - Number of attempts (default 3)
 * @param {number} base - Base delay in ms (default 500)
 * @returns {Promise} - Result of successful execution
 */
export async function withRetry(fn, tries = 3, base = 500) {
  let lastError;
  
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      
      // Don't retry on the last attempt
      if (i === tries - 1) break;
      
      // Exponential backoff with jitter
      const delay = base * Math.pow(2, i) + Math.random() * 250;
      console.log(`[retry] Attempt ${i + 1}/${tries} failed, retrying in ${Math.round(delay)}ms:`, e.message);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

/**
 * Check if an error is retryable
 * @param {Error} error - The error to check
 * @returns {boolean} - Whether the error is retryable
 */
export function isRetryableError(error) {
  const message = error.message || '';
  
  // Network errors
  if (message.includes('ECONNREFUSED')) return true;
  if (message.includes('ETIMEDOUT')) return true;
  if (message.includes('ENOTFOUND')) return true;
  if (message.includes('fetch failed')) return true;
  
  // Database connection errors
  if (message.includes('connection')) return true;
  if (message.includes('timeout')) return true;
  
  // Rate limiting
  if (error.status === 429) return true;
  if (message.includes('rate limit')) return true;
  
  // Temporary failures
  if (error.status >= 500 && error.status < 600) return true;
  
  return false;
}

/**
 * Wrap a database operation with retry logic
 * @param {Function} operation - Database operation to execute
 * @returns {Promise} - Result of the operation
 */
export async function withDatabaseRetry(operation) {
  return withRetry(async () => {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableError(error)) {
        throw error; // Don't retry non-retryable errors
      }
      throw error; // Let withRetry handle retryable errors
    }
  });
}
