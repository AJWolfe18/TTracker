// Network utilities with proper timeout and abort handling
// P1 Fix: Prevents hung workers and resource leaks
// Part of TTRC-140 RSS Fetcher implementation

/**
 * Fetch with timeout and proper abort controller cleanup
 * @param {string} url - URL to fetch
 * @param {RequestInit} opts - Fetch options
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Response>} - Fetch response
 */
async function fetchWithTimeout(url, opts = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...opts,
      signal: controller.signal,
      redirect: 'follow'
    });
    
    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Read response body with size limit and streaming
 * SR DEV ENHANCED: Better error propagation and stream management
 * @param {Response} response - Fetch response
 * @param {number} maxBytes - Maximum bytes to read
 * @returns {Promise<string>} - Response text content
 */
async function readLimitedResponse(response, maxBytes = 1500000) {
  // SR DEV FIX: Guard response.body null/undefined
  if (!response || !response.body) {
    throw new Error('No response body available');
  }

  // Check Content-Length header first for fast rejection
  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    throw new Error(`Feed too large: ${contentLength} bytes exceeds limit of ${maxBytes}`);
  }

  // Stream the response with byte counting
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;
      
      // SR DEV FIX: Handle null/undefined chunks
      if (!value) {
        throw new Error('Received null chunk from response stream');
      }
      
      totalBytes += value.byteLength;
      
      // SR DEV FIX: Provide bytes-read context in error
      if (totalBytes > maxBytes) {
        throw new Error(`Feed size limit exceeded: ${totalBytes} bytes (limit: ${maxBytes})`);
      }
      
      chunks.push(value);
    }
  } catch (error) {
    // SR DEV FIX: Treat early close as an error with context
    if (error.message.includes('stream')) {
      throw new Error(`Stream error after ${totalBytes} bytes: ${error.message}`);
    }
    throw error;
  } finally {
    // SR DEV FIX: Always release the lock and destroy stream
    try {
      reader.releaseLock();
    } catch (cleanupError) {
      console.warn('Failed to release stream reader lock:', cleanupError.message);
    }
  }

  // Concatenate chunks and decode
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const concatenated = new Uint8Array(totalLength);
  let offset = 0;
  
  for (const chunk of chunks) {
    concatenated.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder('utf-8').decode(concatenated);
}

/**
 * Retry function with exponential backoff and jitter
 * @param {Function} fn - Function to retry
 * @param {number} maxAttempts - Maximum retry attempts
 * @param {number} baseDelayMs - Base delay in milliseconds
 * @returns {Promise<any>} - Function result
 */
async function withRetry(fn, maxAttempts = 3, baseDelayMs = 500) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxAttempts) {
        break; // Don't wait after the last attempt
      }
      
      // Exponential backoff with jitter
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      const jitter = Math.random() * 250; // Up to 250ms jitter
      const totalDelay = delay + jitter;
      
      console.log(`Attempt ${attempt}/${maxAttempts} failed: ${error.message}. Retrying in ${Math.round(totalDelay)}ms...`);
      
      await new Promise(resolve => setTimeout(resolve, totalDelay));
    }
  }
  
  throw lastError;
}

/**
 * Environment configuration with validation
 */
function getNetworkConfig() {
  const config = {
    maxBytes: parseInt(process.env.RSS_MAX_BYTES || '1500000', 10),
    timeoutMs: parseInt(process.env.FETCH_TIMEOUT_MS || '15000', 10),
    maxRetries: parseInt(process.env.FETCH_MAX_RETRIES || '3', 10),
    baseDelay: parseInt(process.env.FETCH_BASE_DELAY_MS || '500', 10)
  };

  // Validate configuration
  if (config.maxBytes < 100000) {
    throw new Error('RSS_MAX_BYTES must be at least 100KB');
  }
  if (config.timeoutMs < 5000) {
    throw new Error('FETCH_TIMEOUT_MS must be at least 5 seconds');
  }

  return config;
}

export {
  fetchWithTimeout,
  readLimitedResponse,
  withRetry,
  getNetworkConfig
};
