// supabase-config-wrapper.js
// Detects environment and loads appropriate config
// This file can be used in both test and production

// Check if we're in a Node.js environment
const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

let SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, supabaseRequest, supabaseAdminRequest;

if (isNode) {
    // Node.js environment - check for test branch or environment variable
    const isTestEnvironment = 
        process.env.GITHUB_REF === 'refs/heads/test' ||
        process.env.USE_TEST_ENV === 'true' ||
        process.env.NODE_ENV === 'test';
    
    if (isTestEnvironment) {
        console.log('🧪 Using TEST environment (Node.js)');
        // Only try to load test config if it exists
        try {
            const testConfig = await import('./supabase-config-test.js');
            SUPABASE_URL = testConfig.SUPABASE_URL;
            SUPABASE_ANON_KEY = testConfig.SUPABASE_ANON_KEY;
            SUPABASE_SERVICE_ROLE_KEY = testConfig.SUPABASE_SERVICE_ROLE_KEY;
            supabaseRequest = testConfig.supabaseRequest;
            supabaseAdminRequest = testConfig.supabaseAdminRequest;
        } catch (e) {
            console.log('Test config not found, falling back to production');
            const prodConfig = await import('./supabase-config.js');
            SUPABASE_URL = prodConfig.SUPABASE_URL;
            SUPABASE_ANON_KEY = prodConfig.SUPABASE_ANON_KEY;
            SUPABASE_SERVICE_ROLE_KEY = prodConfig.SUPABASE_SERVICE_ROLE_KEY;
            supabaseRequest = prodConfig.supabaseRequest;
            supabaseAdminRequest = prodConfig.supabaseAdminRequest;
        }
    } else {
        console.log('🚀 Using PRODUCTION environment (Node.js)');
        const prodConfig = await import('./supabase-config.js');
        SUPABASE_URL = prodConfig.SUPABASE_URL;
        SUPABASE_ANON_KEY = prodConfig.SUPABASE_ANON_KEY;
        SUPABASE_SERVICE_ROLE_KEY = prodConfig.SUPABASE_SERVICE_ROLE_KEY;
        supabaseRequest = prodConfig.supabaseRequest;
        supabaseAdminRequest = prodConfig.supabaseAdminRequest;
    }
}

export { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, supabaseRequest, supabaseAdminRequest };