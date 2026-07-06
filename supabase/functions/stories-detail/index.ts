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
    let storyId = pathParts[pathParts.length - 1] || url.searchParams.get('id')
    
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

    const STORY_FIELDS = `
        id, story_hash, primary_headline, primary_source, primary_source_url,
        primary_source_domain, primary_actor, last_updated_at, first_seen_at,
        status, severity, alarm_level, category, topic_tags, source_count,
        has_opinion, summary_neutral, summary_spicy, merged_into_story_id
      `

    // Get story details
    let { data: story, error: storyError } = await supabase
      .from('stories')
      .select(STORY_FIELDS)
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

    // ADO-533: if this story was merged away, follow the tombstone chain to the terminal survivor
    // so old links resolve to the live story. Chains can be multi-hop across runs (A merges into B,
    // then later B merges into C), so we loop until merged_into_story_id IS NULL. A visited-set guards
    // against a cycle (which merge_stories should never create) and a hop cap bounds the work.
    let redirectedFrom: string | null = null
    if (story.merged_into_story_id) {
      redirectedFrom = String(story.id)
      const seen = new Set<string>([String(story.id)])
      // Follow the chain all the way to the terminal survivor — merge chains can exceed any fixed hop
      // cap over many Judge runs (a survivor can itself later become a loser). The visited-set bounds the
      // loop to the number of distinct stories, so it always terminates without an arbitrary cap. (Codex P2.)
      while (story.merged_into_story_id) {
        const nextId = String(story.merged_into_story_id)
        if (seen.has(nextId)) break // cycle guard — stop rather than loop forever
        seen.add(nextId)
        const { data: survivor, error: survivorError } = await supabase
          .from('stories')
          .select(STORY_FIELDS)
          .eq('id', nextId)
          .single()
        if (survivorError || !survivor) {
          return new Response(
            JSON.stringify({ error: 'Story not found' }),
            {
              status: 404,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          )
        }
        story = survivor
        storyId = nextId
      }

      // The loop can still stop on the cycle guard (a broken/cyclic chain) with story STILL a tombstone.
      // Never serve a merged/intermediate row — its articles are empty/stale. Return not-found. (Codex P1.)
      if (story.merged_into_story_id || story.status === 'merged_into') {
        console.error(
          `[ADO-533] Tombstone chain from ${redirectedFrom} did not resolve to a live survivor (stopped at ${story.id})`
        )
        return new Response(
          JSON.stringify({ error: 'Story not found' }),
          {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }
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
          title,
          source_name,
          source_domain,
          published_at,
          content_type,
          opinion_flag,
          excerpt,
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
        redirected_from: redirectedFrom, // ADO-533: set when the requested id was a merged tombstone
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