// supabase-browser-config.js
// Browser-side configuration that detects environment based on URL

// Detect if we're on test environment based on URL
const isTestEnvironment = 
    window.location.hostname.includes('test--') ||  // Netlify branch deploy format
    window.location.hostname.includes('test.') ||
    window.location.hostname.includes('-test') ||
    window.location.hostname.includes('--test') ||
    window.location.pathname.includes('/test') ||
    window.location.search.includes('env=test') ||
    window.location.hostname === 'localhost';  // Local development

// Configuration
const PRODUCTION_CONFIG = {
    SUPABASE_URL: 'https://osjbulmltfpcoldydexg.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zamJ1bG1sdGZwY29sZHlkZXhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ3NjQ5NzEsImV4cCI6MjA3MDM0MDk3MX0.COtWEcun0Xkw5hUhaVEJGCrWbumj42L4vwWGgH7RyIE'
};

const TEST_CONFIG = {
    SUPABASE_URL: 'https://wnrjrywpcadwutfykflu.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InducmpyeXdwY2Fkd3V0ZnlrZmx1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyMjA3MzcsImV4cCI6MjA3MDc5NjczN30.n-4DboHQSivt5GWx7X5wuaUsdmjsuJe0VgB18V-GxU4'
};

// Export the appropriate config
const config = isTestEnvironment ? TEST_CONFIG : PRODUCTION_CONFIG;

// Make available globally
window.SUPABASE_CONFIG = config;

// Log environment (visible in browser console)
console.log(`🔧 Using ${isTestEnvironment ? 'TEST' : 'PRODUCTION'} environment`);
console.log(`📍 Supabase URL: ${config.SUPABASE_URL}`);

// Show a small badge in the corner if in test mode
if (isTestEnvironment) {
    window.addEventListener('DOMContentLoaded', () => {
        const badge = document.createElement('div');
        badge.innerHTML = '🧪 TEST ENV';
        badge.style.cssText = 'position: fixed; top: 10px; right: 10px; background: #ef4444; color: white; padding: 5px 10px; border-radius: 5px; font-size: 12px; z-index: 9999; font-family: monospace;';
        document.body.appendChild(badge);
    });
}

// Also export for module usage
const SUPABASE_URL = config.SUPABASE_URL;
const SUPABASE_ANON_KEY = config.SUPABASE_ANON_KEY;