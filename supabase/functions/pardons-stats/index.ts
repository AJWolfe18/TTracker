// Edge Function: GET /pardons-stats
// Returns aggregate statistics for the pardons stats bar
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { getSupabaseClient } from '../_shared/auth.ts'

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Only allow GET
  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const supabase = getSupabaseClient(req)

    // TODO: For scale (>500 records), replace these 4 queries with a single RPC:
    // CREATE FUNCTION get_pardons_stats() RETURNS JSON AS $$
    //   SELECT json_build_object(
    //     'total_pardons', COUNT(*) FILTER (WHERE is_public),
    //     'reoffended_count', COUNT(*) FILTER (WHERE is_public AND post_pardon_status = 're_offended'),
    //     'total_donations', COALESCE(SUM(donation_amount_usd) FILTER (WHERE is_public), 0)
    //   ) FROM pardons;
    // $$ LANGUAGE sql STABLE;

    // Get total count of public pardons
    const { count: totalPardons, error: countError } = await supabase
      .from('pardons')
      .select('*', { count: 'exact', head: true })
      .eq('is_public', true)

    if (countError) {
      throw new Error(`Count error: ${countError.message}`)
    }

    // Get count of re-offended pardons
    const { count: reoffendedCount, error: reoffendedError } = await supabase
      .from('pardons')
      .select('*', { count: 'exact', head: true })
      .eq('is_public', true)
      .eq('post_pardon_status', 're_offended')

    if (reoffendedError) {
      throw new Error(`Reoffended count error: ${reoffendedError.message}`)
    }

    // Get donation totals - fetch donation_amount_usd for all public pardons
    // Note: For ~150 records, in-memory sum is acceptable
    // For scale, consider an RPC function with SUM()
    const { data: donationData, error: donationError } = await supabase
      .from('pardons')
      .select('donation_amount_usd')
      .eq('is_public', true)
      .not('donation_amount_usd', 'is', null)

    if (donationError) {
      throw new Error(`Donation query error: ${donationError.message}`)
    }

    // Sum donations in JavaScript
    const totalDonations = donationData?.reduce((sum, item) => {
      return sum + (parseFloat(item.donation_amount_usd) || 0)
    }, 0) || 0

    // Get counts by connection type for breakdown (optional but useful)
    const { data: connectionBreakdown, error: breakdownError } = await supabase
      .from('pardons')
      .select('primary_connection_type')
      .eq('is_public', true)

    // Build connection type counts
    const connectionCounts: Record<string, number> = {}
    if (!breakdownError && connectionBreakdown) {
      connectionBreakdown.forEach(item => {
        const type = item.primary_connection_type || 'unknown'
        connectionCounts[type] = (connectionCounts[type] || 0) + 1
      })
    }

    // Return stats with cache headers (stats don't change often)
    return new Response(
      JSON.stringify({
        total_pardons: totalPardons || 0,
        total_donations_usd: totalDonations,
        reoffended_count: reoffendedCount || 0,
        connection_breakdown: connectionCounts,
        cached_at: new Date().toISOString(),
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300', // 5 minute cache
        },
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
