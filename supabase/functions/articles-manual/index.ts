// Edge Function: POST /api/v1/articles/manual
// Manual article submission from admin panel
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, handleCors } from '../_shared/cors.ts'
import { getAdminClient, checkAdminAuth } from '../_shared/auth.ts'

interface ArticleSubmission {
  title: string
  url: string
  source_name?: string
  category?: string
  severity_level?: number
}

// Simple URL canonicalization
function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    // Remove www, trailing slashes, and common tracking params
    let canonical = parsed.hostname.replace(/^www\./, '') + parsed.pathname
    canonical = canonical.replace(/\/$/, '')
    return `${parsed.protocol}//${canonical}`
  } catch {
    return url
  }
}

// Extract domain from URL
function extractDomain(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return 'unknown'
  }
}

// Generate a simple hash for URL deduplication
async function hashUrl(url: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(url)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  return hashHex.substring(0, 32) // Use first 32 chars
}

serve(async (req: Request) => {
  // Handle CORS
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  // Check admin authentication
  if (!checkAdminAuth(req)) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  try {
    // Parse request body
    const body: ArticleSubmission = await req.json()
    
    // Validate required fields
    if (!body.title || !body.url) {
      return new Response(
        JSON.stringify({ error: 'Title and URL are required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }
    
    // Process the URL
    const urlCanonical = canonicalizeUrl(body.url)
    const urlHash = await hashUrl(urlCanonical)
    const sourceDomain = extractDomain(body.url)
    
    const supabase = getAdminClient()
    
    // Check if article already exists
    const { data: existing } = await supabase
      .from('political_entries')
      .select('id, title, url')
      .eq('url_hash', urlHash)
      .single()
    
    if (existing) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Article already exists',
          existing_article: existing,
        }),
        {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }
    
    // Create the article
    const newArticle = {
      id: crypto.randomUUID(),
      title: body.title,
      url: body.url,
      url_canonical: urlCanonical,
      url_hash: urlHash,
      source: body.source_name || sourceDomain,
      source_name: body.source_name || sourceDomain,
      source_domain: sourceDomain,
      category: body.category || 'Manual Submission',
      severity_level: body.severity_level || 2,
      published_at: new Date().toISOString(),
      content_type: 'news_report', // Default for manual submissions
      created_at: new Date().toISOString(),
      processed: false,
    }
    
    const { data: article, error: insertError } = await supabase
      .from('political_entries')
      .insert(newArticle)
      .select()
      .single()
    
    if (insertError) {
      return new Response(
        JSON.stringify({ error: insertError.message }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }
    
    // TODO: Trigger clustering process
    // For now, we'll just mark it as needing processing
    
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Article submitted successfully',
        article,
        next_steps: [
          'Article will be processed by clustering algorithm',
          'Check back in a few minutes to see the story it was matched to',
        ],
      }),
      {
        status: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})