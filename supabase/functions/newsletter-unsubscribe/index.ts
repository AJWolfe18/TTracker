// Edge Function: GET /newsletter-unsubscribe?token=uuid
// Handles newsletter unsubscription via secure UUID token
//
// Security: Uses UUID token (NOT email_hash) to prevent dictionary attacks
// Future emails will include: https://site.com/unsubscribe?token=${unsubscribe_token}

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, handleCors } from '../_shared/cors.ts'
import { getAdminClient } from '../_shared/auth.ts'

// UUID v4 validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

    // Validate token format
    if (!token || !UUID_REGEX.test(token)) {
      return new Response(
        JSON.stringify({ error: 'Invalid unsubscribe link.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = getAdminClient()

    // Update subscriber status
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
      return new Response(
        JSON.stringify({ error: 'Something went wrong. Please try again.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Token not found or already unsubscribed
    if (!data || data.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Link not found or already unsubscribed.'
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Log reason if provided (for analytics, not stored in DB for simplicity)
    if (reason) {
      console.log('[Unsubscribe] Reason:', reason, 'ID:', data[0].id)
    }

    console.log('[Unsubscribe] Success for ID:', data[0].id)

    // Return success
    // For GET requests from email links, could return HTML instead
    const acceptsHtml = req.headers.get('accept')?.includes('text/html')

    if (acceptsHtml && req.method === 'GET') {
      return new Response(
        `<!DOCTYPE html>
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
        </html>`,
        { headers: { ...corsHeaders, 'Content-Type': 'text/html' } }
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "You've been unsubscribed. We're sorry to see you go!"
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('[Unsubscribe] Unexpected error:', error)
    return new Response(
      JSON.stringify({ error: 'Something went wrong. Please try again.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
