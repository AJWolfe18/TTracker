// Edge Function: POST /log-search-gap
// Logs zero-result search terms for editorial content roadmap
//
// Called from frontend when search returns no results
// Stores sanitized terms in YOUR DB (not GA4) for editorial review
//
// Security: Fail-closed sanitization - blocks anything that looks like PII

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, handleCors } from '../_shared/cors.ts'
import { getAdminClient } from '../_shared/auth.ts'

// SHA-256 hash function
async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message)
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// Fail-closed sanitization - returns null if term looks suspicious
function sanitizeTerm(term: string): string | null {
  if (!term || typeof term !== 'string') return null

  const t = term.trim().toLowerCase()

  // FAIL if any of these (return null)
  if (t.includes('@')) return null                        // Email-ish
  if (/\d{9,}/.test(t)) return null                       // 9+ digits (SSN, phone)
  if (/\b(ssn|social security|address|phone|email)\b/i.test(t)) return null  // PII keywords
  if (t.length > 40) return null                          // Too long
  if (t.length < 2) return null                           // Too short
  if (t.split(/\s+/).length > 6) return null              // Too many words
  if (/[;="\{\}\[\]<>]/.test(t)) return null              // Suspicious punctuation
  if (/^(the|a|an|is|are|was|were|and|or|but)$/i.test(t)) return null  // Stopwords only

  return t  // Safe to store
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
    const { term, result_count } = body

    // Only log zero-result searches
    if (typeof result_count !== 'number' || result_count > 0) {
      return new Response(
        JSON.stringify({ success: true, logged: false, reason: 'has_results' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Sanitize term
    const sanitized = sanitizeTerm(term)
    if (!sanitized) {
      return new Response(
        JSON.stringify({ success: true, logged: false, reason: 'failed_sanitization' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Hash for deduplication
    const termHash = await sha256(sanitized)

    const supabase = getAdminClient()

    // Atomic upsert - increment count if exists, insert if not
    // Using raw SQL via RPC would be cleaner, but this works without extra setup
    const { data: existing } = await supabase
      .from('search_gaps')
      .select('id, search_count')
      .eq('term_hash', termHash)
      .single()

    if (existing) {
      // Update existing
      await supabase
        .from('search_gaps')
        .update({
          search_count: existing.search_count + 1,
          last_seen: new Date().toISOString(),
        })
        .eq('id', existing.id)
    } else {
      // Insert new
      await supabase
        .from('search_gaps')
        .insert({
          term_sanitized: sanitized,
          term_hash: termHash,
          search_count: 1,
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
        })
    }

    console.log('[SearchGap] Logged:', sanitized, 'hash:', termHash.substring(0, 16))

    return new Response(
      JSON.stringify({ success: true, logged: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('[SearchGap] Unexpected error:', error)
    // Don't fail the request - this is non-critical logging
    return new Response(
      JSON.stringify({ success: true, logged: false, reason: 'error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
