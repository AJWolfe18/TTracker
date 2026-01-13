#!/usr/bin/env node
/**
 * Perplexity Research Integration (ADO-253)
 *
 * Researches pardon recipients using Perplexity API to populate:
 * - primary_connection_type
 * - trump_connection_detail
 * - corruption_level
 * - corruption_reasoning
 * - receipts_timeline
 * - donation_amount_usd
 * - source_urls
 *
 * Usage:
 *   npm run research:pardons              # Research pending pardons (default limit: 20)
 *   npm run research:pardons -- --limit=5 # Research up to 5 pardons
 *   npm run research:pardons -- --force   # Re-research even if already complete
 *   npm run research:pardons -- --dry-run # Preview without API calls
 *
 * Environment:
 *   SUPABASE_URL / SUPABASE_TEST_URL
 *   SUPABASE_SERVICE_ROLE_KEY / SUPABASE_TEST_SERVICE_KEY
 *   PERPLEXITY_API_KEY
 *   RUN_ID (optional - GitHub Actions run ID)
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

// ============================================================
// Constants
// ============================================================

const PROMPT_VERSION = '1.0';
const PERPLEXITY_MODEL = 'sonar';  // Cheapest model (~$0.005/query)
const DEFAULT_LIMIT = 20;
const DELAY_BETWEEN_CALLS_MS = 2000;  // 2 second delay between API calls
const RUNTIME_LIMIT_MS = 4 * 60 * 1000;  // 4 minutes (workflow timeout is 10)

// Connection types enum (must match DB CHECK constraint)
const CONNECTION_TYPES = [
  'major_donor', 'political_ally', 'family', 'business_associate',
  'celebrity', 'jan6_defendant', 'fake_electors', 'mar_a_lago_vip',
  'no_connection', 'campaign_staff'
];

// Event types for receipts_timeline
const EVENT_TYPES = [
  'donation', 'conviction', 'pardon_granted', 'pardon_request',
  'mar_a_lago_visit', 'investigation', 'sentencing', 'legal_filing',
  'indictment', 'arrest', 'campaign_event', 'plea_deal', 'appeal', 'other'
];

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const URL_REGEX = /^https?:\/\/.+/;
const MAX_TIMELINE_LENGTH = 30;
const MAX_SOURCES_LENGTH = 20;

// ============================================================
// Perplexity Prompt
// ============================================================

function buildResearchPrompt(pardon) {
  return `Research this pardon recipient and return structured JSON:

RECIPIENT: ${pardon.recipient_name}
PARDON DATE: ${pardon.pardon_date}
OFFENSE: ${pardon.offense_raw || pardon.crime_description || 'Unknown'}
DISTRICT: ${pardon.conviction_district || 'Unknown'}
TYPE: ${pardon.recipient_type === 'group' ? `GROUP PARDON (~${pardon.recipient_count} people)` : 'Individual'}

Return JSON with EXACTLY these fields:
{
  "primary_connection_type": "major_donor|political_ally|family|business_associate|celebrity|jan6_defendant|fake_electors|mar_a_lago_vip|campaign_staff|no_connection",
  "trump_connection_detail": "2-3 sentence explanation of relationship to Trump",
  "corruption_level": 1-5,
  "corruption_reasoning": "Why this corruption level (1 sentence)",
  "receipts_timeline": [
    {"date": "YYYY-MM-DD", "event_type": "donation|conviction|pardon_granted|mar_a_lago_visit|investigation|sentencing|legal_filing|pardon_request|indictment|arrest|campaign_event|plea_deal|appeal|other", "description": "What happened", "amount_usd": null, "source_url": "citation URL"}
  ],
  "donation_amount_usd": null,
  "sources": ["url1", "url2"]
}

CORRUPTION LEVEL GUIDE:
5 = "Paid-to-Play" - Direct financial quid pro quo, donor bought the pardon
4 = "Friends & Family" - Inner circle, personal relationship, self-dealing
3 = "Swamp Creature" - Political ally, lobbyist connection, covers up wrongdoing
2 = "Celebrity Request" - Kim K called, media campaign, no direct corruption
1 = "Broken Clock" - Actually arguably justified, criminal justice reform

RULES:
- Only include facts with citations in sources array
- If no Trump connection found, use "no_connection" and corruption_level=1
- Include FEC donation records if available
- Note any ongoing investigations affected by pardon
- receipts_timeline must be an array (empty [] if no events found)
- For GROUP pardons (like Jan 6), research the group's connection to Trump, not individuals`;
}

// ============================================================
// Validation
// ============================================================

function validateResearchResponse(json) {
  const errors = [];

  // 1. Required: primary_connection_type (enum)
  if (!CONNECTION_TYPES.includes(json.primary_connection_type)) {
    errors.push(`Invalid primary_connection_type: ${json.primary_connection_type}`);
  }

  // 2. Required: corruption_level (1-5)
  if (typeof json.corruption_level !== 'number' ||
      json.corruption_level < 1 || json.corruption_level > 5) {
    errors.push(`Invalid corruption_level: ${json.corruption_level}`);
  }

  // 3. Required: trump_connection_detail (non-empty string)
  if (typeof json.trump_connection_detail !== 'string' ||
      json.trump_connection_detail.trim().length < 10) {
    errors.push('trump_connection_detail must be at least 10 chars');
  }

  // 4. receipts_timeline: array with valid structure
  if (!Array.isArray(json.receipts_timeline)) {
    errors.push('receipts_timeline must be an array');
  } else {
    if (json.receipts_timeline.length > MAX_TIMELINE_LENGTH) {
      errors.push(`receipts_timeline exceeds max length ${MAX_TIMELINE_LENGTH}`);
    }
    json.receipts_timeline.forEach((event, i) => {
      // Date validation (YYYY-MM-DD or null)
      if (event.date !== null && event.date !== undefined && !DATE_REGEX.test(event.date)) {
        errors.push(`receipts_timeline[${i}].date invalid: ${event.date}`);
      }
      // Event type validation
      if (!EVENT_TYPES.includes(event.event_type)) {
        errors.push(`receipts_timeline[${i}].event_type invalid: ${event.event_type}`);
      }
      // Source URL validation (if present)
      if (event.source_url && !URL_REGEX.test(event.source_url)) {
        errors.push(`receipts_timeline[${i}].source_url invalid URL`);
      }
    });
  }

  // 5. sources: array of valid URLs
  if (!Array.isArray(json.sources)) {
    errors.push('sources must be an array');
  } else {
    if (json.sources.length > MAX_SOURCES_LENGTH) {
      errors.push(`sources exceeds max length ${MAX_SOURCES_LENGTH}`);
    }
    json.sources.forEach((url, i) => {
      if (typeof url === 'string' && !URL_REGEX.test(url)) {
        errors.push(`sources[${i}] invalid URL: ${url}`);
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================
// Perplexity Client
// ============================================================

class PerplexityClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.perplexity.ai';
  }

  async research(query) {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: PERPLEXITY_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a political research assistant. Return ONLY valid JSON. Do not include markdown formatting or code blocks.'
          },
          {
            role: 'user',
            content: query
          }
        ],
        temperature: 0.3,  // Lower temp for factual research
        max_tokens: 1500
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`Perplexity API error: ${response.status}`);
      error.status = response.status;
      error.body = errorText;
      throw error;
    }

    const data = await response.json();
    return {
      content: data.choices[0]?.message?.content || '',
      usage: data.usage || { prompt_tokens: 0, completion_tokens: 0 }
    };
  }

  calculateCost(usage) {
    // Perplexity Sonar pricing (approximate)
    // $5 per 1M input tokens, $15 per 1M output tokens
    const inputCost = (usage.prompt_tokens / 1_000_000) * 5;
    const outputCost = (usage.completion_tokens / 1_000_000) * 15;
    return inputCost + outputCost;
  }
}

// ============================================================
// Pardon Research Worker
// ============================================================

class PardonResearchWorker {
  constructor({ supabase, perplexityClient, runId, dryRun }) {
    this.supabase = supabase;
    this.perplexity = perplexityClient;
    this.runId = runId || 'local';
    this.dryRun = dryRun;
    this.startTime = Date.now();
    this.stats = {
      researched: 0,
      failed: 0,
      skipped: 0,
      totalCost: 0
    };
  }

  async getPendingPardons(limit, force = false) {
    let query = this.supabase
      .from('pardons')
      .select('id, recipient_name, recipient_type, recipient_count, pardon_date, offense_raw, crime_description, conviction_district, research_status, research_prompt_version')
      .order('id', { ascending: true })
      .limit(limit);

    if (!force) {
      // Only get pardons that haven't been researched with current prompt version
      query = query.or(`research_prompt_version.is.null,research_prompt_version.neq.${PROMPT_VERSION}`);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch pardons: ${error.message}`);
    }

    return data || [];
  }

  async researchPardon(pardon) {
    const query = buildResearchPrompt(pardon);

    console.log(`\n🔍 Researching: ${pardon.recipient_name} (ID: ${pardon.id})`);

    if (this.dryRun) {
      console.log('   [DRY RUN] Would call Perplexity API');
      console.log(`   Query preview: ${query.slice(0, 200)}...`);
      this.stats.skipped++;
      return { success: true, dryRun: true };
    }

    try {
      // Call Perplexity API
      const { content, usage } = await this.perplexity.research(query);

      // Parse JSON response (handle markdown code blocks)
      let jsonStr = content.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
      }

      let researchData;
      try {
        researchData = JSON.parse(jsonStr);
      } catch (parseErr) {
        console.error(`   ❌ JSON parse error: ${parseErr.message}`);
        console.error(`   Raw response: ${content.slice(0, 500)}`);
        await this.logError(pardon.id, {
          code: 'JSON_PARSE_ERROR',
          message: parseErr.message,
          http_status: null,
          error_json: { raw_response: content.slice(0, 2000) }
        });
        this.stats.failed++;
        return { success: false, error: parseErr.message };
      }

      // Validate response
      const validation = validateResearchResponse(researchData);
      if (!validation.valid) {
        console.error(`   ❌ Validation errors: ${validation.errors.join(', ')}`);
        await this.logError(pardon.id, {
          code: 'VALIDATION_ERROR',
          message: validation.errors.join('; '),
          http_status: null,
          error_json: { response: researchData, errors: validation.errors }
        });
        this.stats.failed++;
        return { success: false, error: validation.errors.join('; ') };
      }

      // Update pardon with research data
      await this.updatePardon(pardon.id, researchData);

      // Track cost
      const cost = this.perplexity.calculateCost(usage);
      await this.trackCost(pardon.id, usage, cost);

      this.stats.researched++;
      this.stats.totalCost += cost;

      console.log(`   ✅ Success: ${researchData.primary_connection_type}, corruption=${researchData.corruption_level}, cost=$${cost.toFixed(6)}`);

      return { success: true, data: researchData, cost };

    } catch (error) {
      console.error(`   ❌ API error: ${error.message}`);
      await this.logError(pardon.id, {
        code: error.code || 'API_ERROR',
        message: error.message,
        http_status: error.status || null,
        error_json: error.body ? { raw: error.body.slice(0, 2000) } : null
      });
      this.stats.failed++;
      return { success: false, error: error.message };
    }
  }

  async updatePardon(pardonId, data) {
    const { error } = await this.supabase
      .from('pardons')
      .update({
        primary_connection_type: data.primary_connection_type,
        trump_connection_detail: data.trump_connection_detail,
        corruption_level: data.corruption_level,
        // Store reasoning in existing field or notes
        receipts_timeline: data.receipts_timeline,
        donation_amount_usd: data.donation_amount_usd,
        source_urls: data.sources,  // Map 'sources' from prompt to 'source_urls' in DB
        research_status: 'complete',
        research_prompt_version: PROMPT_VERSION,
        researched_at: new Date().toISOString()
      })
      .eq('id', pardonId);

    if (error) {
      throw new Error(`Failed to update pardon ${pardonId}: ${error.message}`);
    }
  }

  async trackCost(pardonId, usage, cost) {
    const { error } = await this.supabase
      .from('pardon_research_costs')
      .insert({
        pardon_id: pardonId,
        input_tokens: usage.prompt_tokens,
        output_tokens: usage.completion_tokens,
        usd_estimate: cost,
        model: PERPLEXITY_MODEL,
        prompt_version: PROMPT_VERSION,
        run_id: this.runId
      });

    if (error) {
      console.warn(`   ⚠️ Failed to track cost: ${error.message}`);
    }
  }

  async logError(pardonId, errorInfo) {
    // Two-step upsert: try insert, on conflict update with incremented attempt_count
    // This is more reliable than Supabase's upsert for incrementing counters

    // First, try to get existing record
    const { data: existing } = await this.supabase
      .from('pardon_research_errors')
      .select('id, attempt_count')
      .eq('pardon_id', pardonId)
      .eq('prompt_version', PROMPT_VERSION)
      .single();

    const now = new Date().toISOString();

    if (existing) {
      // Update existing record, increment attempt_count
      const { error } = await this.supabase
        .from('pardon_research_errors')
        .update({
          run_id: this.runId,
          error_code: errorInfo.code,
          http_status: errorInfo.http_status,
          message: errorInfo.message,
          error_json: errorInfo.error_json,
          last_attempt_at: now,
          attempt_count: existing.attempt_count + 1
        })
        .eq('id', existing.id);

      if (error) {
        console.warn(`   ⚠️ Failed to update error: ${error.message}`);
      }
    } else {
      // Insert new record
      const { error } = await this.supabase
        .from('pardon_research_errors')
        .insert({
          pardon_id: pardonId,
          prompt_version: PROMPT_VERSION,
          run_id: this.runId,
          query: null,  // Could capture query if needed
          error_code: errorInfo.code,
          http_status: errorInfo.http_status,
          message: errorInfo.message,
          error_json: errorInfo.error_json,
          last_attempt_at: now,
          attempt_count: 1
        });

      if (error) {
        console.warn(`   ⚠️ Failed to log error: ${error.message}`);
      }
    }
  }

  async run(limit, force = false) {
    console.log('='.repeat(60));
    console.log('🔬 Perplexity Pardon Research');
    console.log(`   Prompt Version: ${PROMPT_VERSION}`);
    console.log(`   Model: ${PERPLEXITY_MODEL}`);
    console.log(`   Limit: ${limit}`);
    console.log(`   Force: ${force}`);
    console.log(`   Dry Run: ${this.dryRun}`);
    console.log(`   Run ID: ${this.runId}`);
    console.log('='.repeat(60));

    const pardons = await this.getPendingPardons(limit, force);
    console.log(`\n📋 Found ${pardons.length} pardons to research\n`);

    if (pardons.length === 0) {
      console.log('✅ No pardons need research. Exiting.');
      return this.stats;
    }

    for (const pardon of pardons) {
      // Runtime guard
      if (Date.now() - this.startTime > RUNTIME_LIMIT_MS) {
        console.log('\n⏱️ Runtime limit reached. Stopping.');
        break;
      }

      await this.researchPardon(pardon);

      // Delay between calls (except dry run)
      if (!this.dryRun && pardons.indexOf(pardon) < pardons.length - 1) {
        await new Promise(r => setTimeout(r, DELAY_BETWEEN_CALLS_MS));
      }
    }

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Research Complete');
    console.log(`   ✅ Researched: ${this.stats.researched}`);
    console.log(`   ❌ Failed: ${this.stats.failed}`);
    console.log(`   ⏭️ Skipped: ${this.stats.skipped}`);
    console.log(`   💰 Total Cost: $${this.stats.totalCost.toFixed(4)}`);
    console.log(`   ⏱️ Duration: ${Math.round((Date.now() - this.startTime) / 1000)}s`);
    console.log('='.repeat(60));

    return this.stats;
  }
}

// ============================================================
// CLI
// ============================================================

async function main() {
  // Parse CLI args
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');

  let limit = DEFAULT_LIMIT;
  const limitArg = args.find(a => a.startsWith('--limit='));
  if (limitArg) {
    limit = parseInt(limitArg.split('=')[1], 10);
    if (isNaN(limit) || limit < 1) {
      console.error('❌ Invalid --limit value');
      process.exit(1);
    }
  }

  // Validate environment
  const supabaseUrl = process.env.SUPABASE_URL || process.env.SUPABASE_TEST_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_TEST_SERVICE_KEY;
  const perplexityKey = process.env.PERPLEXITY_API_KEY;
  const runId = process.env.RUN_ID;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  if (!perplexityKey && !dryRun) {
    console.error('❌ Missing PERPLEXITY_API_KEY (required unless --dry-run)');
    process.exit(1);
  }

  // Initialize clients
  const supabase = createClient(supabaseUrl, supabaseKey);
  const perplexity = perplexityKey ? new PerplexityClient(perplexityKey) : null;

  // Run worker
  const worker = new PardonResearchWorker({
    supabase,
    perplexityClient: perplexity,
    runId,
    dryRun
  });

  try {
    const stats = await worker.run(limit, force);

    // Exit with error code if all failed
    if (stats.researched === 0 && stats.failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
}

main();
