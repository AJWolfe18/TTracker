#!/usr/bin/env node

/**
 * Filter merge-candidates.csv down to only pairs that are NOT already present
 * in merge-ground-truth.csv.
 *
 * - Treats (story1, story2) as an unordered pair.
 * - Assumes the first four CSV columns are:
 *   bucket,story1_id,story2_id,similarity,...
 *
 * Usage:
 *   node scripts/filter-new-merge-candidates.js \
 *     merge-ground-truth.csv \
 *     merge-candidates.csv \
 *     merge-candidates-to-label.csv
 */

import fs from 'node:fs';
import readline from 'node:readline';

function normalizeId(raw) {
  return String(raw || '')
    .replace(/"/g, '')
    .trim();
}

function pairKey(id1, id2) {
  // Use BigInt for stable numeric ordering, but fall back to string if needed
  try {
    const a = BigInt(id1);
    const b = BigInt(id2);
    return a <= b ? `${a}-${b}` : `${b}-${a}`;
  } catch {
    // If IDs ever stop being numeric, fall back to lexicographic ordering
    const a = String(id1);
    const b = String(id2);
    return a <= b ? `${a}-${b}` : `${b}-${a}`;
  }
}

async function loadExistingKeys(groundTruthPath) {
  const keys = new Set();

  const rl = readline.createInterface({
    input: fs.createReadStream(groundTruthPath),
    crlfDelay: Infinity,
  });

  let isHeader = true;

  for await (const line of rl) {
    if (!line.trim()) continue;
    if (isHeader) {
      isHeader = false;
      continue;
    }

    const cols = line.split(',');
    if (cols.length < 3) continue;

    const id1 = normalizeId(cols[1]);
    const id2 = normalizeId(cols[2]);
    if (!id1 || !id2) continue;

    keys.add(pairKey(id1, id2));
  }

  return keys;
}

async function filterCandidates(groundTruthPath, candidatesPath, outputPath) {
  const existingKeys = await loadExistingKeys(groundTruthPath);
  console.log(`Loaded ${existingKeys.size} existing pair keys from ${groundTruthPath}`);

  const rl = readline.createInterface({
    input: fs.createReadStream(candidatesPath),
    crlfDelay: Infinity,
  });

  const out = fs.createWriteStream(outputPath, { encoding: 'utf8' });

  let isHeader = true;
  let kept = 0;
  let skippedExisting = 0;
  let malformed = 0;

  for await (const line of rl) {
    if (isHeader) {
      out.write(line + '\n');
      isHeader = false;
      continue;
    }

    if (!line.trim()) continue;

    const cols = line.split(',');
    if (cols.length < 3) {
      malformed++;
      continue;
    }

    const id1 = normalizeId(cols[1]);
    const id2 = normalizeId(cols[2]);
    if (!id1 || !id2) {
      malformed++;
      continue;
    }

    const key = pairKey(id1, id2);

    if (existingKeys.has(key)) {
      skippedExisting++;
      continue;
    }

    out.write(line + '\n');
    kept++;
  }

  out.end();

  console.log('\nFilter complete:');
  console.log(`  Kept new candidates:     ${kept}`);
  console.log(`  Skipped existing pairs:  ${skippedExisting}`);
  if (malformed > 0) {
    console.log(`  Skipped malformed lines: ${malformed}`);
  }
  console.log(`  Output written to:       ${outputPath}`);
}

async function main() {
  const [,, gtPath, candPath, outPath] = process.argv;

  if (!gtPath || !candPath || !outPath) {
    console.error('Usage: node scripts/filter-new-merge-candidates.js <merge-ground-truth.csv> <merge-candidates.csv> <output.csv>');
    process.exit(1);
  }

  try {
    await filterCandidates(gtPath, candPath, outPath);
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

main();
