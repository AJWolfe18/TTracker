// Edge Function: queue-stats
// Returns job queue statistics for admin panel monitoring
// With proper aggregation, caching, and stuck job detection

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

// Optional auth token for protected stats (can be same as cron token)
const STATS_AUTH_TOKEN = Deno.env.get('EDGE_CRON_TOKEN')

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Optional authentication check (if token is configured)
    if (STATS_AUTH_TOKEN) {
      const authHeader = req.headers.get('Authorization')
      if (!authHeader || authHeader !== `Bearer ${STATS_AUTH_TOKEN}`) {
        console.log(JSON.stringify({
          fn: 'queue-stats',
          event: 'auth_failed',
          t: new Date().toISOString(),
          ip: req.headers.get('x-forwarded-for') || 'unknown'
        }))
        return new Response('Unauthorized', { status: 401 })
      }
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabase = createClient(supabaseUrl, supabaseAnonKey)

    // Try RPC function first (if it exists)
    const { data: rpcStats, error: rpcError } = await supabase
      .rpc('get_queue_stats')

    let stats
    
    if (rpcError || !rpcStats) {
      // Fallback to direct aggregation query
      console.log('Using direct aggregation query for stats')
      
      // Build aggregation query using raw SQL for better performance
      const { data: rawStats, error: queryError } = await supabase
        .from('job_queue')
        .select('*')
        .limit(1000)  // Safety limit

      if (queryError) {
        throw new Error(`Failed to fetch queue stats: ${queryError.message}`)
      }

      // Aggregate in memory (not ideal but works)
      const statsByType: Record<string, any> = {}
      
      for (const job of rawStats || []) {
        if (!statsByType[job.job_type]) {
          statsByType[job.job_type] = {
            job_type: job.job_type,
            pending: 0,
            processing: 0,
            completed: 0,
            failed: 0,
            next_run_at: null,
            oldest_pending: null
          }
        }

        const typeStats = statsByType[job.job_type]
        
        // Count by status
        if (job.status === 'pending') typeStats.pending++
        else if (job.status === 'processing') typeStats.processing++
        else if (job.status === 'completed') typeStats.completed++
        else if (job.status === 'failed') typeStats.failed++

        // Track next run time and oldest pending for pending jobs
        if (job.status === 'pending' && job.run_at) {
          const runAt = new Date(job.run_at)
          
          // Next run time (earliest pending)
          if (!typeStats.next_run_at || runAt < new Date(typeStats.next_run_at)) {
            typeStats.next_run_at = job.run_at
          }
          
          // Oldest pending (for stuck job detection)
          if (!typeStats.oldest_pending || runAt < new Date(typeStats.oldest_pending)) {
            typeStats.oldest_pending = job.run_at
          }
        }
      }

      stats = Object.values(statsByType)
    } else {
      stats = rpcStats
    }

    // Enrich with stuck job detection
    const now = Date.now()
    const enrichedStats = (stats || []).map((row: any) => ({
      ...row,
      max_pending_age_minutes: row.oldest_pending 
        ? Math.floor((now - new Date(row.oldest_pending).getTime()) / 60000)
        : 0,
      is_stuck: row.oldest_pending 
        ? (now - new Date(row.oldest_pending).getTime()) > 30 * 60000  // >30 min is stuck
        : false
    }))

    // Sort by job type
    enrichedStats.sort((a: any, b: any) => a.job_type.localeCompare(b.job_type))

    // Calculate totals
    const totals = {
      total_pending: enrichedStats.reduce((sum: number, s: any) => sum + (s.pending || 0), 0),
      total_processing: enrichedStats.reduce((sum: number, s: any) => sum + (s.processing || 0), 0),
      total_completed: enrichedStats.reduce((sum: number, s: any) => sum + (s.completed || 0), 0),
      total_failed: enrichedStats.reduce((sum: number, s: any) => sum + (s.failed || 0), 0),
      has_stuck_jobs: enrichedStats.some((s: any) => s.is_stuck)
    }

    return new Response(
      JSON.stringify({
        stats: enrichedStats,
        totals,
        timestamp: new Date().toISOString()
      }),
      { 
        status: 200, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Cache-Control': 'max-age=30'  // Cache for 30 seconds
        } 
      }
    )

  } catch (error) {
    console.error('Error in queue-stats:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})
