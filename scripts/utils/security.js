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
  // Handle TEST environment
  const isTest = process.env.NODE_ENV === 'test';
  
  // Required credentials - use TEST versions if in test mode
  const supabaseUrl = isTest 
    ? (process.env.SUPABASE_TEST_URL || process.env.SUPABASE_URL)
    : process.env.SUPABASE_URL;
  const serviceRoleKey = isTest
    ? (process.env.SUPABASE_TEST_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
    : process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  
  // Validate Supabase URL
  if (!supabaseUrl) {
    throw new Error(`Missing required environment variable: ${isTest ? 'SUPABASE_TEST_URL' : 'SUPABASE_URL'}`);
  }
  
  try {
    const url = new URL(supabaseUrl);
    if (!url.hostname.includes('supabase')) {
      console.warn('SUPABASE_URL does not appear to be a Supabase URL');
    }
  } catch (e) {
    throw new Error(`Invalid SUPABASE_URL format: ${e.message}`);
  }
  
  // Validate service role key
  if (!serviceRoleKey) {
    throw new Error(`Missing required environment variable: ${isTest ? 'SUPABASE_TEST_SERVICE_KEY' : 'SUPABASE_SERVICE_ROLE_KEY'}`);
  }
  
  assertJwtLike(isTest ? 'SUPABASE_TEST_SERVICE_KEY' : 'SUPABASE_SERVICE_ROLE_KEY', serviceRoleKey);
  
  // OpenAI is optional but validate if provided
  if (openaiKey) {
    if (!openaiKey.startsWith('sk-')) {
      throw new Error('Invalid OPENAI_API_KEY format: expected sk-* format');
    }
  }
  
  return {
    supabaseUrl,
    serviceRoleKey,
    openaiKey
  };
}

/**
 * Redact sensitive information from strings
 * @param {string} str - String that may contain credentials
 * @returns {string} String with credentials redacted
 */
function redactCredentials(str) {
  if (!str || typeof str !== 'string') return str;
  
  // Redact anything that looks like a JWT
  let redacted = str.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, 'eyJ***REDACTED***');
  
  // Redact API keys
  redacted = redacted.replace(/sk-[\w-]{20,}/gi, 'sk-***REDACTED***');
  
  // Redact bearer tokens
  redacted = redacted.replace(/Bearer\s+[\w-]+/gi, 'Bearer ***REDACTED***');
  
  return redacted;
}

/**
 * Safe logging that redacts credentials
 * @param {string} level - Log level (info, warn, error)
 * @param {string} message - Log message
 * @param {Object} metadata - Additional metadata to log
 */
function safeLog(level, message, metadata = {}) {
  const timestamp = new Date().toISOString();
  
  // Redact any credentials in the message
  const safeMessage = redactCredentials(message);
  
  // Redact credentials in metadata
  const safeMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === 'string') {
      safeMetadata[key] = redactCredentials(value);
    } else if (typeof value === 'object' && value !== null) {
      // Deep redact for nested objects
      safeMetadata[key] = JSON.parse(redactCredentials(JSON.stringify(value)));
    } else {
      safeMetadata[key] = value;
    }
  }
  
  // Format log entry
  const logEntry = {
    timestamp,
    level: level.toUpperCase(),
    message: safeMessage,
    ...safeMetadata
  };
  
  // Output based on level
  if (level === 'error') {
    console.error(JSON.stringify(logEntry));
  } else if (level === 'warn') {
    console.warn(JSON.stringify(logEntry));
  } else {
    console.log(JSON.stringify(logEntry));
  }
}

/**
 * Initialize and validate environment variables on startup
 * @returns {Object} Validated configuration
 */
function initializeEnvironment() {
  try {
    const config = validateEnvironment();
    safeLog('info', 'Environment validation successful', {
      supabaseUrl: config.supabaseUrl,
      hasServiceKey: !!config.serviceRoleKey,
      hasOpenAI: !!config.openaiKey
    });
    return config;
  } catch (error) {
    safeLog('error', 'Environment validation failed', { error: error.message });
    throw error;
  }
}

// Export utilities
export {
  assertJwtLike,
  validateEnvironment,
  redactCredentials,
  safeLog,
  initializeEnvironment
};
