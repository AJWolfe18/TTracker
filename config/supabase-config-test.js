// supabase-config-test.js
// Test environment Supabase configuration
// This file should NEVER be promoted to production

import fetch from 'node-fetch';

export const SUPABASE_URL = 'https://wnrjrywpcadwutfykflu.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InducmpyeXdwY2Fkd3V0ZnlrZmx1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyMjA3MzcsImV4cCI6MjA3MDc5NjczN30.n-4DboHQSivt5GWx7X5wuaUsdmjsuJe0VgB18V-GxU4';

// Helper function for Supabase API calls (matches production signature)
export async function supabaseRequest(endpoint, method = 'GET', body = null, headers = {}) {
    const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
    const options = {
        method,
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
            ...headers
        }
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Supabase error: ${response.status} - ${error}`);
    }

    // Handle different response types
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
        return await response.json();
    }
    
    return { success: true };
}

// For use with the service role key (has full access)
export async function supabaseAdminRequest(endpoint, method = 'GET', body = null, serviceKey) {
    // For test environment, we'll use a placeholder or env variable
    // This should be set in GitHub secrets for the test branch
    const testServiceKey = serviceKey || process.env.SUPABASE_TEST_SERVICE_KEY;
    
    if (!testServiceKey) {
        console.warn('Service role key not provided for test admin request - using anon key');
        return supabaseRequest(endpoint, method, body);
    }
    
    return supabaseRequest(endpoint, method, body, {
        'Authorization': `Bearer ${testServiceKey}`
    });
}