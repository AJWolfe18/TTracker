// Security utilities for credential validation and management
// P1 Fix: Prevents credential exposure and misconfig deploys
// Part of TTRC-140 RSS Fetcher implementation

/**
 * Validate JWT-like structure (3 parts separated by dots)
 * @param {string} name - Name of the credential for error messages
 * @param {string} value - The credential value to validate
 * @throws {Error} If credential is invalid
 */
function assertJwtLike(name, value) {
  if (!value) {
    throw new Error(`Missing required credential: ${name}`);
  }
  
  if (typeof value !== 'string') {
    throw new Error(`Invalid credential type for ${name}: expected string`);
  }
  
  const parts = value.split('.');
  if (parts.length !== 3) {
    throw new Error(`Invalid credential format for ${name}: expected JWT-like structure (3 parts)`);
  }
  
  // Basic length validation (real JWTs are much longer)
  if (parts.some(part => part.length < 4)) {
    throw new Error(`Invalid credential format for ${name}: parts too short`);
  }
}

/**
 * Validate and return required environment variables
 * @returns {Object} Validated configuration object
 */
function validateEnvironment() {
  // Required credentials
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  
  // Validate Supabase URL
  if (!supabaseUrl) {
    throw new Error('Missing required environment variable: SUPABASE_URL');
  }
  
  try {
    const url = new URL(supabaseUrl);
    if (!url.hostname.includes('supabase')) {
      console.warn('SUPABASE_URL does not appear to be a Supabase URL');
    }
  } catch (error) {
    throw new Error(`Invalid SUPABASE_URL format: ${error.message}`);
  }
  
  // Validate service role key
  assertJwtLike('SUPABASE_SERVICE_ROLE_KEY', serviceRoleKey);
  
  // Validate OpenAI key (if provided)
  if (openaiKey) {
    if (!openaiKey.startsWith('sk-')) {
      throw new Error('Invalid OPENAI_API_KEY format: must start with sk-');
    }
    if (openaiKey.length < 20) {
      throw new Error('Invalid OPENAI_API_KEY format: too short');
    }
  }
  
  // Optional configuration with defaults
  const config = {
    supabaseUrl,
    serviceRoleKey,
    openaiKey,
    // RSS-specific settings with validation
    rssMaxBytes: parseInt(process.env.RSS_MAX_BYTES || '1500000', 10),
    fetchTimeoutMs: parseInt(process.env.FETCH_TIMEOUT_MS || '15000', 10),
    failureSkipThreshold: parseInt(process.env.FAILURE_SKIP_THRESHOLD || '5', 10),
    feedsPerRun: parseInt(process.env.FEEDS_PER_RUN || '20', 10)
  };
  
  // Validate numeric configurations
  if (config.rssMaxBytes < 100000 || config.rssMaxBytes > 10000000) {
    throw new Error('RSS_MAX_BYTES must be between 100KB and 10MB');
  }
  
  if (config.fetchTimeoutMs < 5000 || config.fetchTimeoutMs > 60000) {
    throw new Error('FETCH_TIMEOUT_MS must be between 5 and 60 seconds');
  }
  
  if (config.failureSkipThreshold < 1 || config.failureSkipThreshold > 20) {
    throw new Error('FAILURE_SKIP_THRESHOLD must be between 1 and 20');
  }
  
  return config;
}

/**
 * Safe logging utility that redacts sensitive information
 * @param {string} level - Log level (info, warn, error)
 * @param {string} message - Log message
 * @param {Object} context - Additional context (will be sanitized)
 */
function safeLog(level, message, context = {}) {
  // Redact sensitive fields
  const sensitiveKeys = [
    'password', 'secret', 'key', 'token', 'auth', 'credential',
    'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY', 'serviceRoleKey', 'openaiKey'
  ];
  
  const sanitizedContext = { ...context };
  
  function redactSensitive(obj, path = '') {
    if (typeof obj !== 'object' || obj === null) return obj;
    
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = path ? `${path}.${key}` : key;
      
      if (sensitiveKeys.some(sensitive => 
        key.toLowerCase().includes(sensitive.toLowerCase())
      )) {
        obj[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        redactSensitive(value, fullKey);
      }
    }
    
    return obj;
  }
  
  redactSensitive(sanitizedContext);
  
  const logEntry = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    message,
    ...sanitizedContext
  };
  
  console.log(JSON.stringify(logEntry));
}

/**
 * Initialize and validate runtime environment
 * Call this at application startup to fail fast on misconfigurations
 */
function initializeEnvironment() {
  try {
    const config = validateEnvironment();
    
    safeLog('info', 'Environment validation successful', {
      supabaseConfigured: !!config.supabaseUrl,
      openaiConfigured: !!config.openaiKey,
      rssMaxBytes: config.rssMaxBytes,
      fetchTimeoutMs: config.fetchTimeoutMs
    });
    
    return config;
  } catch (error) {
    safeLog('error', 'Environment validation failed', { error: error.message });
    throw error;
  }
}

/**
 * Create a sanitized configuration object for client use
 * Removes sensitive credentials while keeping operational settings
 */
function getPublicConfig(config) {
  return {
    rssMaxBytes: config.rssMaxBytes,
    fetchTimeoutMs: config.fetchTimeoutMs,
    failureSkipThreshold: config.failureSkipThreshold,
    feedsPerRun: config.feedsPerRun,
    supabaseConfigured: !!config.supabaseUrl,
    openaiConfigured: !!config.openaiKey
  };
}

export {
  assertJwtLike,
  validateEnvironment,
  safeLog,
  initializeEnvironment,
  getPublicConfig
};

// For testing purposes, add validateCredentials alias
export const validateCredentials = validateEnvironment;
