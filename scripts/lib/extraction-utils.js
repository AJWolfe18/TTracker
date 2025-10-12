/**
 * Extraction Utilities (TTRC-225)
 *
 * Utilities for extracting metadata from articles:
 * - URL canonicalization (strip UTM, resolve redirects)
 * - Artifact detection (PDFs, FR docs, press releases)
 * - Keyphrase extraction (TF-IDF based)
 * - Geography extraction (country, state, city)
 *
 * These are "quick wins" that don't require OpenAI API calls.
 */

import { URL } from 'url';
import natural from 'natural';

const TfIdf = natural.TfIdf;
const tfidf = new TfIdf();

// ============================================================================
// URL Canonicalization
// ============================================================================

/**
 * Canonicalize URL by removing tracking parameters and normalizing
 * @param {string} url - Original URL
 * @returns {string} - Canonical URL
 */
export function canonicalizeUrl(url) {
  try {
    const parsed = new URL(url);

    // Remove tracking parameters
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'msclkid',
      'ref', 'referrer', 'source',
      '_ga', '_gl', 'mc_cid', 'mc_eid'
    ];

    trackingParams.forEach(param => {
      parsed.searchParams.delete(param);
    });

    // Remove fragment (hash)
    parsed.hash = '';

    // Normalize trailing slash
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    parsed.pathname = pathname;

    // Normalize protocol to https
    if (parsed.protocol === 'http:') {
      parsed.protocol = 'https:';
    }

    return parsed.toString();
  } catch (e) {
    console.error('[extraction-utils] Failed to canonicalize URL:', e.message);
    return url;  // Return original on error
  }
}

/**
 * TODO: Resolve URL redirects (requires HTTP requests)
 * For now, we'll just canonicalize without following redirects
 * This can be added later if needed
 */
export async function resolveRedirects(url) {
  // Placeholder - would need HTTP client to follow 301/302
  return canonicalizeUrl(url);
}

// ============================================================================
// Artifact Detection
// ============================================================================

/**
 * Extract artifact URLs from article content
 * Detects: PDFs, Federal Register docs, press releases
 * @param {string} content - Article HTML or text content
 * @param {string} url - Article URL (for resolving relative links)
 * @returns {string[]} - Array of artifact URLs
 */
export function extractArtifacts(content, url) {
  if (!content) return [];

  const artifacts = new Set();

  // Regex patterns for common artifacts
  const patterns = [
    // PDF links
    /https?:\/\/[^\s"'<>]+\.pdf/gi,

    // Federal Register documents
    /https?:\/\/www\.federalregister\.gov\/documents\/[^\s"'<>]+/gi,
    /https?:\/\/www\.regulations\.gov\/document\/[^\s"'<>]+/gi,

    // White House press releases
    /https?:\/\/www\.whitehouse\.gov\/briefing-room\/[^\s"'<>]+/gi,

    // Congressional bills
    /https?:\/\/www\.congress\.gov\/bill\/[^\s"'<>]+/gi,

    // Executive orders
    /https?:\/\/www\.whitehouse\.gov\/presidential-actions\/[^\s"'<>]+/gi
  ];

  // Extract matches
  patterns.forEach(pattern => {
    const matches = content.match(pattern);
    if (matches) {
      matches.forEach(match => {
        // Clean up and canonicalize
        const cleaned = match.replace(/[.,;!?]+$/, '');  // Remove trailing punctuation
        artifacts.add(canonicalizeUrl(cleaned));
      });
    }
  });

  return Array.from(artifacts);
}

// ============================================================================
// Keyphrase Extraction (TF-IDF)
// ============================================================================

/**
 * Extract top keyphrases from text using TF-IDF
 * @param {string} text - Article text (title + content)
 * @param {number} topN - Number of keyphrases to return (default: 10)
 * @returns {string[]} - Array of keyphrases
 */
export function extractKeyphrases(text, topN = 10) {
  if (!text) return [];

  // Tokenize and filter
  const tokenizer = new natural.WordTokenizer();
  const tokens = tokenizer.tokenize(text.toLowerCase());

  // Remove stopwords and short tokens
  const stopwords = new Set(natural.stopwords);
  const filtered = tokens.filter(token =>
    !stopwords.has(token) &&
    token.length >= 3 &&
    /^[a-z]+$/.test(token)  // Only alphabetic
  );

  // Get bi-grams as well (common phrases)
  const bigrams = [];
  for (let i = 0; i < filtered.length - 1; i++) {
    bigrams.push(`${filtered[i]} ${filtered[i + 1]}`);
  }

  // Combine unigrams and bigrams
  const phrases = [...filtered, ...bigrams];

  // Calculate frequency
  const freq = {};
  phrases.forEach(phrase => {
    freq[phrase] = (freq[phrase] || 0) + 1;
  });

  // Sort by frequency and return top N
  const sorted = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([phrase]) => phrase);

  return sorted;
}

// ============================================================================
// Geography Extraction
// ============================================================================

// Common US states and their abbreviations
const US_STATES = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
  'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
  'wisconsin': 'WI', 'wyoming': 'WY'
};

// Major US cities
const US_CITIES = [
  'new york', 'los angeles', 'chicago', 'houston', 'phoenix', 'philadelphia',
  'san antonio', 'san diego', 'dallas', 'san jose', 'austin', 'jacksonville',
  'fort worth', 'columbus', 'charlotte', 'san francisco', 'indianapolis',
  'seattle', 'denver', 'washington', 'boston', 'detroit', 'nashville',
  'memphis', 'portland', 'las vegas', 'baltimore', 'milwaukee', 'atlanta',
  'miami', 'oakland', 'minneapolis', 'tampa', 'new orleans'
];

// Common countries
const COUNTRIES = [
  'united states', 'usa', 'china', 'russia', 'ukraine', 'israel', 'iran',
  'north korea', 'south korea', 'japan', 'germany', 'france', 'united kingdom',
  'uk', 'canada', 'mexico', 'brazil', 'india', 'pakistan', 'syria', 'iraq',
  'afghanistan', 'gaza', 'palestine'
];

/**
 * Extract geography from text (simple pattern matching)
 * @param {string} text - Article text
 * @returns {object} - {country, state, city}
 */
export function extractGeography(text) {
  if (!text) return null;

  const lower = text.toLowerCase();
  const geo = {};

  // Check for countries
  for (const country of COUNTRIES) {
    if (lower.includes(country)) {
      geo.country = country.toUpperCase();
      break;
    }
  }

  // Check for US states
  for (const [state, abbr] of Object.entries(US_STATES)) {
    if (lower.includes(state) || lower.includes(abbr.toLowerCase())) {
      geo.state = abbr;
      geo.country = 'USA';  // Override country
      break;
    }
  }

  // Check for US cities
  for (const city of US_CITIES) {
    if (lower.includes(city)) {
      geo.city = city;
      geo.country = 'USA';  // Override country
      break;
    }
  }

  // Return null if nothing found
  return Object.keys(geo).length > 0 ? geo : null;
}

// ============================================================================
// Content Cleaning
// ============================================================================

/**
 * Clean and normalize article content
 * @param {string} content - Raw article content
 * @returns {string} - Cleaned content
 */
export function cleanContent(content) {
  if (!content) return '';

  return content
    // Remove boilerplate patterns
    .replace(/sign up for our newsletter/gi, '')
    .replace(/subscribe to our channel/gi, '')
    .replace(/follow us on twitter/gi, '')
    .replace(/read more:/gi, '')

    // Normalize quotes
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/—/g, '-')

    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract first N sentences from content
 * @param {string} content - Article content
 * @param {number} n - Number of sentences (default: 3)
 * @returns {string} - First N sentences
 */
export function getFirstSentences(content, n = 3) {
  if (!content) return '';

  const sentences = content.split(/[.!?]+/);
  return sentences.slice(0, n).join('. ').trim() + '.';
}
