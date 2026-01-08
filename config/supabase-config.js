// supabase-config.js
// Shared configuration for all scripts
// TTRC-362: Removed hardcoded PROD refs - uses env vars + lazy validation

import fetch from 'node-fetch';
import { validateEnv } from '../lib/env-validation.js';

// Export env values directly (no hardcoded refs)
// Existing imports still work - they'll be undefined if env not set
// That's fine for lint/tests; fail-closed at runtime when actually used
export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Lazy getter - validates only when actually used
// Prevents import-time explosions during lint/tests
export function getSupabaseConfig() {
  const { SUPABASE_URL } = validateEnv({ requireAnonKey: true });
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  return { SUPABASE_URL, SUPABASE_ANON_KEY };
}

// Optional: explicit assertion for code that uses constants directly
// Gives clear error if called without env setup
export function assertSupabaseEnv() {
  return getSupabaseConfig();
}

// Helper function for Supabase API calls
export async function supabaseRequest(endpoint, method = 'GET', body = null, headers = {}) {
    // Lazy validation - fail-closed when actually used
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = getSupabaseConfig();
    const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
    const options = {
        method,
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation', // Return the data after insert/update
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

// For use with the service role key in GitHub Actions (has full access)
export async function supabaseAdminRequest(endpoint, method = 'GET', body = null, serviceKey) {
    if (!serviceKey) {
        throw new Error('Service role key required for admin requests');
    }
    
    return supabaseRequest(endpoint, method, body, {
        'Authorization': `Bearer ${serviceKey}`
    });
}