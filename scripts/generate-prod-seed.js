#!/usr/bin/env node
/**
 * Generate PROD seed SQL from TEST pardons data
 * Filters out test records and AI-generated columns
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_FILE = process.argv[2] || path.join(
  os.homedir(),
  '.claude/projects/C--Users-Josh-OneDrive-Desktop-GitHub-TTracker/1e23f198-5d99-4be8-9fce-aa719af58869/tool-results/mcp-supabase-test-postgrestRequest-1768524251663.txt'
);

const OUTPUT_FILE = path.join(__dirname, 'prod-seed-pardons.sql');

// Read and parse
const raw = fs.readFileSync(INPUT_FILE, 'utf8');
const parsed = JSON.parse(raw);
const data = JSON.parse(parsed[0].text);

// Filter out test records and duplicates
const realPardons = data.filter(p =>
  !p.recipient_name.toLowerCase().includes('test') &&
  // Remove manual duplicates (keep DOJ-sourced versions)
  p.recipient_name !== 'January 6th Mass Pardon' &&
  p.recipient_name !== 'Ross Ulbricht'
);

console.log(`Total pardons in TEST: ${data.length}`);
console.log(`Real pardons (excluding test): ${realPardons.length}`);

// Escape single quotes for SQL
function esc(val, colName) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'number') return val.toString();
  if (Array.isArray(val)) {
    // source_urls is JSONB, not TEXT[]
    if (colName === 'source_urls') {
      if (val.length === 0) return "'[]'::jsonb";
      return "'" + JSON.stringify(val).replace(/'/g, "''") + "'::jsonb";
    }
    // Other arrays use TEXT[]
    if (val.length === 0) return "ARRAY[]::TEXT[]";
    return "ARRAY['" + val.map(v => String(v).replace(/'/g, "''")).join("','") + "']::TEXT[]";
  }
  return "'" + String(val).replace(/'/g, "''") + "'";
}

// Seed columns only (no AI-generated fields)
const cols = [
  'recipient_name', 'recipient_slug', 'nickname', 'photo_url', 'recipient_type',
  'recipient_count', 'recipient_criteria', 'pardon_date', 'clemency_type', 'status',
  'conviction_district', 'case_number', 'offense_raw', 'crime_description',
  'original_sentence', 'conviction_date', 'post_pardon_status', 'post_pardon_notes',
  'needs_review', 'primary_source_url', 'source_urls', 'source_system', 'source_key'
];

let sql = '-- Pardons Seed Data Export from TEST\n';
sql += '-- Generated: ' + new Date().toISOString() + '\n';
sql += '-- Records: ' + realPardons.length + '\n\n';
sql += '-- Note: This imports SEED data only. Run research + enrichment pipelines after.\n';
sql += '-- AI columns (corruption_level, trump_connection_detail, summary_spicy, etc.) will be NULL.\n\n';

// Generate INSERT statements
// ON CONFLICT uses composite key: (recipient_slug, clemency_type, pardon_date)
// This allows multiple clemency actions per person while preventing true duplicates
realPardons.forEach(p => {
  const values = cols.map(c => esc(p[c], c));
  sql += 'INSERT INTO pardons (' + cols.join(', ') + ')\n';
  sql += 'VALUES (' + values.join(', ') + ');\n\n';
});

// Write to file
fs.writeFileSync(OUTPUT_FILE, sql);
console.log(`\nGenerated: ${OUTPUT_FILE}`);
console.log(`Size: ${(sql.length / 1024).toFixed(1)} KB`);
