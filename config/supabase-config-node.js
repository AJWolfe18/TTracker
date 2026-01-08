// supabase-config-node.js
// Configuration for Node.js scripts (GitHub Actions)
// TTRC-362: Removed PROD fallbacks - fail closed on misconfiguration

import fetch from 'node-fetch';
import { validateEnv } from '../lib/env-validation.js';

// Validate environment configuration (fail closed - no PROD fallbacks)
validateEnv({ requireAnonKey: true });

// Environment variables are now REQUIRED (no fallbacks)
export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
// Service role key for write operations (bypasses RLS)
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || null;

// Log which environment we're using (without exposing full credentials)
console.log(`📍 Using Supabase: ${SUPABASE_URL.substring(0, 30)}...`);

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
            'Prefer': 'return=representation,missing=default',
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
