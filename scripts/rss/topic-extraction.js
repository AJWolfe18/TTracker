/**
 * TTRC-306: Topic Slug Extraction
 *
 * Uses GPT-4o-mini to generate canonical topic slugs for clustering.
 * Cost: ~$0.0005 per article
 *
 * IMPORTANT: Slugs are normalized aggressively to ensure consistency.
 * The LLM output is NOT trusted directly - it's cleaned and validated.
 */

// ============================================================================
// Synonym Canonicalization (TTRC-302)
// ============================================================================
// Maps common event word variants to canonical forms to reduce slug drift.
// e.g., CONFIRMED, CONFIRMATION, CONFIRMING → CONFIRM
// This avoids full Porter stemming which mangles proper nouns/acronyms.

const EVENT_WORD_MAP = {
  CONFIRMED: 'CONFIRM',
  CONFIRMATION: 'CONFIRM',
  CONFIRMING: 'CONFIRM',

  HEARING: 'HEAR',
  HEARINGS: 'HEAR',

  NOMINATION: 'NOMINATE',
  NOMINATED: 'NOMINATE',
  NOMINATIONS: 'NOMINATE',

  INVESTIGATION: 'INVESTIGATE',
  INVESTIGATING: 'INVESTIGATE',
  INVESTIGATED: 'INVESTIGATE',

  ANNOUNCEMENT: 'ANNOUNCE',
  ANNOUNCED: 'ANNOUNCE',
  ANNOUNCING: 'ANNOUNCE',

  APPOINTMENT: 'APPOINT',
  APPOINTED: 'APPOINT',

  INDICTMENT: 'INDICT',
  INDICTED: 'INDICT',

  ARREST: 'ARREST',
  ARRESTED: 'ARREST',

  RESIGNATION: 'RESIGN',
  RESIGNED: 'RESIGN',

  // Expand as drift families are observed
};

// Skip tokens: short words, pure numbers, known acronyms
const SKIP_TOKENS = new Set([
  'DOJ', 'FBI', 'DHS', 'CIA', 'NSA', 'EPA', 'IRS',
  'GOP', 'DNC', 'USA', 'US', 'UN', 'NATO',
]);

/**
 * Canonicalize slug via synonym mapping to reduce drift
 * HEGSETH-CONFIRMATION-HEARING → HEGSETH-CONFIRM-HEAR
 * Avoids Porter stemming to preserve proper nouns and acronyms
 */
function canonicalizeSlug(slug) {
  if (!slug) return null;

  const tokens = slug.split('-').filter(Boolean);

  const mapped = tokens.map((t) => {
    // Slug should already be uppercase from normalizeSlug()
    if (t.length <= 3) return t;
    if (/^\d+$/.test(t)) return t;
    if (SKIP_TOKENS.has(t)) return t;
    return EVENT_WORD_MAP[t] ?? t;
  });

  // Remove immediate duplicates caused by mapping
  const deduped = [];
  for (const t of mapped) {
    if (deduped[deduped.length - 1] !== t) deduped.push(t);
  }

  return deduped.join('-');
}

const SLUG_PROMPT = `Generate a canonical topic slug for this news article.

Rules:
1. Use ALL-CAPS with hyphens (e.g., HEGSETH-CONFIRMATION-HEARING)
2. 2-5 words maximum
3. Identify the SPECIFIC EVENT, not general topics
4. Different articles about the same event should get IDENTICAL slugs
5. Focus on: WHO-did-WHAT or WHAT-happened-WHERE

Examples:
- "Trump fires FBI director Wray" → TRUMP-FIRES-WRAY
- "Wray resignation after Trump pressure" → TRUMP-FIRES-WRAY
- "Senate confirms Hegseth as Defense Secretary" → HEGSETH-CONFIRMATION
- "Hegseth faces opposition in committee vote" → HEGSETH-CONFIRMATION
- "New Epstein documents released by FBI" → EPSTEIN-FILES-RELEASE
- "Gaza ceasefire deal reached" → GAZA-CEASEFIRE-DEAL
- "Trump's Tylenol advice and health policy" → TRUMP-TYLENOL-ADVICE
- "Government shutdown averted by funding bill" → GOVT-SHUTDOWN-AVERTED

For general opinion/analysis pieces without a specific event, use the primary topic:
- "Analysis: Trump's foreign policy shift" → TRUMP-FOREIGN-POLICY-ANALYSIS

Return ONLY the slug, nothing else.`;

/**
 * Normalize slug to consistent format
 * - Uppercase
 * - Replace non-alphanumeric with hyphens
 * - Collapse multiple hyphens
 * - Trim leading/trailing hyphens
 */
export function normalizeSlug(raw) {
  if (!raw) return null;
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')  // non-alnum → hyphen
    .replace(/-+/g, '-')          // collapse consecutive hyphens
    .replace(/^-|-$/g, '');       // trim leading/trailing hyphens
}

/**
 * Extract topic slug for an article
 * Uses title + content (or excerpt as fallback)
 * @param {string} title - Article title
 * @param {string} content - Article content (preferred)
 * @param {string} excerpt - RSS excerpt (fallback)
 * @param {object} openai - OpenAI client instance
 * @returns {string|null} - Normalized slug or null
 */
export async function extractTopicSlug(title, content = '', excerpt = '', openai = null) {
  if (!title) return null;
  if (!openai) {
    console.error('[topic-extraction] No OpenAI client provided');
    return null;
  }

  // Prefer content, fall back to excerpt
  const contentSnippet = (content || excerpt || '').slice(0, 500);
  const inputContent = `Title: ${title}\nExcerpt: ${contentSnippet}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SLUG_PROMPT },
        { role: 'user', content: inputContent }
      ],
      max_tokens: 50,
      temperature: 0.0  // Zero temp for maximum consistency
    });

    const rawSlug = response.choices[0]?.message?.content?.trim();
    const normalizedSlug = normalizeSlug(rawSlug);
    const canonicalSlug = canonicalizeSlug(normalizedSlug);

    // Validate the canonical slug (not the raw/normalized one)
    if (!canonicalSlug || !canonicalSlug.match(/^[A-Z0-9-]{3,60}$/)) {
      console.warn(`[topic-extraction] Invalid slug: raw="${rawSlug}" normalized="${normalizedSlug}" canonical="${canonicalSlug}" title="${title.slice(0, 50)}..."`);
      return null;
    }

    return canonicalSlug;
  } catch (error) {
    console.error(`[topic-extraction] Error extracting slug:`, error.message);
    return null;
  }
}

/**
 * Extract topic slugs for a batch of articles
 * @param {array} articles - Array of article objects with title, content, excerpt
 * @param {object} openai - OpenAI client instance
 * @param {number} batchSize - Number of concurrent requests (default 10)
 * @returns {array} - Array of slugs (null for failed extractions)
 */
export async function extractTopicSlugBatch(articles, openai, batchSize = 10) {
  const results = [];

  for (let i = 0; i < articles.length; i += batchSize) {
    const batch = articles.slice(i, i + batchSize);
    // Use content || excerpt consistently
    const promises = batch.map(a => extractTopicSlug(
      a.title,
      a.content || '',
      a.excerpt || '',
      openai
    ));
    const slugs = await Promise.all(promises);

    results.push(...slugs);

    // Rate limit: 10 per batch with 500ms delay
    if (i + batchSize < articles.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return results;
}

export { SLUG_PROMPT };
