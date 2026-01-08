#!/usr/bin/env node
/**
 * Entity Normalization Tests
 *
 * Table-driven tests for normalizeEntityId() and normalizeEntities()
 * Run BEFORE migration to ensure normalization logic is correct.
 *
 * Usage: node scripts/tests/entity-normalization.mjs
 */

import { normalizeEntityId, normalizeEntities, normalizeTopEntities, isValidEntityId } from '../lib/entity-normalization.js';

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

// ============================================================================
// Test Runner
// ============================================================================

let passed = 0;
let failed = 0;
const failures = [];

console.log('='.repeat(60));
console.log('Entity Normalization Tests');
console.log('='.repeat(60));
console.log('');

// Test normalizeEntityId
console.log('--- normalizeEntityId ---');
for (const { in: input, out: expected, desc } of testCases) {
  const actual = normalizeEntityId(input);
  if (actual === expected) {
    passed++;
    console.log(`  ✅ ${input} → ${expected} (${desc})`);
  } else {
    failed++;
    console.log(`  ❌ ${input} → expected ${expected}, got ${actual} (${desc})`);
    failures.push({ input, expected, actual, desc });
  }
}

console.log('');

// Test normalizeEntities
console.log('--- normalizeEntities ---');
{
  const input = [
    { id: 'US-JEFFERIES', name: 'Jeffries', type: 'PERSON', confidence: 0.9 },
    { id: 'US-TRUMP', name: 'Trump', type: 'PERSON', confidence: 0.95 },
    { id: 'US-FUNDING', name: 'Funding', type: 'PERSON', confidence: 0.8 },
  ];
  const result = normalizeEntities(input);

  if (result.length === 2 && result[0].id === 'US-JEFFRIES' && result[1].id === 'US-TRUMP') {
    passed++;
    console.log('  ✅ normalizes array and filters garbage');
  } else {
    failed++;
    console.log('  ❌ normalizes array and filters garbage');
    failures.push({ test: 'normalizeEntities array', expected: 'length 2, JEFFRIES, TRUMP', actual: JSON.stringify(result) });
  }
}

// Test normalizeTopEntities
console.log('');
console.log('--- normalizeTopEntities ---');
{
  const input = ['US-JEFFERIES', 'US-JEFFRIES', 'US-TRUMP', 'US-FUNDING'];
  const result = normalizeTopEntities(input);

  if (result.length === 2 && result.includes('US-JEFFRIES') && result.includes('US-TRUMP') && !result.includes('US-FUNDING')) {
    passed++;
    console.log('  ✅ normalizes, deduplicates, and filters');
  } else {
    failed++;
    console.log('  ❌ normalizes, deduplicates, and filters');
    failures.push({ test: 'normalizeTopEntities', expected: 'JEFFRIES, TRUMP only', actual: JSON.stringify(result) });
  }
}

// Test isValidEntityId
console.log('');
console.log('--- isValidEntityId ---');
const validIds = ['US-TRUMP', 'IL-NETANYAHU', 'ORG-DOJ', 'LOC-USA', 'EVT-JAN6'];
const invalidIds = ['INVALID', 'NOT-AN-ENTITY', '', null];

for (const id of validIds) {
  if (isValidEntityId(id)) {
    passed++;
    console.log(`  ✅ ${id} is valid`);
  } else {
    failed++;
    console.log(`  ❌ ${id} should be valid`);
    failures.push({ test: 'isValidEntityId', input: id, expected: true, actual: false });
  }
}

for (const id of invalidIds) {
  if (!isValidEntityId(id)) {
    passed++;
    console.log(`  ✅ ${id} is invalid`);
  } else {
    failed++;
    console.log(`  ❌ ${id} should be invalid`);
    failures.push({ test: 'isValidEntityId', input: id, expected: false, actual: true });
  }
}

// Summary
console.log('');
console.log('='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failures.length > 0) {
  console.log('');
  console.log('FAILURES:');
  for (const f of failures) {
    console.log(`  - ${JSON.stringify(f)}`);
  }
  process.exit(1);
} else {
  console.log('');
  console.log('✅ All tests passed! Safe to run migration.');
  process.exit(0);
}
