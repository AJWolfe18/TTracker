#!/usr/bin/env node
// ADO-571: render the share card locally with the same Satori tree the edge function uses.
//   node scripts/social/render-og-card.mjs default            -> public/og-default.png
//   node scripts/social/render-og-card.mjs sample <out.png>   -> a sample story card (visual check)
//   node scripts/social/render-og-card.mjs sample-long <out>  -> 32px long-headline variant
// Fonts are fetched from gstatic once and cached in the OS temp dir. $0, no DB access.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { Card, DefaultCard } from '../../netlify/edge-functions/_shared/og-card.mjs';
import { buildCardProps } from '../../netlify/edge-functions/_shared/og-card-props.mjs';

// Keep in sync with FONT_URLS in netlify/edge-functions/og-image.ts
const FONTS = [
  ['Newsreader', 500, 'normal', 'https://fonts.gstatic.com/s/newsreader/v26/cY9qfjOCX1hbuyalUrK49dLac06G1ZGsZBtoBCzBDXXD9JVF438wSo_ADA.ttf'],
  ['Newsreader', 600, 'normal', 'https://fonts.gstatic.com/s/newsreader/v26/cY9qfjOCX1hbuyalUrK49dLac06G1ZGsZBtoBCzBDXXD9JVF438wpojADA.ttf'],
  ['Newsreader', 500, 'italic', 'https://fonts.gstatic.com/s/newsreader/v26/cY9kfjOCX1hbuyalUrK439vogqC9yFZCYg7oRZaLP4obnf7fTXglsMwaT-ZA.ttf'],
  ['JetBrains Mono', 700, 'normal', 'https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8L6tjPQ.ttf'],
];

async function loadFonts() {
  const dir = join(tmpdir(), 'tt-og-fonts');
  mkdirSync(dir, { recursive: true });
  const out = [];
  for (const [name, weight, style, url] of FONTS) {
    const file = join(dir, url.split('/').pop());
    if (!existsSync(file)) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`font fetch ${r.status}: ${url}`);
      writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    }
    out.push({ name, weight, style, data: readFileSync(file) });
  }
  return out;
}

const SAMPLES = {
  sample: buildCardProps('detail', { id: 16879, primary_headline: 'Judges Fired After Blocking Deportations of Pro-Palestinian Students', alarm_level: 5, last_updated_at: '2026-04-12T15:28:04Z' }),
  'sample-long': buildCardProps('detail', { id: 16891, primary_headline: 'Trump news at a glance: president signals more mass pardons in pipeline; Vance leaves Pakistan after Iran peace talks break down', alarm_level: 4, last_updated_at: '2026-04-13T10:00:00Z' }),
  'sample-pardon': buildCardProps('pardons', { id: 412, recipient_name: 'Changpeng Zhao', corruption_level: 5, updated_at: '2026-01-05T00:00:00Z' }),
};

const [mode = 'default', outArg] = process.argv.slice(2);
const tree = mode === 'default' ? DefaultCard() : Card(SAMPLES[mode] ?? SAMPLES.sample);
const out = mode === 'default' ? 'public/og-default.png' : (outArg || `og-${mode}.png`);

const svg = await satori(tree, { width: 1200, height: 630, fonts: await loadFonts() });
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
