#!/usr/bin/env node
/**
 * Preflight check: Verify we're targeting TEST environment
 * Run before any enrichment scripts to prevent accidental PROD writes
 */
import dotenv from 'dotenv';
dotenv.config();

const TEST_REF = 'wnrjrywpcadwutfykflu';

console.log('=== PREFLIGHT: TEST ENVIRONMENT CHECK ===\n');

// 1. URL Check
const url = process.env.SUPABASE_TEST_URL || process.env.SUPABASE_URL;
console.log('Resolved URL:', url ? url.substring(0, 45) + '...' : 'MISSING');

if (!url) {
  console.error('❌ No Supabase URL found - STOP');
  process.exit(1);
}

const urlRef = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
console.log('Extracted ref:', urlRef);

if (urlRef !== TEST_REF) {
  console.error(`❌ URL ref "${urlRef}" does not match TEST ref "${TEST_REF}" - STOP`);
  process.exit(1);
}
console.log('✅ TEST URL confirmed\n');

// 2. JWT Check (base64url decode - handles -_ chars and padding)
const key = process.env.SUPABASE_TEST_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log('=== JWT CHECK ===');

if (!key) {
  console.error('❌ No resolved key - STOP');
  process.exit(1);
}

try {
  const part = key.split('.')[1];
  const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

  console.log('JWT role:', payload.role);
  console.log('JWT iss:', payload.iss ? payload.iss.substring(0, 55) + '...' : 'MISSING');

  if (payload.role !== 'service_role') {
    console.error('❌ Not a service_role key - STOP');
    process.exit(1);
  }

  // Note: Supabase JWTs have iss="supabase", not the project URL
  // The URL check above is the reliable project identifier
  // If the key doesn't match the project, API calls will fail anyway
  console.log('✅ Key is service_role (URL determines target project)\n');

} catch (err) {
  console.error('❌ Failed to decode JWT:', err.message);
  process.exit(1);
}

console.log('=== PREFLIGHT PASSED ===');
console.log('Safe to run enrichment scripts against TEST environment.');
