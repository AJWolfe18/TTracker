// RSS Enqueue Edge Function
// Schedules RSS feed fetch jobs by enqueuing them into the job_queue
// Called by Supabase Scheduler every 10 minutes
// Manual invoke: supabase functions invoke rss-enqueue --no-verify-jwt

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceKey) {
      return new Response(
        JSON.stringify({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
        {
          status: 500,
          headers: { ...corsHeaders, "content-type": "application/json" }
        }
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Parse request body to check for job type
    let requestBody: any = {};
    try {
      const text = await req.text();
      if (text) {
        requestBody = JSON.parse(text);
      }
    } catch {
      // Default to RSS fetch if no body provided
      requestBody = {};
    }

    // Handle lifecycle job enqueue (TTRC-231)
    if (requestBody.kind === 'lifecycle' || requestBody.kind === 'story.lifecycle') {
      const { error } = await supabase
        .from("job_queue")
        .insert({
          job_type: "story.lifecycle",
          payload: {
            triggered_by: "github_actions_cron",
            triggered_at: new Date().toISOString()
          },
          priority: 5,
          run_at: new Date().toISOString(),
        });

      if (error) {
        return new Response(
          JSON.stringify({ error: `Failed to enqueue lifecycle job: ${error.message}` }),
          {
            status: 500,
            headers: { ...corsHeaders, "content-type": "application/json" }
          }
        );
      }

      return new Response(
        JSON.stringify({
          enqueued: 1,
          job_type: "story.lifecycle",
          message: "Lifecycle update job enqueued successfully",
          timestamp: new Date().toISOString()
        }),
        {
          headers: { ...corsHeaders, "content-type": "application/json" },
        }
      );
    }

    // Handle story merge job enqueue (TTRC-231)
    if (requestBody.kind === 'story.merge') {
      const { error } = await supabase
        .from("job_queue")
        .insert({
          job_type: "story.merge",
          payload: {
            triggered_by: "github_actions_cron",
            triggered_at: new Date().toISOString(),
            limit: 10,
            threshold: 0.70
          },
          priority: 5,
          run_at: new Date().toISOString(),
        });

      if (error) {
        return new Response(
          JSON.stringify({ error: `Failed to enqueue merge job: ${error.message}` }),
          {
            status: 500,
            headers: { ...corsHeaders, "content-type": "application/json" }
          }
        );
      }

      return new Response(
        JSON.stringify({
          enqueued: 1,
          job_type: "story.merge",
          message: "Story merge job enqueued successfully",
          timestamp: new Date().toISOString()
        }),
        {
          headers: { ...corsHeaders, "content-type": "application/json" },
        }
      );
    }

    // Pull active feeds that aren't in heavy backoff (failure_count < 5)
    const { data: feeds, error: feedError } = await supabase
      .from("feed_registry")
      .select("id, feed_url, source_name, failure_count")
      .eq("is_active", true)
      .lt("failure_count", 5)
      .order("source_name");

    if (feedError) {
      return new Response(
        JSON.stringify({ error: `Feed query failed: ${feedError.message}` }), 
        { 
          status: 500,
          headers: { ...corsHeaders, "content-type": "application/json" }
        }
      );
    }

    if (!feeds || feeds.length === 0) {
      return new Response(
        JSON.stringify({ 
          enqueued: 0, 
          failed: 0, 
          message: "No active feeds available (all may be in backoff)" 
        }), 
        { 
          headers: { ...corsHeaders, "content-type": "application/json" }
        }
      );
    }

    console.log(`Found ${feeds.length} active feeds to enqueue`);

    // Enqueue fetch_feed jobs for each active feed
    const results = await Promise.all(
      feeds.map(async (feed) => {
        try {
          const { error } = await supabase
            .from("job_queue")
            .insert({
              job_type: "fetch_feed",
              payload: {
                feed_id: feed.id,
                url: feed.feed_url,
                source_name: feed.source_name
              },
              run_at: new Date().toISOString(),
            });

          if (error) {
            console.error(`Failed to enqueue feed ${feed.source_name}:`, error);
            return { feed: feed.source_name, error: error.message };
          }

          console.log(`Enqueued: ${feed.source_name}`);
          return { feed: feed.source_name, success: true };
        } catch (err) {
          console.error(`Exception enqueuing feed ${feed.source_name}:`, err);
          return { feed: feed.source_name, error: err.message };
        }
      })
    );

    const successful = results.filter((r: any) => r.success);
    const failed = results.filter((r: any) => r.error);

    const response = {
      enqueued: successful.length,
      failed: failed.length,
      feeds_processed: feeds.length,
      successful_feeds: successful.map((r: any) => r.feed),
      failed_feeds: failed.map((r: any) => ({ feed: r.feed, error: r.error })),
      timestamp: new Date().toISOString()
    };

    console.log(`RSS Enqueue complete: ${successful.length}/${feeds.length} successful`);

    return new Response(
      JSON.stringify(response), 
      {
        headers: { ...corsHeaders, "content-type": "application/json" },
      }
    );

  } catch (error) {
    console.error("RSS Enqueue function error:", error);
    
    return new Response(
      JSON.stringify({ 
        error: "Internal server error", 
        details: error.message,
        timestamp: new Date().toISOString()
      }), 
      { 
        status: 500,
        headers: { ...corsHeaders, "content-type": "application/json" }
      }
    );
  }
});
