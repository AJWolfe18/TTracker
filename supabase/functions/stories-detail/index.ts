// Edge Function: GET /api/v1/stories/:id
// Returns story details with associated articles
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, handleCors } from '../_shared/cors.ts'
import { getSupabaseClient } from '../_shared/auth.ts'

serve(async (req: Request) => {
  // Handle CORS
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const url = new URL(req.url)
    // Extract story ID from path or query param
    const pathParts = url.pathname.split('/')
    const storyId = pathParts[pathParts.length - 1] || url.searchParams.get('id')
    
    if (!storyId) {
      return new Response(
        JSON.stringify({ error: 'Story ID required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }
    
    const supabase = getSupabaseClient(req)
    
    // Get story details
    const { data: story, error: storyError } = await supabase
      .from('stories')
      .select('*')
      .eq('id', storyId)
      .single()
    
    if (storyError || !story) {
      return new Response(
        JSON.stringify({ error: 'Story not found' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }
    
    // Get associated articles (changed from political_entries)
    const { data: articles, error: articlesError } = await supabase
      .from('article_story')
      .select(`
        article_id,
        is_primary_source,
        similarity_score,
        matched_at,
        articles (
          id,
          url,
          url_hash,
          headline,
          source_name,
          source_domain,
          published_at,
          content,
          content_type,
          opinion_flag,
          metadata
        )
      `)
      .eq('story_id', storyId)
      .order('matched_at', { ascending: false })
    
    if (articlesError) {
      return new Response(
        JSON.stringify({ error: articlesError.message }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }
    
    // Format the response
    const formattedArticles = articles?.map(item => ({
      ...item.articles,
      is_primary_source: item.is_primary_source,
      similarity_score: item.similarity_score,
      matched_at: item.matched_at,
    })) || []
    
    return new Response(
      JSON.stringify({
        story,
        articles: formattedArticles,
      }),
      {
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