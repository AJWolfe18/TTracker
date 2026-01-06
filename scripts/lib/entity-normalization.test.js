/**
 * Entity Normalization Tests
 *
 * Table-driven tests for normalizeEntityId() and normalizeEntities()
 * Run BEFORE migration to ensure normalization logic is correct.
 *
 * Usage: npm test -- --testPathPattern=entity-normalization
 */

import { normalizeEntityId, normalizeEntities, normalizeTopEntities, isValidEntityId } from './entity-normalization.js';

// ============================================================================
// Test Cases for normalizeEntityId
// ============================================================================

const testCases = [
  // === SPELLING VARIANTS ===
  { in: 'US-JEFFERIES', out: 'US-JEFFRIES', desc: 'spelling variant Jefferies → Jeffries' },

  // === INTERNATIONAL FIGURES (country code prefix) ===
  { in: 'US-NETANYAHU', out: 'IL-NETANYAHU', desc: 'Netanyahu uses IL- prefix' },
  { in: 'US-PUTIN', out: 'RU-PUTIN', desc: 'Putin uses RU- prefix' },
  { in: 'US-MBS', out: 'SA-MBS', desc: 'MBS uses SA- prefix' },
  { in: 'US-BIN-SALMAN', out: 'SA-MBS', desc: 'bin Salman → SA-MBS' },
  { in: 'US-ZELENSKY', out: 'UA-ZELENSKY', desc: 'Zelensky uses UA- prefix' },
  { in: 'US-ZELENSKYY', out: 'UA-ZELENSKY', desc: 'Zelenskyy variant → UA-ZELENSKY' },
  { in: 'GB-STARMER', out: 'UK-STARMER', desc: 'ISO GB- → canonical UK-' },
  { in: 'US-STARMER', out: 'UK-STARMER', desc: 'Starmer uses UK- prefix' },

  // === STATES AS PEOPLE → LOC ===
  { in: 'US-TEXAS', out: 'LOC-TEXAS', desc: 'state as person → LOC-' },
  { in: 'US-UTAH', out: 'LOC-UTAH', desc: 'state as person → LOC-' },
  { in: 'US-VIRGINIA', out: 'LOC-VIRGINIA', desc: 'state as person → LOC-' },

  // === PARTY CONSOLIDATION ===
  { in: 'ORG-DEMOCRATS', out: 'ORG-DEM', desc: 'Democrats → ORG-DEM' },
  { in: 'ORG-DEMS', out: 'ORG-DEM', desc: 'Dems → ORG-DEM' },
  { in: 'ORG-REPUBLICANS', out: 'ORG-GOP', desc: 'Republicans → ORG-GOP' },
  { in: 'ORG-REPUBLICAN', out: 'ORG-GOP', desc: 'Republican → ORG-GOP' },

  // === MEDIA CONSOLIDATION ===
  { in: 'ORG-WASHINGTON-POST', out: 'ORG-WAPO', desc: 'Washington Post → WAPO' },
  { in: 'ORG-WP', out: 'ORG-WAPO', desc: 'WP → WAPO' },
  { in: 'ORG-FOX-NEWS', out: 'ORG-FOX', desc: 'Fox News → FOX' },

  // === EVENT CONSOLIDATION ===
  { in: 'EVT-SHUTDOWN', out: 'EVT-GOVERNMENT-SHUTDOWN', desc: 'shutdown → government-shutdown' },
  { in: 'EVT-EPSTEIN', out: 'EVT-EPSTEIN-FILES', desc: 'Epstein → Epstein-Files' },
  { in: 'EVT-EPSTEIN-SCANDAL', out: 'EVT-EPSTEIN-FILES', desc: 'Epstein-Scandal → Epstein-Files' },

  // === WRONG TYPE PREFIX FIXES ===
  { in: 'LOC-WHITE-HOUSE', out: 'ORG-WHITE-HOUSE', desc: 'White House is ORG not LOC' },
  { in: 'ORG-ISRAEL', out: 'LOC-ISRAEL', desc: 'Israel is LOC not ORG' },
  { in: 'US-SAUDI-ARABIA', out: 'LOC-SAUDI-ARABIA', desc: 'Saudi Arabia is LOC' },

  // === BAD_IDS → null ===
  { in: 'US-FUNDING', out: null, desc: 'garbage entity filtered' },
  { in: 'ORG-GOVERNMENT', out: null, desc: 'too generic filtered' },
  { in: 'US-MAYOR', out: null, desc: 'generic title filtered' },
  { in: 'US-PRESIDENT', out: null, desc: 'generic title filtered' },
  { in: 'LOC-MEDICARE', out: null, desc: 'program as location filtered' },
  { in: 'ORG-BIDEN', out: null, desc: 'person as org filtered' },
  { in: 'ORG-COURT', out: null, desc: 'too generic filtered' },
  { in: 'US-CITIZENS', out: null, desc: 'semantic garbage filtered' },

  // === VALID IDs PASS THROUGH ===
  { in: 'US-TRUMP', out: 'US-TRUMP', desc: 'valid person passes through' },
  { in: 'US-BIDEN', out: 'US-BIDEN', desc: 'valid person passes through' },
  { in: 'ORG-DOJ', out: 'ORG-DOJ', desc: 'valid org passes through' },
  { in: 'ORG-FBI', out: 'ORG-FBI', desc: 'valid org passes through' },
  { in: 'LOC-TEXAS', out: 'LOC-TEXAS', desc: 'valid location passes through' },
  { in: 'LOC-USA', out: 'LOC-USA', desc: 'valid location passes through' },
  { in: 'EVT-JAN6', out: 'EVT-JAN6', desc: 'valid event passes through' },
  { in: 'IL-NETANYAHU', out: 'IL-NETANYAHU', desc: 'international person passes through' },
  { in: 'RU-PUTIN', out: 'RU-PUTIN', desc: 'international person passes through' },
  { in: 'SA-MBS', out: 'SA-MBS', desc: 'international person passes through' },

  // === NAME-BASED ALIASES ===
  { in: 'Donald Trump', out: 'US-TRUMP', desc: 'name to ID alias' },
  { in: 'Trump', out: 'US-TRUMP', desc: 'short name to ID alias' },
  { in: 'Joe Biden', out: 'US-BIDEN', desc: 'name to ID alias' },
  { in: 'Department of Justice', out: 'ORG-DOJ', desc: 'org name to ID alias' },
  { in: 'Mohammed bin Salman', out: 'SA-MBS', desc: 'MBS name to ID' },

  // === EDGE CASES ===
  { in: null, out: null, desc: 'null input returns null' },
  { in: '', out: null, desc: 'empty string returns null' },
  { in: '  ', out: null, desc: 'whitespace returns null' },
  { in: 'us-trump', out: 'US-TRUMP', desc: 'lowercase normalized to uppercase' },
  { in: 'INVALID-FORMAT', out: null, desc: 'invalid format rejected' },
  { in: 'NOT-AN-ENTITY', out: null, desc: 'unknown format rejected' },
];

describe('normalizeEntityId', () => {
  test.each(testCases)('$in → $out ($desc)', ({ in: input, out: expected }) => {
    expect(normalizeEntityId(input)).toBe(expected);
  });
});

// ============================================================================
// Test Cases for normalizeEntities (array of entity objects)
// ============================================================================

describe('normalizeEntities', () => {
  test('normalizes array of entity objects', () => {
    const input = [
      { id: 'US-JEFFERIES', name: 'Jeffries', type: 'PERSON', confidence: 0.9 },
      { id: 'US-TRUMP', name: 'Trump', type: 'PERSON', confidence: 0.95 },
      { id: 'US-FUNDING', name: 'Funding', type: 'PERSON', confidence: 0.8 },
    ];

    const result = normalizeEntities(input);

    expect(result).toHaveLength(2); // US-FUNDING filtered out
    expect(result[0].id).toBe('US-JEFFRIES');
    expect(result[1].id).toBe('US-TRUMP');
  });

  test('handles empty array', () => {
    expect(normalizeEntities([])).toEqual([]);
  });

  test('handles non-array input', () => {
    expect(normalizeEntities(null)).toBe(null);
    expect(normalizeEntities(undefined)).toBe(undefined);
  });
});

// ============================================================================
// Test Cases for normalizeTopEntities (string array from DB)
// ============================================================================

describe('normalizeTopEntities', () => {
  test('normalizes and deduplicates entity IDs', () => {
    const input = ['US-JEFFERIES', 'US-JEFFRIES', 'US-TRUMP', 'US-FUNDING'];

    const result = normalizeTopEntities(input);

    // US-JEFFERIES → US-JEFFRIES (deduped with existing)
    // US-FUNDING → null (filtered)
    expect(result).toContain('US-JEFFRIES');
    expect(result).toContain('US-TRUMP');
    expect(result).not.toContain('US-FUNDING');
    expect(result).toHaveLength(2);
  });

  test('handles empty array', () => {
    expect(normalizeTopEntities([])).toEqual([]);
  });

  test('handles non-array input', () => {
    expect(normalizeTopEntities(null)).toBe(null);
  });
});

// ============================================================================
// Test Cases for isValidEntityId (format validation)
// ============================================================================

describe('isValidEntityId', () => {
  test('accepts valid person IDs', () => {
    expect(isValidEntityId('US-TRUMP')).toBe(true);
    expect(isValidEntityId('US-BIDEN')).toBe(true);
    expect(isValidEntityId('IL-NETANYAHU')).toBe(true);
    expect(isValidEntityId('RU-PUTIN')).toBe(true);
  });

  test('accepts valid org IDs', () => {
    expect(isValidEntityId('ORG-DOJ')).toBe(true);
    expect(isValidEntityId('ORG-FBI')).toBe(true);
    expect(isValidEntityId('ORG-WHITE-HOUSE')).toBe(true);
  });

  test('accepts valid location IDs', () => {
    expect(isValidEntityId('LOC-USA')).toBe(true);
    expect(isValidEntityId('LOC-TEXAS')).toBe(true);
    expect(isValidEntityId('LOC-NEW-YORK')).toBe(true);
  });

  test('accepts valid event IDs', () => {
    expect(isValidEntityId('EVT-JAN6')).toBe(true);
    expect(isValidEntityId('EVT-GOVERNMENT-SHUTDOWN')).toBe(true);
  });

  test('rejects invalid formats', () => {
    expect(isValidEntityId('INVALID')).toBe(false);
    expect(isValidEntityId('NOT-AN-ENTITY')).toBe(false);
    expect(isValidEntityId('')).toBe(false);
    expect(isValidEntityId(null)).toBe(false);
  });
});
