// ADO-572 AC 2: copy matches PRD section 5, first sentence, UTM link, no em dashes.
import assert from 'node:assert/strict';
import { buildCopy, firstSentence, stripDashes, postUrl, imageUrl, LABELS, UTM } from '../social/lib/copy.mjs';

// first sentence
assert.equal(firstSentence('They did it. Again — and worse.'), 'They did it.');
assert.equal(firstSentence('The U.S. Supreme Court punted. Again.'), 'The U.S. Supreme Court punted.');
assert.equal(firstSentence('Mr. Smith goes to Washington! Then leaves.'), 'Mr. Smith goes to Washington!');
assert.equal(firstSentence('No terminator here'), 'No terminator here');
assert.equal(firstSentence(''), '');
assert.equal(firstSentence('Money — lots of it — changed hands. Then silence.'), 'Money, lots of it, changed hands.');

// dashes
assert.equal(stripDashes('a — b'), 'a, b');
assert.equal(stripDashes('2024–2025'), '2024-2025');

// urls
assert.equal(postUrl('https://trumpytracker.com', 'pardon', 12), `https://trumpytracker.com/pardons/12?${UTM}`);
assert.equal(postUrl('https://trumpytracker.com', 'story', 16879), `https://trumpytracker.com/detail/16879?${UTM}`);
assert.equal(postUrl('https://trumpytracker.com', 'eo', 'eo_123_abc'), `https://trumpytracker.com/eos/eo_123_abc?${UTM}`);
assert.equal(imageUrl('https://trumpytracker.com', 'eo', 'eo_123_abc'), 'https://trumpytracker.com/api/og-image/eos/eo_123_abc.png');
assert.throws(() => postUrl('x', 'digest', 1), /unknown type/);

// template (PRD section 5)
const url = postUrl('https://trumpytracker.com', 'story', 1);
const c = buildCopy({ headline: 'H', spicy: 'One. Two.', alarm: 5, sources: 7, url });
assert.equal(c, `H\n\nOne.\n\nLEVEL 5 · CRISIS  |  7 sources\n${url}`);
assert.ok(c.includes('utm_source=facebook&utm_medium=social&utm_campaign=auto'));
assert.ok(!c.includes('—') && !c.includes('–'), 'no em/en dashes');

// singular source, no-source types, headline dashes, missing spicy
assert.ok(buildCopy({ headline: 'H', spicy: 'A.', alarm: 5, sources: 1, url }).includes('|  1 source\n'));
const eo = buildCopy({ headline: 'Order — the big one', spicy: 'Bad. Worse.', alarm: 5, sources: null, url });
assert.equal(eo, `Order, the big one\n\nBad.\n\nLEVEL 5 · CRISIS\n${url}`);
assert.equal(buildCopy({ headline: 'H', spicy: '', alarm: 4, url }), `H\n\nLEVEL 4 · SEVERE\n${url}`);
// out-of-range alarm falls back to NOTABLE like og-tags
assert.ok(buildCopy({ headline: 'H', spicy: 'x.', alarm: 9, url }).includes('LEVEL 2 · NOTABLE'));

// labels mirror og-card-props
assert.deepEqual(LABELS, { 5: 'CRISIS', 4: 'SEVERE', 3: 'SERIOUS', 2: 'NOTABLE', 1: 'WATCH', 0: 'WIN' });

console.log('social-copy: ok');
