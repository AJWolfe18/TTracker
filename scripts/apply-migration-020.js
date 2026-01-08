#!/usr/bin/env node
// One-off script to apply migration 020
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('📋 Migration 020: Story Reopen Support\n');
console.log('Please run the following SQL in your Supabase SQL Editor:\n');
console.log('Dashboard → SQL Editor → New Query\n');
console.log('═'.repeat(80));

const migrationPath = path.join(__dirname, '..', 'migrations', '020_story_reopen_support.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

console.log(sql);
console.log('═'.repeat(80));
console.log('\nOR copy/paste from: migrations/020_story_reopen_support.sql\n');
