/**
 * Entity ID Normalization Module
 *
 * Fixes inconsistent entity IDs from OpenAI extraction.
 * Maps raw names and variant formats to canonical IDs.
 *
 * Canonical format:
 * - People: US-LASTNAME (e.g., US-TRUMP, US-BIDEN)
 * - Organizations: ORG-ABBREV (e.g., ORG-DOJ, ORG-FBI)
 * - Locations: LOC-NAME (e.g., LOC-USA, LOC-UKRAINE)
 * - Events: EVT-NAME (e.g., EVT-JAN6, EVT-SNAP)
 *
 * Created: 2025-11-30 for TTRC-236 entity normalization blocker
 */

// Raw names → Canonical IDs
const ENTITY_ALIASES = {
  // === PEOPLE - Current Administration ===
  'Donald Trump': 'US-TRUMP',
  'President Trump': 'US-TRUMP',
  'Donald J. Trump': 'US-TRUMP',
  'Trump': 'US-TRUMP',
  'US-DONALD-TRUMP': 'US-TRUMP',
  'DONALD-TRUMP': 'US-TRUMP',

  'JD Vance': 'US-VANCE',
  'J.D. Vance': 'US-VANCE',
  'Vice President Vance': 'US-VANCE',

  'Pete Hegseth': 'US-HEGSETH',
  'Secretary Hegseth': 'US-HEGSETH',

  'Kristi Noem': 'US-NOEM',
  'Secretary Noem': 'US-NOEM',

  'Marco Rubio': 'US-RUBIO',
  'Secretary Rubio': 'US-RUBIO',

  'Kash Patel': 'US-PATEL',
  'Director Patel': 'US-PATEL',

  'Robert Kennedy Jr': 'US-KENNEDY-JR',
  'Robert F. Kennedy Jr': 'US-KENNEDY-JR',
  'RFK Jr': 'US-KENNEDY-JR',

  'Elon Musk': 'US-MUSK',

  // === PEOPLE - Congress ===
  'Nancy Pelosi': 'US-PELOSI',
  'Chuck Schumer': 'US-SCHUMER',
  'Mitch McConnell': 'US-MCCONNELL',
  'John Thune': 'US-THUNE',
  'Hakeem Jeffries': 'US-JEFFRIES',
  'Mike Johnson': 'US-JOHNSON',
  'Marjorie Taylor Greene': 'US-GREENE',
  'MTG': 'US-GREENE',
  'Adam Schiff': 'US-SCHIFF',
  'Ted Cruz': 'US-CRUZ',
  'Bernie Sanders': 'US-SANDERS',
  'Elizabeth Warren': 'US-WARREN',
  'AOC': 'US-AOC',
  'Alexandria Ocasio-Cortez': 'US-AOC',

  // === PEOPLE - Former Officials ===
  'Joe Biden': 'US-BIDEN',
  'President Biden': 'US-BIDEN',
  'Joseph Biden': 'US-BIDEN',

  'James Comey': 'US-COMEY',
  'Director Comey': 'US-COMEY',

  'John Brennan': 'US-BRENNAN',
  'Director Brennan': 'US-BRENNAN',

  'Letitia James': 'US-JAMES',
  'AG James': 'US-JAMES',

  'Rudy Giuliani': 'US-GIULIANI',

  // === PEOPLE - Other Political Figures ===
  'Gavin Newsom': 'US-NEWSOM',
  'Governor Newsom': 'US-NEWSOM',

  'Ron DeSantis': 'US-DESANTIS',
  'Governor DeSantis': 'US-DESANTIS',

  'Liz Cheney': 'US-CHENEY',

  'Dan Bongino': 'US-BONGINO',

  'Nick Fuentes': 'US-FUENTES',

  'Tucker Carlson': 'US-CARLSON',

  'Steve Bannon': 'US-BANNON',

  // === PEOPLE - International ===
  'Vladimir Putin': 'RU-PUTIN',
  'Putin': 'RU-PUTIN',

  'Volodymyr Zelensky': 'UA-ZELENSKY',
  'Zelensky': 'UA-ZELENSKY',

  'Benjamin Netanyahu': 'IL-NETANYAHU',
  'Netanyahu': 'IL-NETANYAHU',
  'Bibi': 'IL-NETANYAHU',

  'Viktor Orban': 'HU-ORBAN',
  'Viktor Orbán': 'HU-ORBAN',
  'Orban': 'HU-ORBAN',

  // === ORGANIZATIONS - Government ===
  'Department of Justice': 'ORG-DOJ',
  'Justice Department': 'ORG-DOJ',
  'DOJ': 'ORG-DOJ',

  'FBI': 'ORG-FBI',
  'Federal Bureau of Investigation': 'ORG-FBI',

  'CIA': 'ORG-CIA',
  'Central Intelligence Agency': 'ORG-CIA',

  'Department of Homeland Security': 'ORG-DHS',
  'DHS': 'ORG-DHS',
  'Homeland Security': 'ORG-DHS',

  'Pentagon': 'ORG-PENTAGON',
  'Department of Defense': 'ORG-DOD',
  'DoD': 'ORG-DOD',

  'State Department': 'ORG-DOS',
  'Department of State': 'ORG-DOS',

  'Supreme Court': 'ORG-SUPREME-COURT',
  'SCOTUS': 'ORG-SUPREME-COURT',
  'US Supreme Court': 'ORG-SUPREME-COURT',
  'U.S. Supreme Court': 'ORG-SUPREME-COURT',

  'White House': 'ORG-WHITE-HOUSE',
  'The White House': 'ORG-WHITE-HOUSE',

  'Congress': 'ORG-CONGRESS',
  'U.S. Congress': 'ORG-CONGRESS',
  'US Congress': 'ORG-CONGRESS',

  'Senate': 'ORG-SENATE',
  'U.S. Senate': 'ORG-SENATE',
  'US Senate': 'ORG-SENATE',

  'House of Representatives': 'ORG-HOUSE',
  'House': 'ORG-HOUSE',
  'U.S. House': 'ORG-HOUSE',

  'Capitol Police': 'ORG-CAPITOL-POLICE',
  'US Capitol Police': 'ORG-CAPITOL-POLICE',

  'ICE': 'ORG-ICE',
  'Immigration and Customs Enforcement': 'ORG-ICE',

  'USDA': 'ORG-USDA',
  'Department of Agriculture': 'ORG-USDA',

  'FAA': 'ORG-FAA',
  'Federal Aviation Administration': 'ORG-FAA',

  'CDC': 'ORG-CDC',
  'Centers for Disease Control': 'ORG-CDC',

  'FDA': 'ORG-FDA',
  'Food and Drug Administration': 'ORG-FDA',

  'FCC': 'ORG-FCC',
  'Federal Communications Commission': 'ORG-FCC',

  'SEC': 'ORG-SEC',
  'Securities and Exchange Commission': 'ORG-SEC',

  // === ORGANIZATIONS - Political Parties ===
  'Republican Party': 'ORG-GOP',
  'Republicans': 'ORG-GOP',
  'GOP': 'ORG-GOP',
  'RNC': 'ORG-RNC',

  'Democratic Party': 'ORG-DEM',
  'Democrats': 'ORG-DEM',
  'DNC': 'ORG-DNC',

  'Senate Republicans': 'ORG-SENATE-GOP',
  'Senate Democrats': 'ORG-SENATE-DEM',
  'House Republicans': 'ORG-HOUSE-GOP',
  'House Democrats': 'ORG-HOUSE-DEM',

  // === ORGANIZATIONS - Media ===
  'New York Times': 'ORG-NYT',
  'The New York Times': 'ORG-NYT',
  'NYT': 'ORG-NYT',

  'Washington Post': 'ORG-WAPO',
  'The Washington Post': 'ORG-WAPO',
  'WaPo': 'ORG-WAPO',

  'Associated Press': 'ORG-AP',
  'AP': 'ORG-AP',

  'Reuters': 'ORG-REUTERS',

  'Fox News': 'ORG-FOX',
  'Fox': 'ORG-FOX',

  'CNN': 'ORG-CNN',

  'Politico': 'ORG-POLITICO',
  'POLITICO': 'ORG-POLITICO',

  'BBC': 'ORG-BBC',

  'PBS': 'ORG-PBS',
  'PBS NewsHour': 'ORG-PBS',

  // === ORGANIZATIONS - Other ===
  'Heritage Foundation': 'ORG-HERITAGE',
  'The Heritage Foundation': 'ORG-HERITAGE',

  'ACLU': 'ORG-ACLU',
  'American Civil Liberties Union': 'ORG-ACLU',

  'NATO': 'ORG-NATO',

  'UN': 'ORG-UN',
  'United Nations': 'ORG-UN',

  'WHO': 'ORG-WHO',
  'World Health Organization': 'ORG-WHO',

  'Tesla': 'ORG-TESLA',

  // === LOCATIONS ===
  'United States': 'LOC-USA',
  'U.S.': 'LOC-USA',
  'US': 'LOC-USA',
  'USA': 'LOC-USA',
  'America': 'LOC-USA',

  'Washington D.C.': 'LOC-DC',
  'Washington, D.C.': 'LOC-DC',
  'Washington DC': 'LOC-DC',
  'D.C.': 'LOC-DC',

  'New York': 'LOC-NEWYORK',
  'New York City': 'LOC-NYC',
  'NYC': 'LOC-NYC',

  'California': 'LOC-CALIFORNIA',
  'Texas': 'LOC-TEXAS',
  'Florida': 'LOC-FLORIDA',

  'Russia': 'LOC-RUSSIA',
  'Ukraine': 'LOC-UKRAINE',
  'China': 'LOC-CHINA',
  'Israel': 'LOC-ISRAEL',
  'Gaza': 'LOC-GAZA',
  'Iran': 'LOC-IRAN',
  'Venezuela': 'LOC-VENEZUELA',

  // === EVENTS/PROGRAMS ===
  'January 6': 'EVT-JAN6',
  'January 6th': 'EVT-JAN6',
  'Jan 6': 'EVT-JAN6',
  'J6': 'EVT-JAN6',

  'SNAP': 'EVT-SNAP',
  'SNAP benefits': 'EVT-SNAP',
  'food stamps': 'EVT-SNAP',

  'Obamacare': 'EVT-ACA',
  'Affordable Care Act': 'EVT-ACA',
  'ACA': 'EVT-ACA',

  // === ID VARIANT NORMALIZATION ===
  // GPT sometimes generates these non-canonical IDs
  // Fix: Normalize to correct canonical form
  'ORG-US': 'LOC-USA',       // Wrong type: US as org → should be LOC-USA
  'ORG-USA': 'LOC-USA',      // Wrong type: USA as org → should be LOC-USA
  'LOC-US': 'LOC-USA',       // Missing 'A': US → USA
  'US-SENATE': 'ORG-SENATE', // Wrong prefix: US- → ORG-
  'US-CONGRESS': 'ORG-CONGRESS',
  'US-HOUSE': 'ORG-HOUSE',
  'US-DOJ': 'ORG-DOJ',
  'US-FBI': 'ORG-FBI',
  'US-CIA': 'ORG-CIA',
  'US-DHS': 'ORG-DHS',
  'US-WHITE-HOUSE': 'ORG-WHITE-HOUSE',
  'US-SUPREME-COURT': 'ORG-SUPREME-COURT',

  // === PERIOD VARIANTS (GPT includes periods) ===
  'LOC-D.C.': 'LOC-DC',
  'LOC-DC.': 'LOC-DC',
  'ORG-U.N.': 'ORG-UN',
  'ORG-C.D.C.': 'ORG-CDC',
  'ORG-F.B.I.': 'ORG-FBI',
  'ORG-C.I.A.': 'ORG-CIA',
  'ORG-D.O.J.': 'ORG-DOJ',
  'ORG-D.H.S.': 'ORG-DHS',
  'ORG-F.A.A.': 'ORG-FAA',
  'ORG-F.D.A.': 'ORG-FDA',
  'ORG-V.O.A.': 'ORG-VOA', // Voice of America
};

// ============================================================================
// ID Validation
// ============================================================================

/**
 * Valid entity ID patterns (format-only validation)
 * Semantic validation happens via prompt improvements, not here.
 */
const VALID_ID_PATTERNS = [
  /^US-[A-Z][A-Z0-9-]*$/,       // US People: US-TRUMP, US-BIDEN
  /^[A-Z]{2}-[A-Z][A-Z0-9-]*$/, // International: RU-PUTIN, IL-NETANYAHU
  /^ORG-[A-Z0-9-]+$/,           // Organizations: ORG-DOJ, ORG-FBI
  /^LOC-[A-Z0-9-]+$/,           // Locations: LOC-USA, LOC-UKRAINE
  /^EVT-[A-Z0-9-]+$/,           // Events: EVT-JAN6, EVT-SNAP
];

/**
 * Check if an entity ID matches valid format patterns
 * @param {string} id - Entity ID to validate
 * @returns {boolean} - True if ID matches a valid pattern
 */
export function isValidEntityId(id) {
  if (!id || typeof id !== 'string') return false;
  return VALID_ID_PATTERNS.some(pattern => pattern.test(id));
}

// ============================================================================
// Normalization
// ============================================================================

/**
 * Normalize a single entity ID
 * @param {string} entityId - Raw entity ID from OpenAI
 * @returns {string|null} - Canonical entity ID, or null if invalid
 */
export function normalizeEntityId(entityId) {
  if (!entityId || typeof entityId !== 'string') {
    return null;
  }

  // Trim whitespace and normalize to uppercase for ID pattern matching
  const trimmed = entityId.trim();
  const uppercased = trimmed.toUpperCase();

  // Step 1: Check alias mapping (case-insensitive)
  // First try direct lookup on original (for name-based aliases like "Donald Trump")
  if (ENTITY_ALIASES[trimmed]) {
    return ENTITY_ALIASES[trimmed];
  }

  // Then try uppercased (for ID-based aliases like "ORG-US")
  if (ENTITY_ALIASES[uppercased]) {
    return ENTITY_ALIASES[uppercased];
  }

  // Finally try case-insensitive full scan (for edge cases)
  const lowerKey = trimmed.toLowerCase();
  for (const [alias, canonical] of Object.entries(ENTITY_ALIASES)) {
    if (alias.toLowerCase() === lowerKey) {
      return canonical;
    }
  }

  // Step 2: Validate ID format (must be uppercase for pattern matching)
  // If ID doesn't match any valid pattern, reject it
  if (!isValidEntityId(uppercased)) {
    // Invalid format - return null to filter out
    return null;
  }

  // Return uppercased version (canonical form is always uppercase)
  return uppercased;
}

/**
 * Normalize an array of entity objects from OpenAI
 * Filters out entities with invalid IDs (null after normalization)
 * @param {Array<{id: string, name: string, type: string, confidence: number}>} entities
 * @returns {Array} - Entities with normalized IDs, invalid entities filtered out
 */
export function normalizeEntities(entities) {
  if (!Array.isArray(entities)) {
    return entities;
  }

  return entities
    .map(entity => ({
      ...entity,
      id: normalizeEntityId(entity.id)
    }))
    .filter(entity => entity.id !== null);
}

/**
 * Normalize a top_entities array (text[] from DB)
 * Filters out invalid IDs (null after normalization)
 * @param {string[]} topEntities - Array of entity IDs
 * @returns {string[]} - Normalized, filtered, and deduplicated array
 */
export function normalizeTopEntities(topEntities) {
  if (!Array.isArray(topEntities)) {
    return topEntities;
  }

  // Normalize each ID, filter nulls, then deduplicate
  return [...new Set(
    topEntities
      .map(id => normalizeEntityId(id))
      .filter(id => id !== null)
  )];
}

/**
 * Check if an entity ID needs normalization
 * @param {string} entityId - Entity ID to check
 * @returns {boolean} - True if ID would be changed by normalization
 */
export function needsNormalization(entityId) {
  return normalizeEntityId(entityId) !== entityId;
}

/**
 * Get all alias mappings (for debugging/audit)
 * @returns {Object} - The ENTITY_ALIASES map
 */
export function getAliasMappings() {
  return { ...ENTITY_ALIASES };
}

export default {
  normalizeEntityId,
  normalizeEntities,
  normalizeTopEntities,
  needsNormalization,
  getAliasMappings,
  isValidEntityId,
};
