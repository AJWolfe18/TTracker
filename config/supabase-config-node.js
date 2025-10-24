// supabase-config-node.js
// Configuration for Node.js scripts (GitHub Actions)
// Now supports environment variables for test/production separation

import fetch from 'node-fetch';

// Use environment variables if provided (from GitHub Actions), otherwise use production defaults
export const SUPABASE_URL = process.env.SUPABASE_URL || 'https://osjbulmltfpcoldydexg.supabase.co';
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zamJ1bG1sdGZwY29sZHlkZXhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ3NjQ5NzEsImV4cCI6MjA3MDM0MDk3MX0.COtWEcun0Xkw5hUhaVEJGCrWbumj42L4vwWGgH7RyIE';
// Service role key for write operations (bypasses RLS)
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || null;

// Log which environment we're using (without exposing full credentials)
if (process.env.SUPABASE_URL) {
    console.log(`📍 Using Supabase from environment: ${SUPABASE_URL.substring(0, 30)}...`);
} else {
    console.log('📍 Using default production Supabase');
}

// Helper function for Supabase API calls
export async function supabaseRequest(endpoint, method = 'GET', body = null, headers = {}) {
    const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;

    // Use SERVICE_ROLE_KEY for write operations if available, otherwise use ANON_KEY
    const writeOperations = ['POST', 'PUT', 'PATCH', 'DELETE'];
    const useServiceRole = SUPABASE_SERVICE_ROLE_KEY && writeOperations.includes(method);
    const apiKey = useServiceRole ? SUPABASE_SERVICE_ROLE_KEY : SUPABASE_ANON_KEY;

    const options = {
        method,
        headers: {
            'apikey': apiKey,
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation,missing=default', // Add missing=default to handle auto-generated columns
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