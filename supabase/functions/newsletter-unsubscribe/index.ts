// Edge Function: GET /newsletter-unsubscribe?token=uuid
// Handles newsletter unsubscription via secure UUID token
//
// Security:
// 1. Uses UUID token (NOT email_hash) to prevent dictionary attacks
// 2. Rate limited to prevent endpoint hammering
// 3. Always returns 200 OK to prevent token enumeration (no signal leakage)
//
// Future emails will include: https://site.com/unsubscribe?token=${unsubscribe_token}

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, handleCors } from '../_shared/cors.ts'
import { getAdminClient } from '../_shared/auth.ts'

// UUID v4 validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// SHA-256 hash function
async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message)
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// Simple rate limit check for unsubscribe (10/min per IP)
// TODO: Non-atomic limiter; acceptable for defense-in-depth on low-value endpoint.
async function checkUnsubscribeRateLimit(
  supabase: ReturnType<typeof getAdminClient>,
  ipHash: string
): Promise<boolean> {
  const now = Date.now()
  const minuteBucket = Math.floor(now / 60000)

  // Check minute limit
  const { data: minuteData } = await supabase
    .from('rate_limits')
    .select('request_count')
    .eq('ip_hash', ipHash)
    .eq('bucket_type', 'minute')
    .eq('bucket', minuteBucket)
    .single()

  if (minuteData && minuteData.request_count >= 10) {
    console.warn('[RateLimit] EXCEEDED unsubscribe limit for IP hash:', ipHash.substring(0, 16))
    return false
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

  return true
}

// Generic success HTML page (shown for all cases to prevent signal leakage)
const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Unsubscribed - TrumpyTracker</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 600px;
      margin: 50px auto;
      padding: 20px;
      text-align: center;
    }
    h1 { color: #333; }
    p { color: #666; }
    a { color: #0066cc; }
  </style>
</head>
<body>
  <h1>You've been unsubscribed</h1>
  <p>We're sorry to see you go!</p>
  <p>You will no longer receive emails from TrumpyTracker.</p>
  <p><a href="https://trumpytracker.com">Return to TrumpyTracker</a></p>
</body>
</html>`

serve(async (req: Request) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  // Accept GET (for email links) and POST (for API calls)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Get client IP for rate limiting
    const clientIP = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('cf-connecting-ip')
      || 'unknown'

    const salt = Deno.env.get('RATE_LIMIT_SALT') || 'default-salt'
    const ipHash = await sha256(clientIP + salt)

    const supabase = getAdminClient()

    // Rate limit check
    const allowed = await checkUnsubscribeRateLimit(supabase, ipHash)
    if (!allowed) {
      return new Response(
        JSON.stringify({ error: 'Too many requests. Please try again later.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let token: string | null = null
    let reason: string | null = null

    // Get params from URL (GET) or body (POST)
    if (req.method === 'GET') {
      const url = new URL(req.url)
      token = url.searchParams.get('token')
      reason = url.searchParams.get('reason')
    } else {
      const body = await req.json()
      token = body.token
      reason = body.reason
    }

    // Check if token looks valid (but always return success to prevent enumeration)
    const tokenValid = token && UUID_REGEX.test(token)

    if (tokenValid) {
      // Attempt the unsubscribe
      const { data, error } = await supabase
        .from('newsletter_subscribers')
        .update({
          status: 'unsubscribed',
          unsubscribed_at: new Date().toISOString(),
        })
        .eq('unsubscribe_token', token)
        .select('id')

      if (error) {
        console.error('[Unsubscribe] DB error:', error)
        // Still return success to prevent signal leakage
      } else if (data && data.length > 0) {
        // Log successful unsubscribe
        if (reason) {
          console.log('[Unsubscribe] Success with reason:', reason, 'ID:', data[0].id)
        } else {
          console.log('[Unsubscribe] Success for ID:', data[0].id)
        }
      } else {
        // Token not found - log but don't reveal to client
        console.log('[Unsubscribe] Token not found or already unsubscribed')
      }
    } else {
      console.log('[Unsubscribe] Invalid token format received')
    }

    // ALWAYS return 200 OK with generic success message
    // This prevents token enumeration attacks
    const acceptsHtml = req.headers.get('accept')?.includes('text/html')

    if (acceptsHtml && req.method === 'GET') {
      return new Response(SUCCESS_HTML, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/html' }
      })
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "You've been unsubscribed. We're sorry to see you go!"
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('[Unsubscribe] Unexpected error:', error)
    // Still return success to prevent signal leakage
    return new Response(
      JSON.stringify({
        success: true,
        message: "You've been unsubscribed. We're sorry to see you go!"
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
