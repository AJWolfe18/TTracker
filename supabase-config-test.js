// supabase-config-test.js
// TEST ENVIRONMENT configuration
// This file is used when NODE_ENV=test or on the test branch

import fetch from 'node-fetch';

// TEST SUPABASE CREDENTIALS
export const SUPABASE_URL = 'https://wnrjrywpcadwutfykflu.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InducmpyeXdwY2Fkd3V0ZnlrZmx1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyMjA3MzcsImV4cCI6MjA3MDc5NjczN30.n-4DboHQSivt5GWx7X5wuaUsdmjsuJe0VgB18V-GxU4';

// Helper function for Supabase API calls
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

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
        return await response.json();
    }
    
    return { success: true };
}

export async function supabaseAdminRequest(endpoint, method = 'GET', body = null, serviceKey) {
    if (!serviceKey) {
        throw new Error('Service role key required for admin requests');
    }
    
    return supabaseRequest(endpoint, method, body, {
        'Authorization': `Bearer ${serviceKey}`
    });
}