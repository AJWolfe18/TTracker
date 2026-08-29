// ADO-571: the "receipt" share card as a Satori element tree (no JSX so Node can load it).
// Reference markup: docs/features/growth/receipt-card-reference.md. Satori rules: every parent with
// >1 child is display:flex; no text-wrap; rotate + box-shadow are supported.

// Satori rejects an empty children array on a div, so leaf nodes get no children key at all.
const h = (type, style, ...children) => ({ type, props: children.length === 0 ? { style } : { style, children: children.length === 1 ? children[0] : children } });

const SERIF = 'Newsreader';
const MONO = 'JetBrains Mono';
const INK = '#1a1a1a';
const PAPER = '#f3efe6';
const RULE = '#b9b2a4';
const RED = '#c94a3e';
const BLACK = '#0a0a0b';
const WHITE = '#f5f5f4';
const GREY = '#a3a3a3';

export const TAGLINE = 'Keeping receipts on every scandal, pardon, and power grab.';

const dashed = () => h('div', { borderTop: `2px dashed ${RULE}`, width: '100%' });
const row = (extra = {}) => ({ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, ...extra });

function wordmark(size) {
  return h('div', { display: 'flex', flexDirection: 'column', fontFamily: SERIF, fontWeight: 600, fontSize: size, lineHeight: 1, color: WHITE, letterSpacing: '-0.02em' },
    h('span', {}, 'TRUMPY'),
    h('div', { display: 'flex' }, h('span', { color: RED }, '/'), h('span', {}, 'TRACKER')),
  );
}

function brandColumn({ width, wordmarkSize, taglineSize, domainSize }) {
  return h('div', { display: 'flex', flexDirection: 'column', gap: 28, width },
    wordmark(wordmarkSize),
    h('div', { fontFamily: SERIF, fontStyle: 'italic', fontSize: taglineSize, lineHeight: 1.3, color: GREY }, TAGLINE),
    h('div', { fontFamily: MONO, fontSize: domainSize, color: WHITE, letterSpacing: '0.1em', textTransform: 'uppercase' }, 'trumpytracker.com'),
  );
}

export function Card(p) {
  const lineHeight = 1.08;
  return h('div', { width: 1200, height: 630, background: BLACK, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '0 64px', overflow: 'hidden' },
    brandColumn({ width: 380, wordmarkSize: 40, taglineSize: 26, domainSize: 18 }),
    h('div', { width: 640, background: PAPER, color: INK, padding: '40px 44px', display: 'flex', flexDirection: 'column', gap: 22, boxShadow: '0 30px 60px rgba(0,0,0,0.6)', transform: 'rotate(-1.2deg)' },
      h('div', row({ fontSize: 16, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#4a4e56' }),
        h('span', {}, `Receipt No. ${p.receiptNo}`),
        h('span', {}, p.dateText),
      ),
      dashed(),
      // clamp to 4 lines: Satori has no line-clamp, so cap the box height and hide overflow
      h('div', { display: 'flex', fontFamily: SERIF, fontWeight: 500, fontSize: p.headlineSize, lineHeight, letterSpacing: '-0.02em', maxHeight: Math.round(p.headlineSize * lineHeight * 4), overflow: 'hidden' }, p.headline),
      dashed(),
      h('div', { display: 'flex', flexDirection: 'column', gap: 10, fontFamily: MONO, fontSize: 17, letterSpacing: '0.06em', textTransform: 'uppercase', color: INK },
        h('div', row(), h('span', {}, 'Filed under'), h('span', {}, p.typeLabel)),
        h('div', row({ alignItems: 'center' }),
          h('span', { fontWeight: 700 }, 'Alarm level'),
          h('span', { background: RED, color: WHITE, padding: '6px 12px', fontWeight: 700 }, p.badge),
        ),
      ),
    ),
  );
}

// og-default.png (Task 3): black card, brand column only, centered.
export function DefaultCard() {
  return h('div', { width: 1200, height: 630, background: BLACK, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    brandColumn({ width: 720, wordmarkSize: 72, taglineSize: 36, domainSize: 22 }),
  );
}
