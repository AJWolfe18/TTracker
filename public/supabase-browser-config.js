// supabase-browser-config.js
// Browser-side configuration with environment detection
// This file works in both test and production

(function() {
    // Detect if we're on test environment based on URL
    const isTestEnvironment = 
        window.location.hostname.includes('test--') ||  // Netlify branch deploy
        window.location.hostname.includes('test.') ||
        window.location.search.includes('env=test');

    // Configuration (NO SERVICE KEYS IN BROWSER!)
    const PRODUCTION_CONFIG = {
        SUPABASE_URL: 'https://osjbulmltfpcoldydexg.supabase.co',
        SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zamJ1bG1sdGZwY29sZHlkZXhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ3NjQ5NzEsImV4cCI6MjA3MDM0MDk3MX0.COtWEcun0Xkw5hUhaVEJGCrWbumj42L4vwWGgH7RyIE'
    };

    const TEST_CONFIG = {
        SUPABASE_URL: 'https://wnrjrywpcadwutfykflu.supabase.co',
        SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InducmpyeXdwY2Fkd3V0ZnlrZmx1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyMjA3MzcsImV4cCI6MjA3MDc5NjczN30.n-4DboHQSivt5GWx7X5wuaUsdmjsuJe0VgB18V-GxU4'
    };

    // Select the appropriate config
    const config = isTestEnvironment ? TEST_CONFIG : PRODUCTION_CONFIG;

    // Make available globally
    window.SUPABASE_CONFIG = config;
    window.SUPABASE_URL = config.SUPABASE_URL;
    window.SUPABASE_ANON_KEY = config.SUPABASE_ANON_KEY;
    // NOTE: Service role keys should NEVER be in browser code!

    // Show environment indicator in test mode
    if (isTestEnvironment) {
        window.addEventListener('DOMContentLoaded', () => {
            const badge = document.createElement('div');
            badge.innerHTML = '🧪 TEST';
            badge.style.cssText = 'position: fixed; top: 10px; right: 10px; background: #ef4444; color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px; z-index: 9999; font-family: monospace; font-weight: bold; pointer-events: none;';
            badge.title = 'Test Environment - Data will not affect production';
            document.body.appendChild(badge);
        });
        console.log('🧪 Test environment detected');
    }
})();