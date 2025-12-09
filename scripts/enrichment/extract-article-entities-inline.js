/**
 * TTRC-298: Article Entity Extraction Module
 *
 * Shared module for extracting entities from article content.
 * Used by:
 *   - rss-tracker-supabase.js (pipeline entity extraction phase)
 *   - backfill-article-entities-inline.js (historical backfill)
 *
 * Features:
 *   - GPT-4o-mini extraction with canonical IDs
 *   - Entity deduplication (one vote per entity per article)
 *   - Defensive JSON parsing (separates parse vs API errors)
 *   - Normalization via entity-normalization.js
 */

import { normalizeEntities } from '../lib/entity-normalization.js';

// ============================================================================
// Entity Extraction Prompt
// ============================================================================

export const ENTITY_EXTRACTION_PROMPT = `You are a political entity extractor. Return ONLY valid JSON object.

Extract 3-8 key entities from this news article using CANONICAL IDs:

Entity formats:
* PERSON: US-<LASTNAME> (e.g., US-TRUMP, US-BIDEN, US-PELOSI)
* ORG: ORG-<ABBREV> (e.g., ORG-DOJ, ORG-DHS, ORG-SUPREME-COURT)
* LOCATION: LOC-<NAME> (e.g., LOC-USA, LOC-TEXAS, LOC-UKRAINE)
* EVENT: EVT-<NAME> (e.g., EVT-JAN6, EVT-ACA)

Return JSON object format:
{
  "entities": [
    {
      "id": "US-TRUMP",
      "name": "Donald Trump",
      "type": "PERSON",
      "confidence": 0.95
    }
  ]
}

Guidelines:
- Only include entities with confidence ≥0.70
- Sort by importance/salience
- Prefer fewer high-quality entities over many weak ones
- Keep diverse types (not all PERSONs unless justified)
- If you cannot assign canonical ID, omit the entity
- Return empty array {"entities": []} if no entities found

IMPORTANT: Return ONLY the JSON object with "entities" key.`;

// ============================================================================
// Main Extraction Function
// ============================================================================

/**
 * Extract entities from article title and content
 * @param {string} title - Article title
 * @param {string} content - Article content (scraped_content or excerpt)
 * @param {OpenAI} openaiClient - OpenAI client instance
 * @returns {Promise<{entities: Array, tokens: object|null}>}
 */
export async function extractArticleEntities(title, content, openaiClient) {
  // Prepare article text (truncate to 4000 chars for token efficiency)
  const articleText = `Title: ${title}\n\nContent: ${content || '(no content)'}`.slice(0, 4000);

  try {
    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: ENTITY_EXTRACTION_PROMPT },
        { role: 'user', content: articleText }
      ],
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: 'json_object' }
    });

    // Defensive JSON parsing - separate parse errors from API errors
    let entities = [];
    try {
      const responseText = response.choices[0].message.content || '{}';
      const parsed = JSON.parse(responseText);

      // Handle different response formats
      if (Array.isArray(parsed.entities)) {
        entities = parsed.entities;
      } else if (Array.isArray(parsed.entity)) {
        entities = parsed.entity;
      } else if (Array.isArray(parsed)) {
        entities = parsed;
      } else {
        console.warn('[entity-extraction] Unexpected JSON structure, returning empty');
        return { entities: [], tokens: response.usage };
      }
    } catch (parseErr) {
      console.error('[entity-extraction] JSON parse error:', parseErr.message);
      return { entities: [], tokens: response.usage };
    }

    // Normalize entity IDs using existing normalization module
    entities = normalizeEntities(entities);

    // Filter to high-confidence entities with valid IDs
    entities = entities.filter(e => e?.id && (e.confidence ?? 1) >= 0.70);

    // Deduplicate by entity ID (one vote per article)
    // Keep highest confidence if duplicate
    const map = new Map();
    for (const e of entities) {
      const existing = map.get(e.id);
      if (!existing || (e.confidence ?? 1) > (existing.confidence ?? 1)) {
        map.set(e.id, e);
      }
    }
    const uniqueEntities = Array.from(map.values());

    return { entities: uniqueEntities, tokens: response.usage };

  } catch (err) {
    console.error(`[entity-extraction] API error: ${err.message}`);
    return { entities: [], tokens: null };
  }
}
