// supabase-config-wrapper.js
// This file detects which environment we're in and loads the right config

import * as prodConfig from './supabase-config.js';
import * as testConfig from './supabase-config-test.js';

// Detect environment based on:
// 1. NODE_ENV environment variable
// 2. GitHub branch name (from GITHUB_REF)
// 3. Manual override with USE_TEST_ENV
const isTestEnvironment = 
    process.env.NODE_ENV === 'test' ||
    process.env.GITHUB_REF === 'refs/heads/test' ||
    process.env.USE_TEST_ENV === 'true';

// Export the appropriate config
const config = isTestEnvironment ? testConfig : prodConfig;

export const SUPABASE_URL = config.SUPABASE_URL;
export const SUPABASE_ANON_KEY = config.SUPABASE_ANON_KEY;
export const supabaseRequest = config.supabaseRequest;
export const supabaseAdminRequest = config.supabaseAdminRequest;

// Log which environment we're using (helpful for debugging)
console.log(`🔧 Using ${isTestEnvironment ? 'TEST' : 'PRODUCTION'} environment`);
console.log(`📍 Supabase URL: ${SUPABASE_URL}`);