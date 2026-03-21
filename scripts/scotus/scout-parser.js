/**
 * SCOTUS Scout Parser
 *
 * Parses raw Perplexity response into structured Scout output.
 * Handles: JSON extraction, field normalization, name normalization.
 */

// ============================================================
// Disposition normalization
// ============================================================

const DISPOSITION_ALIASES = {
  'affirmed': 'affirmed',
  'affirm': 'affirmed',
  'reversed': 'reversed',
  'reverse': 'reversed',
  'vacated': 'vacated',
  'vacate': 'vacated',
  'remanded': 'remanded',
  'remand': 'remanded',
  'reversed and remanded': 'reversed_and_remanded',
  'reversed_and_remanded': 'reversed_and_remanded',
  'vacated and remanded': 'vacated_and_remanded',
  'vacated_and_remanded': 'vacated_and_remanded',
  'dismissed': 'dismissed',
  'dismiss': 'dismissed',
  'gvr': 'GVR',
  'GVR': 'GVR',
  'granted, vacated, and remanded': 'GVR',
  'granted vacated and remanded': 'GVR',
};

export const VALID_DISPOSITIONS = [
  'affirmed', 'reversed', 'vacated', 'remanded',
  'reversed_and_remanded', 'vacated_and_remanded',
  'dismissed', 'GVR',
];

export const VALID_OPINION_TYPES = [
  'majority', 'plurality', 'per_curiam', 'unsigned_per_curiam', 'DIG',
];

export const VALID_ISSUE_AREAS = [
  'constitutional_rights', 'criminal_procedure', 'civil_rights',
  'first_amendment', 'due_process', 'federal_regulation', 'taxation',
  'immigration', 'environmental', 'labor', 'voting_rights',
  'executive_power', 'judicial_power', 'property', 'other',
];

const VALID_CONFIDENCE = ['high', 'medium', 'low'];

// ============================================================
// Justice name normalization
// ============================================================

const JUSTICE_NAME_MAP = {
  'roberts': 'Roberts',
  'thomas': 'Thomas',
  'alito': 'Alito',
  'sotomayor': 'Sotomayor',
  'kagan': 'Kagan',
  'gorsuch': 'Gorsuch',
  'kavanaugh': 'Kavanaugh',
  'barrett': 'Barrett',
  'jackson': 'Jackson',
  // Common first-name variants
  'john roberts': 'Roberts',
  'clarence thomas': 'Thomas',
  'samuel alito': 'Alito',
  'sonia sotomayor': 'Sotomayor',
  'elena kagan': 'Kagan',
  'neil gorsuch': 'Gorsuch',
  'brett kavanaugh': 'Kavanaugh',
  'amy coney barrett': 'Barrett',
  'ketanji brown jackson': 'Jackson',
  // Abbreviated
  'cj roberts': 'Roberts',
  'chief justice roberts': 'Roberts',
  'justice thomas': 'Thomas',
  'justice alito': 'Alito',
  'justice sotomayor': 'Sotomayor',
  'justice kagan': 'Kagan',
  'justice gorsuch': 'Gorsuch',
  'justice kavanaugh': 'Kavanaugh',
  'justice barrett': 'Barrett',
  'justice jackson': 'Jackson',
};

function normalizeJusticeName(name) {
  if (!name || typeof name !== 'string') return null;
  const lower = name.trim().toLowerCase();
  return JUSTICE_NAME_MAP[lower] || name.trim();
}

// ============================================================
// Parse
// ============================================================

/**
 * Parse raw Perplexity response content into Scout result
 * @param {string} rawContent - Raw text from Perplexity
 * @param {string[]} citations - Citation URLs from Perplexity API
 * @returns {{ parsed: object|null, parseError: string|null }}
 */
export function parseScoutResponse(rawContent, citations = []) {
  if (!rawContent || typeof rawContent !== 'string') {
    return { parsed: null, parseError: 'Empty or non-string response' };
  }

  // Strip markdown code blocks if present
  let jsonStr = rawContent.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  }

  let raw;
  try {
    raw = JSON.parse(jsonStr);
  } catch (e) {
    return { parsed: null, parseError: `JSON parse error: ${e.message}` };
  }

  // Normalize into canonical Scout shape
  const result = normalizeScoutOutput(raw, citations);
  return { parsed: result, parseError: null };
}

/**
 * Normalize raw JSON into canonical Scout output
 */
function normalizeScoutOutput(raw, citations) {
  const out = {};

  // Status
  out.status = ['ok', 'uncertain', 'failed'].includes(raw.status) ? raw.status : 'uncertain';

  // Disposition
  const rawDisp = String(raw.formal_disposition || '').trim().toLowerCase();
  out.formal_disposition = DISPOSITION_ALIASES[rawDisp] || raw.formal_disposition || null;
  out.formal_disposition_detail = raw.formal_disposition_detail || null;

  // Opinion type
  out.opinion_type = VALID_OPINION_TYPES.includes(raw.opinion_type) ? raw.opinion_type : null;

  // Vote split — enforce N-N format
  out.vote_split = normalizeVoteSplit(raw.vote_split);

  // Majority author
  out.majority_author = normalizeJusticeName(raw.majority_author);

  // Dissent authors
  out.dissent_authors = normalizeDissentAuthors(raw.dissent_authors);

  // Text fields
  out.substantive_winner = typeof raw.substantive_winner === 'string' ? raw.substantive_winner.trim() : null;
  out.practical_effect = typeof raw.practical_effect === 'string' ? raw.practical_effect.trim() : null;
  out.holding = typeof raw.holding === 'string' ? raw.holding.trim() : null;

  // Issue area
  out.issue_area = VALID_ISSUE_AREAS.includes(raw.issue_area) ? raw.issue_area : null;

  // Citation
  out.case_citation = typeof raw.case_citation === 'string' ? raw.case_citation.trim() : null;

  // Confidence
  out.fact_confidence = normalizeConfidence(raw.fact_confidence);

  // Source tiers
  out.source_tiers_used = Array.isArray(raw.source_tiers_used)
    ? raw.source_tiers_used.filter(t => [1, 2, 3].includes(t))
    : [];

  // Source URLs — merge Perplexity citations with any returned in JSON
  const jsonUrls = Array.isArray(raw.source_urls) ? raw.source_urls.filter(u => typeof u === 'string') : [];
  const allUrls = [...new Set([...citations, ...jsonUrls])];
  out.source_urls = allUrls;

  return out;
}

function normalizeVoteSplit(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  // Match N-N pattern (e.g. "7-2", "9-0")
  const match = str.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
  if (match) return `${match[1]}-${match[2]}`;
  // Try to extract from text like "7 to 2" or "7:2"
  const altMatch = str.match(/^(\d+)\s*(?:to|:)\s*(\d+)$/i);
  if (altMatch) return `${altMatch[1]}-${altMatch[2]}`;
  return null;
}

function normalizeDissentAuthors(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeJusticeName)
    .filter(n => n !== null);
}

function normalizeConfidence(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      formal_disposition: 'low',
      vote_split: 'low',
      majority_author: 'low',
      dissent_authors: 'low',
      substantive_winner: 'low',
    };
  }

  const fields = ['formal_disposition', 'vote_split', 'majority_author', 'dissent_authors', 'substantive_winner'];
  const out = {};
  for (const f of fields) {
    out[f] = VALID_CONFIDENCE.includes(raw[f]) ? raw[f] : 'low';
  }
  return out;
}
