// ADO-581: toStr() must never throw on parser output. xml2js yields NULL-PROTOTYPE
// objects for attribute-only elements (<guid isPermaLink="false"></guid>), and
// String() on those throws "Cannot convert object to primitive value" - five
// Democracy Docket articles failed on the first TEST fetch (September 8, 2026).
import assert from 'node:assert/strict';
import { toStr, toBool, toStrArray } from '../rss/utils/primitive.js';

const attrOnly = Object.create(null);
attrOnly.$ = { isPermaLink: 'false' };

assert.equal(toStr(attrOnly), '');                                   // the bug
assert.equal(toStr({ $: { isPermaLink: 'false' } }), '');            // plain-proto variant
assert.equal(toStr({ _: 'text', $: { domain: 'x' } }), 'text');      // <category domain="x">text</category>
assert.equal(toStr({ '#': 'hash-text' }), 'hash-text');
assert.equal(toStr({ $: { href: 'https://a.test/' } }), 'https://a.test/');  // Atom <link href>
assert.equal(toStr({ $: { url: 'https://b.test/' } }), 'https://b.test/');
assert.equal(toStr(null), '');
assert.equal(toStr(undefined), '');
assert.equal(toStr('plain'), 'plain');
assert.equal(toStr(42), '42');
assert.equal(toStr(true), 'true');
assert.equal(toStr([]), '');                                         // arrays are objects too
assert.equal(toBool(attrOnly), false);
assert.deepEqual(toStrArray(['a', attrOnly, { _: 'c' }]), ['a', '', 'c']);

// safeGuid's contract downstream: an empty guid falls back to the link
assert.equal((toStr(attrOnly) || 'https://fallback.test/') , 'https://fallback.test/');

console.log('rss-primitive.test: all assertions passed');
