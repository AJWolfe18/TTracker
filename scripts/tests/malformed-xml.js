// File: scripts/tests/malformed-xml.js
// Purpose: Ensure malformed RSS/Atom does not crash parsing path
// Usage: node scripts/tests/malformed-xml.js

import Parser from 'rss-parser';

async function main() {
  const parser = new Parser();
  const bad = '<rss><channel><item></rss'; // intentionally malformed
  let threw = false;
  try {
    await parser.parseString(bad);
  } catch (e) {
    threw = true;
    console.log('[OK] Malformed XML threw as expected:', e.message.split('\n')[0]);
  }
  if (!threw) {
    console.error('[FAIL] Malformed XML did not throw');
    process.exit(1);
  }
}

main();
