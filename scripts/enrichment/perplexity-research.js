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

const PROMPT_VERSION = '1.4';  // v1.3 + ADO-264 corruption scoring overhaul (new labels, better logic)
const PERPLEXITY_MODEL = 'sonar';  // Cheapest model (~$0.005/query)
const DEFAULT_LIMIT = 20;
const DELAY_BETWEEN_CALLS_MS = 2000;  // 2 second delay between API calls
const RUNTIME_LIMIT_MS = 4 * 60 * 1000;  // 4 minutes (workflow timeout is 10)
const MAX_RETRIES = 3;  // For rate limit (429) handling
const RETRY_BASE_DELAY_MS = 5000;  // 5 second base for exponential backoff
const MAX_RETRY_DELAY_MS = 15000;  // Clamp retry sleep to 15s max

// Connection types enum (must match DB CHECK constraint)
const CONNECTION_TYPES = [
  'major_donor', 'political_ally', 'family', 'business_associate',
  'celebrity', 'jan6_defendant', 'fake_electors', 'mar_a_lago_vip',
  'cabinet_connection', 'lobbyist', 'campaign_staff', 'wealthy_unknown',
  'no_connection'
];

// Event types for receipts_timeline
const EVENT_TYPES = [
  'donation', 'conviction', 'pardon_granted', 'pardon_request',
  'mar_a_lago_visit', 'investigation', 'sentencing', 'legal_filing',
  'indictment', 'arrest', 'campaign_event', 'plea_deal', 'appeal',
  'lobbying', 'advocacy', 'other'
];

// Accept YYYY, YYYY-MM, or YYYY-MM-DD (Perplexity sometimes returns partial dates)
const DATE_REGEX = /^\d{4}(-\d{2})?(-\d{2})?$/;
// URL must be http(s)://, have at least one dot in host, no spaces
const URL_REGEX = /^https?:\/\/[^\s]+\.[^\s]+/;
const MAX_TIMELINE_LENGTH = 30;
const MAX_SOURCES_LENGTH = 20;

// ============================================================
// Security Helpers
// ============================================================

/**
 * Sanitize text for prompt injection protection
 * Removes control characters, limits length, escapes special patterns
 */
function sanitizeForPrompt(text, maxLength = 500) {
  if (text == null) return '';
  return String(text)
    .replace(/[\x00-\x1f\x7f]/g, '')  // Remove ASCII control chars
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')  // Remove Unicode bidi controls
    .replace(/```/g, '')  // Prevent markdown code block injection
    .replace(/\s+/g, ' ')  // Collapse excessive whitespace
    .trim()
    .slice(0, maxLength);
}

/**
 * Sanitize error response body to prevent API key/secret exposure
 * Removes anything that looks like an API key or secret
 */
function sanitizeErrorBody(body, maxLength = 500) {
  if (!body) return null;
  return String(body)
    // Redact Authorization credentials (Bearer/Basic), including JSON-like fields
    .replace(/["']?\s*authorization\s*["']?\s*[:=]\s*["']?Bearer\s+[^\s'"]+/gi, 'Authorization: Bearer [REDACTED]')
    .replace(/["']?\s*authorization\s*["']?\s*[:=]\s*["']?Basic\s+[^\s'"]+/gi, 'Authorization: Basic [REDACTED]')
    .replace(/Bearer\s+[^\s'"]+/gi, 'Bearer [REDACTED]')
    // Redact explicit api key fields
    .replace(/api[_-]?key["\s:=]+[A-Za-z0-9._-]{20,}/gi, 'api_key: [REDACTED]')
    // Redact x-api-key header fields
    .replace(/["']?\s*x[-_]?api[-_]?key["']?\s*[:=]\s*["']?[^"'\s]+/gi, 'x-api-key: [REDACTED]')
    // Redact access_token and refresh_token fields
    .replace(/\b(access|refresh)_token["\s:=]+[A-Za-z0-9._-]{20,}/gi, '$1_token: [REDACTED]')
    // Redact common secret prefixes (e.g., sk-..., pplx-...)
    .replace(/\bsk-[A-Za-z0-9._-]{20,}\b/gi, '[REDACTED_KEY]')
    .replace(/\bpplx-[A-Za-z0-9._-]{20,}\b/gi, '[REDACTED_KEY]')
    // Redact long token-like strings (incl. dots)
    .replace(/[A-Za-z0-9._-]{32,}/g, '[LONG_STRING_REDACTED]')
    .slice(0, maxLength);
}

// ============================================================
// Perplexity Prompt
// ============================================================

function buildResearchPrompt(pardon) {
  // Sanitize all pardon data to prevent prompt injection
  const name = sanitizeForPrompt(pardon.recipient_name, 200);
  const date = sanitizeForPrompt(pardon.pardon_date, 20);
  const offense = sanitizeForPrompt(pardon.offense_raw || pardon.crime_description || 'Unknown', 500);
  const district = sanitizeForPrompt(pardon.conviction_district || 'Unknown', 100);
  const recipientType = pardon.recipient_type === 'group' ? `GROUP PARDON (~${pardon.recipient_count || 0} people)` : 'Individual';

  return `Research this pardon recipient and return structured JSON:

RECIPIENT: ${name}
PARDON DATE: ${date}
OFFENSE: ${offense}
DISTRICT: ${district}
TYPE: ${recipientType}

SEARCH SCOPE - Look for connections to ANY of these:
- Trump directly (donations, business, personal relationship)
- Trump family (Don Jr, Eric, Ivanka, Jared Kushner)
- Cabinet members (AG Pam Bondi, other officials)
- Trump administration officials
- GOP/RNC donors or fundraisers
- Lobbyists with Trump administration access
- Mar-a-Lago members or guests
- Who specifically advocated for this pardon?
- Any future business arrangements with Trump orbit

Return JSON with EXACTLY these fields:
{
  "primary_connection_type": "major_donor|political_ally|family|business_associate|celebrity|jan6_defendant|fake_electors|mar_a_lago_vip|cabinet_connection|lobbyist|campaign_staff|wealthy_unknown|no_connection",
  "trump_connection_detail": "2-3 sentence explanation of connection (or lack thereof) to Trump orbit",
  "corruption_level": 1-5,
  "corruption_reasoning": "Why this corruption level (1 sentence)",
  "receipts_timeline": [
    {"date": "YYYY-MM-DD or null", "event_type": "see enum below", "description": "What happened", "amount_usd": null, "source_url": "citation URL"}
  ],
  "donation_amount_usd": null,
  "pardon_advocates": ["Name/Org 1", "Name/Org 2"],
  "sources": ["url1", "url2"]
}

EVENT TYPE ENUM (use exactly one):
"donation" | "conviction" | "pardon_granted" | "pardon_request" | "mar_a_lago_visit" |
"investigation" | "sentencing" | "legal_filing" | "indictment" | "arrest" |
"campaign_event" | "plea_deal" | "appeal" | "lobbying" | "advocacy" | "other"

DATE RULE:
- Use "YYYY-MM-DD" when exact date is known
- Use null if date unknown — do NOT guess or use partial dates

TIMELINE REQUIREMENT:
- ALWAYS include a "pardon_granted" event

CORRUPTION LEVEL GUIDE - Answer: What MECHANISM got them the pardon?

| Level | Label | Mechanism | Question |
|-------|-------|-----------|----------|
| 5 | Pay 2 Win | MONEY | Did they pay? (donations, PAC, legal fund, inaugural) |
| 4 | Cronies-in-Chief | DIRECT | Know Trump directly? (inner circle, family, staff, Rudy, Meadows) |
| 3 | The Party Favor | NETWORK | Know someone who knows Trump? (MAGA world, GOP allies, Alice Johnson) |
| 2 | The PR Stunt | FAME | Are they famous? (celebrity, media attention) |
| 1 | The Ego Discount | FLATTERY | Did they just suck up? (DM'd Trump, no other connection) |
| 0 | Actual Mercy | MERIT | Genuinely deserved? (EXTREMELY RARE - no Trump world ties) |

KEY PRINCIPLE: Score based on HOW they got the pardon, not "why."
- Direct Trump relationship (worked for him, family) = Level 4
- Indirect connection (MAGA celebrity, GOP ally, senators advocated) = Level 3
- If Alice Marie Johnson advocated = Level 3 (she's Trump's pardon ambassador)
- Rich person, no connection found = Level 3 (wealthy_unknown)
- Celebrity with no network = Level 2
- Pure flattery only = Level 1 (rare)
- Level 0 = probably empty

CRITICAL SCORING RULES:
- Money (donations, PAC, inaugural fund) = Level 5
- Inner circle / direct Trump contact = Level 4 (family, staff, lawyers)
- MAGA world / GOP network / friend of friend = Level 3 (THIS IS THE DEFAULT)
- Celebrity with no network connection = Level 2
- Pure flattery, no other mechanism = Level 1 (RARE)
- True merit with NO Trump world connection = Level 0 (EXTREMELY RARE, probably empty)

RULES:
- receipts_timeline must be an array (empty [] if no events found)
- pardon_advocates must be an array (empty [] if unknown)
- For GROUP pardons (like Jan 6), the group connection IS the crime FOR Trump = Level 4`;
}

// ============================================================
// Validation
// ============================================================

// Fix known Perplexity typos before validation
const CONNECTION_TYPE_TYPOS = {
  'political_ly': 'political_ally',
  'politcal_ally': 'political_ally',
  'political_alley': 'political_ally',
  'no_conection': 'no_connection',
  'campaign_staf': 'campaign_staff',
};

function fixPerplexityTypos(json) {
  if (json.primary_connection_type && CONNECTION_TYPE_TYPOS[json.primary_connection_type]) {
    console.log(`   ⚠️ Fixed typo: ${json.primary_connection_type} → ${CONNECTION_TYPE_TYPOS[json.primary_connection_type]}`);
    json.primary_connection_type = CONNECTION_TYPE_TYPOS[json.primary_connection_type];
  }
  return json;
}

function validateResearchResponse(json) {
  // Fix typos first
  json = fixPerplexityTypos(json);

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

  // 2b. corruption_reasoning: required for levels 2-5, flexible for no_connection level 1
  const isNoConnection = json.primary_connection_type === 'no_connection' && json.corruption_level === 1;
  if (!isNoConnection) {
    if (typeof json.corruption_reasoning !== 'string' || json.corruption_reasoning.trim().length < 5) {
      errors.push('corruption_reasoning required for corruption_level 2-5 (min 5 chars)');
    }
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

  // 6. pardon_advocates: must be array (v1.2)
  if (json.pardon_advocates !== undefined && !Array.isArray(json.pardon_advocates)) {
    errors.push('pardon_advocates must be an array');
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

  async research(query, retryCount = 0) {
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

    // Handle rate limiting (429) with exponential backoff
    if (response.status === 429 && retryCount < MAX_RETRIES) {
      const retryAfterSec = parseInt(response.headers.get('retry-after') || '0', 10);
      const baseDelay = retryAfterSec ? retryAfterSec * 1000 : RETRY_BASE_DELAY_MS * Math.pow(2, retryCount);
      const delay = Math.min(baseDelay, MAX_RETRY_DELAY_MS);  // Cap at 15s to stay within runtime budget
      console.log(`   ⏳ Rate limited (429). Retry ${retryCount + 1}/${MAX_RETRIES} after ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
      return this.research(query, retryCount + 1);
    }

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`Perplexity API error: ${response.status}`);
      error.status = response.status;
      // Sanitize error body before storing (prevent API key exposure)
      error.body = sanitizeErrorBody(errorText, 1000);
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
        // Sanitize response before logging (security: prevent sensitive data in logs)
        const sanitizedPreview = sanitizeErrorBody(content, 300);
        console.error(`   Response preview: ${sanitizedPreview}`);
        await this.logError(pardon.id, {
          code: 'JSON_PARSE_ERROR',
          message: parseErr.message,
          http_status: null,
          error_json: { raw_response: sanitizeErrorBody(content, 1000) }
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
        // Sanitize error body to prevent API key/secret exposure in logs
        error_json: error.body ? { raw: sanitizeErrorBody(error.body, 1000) } : null
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
        corruption_reasoning: data.corruption_reasoning ?? null,
        receipts_timeline: data.receipts_timeline,
        donation_amount_usd: data.donation_amount_usd ?? null,
        pardon_advocates: data.pardon_advocates ?? [],  // v1.2: array of advocates
        source_urls: data.sources ?? [],  // Map 'sources' from prompt to 'source_urls' in DB
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
      // Cost tracking failure is serious - budget tracking becomes inaccurate
      // Log prominently and track in stats so it's visible in summary
      console.error(`   ❌ COST TRACKING FAILED: ${error.message}`);
      console.error(`      Untracked cost: $${cost.toFixed(6)} for pardon ${pardonId}`);
      this.stats.costTrackingFailures = (this.stats.costTrackingFailures || 0) + 1;
      this.stats.untrackedCost = (this.stats.untrackedCost || 0) + cost;
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

    for (let i = 0; i < pardons.length; i++) {
      // Runtime guard
      if (Date.now() - this.startTime > RUNTIME_LIMIT_MS) {
        console.log('\n⏱️ Runtime limit reached. Stopping.');
        break;
      }

      await this.researchPardon(pardons[i]);

      // Delay between calls (except dry run and last item)
      if (!this.dryRun && i < pardons.length - 1) {
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
    if (this.stats.costTrackingFailures) {
      console.log(`   ⚠️ Cost Tracking Failures: ${this.stats.costTrackingFailures} ($${this.stats.untrackedCost.toFixed(4)} untracked)`);
    }
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
