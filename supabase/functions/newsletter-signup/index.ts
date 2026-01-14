// Edge Function: POST /newsletter-signup
// Handles newsletter signups with Turnstile + rate limiting + honeypot
//
// Security layers:
// 1. Turnstile CAPTCHA verification (if configured)
// 2. DB-based rate limiting (5/min, 20/day per IP)
// 3. Honeypot field detection
// 4. Email format validation
// 5. Generic response (no duplicate leakage)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, handleCors } from '../_shared/cors.ts'
import { getAdminClient } from '../_shared/auth.ts'

// Email validation regex (reasonable, not perfect)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// SHA-256 hash function
async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message)
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// Verify Turnstile token with Cloudflare
async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY')

  // If no secret configured, skip verification (allows gradual rollout)
  if (!secret) {
    console.log('[Turnstile] No secret configured, skipping verification')
    return true
  }

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret,
        response: token,
        remoteip: ip,
      }),
    })

    const result = await response.json()

    if (!result.success) {
      console.log('[Turnstile] Verification failed:', result['error-codes'])
    }

    return result.success === true
  } catch (error) {
    console.error('[Turnstile] Verification error:', error)
    return false
  }
}

// Check and update rate limits
// TODO: Non-atomic limiter (read-check-write race condition possible).
// Acceptable because Turnstile is primary bot protection; this is defense-in-depth.
// Revisit if abuse observed in logs (search for "[RateLimit] EXCEEDED").
async function checkRateLimit(
  supabase: ReturnType<typeof getAdminClient>,
  ipHash: string
): Promise<{ allowed: boolean; reason?: string }> {
  const now = Date.now()
  const minuteBucket = Math.floor(now / 60000)
  const dayBucket = Math.floor(now / 86400000)

  // Probabilistic cleanup (1-in-50 requests) - prune old buckets by type
  if (Math.random() < 0.02) {
    const oldMinuteBucket = minuteBucket - 120 // ~2 hours of minute buckets
    const oldDayBucket = dayBucket - 2 // ~2 days of day buckets

    await supabase
      .from('rate_limits')
      .delete()
      .eq('bucket_type', 'minute')
      .lt('bucket', oldMinuteBucket)

    await supabase
      .from('rate_limits')
      .delete()
      .eq('bucket_type', 'day')
      .lt('bucket', oldDayBucket)
  }

  // Check minute limit
  const { data: minuteData } = await supabase
    .from('rate_limits')
    .select('request_count')
    .eq('ip_hash', ipHash)
    .eq('bucket_type', 'minute')
    .eq('bucket', minuteBucket)
    .single()

  if (minuteData && minuteData.request_count >= 5) {
    console.warn('[RateLimit] EXCEEDED minute limit for IP hash:', ipHash.substring(0, 16), 'count:', minuteData.request_count)
    return { allowed: false, reason: 'rate_limit_minute' }
  }

  // Check day limit
  const { data: dayData } = await supabase
    .from('rate_limits')
    .select('request_count')
    .eq('ip_hash', ipHash)
    .eq('bucket_type', 'day')
    .eq('bucket', dayBucket)
    .single()

  if (dayData && dayData.request_count >= 20) {
    console.warn('[RateLimit] EXCEEDED day limit for IP hash:', ipHash.substring(0, 16), 'count:', dayData.request_count)
    return { allowed: false, reason: 'rate_limit_day' }
  }

  // Upsert minute bucket
  await supabase.from('rate_limits').upsert(
    {
      ip_hash: ipHash,
      bucket_type: 'minute',
      bucket: minuteBucket,
      request_count: (minuteData?.request_count || 0) + 1,
    },
    { onConflict: 'ip_hash,bucket_type,bucket' }
  )

  // Upsert day bucket
  await supabase.from('rate_limits').upsert(
    {
      ip_hash: ipHash,
      bucket_type: 'day',
      bucket: dayBucket,
      request_count: (dayData?.request_count || 0) + 1,
    },
    { onConflict: 'ip_hash,bucket_type,bucket' }
  )

  return { allowed: true }
}

// Extract referrer domain from full URL
function extractDomain(referrer: string | null): string | null {
  if (!referrer) return null
  try {
    const url = new URL(referrer)
    return url.hostname
  } catch {
    return null
  }
}

serve(async (req: Request) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  // Only accept POST
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const body = await req.json()
    const {
      email,
      turnstile_token,
      honeypot,        // Should be empty (hidden field)
      signup_page,     // 'stories' | 'eos' | 'pardons'
      signup_source,   // 'footer' | 'inline_50pct'
      utm_source,
      utm_medium,
      utm_campaign,
    } = body

    // Get client IP for rate limiting (prefer trusted proxy headers)
    const clientIP =
      req.headers.get('cf-connecting-ip') ||
      req.headers.get('x-real-ip') ||
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      '0.0.0.0'

    // Fail closed if salt not configured
    const salt = Deno.env.get('RATE_LIMIT_SALT')
    if (!salt) {
      console.error('[Newsletter] Missing RATE_LIMIT_SALT env var')
      return new Response(
        JSON.stringify({ success: false, message: 'Service temporarily unavailable. Please try again later.' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    const ipHash = await sha256(clientIP + salt)

    const supabase = getAdminClient()

    // 1. Honeypot check (bot filled hidden field)
    if (honeypot) {
      console.log('[Newsletter] Honeypot triggered from IP hash:', ipHash.substring(0, 16))
      // Return success to not reveal detection
      return new Response(
        JSON.stringify({ success: true, message: 'Thanks! Check your email soon.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 2. Rate limit check
    const rateCheck = await checkRateLimit(supabase, ipHash)
    if (!rateCheck.allowed) {
      console.log('[Newsletter] Rate limited:', rateCheck.reason, 'IP hash:', ipHash.substring(0, 16))
      return new Response(
        JSON.stringify({ error: 'Too many requests. Please try again later.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 3. Email validation
    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      return new Response(
        JSON.stringify({ error: 'Please enter a valid email address.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 4. Turnstile verification (if configured)
    if (turnstile_token) {
      const turnstileValid = await verifyTurnstile(turnstile_token, clientIP)
      if (!turnstileValid) {
        console.log('[Newsletter] Turnstile failed for IP hash:', ipHash.substring(0, 16))
        return new Response(
          JSON.stringify({ error: 'Verification failed. Please try again.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    } else {
      // No token provided - check if Turnstile is required
      const secret = Deno.env.get('TURNSTILE_SECRET_KEY')
      if (secret) {
        console.log('[Newsletter] Missing Turnstile token, IP hash:', ipHash.substring(0, 16))
        return new Response(
          JSON.stringify({ error: 'Verification required.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // 5. Insert subscriber (ON CONFLICT DO NOTHING for duplicates)
    const referrerDomain = extractDomain(req.headers.get('referer'))

    const { error: insertError } = await supabase
      .from('newsletter_subscribers')
      .insert({
        email: email.trim().toLowerCase(),
        signup_page: signup_page || 'unknown',
        signup_source: signup_source || 'footer',
        referrer_domain: referrerDomain,
        utm_source: utm_source || null,
        utm_medium: utm_medium || null,
        utm_campaign: utm_campaign || null,
        status: 'active',  // Skip double opt-in for now
      })

    // Ignore duplicate errors (23505 = unique_violation)
    if (insertError && insertError.code !== '23505') {
      console.error('[Newsletter] Insert error:', insertError)
      return new Response(
        JSON.stringify({ error: 'Something went wrong. Please try again.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 6. Always return generic success (don't leak duplicate status)
    console.log('[Newsletter] Signup processed for IP hash:', ipHash.substring(0, 16))

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Thanks! Check your email soon.'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('[Newsletter] Unexpected error:', error)
    return new Response(
      JSON.stringify({ error: 'Something went wrong. Please try again.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
