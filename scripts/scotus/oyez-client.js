/**
 * Oyez API Client — Structured data extraction only
 *
 * Queries api.oyez.org for SCOTUS case data and extracts from
 * the `decisions[0].votes` array ONLY when populated.
 *
 * Does NOT parse `written_opinion` (proven incomplete for recent terms)
 * or `conclusion` text (same interpretation problem as Perplexity).
 *
 * Free API, no auth required.
 */

const SCOTUS_JUSTICES = new Set([
  'Roberts', 'Thomas', 'Alito', 'Sotomayor', 'Kagan',
  'Gorsuch', 'Kavanaugh', 'Barrett', 'Jackson',
]);

const OYEZ_BASE_URL = 'https://api.oyez.org/cases';

/**
 * Fetch structured case data from Oyez API.
 *
 * @param {string} term - SCOTUS term year (e.g., "2024")
 * @param {string} docketNumber - Case docket (e.g., "23-852")
 * @param {{ timeoutMs?: number }} opts
 * @returns {Promise<OyezResult|null>} Structured data or null on any failure
 *
 * @typedef {Object} OyezResult
 * @property {string[]} dissentAuthors - Last names of minority-voting justices
 * @property {string|null} voteSplit - "N-N" format or null
 * @property {string|null} majorityAuthor - Last name or null
 * @property {string|null} winningParty - As stated by Oyez
 */
export async function fetchOyezCase(term, docketNumber, opts = {}) {
  const timeoutMs = opts.timeoutMs || 10000;

  // Oyez uses the term year when the case was argued, which may differ from our DB term.
  // Try the DB term first, then term - 1 as fallback.
  const termsToTry = [term, String(Number(term) - 1)];

  for (const t of termsToTry) {
    const url = `${OYEZ_BASE_URL}/${t}/${docketNumber}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const resp = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (resp.status === 404) continue; // Try next term
      if (!resp.ok) return null;

      const data = await resp.json();
      return extractStructuredData(data);
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log(`  Oyez: timeout for ${t}/${docketNumber}`);
        return null;
      }
      // Network error — don't retry alternate term
      console.log(`  Oyez: error for ${t}/${docketNumber}: ${err.message}`);
      return null;
    }
  }

  // Neither term found
  return null;
}

/**
 * Extract structured data from Oyez API response.
 * ONLY uses decisions[0].votes when populated.
 *
 * @param {object} data - Raw Oyez API response
 * @returns {OyezResult|null}
 */
function extractStructuredData(data) {
  // Guard: decisions must exist, be an array, and have at least one entry
  if (!data.decisions || !Array.isArray(data.decisions) || data.decisions.length === 0) {
    return null; // decisions not populated (common for 2024/2025 term)
  }

  // Guard: multiple decisions entries = ambiguous
  if (data.decisions.length > 1) {
    return { _blocked: 'multiple_decisions', dissentAuthors: [], voteSplit: null, majorityAuthor: null, winningParty: null };
  }

  const decision = data.decisions[0];

  // Guard: votes must exist and be an array
  if (!decision.votes || !Array.isArray(decision.votes) || decision.votes.length === 0) {
    return null;
  }

  // --- Extract dissent authors ---
  const dissentAuthors = [];
  for (const v of decision.votes) {
    if (v.vote === 'minority' && v.member) {
      const lastName = extractLastName(v.member);
      if (lastName && SCOTUS_JUSTICES.has(lastName)) {
        dissentAuthors.push(lastName);
      }
    }
  }

  // --- Extract vote split ---
  let voteSplit = null;
  const majVote = decision.majority_vote;
  const minVote = decision.minority_vote;
  if (typeof majVote === 'number' && typeof minVote === 'number' && majVote + minVote <= 9) {
    voteSplit = `${majVote}-${minVote}`;
  }

  // --- Extract majority author ---
  let majorityAuthor = null;
  const majorityAuthors = decision.votes.filter(v => v.opinion_type === 'majority');
  if (majorityAuthors.length === 1 && majorityAuthors[0].member) {
    const lastName = extractLastName(majorityAuthors[0].member);
    if (lastName && SCOTUS_JUSTICES.has(lastName)) {
      majorityAuthor = lastName;
    }
  }
  // Zero or >1 → no fill (ambiguous)

  // --- Winning party ---
  const winningParty = decision.winning_party || null;

  return { dissentAuthors, voteSplit, majorityAuthor, winningParty };
}

/**
 * Extract last name from Oyez member object.
 * Oyez uses various fields: last_name, name, etc.
 */
function extractLastName(member) {
  if (member.last_name) return member.last_name;
  if (member.name) {
    // "John G. Roberts, Jr." → "Roberts"
    const parts = member.name.replace(/,?\s*Jr\.?\s*$/i, '').trim().split(/\s+/);
    return parts[parts.length - 1];
  }
  return null;
}

export { extractStructuredData, SCOTUS_JUSTICES };
