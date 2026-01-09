/**
 * Unit tests for primitive coercion helpers
 * Tests real-world RSS parser object shapes from Guardian, NYT, PBS feeds
 * 
 * Run: node scripts/test/test-primitive-coercion.js
 * 
 * Related: TTRC-268, TTRC-272
 */

import { toStr, toBool, toStrArray, safeJson } from '../rss/utils/primitive.js';

console.log('=== Testing Primitive Coercion Helpers ===\n');

// Test toStr() with various RSS parser shapes
console.log('Testing toStr()...');
const stringTests = [
  {
    name: 'Plain string (WaPo, Politico)',
    input: 'plain text',
    expected: 'plain text'
  },
  {
    name: 'RSS parser object with _ property (Guardian)',
    input: { _: 'Guardian text' },
    expected: 'Guardian text'
  },
  {
    name: 'Object with $ attributes (guid isPermaLink)',
    input: { _: 'https://example.com', $: { isPermaLink: 'true' } },
    expected: 'https://example.com'
  },
  {
    name: 'Link object with href',
    input: { $: { href: 'https://example.com' } },
    expected: 'https://example.com'
  },
  {
    name: 'Link object with url',
    input: { $: { url: 'https://example.com/article' } },
    expected: 'https://example.com/article'
  },
  {
    name: 'Object with # property (some parsers)',
    input: { '#': 'Content text' },
    expected: 'Content text'
  },
  {
    name: 'Null value',
    input: null,
    expected: ''
  },
  {
    name: 'Undefined value',
    input: undefined,
    expected: ''
  },
  {
    name: 'Number primitive',
    input: 42,
    expected: '42'
  },
  {
    name: 'Boolean primitive',
    input: true,
    expected: 'true'
  }
];

let passed = 0;
let failed = 0;

stringTests.forEach(({ name, input, expected }) => {
  const result = toStr(input);
  const pass = result === expected;
  
  if (pass) {
    console.log(`✅ ${name}`);
    passed++;
  } else {
    console.log(`❌ ${name}`);
    console.log(`   Expected: "${expected}"`);
    console.log(`   Got: "${result}"`);
    failed++;
  }
});

console.log('');

// Test toStrArray() with category arrays
console.log('Testing toStrArray()...');
const arrayTests = [
  {
    name: 'Array of plain strings',
    input: ['Politics', 'Congress', 'Trump'],
    expected: ['Politics', 'Congress', 'Trump']
  },
  {
    name: 'Array of RSS parser objects (Guardian categories)',
    input: [
      { _: 'Politics', $: { domain: 'topics' } },
      { _: 'Congress' },
      'Trump'
    ],
    expected: ['Politics', 'Congress', 'Trump']
  },
  {
    name: 'Empty array',
    input: [],
    expected: []
  },
  {
    name: 'Non-array (null)',
    input: null,
    expected: []
  },
  {
    name: 'Non-array (undefined)',
    input: undefined,
    expected: []
  }
];

arrayTests.forEach(({ name, input, expected }) => {
  const result = toStrArray(input);
  const pass = JSON.stringify(result) === JSON.stringify(expected);
  
  if (pass) {
    console.log(`✅ ${name}`);
    passed++;
  } else {
    console.log(`❌ ${name}`);
    console.log(`   Expected: ${JSON.stringify(expected)}`);
    console.log(`   Got: ${JSON.stringify(result)}`);
    failed++;
  }
});

console.log('');

// Test toBool() with various boolean representations
console.log('Testing toBool()...');
const boolTests = [
  {
    name: 'RSS object with "true"',
    input: { _: 'true', $: { isPermaLink: 'true' } },
    expected: true
  },
  {
    name: 'Plain string "true"',
    input: 'true',
    expected: true
  },
  {
    name: 'Plain string "false"',
    input: 'false',
    expected: false
  },
  {
    name: 'Numeric "1"',
    input: '1',
    expected: true
  },
  {
    name: 'Numeric "0"',
    input: '0',
    expected: false
  },
  {
    name: 'String "yes"',
    input: 'yes',
    expected: true
  },
  {
    name: 'String "no"',
    input: 'no',
    expected: false
  },
  {
    name: 'Null value',
    input: null,
    expected: false
  },
  {
    name: 'Undefined value',
    input: undefined,
    expected: false
  },
  {
    name: 'Empty string',
    input: '',
    expected: false
  },
  {
    name: 'Case insensitive "TRUE"',
    input: 'TRUE',
    expected: true
  }
];

boolTests.forEach(({ name, input, expected }) => {
  const result = toBool(input);
  const pass = result === expected;
  
  if (pass) {
    console.log(`✅ ${name}`);
    passed++;
  } else {
    console.log(`❌ ${name}`);
    console.log(`   Expected: ${expected}`);
    console.log(`   Got: ${result}`);
    failed++;
  }
});

console.log('');

// Test safeJson() with non-serializable types
console.log('Testing safeJson()...');
const jsonTests = [
  {
    name: 'Object with BigInt',
    input: { id: 123n, name: 'Test' },
    test: (result) => {
      const parsed = JSON.parse(result);
      return parsed.id === '123' && parsed.name === 'Test';
    }
  },
  {
    name: 'Nested object',
    input: { a: 1, b: { c: 2 } },
    test: (result) => {
      const parsed = JSON.parse(result);
      return parsed.a === 1 && parsed.b.c === 2;
    }
  }
];

jsonTests.forEach(({ name, input, test }) => {
  try {
    const result = safeJson(input);
    const pass = test(result);
    
    if (pass) {
      console.log(`✅ ${name}`);
      passed++;
    } else {
      console.log(`❌ ${name}`);
      console.log(`   Test failed for result: ${result}`);
      failed++;
    }
  } catch (err) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${err.message}`);
    failed++;
  }
});

console.log('\n=== Test Summary ===');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);

if (failed === 0) {
  console.log('\n🎉 All tests passed!');
  process.exit(0);
} else {
  console.log(`\n⚠️  ${failed} test(s) failed`);
  process.exit(1);
}
