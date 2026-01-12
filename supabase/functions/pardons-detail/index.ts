// Edge Function: GET /pardons-detail?id=123
// Returns single pardon with full data + related stories
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, handleCors } from '../_shared/cors.ts'
import { getSupabaseClient } from '../_shared/auth.ts'

serve(async (req: Request) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const url = new URL(req.url)

    // Extract pardon ID from path or query param
    // Path format: /pardons-detail/123 or /functions/v1/pardons-detail?id=123
    const pathParts = url.pathname.split('/')
    const lastSegment = pathParts[pathParts.length - 1]
    // Use path segment only if it's numeric, otherwise use query param
    const pardonId = /^\d+$/.test(lastSegment) ? lastSegment : url.searchParams.get('id')

    if (!pardonId) {
      return new Response(
        JSON.stringify({ error: 'Pardon ID required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    const supabase = getSupabaseClient(req)

    // Get pardon details (all fields)
    const { data: pardon, error: pardonError } = await supabase
      .from('pardons')
      .select(`
        id,
        recipient_name,
        recipient_slug,
        nickname,
        photo_url,
        recipient_type,
        recipient_count,
        recipient_criteria,
        pardon_date,
        clemency_type,
        status,
        conviction_district,
        case_number,
        offense_raw,
        crime_description,
        crime_category,
        original_sentence,
        conviction_date,
        primary_connection_type,
        secondary_connection_types,
        corruption_level,
        research_status,
        post_pardon_status,
        post_pardon_notes,
        trump_connection_detail,
        donation_amount_usd,
        receipts_timeline,
        summary_neutral,
        summary_spicy,
        why_it_matters,
        pattern_analysis,
        enriched_at,
        needs_review,
        primary_source_url,
        source_urls,
        is_public,
        created_at,
        updated_at
      `)
      .eq('id', pardonId)
      .eq('is_public', true) // RLS backup
      .single()

    if (pardonError || !pardon) {
      return new Response(
        JSON.stringify({ error: 'Pardon not found' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // Get related stories via junction table
    const { data: relatedStories, error: storiesError } = await supabase
      .from('pardon_story')
      .select(`
        story_id,
        link_type,
        linked_at,
        stories (
          id,
          primary_headline,
          primary_source,
          primary_source_url,
          primary_source_domain,
          last_updated_at,
          summary_neutral,
          summary_spicy
        )
      `)
      .eq('pardon_id', pardonId)
      .order('linked_at', { ascending: false })

    if (storiesError) {
      // Log but don't fail - pardon detail is still useful without stories
      console.error('Error fetching related stories:', storiesError.message)
    }

    // Format related stories
    const formattedStories = relatedStories?.map(item => ({
      ...item.stories,
      link_type: item.link_type,
      linked_at: item.linked_at,
    })).filter(s => s.id) || []

    return new Response(
      JSON.stringify({
        pardon,
        related_stories: formattedStories,
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
