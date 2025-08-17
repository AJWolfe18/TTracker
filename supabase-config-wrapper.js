// supabase-config-wrapper.js
// Detects environment and loads appropriate config
// This file can be used in both test and production

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Multiple ways to detect test environment
function isTestEnvironment() {
    // 1. Check for environment variable
    if (process.env.USE_TEST_ENV === 'true' || process.env.NODE_ENV === 'test') {
        return true;
    }
    
    // 2. Check for GitHub Actions test branch
    if (process.env.GITHUB_REF === 'refs/heads/test') {
        return true;
    }
    
    // 3. Check for TEST_BRANCH_MARKER.md file (most reliable for local)
    try {
        const markerPath = path.join(__dirname, 'TEST_BRANCH_MARKER.md');
        if (fs.existsSync(markerPath)) {
            return true;
        }
    } catch (e) {
        // File doesn't exist, we're on production
    }
    
    return false;
}

// Determine which config to use
const useTestConfig = isTestEnvironment();

console.log(`🔧 Environment Detection:`);
console.log(`  - USE_TEST_ENV: ${process.env.USE_TEST_ENV || 'not set'}`);
console.log(`  - NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
console.log(`  - GITHUB_REF: ${process.env.GITHUB_REF || 'not set'}`);
console.log(`  - TEST_BRANCH_MARKER.md: ${fs.existsSync(path.join(__dirname, 'TEST_BRANCH_MARKER.md')) ? 'found' : 'not found'}`);
console.log(`  → Using ${useTestConfig ? 'TEST' : 'PRODUCTION'} environment`);

// Import the appropriate config
let config;
if (useTestConfig) {
    try {
        config = await import('./supabase-config-test.js');
        console.log('✅ Loaded test configuration');
    } catch (e) {
        console.error('❌ Failed to load test config, falling back to production:', e.message);
        config = await import('./supabase-config.js');
    }
} else {
    config = await import('./supabase-config.js');
    console.log('📦 Loaded production configuration');
}

// Export everything from the selected config
export const SUPABASE_URL = config.SUPABASE_URL;
export const SUPABASE_ANON_KEY = config.SUPABASE_ANON_KEY;
export const SUPABASE_SERVICE_ROLE_KEY = config.SUPABASE_SERVICE_ROLE_KEY;
export const supabaseRequest = config.supabaseRequest;
export const supabaseAdminRequest = config.supabaseAdminRequest;