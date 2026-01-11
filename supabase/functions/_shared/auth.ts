// Authentication utilities for Edge Functions
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const MAX_API_KEY_LEN = 256 // prevent abuse via oversized headers (bytes)
const textEncoder = new TextEncoder()

// Timing-safe string comparison to prevent timing attacks.
// Compares as bytes over the max length of both inputs.
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = textEncoder.encode(a)
  const bBytes = textEncoder.encode(b)

  const len = Math.max(aBytes.length, bBytes.length)
  let diff = aBytes.length === bBytes.length ? 0 : 1

  for (let i = 0; i < len; i++) {
    const x = aBytes[i] ?? 0
    const y = bBytes[i] ?? 0
    diff |= x ^ y
  }
  return diff === 0
}

export function getSupabaseClient(req: Request) {
  const authHeader = req.headers.get('Authorization')
  
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      global: {
        headers: {
          Authorization: authHeader ?? '',
        },
      },
    }
  )
}

export function getAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )
}

export function checkAdminAuth(req: Request): boolean {
  const apiKey = req.headers.get('x-api-key')
  const adminKey = Deno.env.get('ADMIN_API_KEY')

  if (!adminKey) {
    console.warn('ADMIN_API_KEY not set')
    return false
  }

  if (!apiKey) {
    return false
  }

  // Check byte length (not code units) to prevent oversized headers
  const keyBytes = textEncoder.encode(apiKey)
  if (keyBytes.length > MAX_API_KEY_LEN) {
    return false
  }

  // Use timing-safe comparison to prevent timing attacks
  return timingSafeEqual(apiKey, adminKey)
}