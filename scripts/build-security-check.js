#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__']);
const SKIP_FILES = new Set(['build-security-check.js']);
const SKIP_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.webm', '.zip', '.tar', '.gz']);
const SKIP_PATTERNS = [/\.test\./, /\.fixture\./, /\.spec\./, /^admin/];

const RULES_EVERYWHERE = [
  {
    name: 'Long JWT token (possible service role key)',
    pattern: /eyJ[A-Za-z0-9_-]{200,}/g,
    exclude: (line) => line.includes('ANON_KEY') || line.includes('anon'),
  },
  { name: 'GitHub PAT (ghp_)', pattern: /ghp_[A-Za-z0-9]{36}/g },
  { name: 'GitHub PAT (github_pat_)', pattern: /github_pat_[A-Za-z0-9_]{40,}/g },
  {
    name: 'Hardcoded secret assignment',
    pattern: /(?:OPENAI_API_KEY|PERPLEXITY_API_KEY|EDGE_CRON_TOKEN|SUPABASE_SERVICE_ROLE_KEY)\s*[=:]\s*["'][A-Za-z0-9_-]{10,}["']/g,
    exclude: (line) => line.includes('process.env') || line.includes('Deno.env') || line.includes('$env:'),
  },
];

const RULES_DIST_ONLY = [
  { name: 'service_role in build output', pattern: /service_role/gi },
  { name: 'SUPABASE_SERVICE in build output', pattern: /SUPABASE_SERVICE/g },
  { name: '.env file in build output', pattern: /\.env$/g },
];

let findings = 0;

async function scanFile(filePath, isDist) {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const rules = isDist ? [...RULES_EVERYWHERE, ...RULES_DIST_ONLY] : RULES_EVERYWHERE;
  for (let i = 0; i < lines.length; i++) {
    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(lines[i])) {
        if (rule.exclude && rule.exclude(lines[i])) continue;
        console.error(`SECURITY: ${rule.name}`);
        console.error(`  File: ${filePath}:${i + 1}`);
        console.error(`  Line: ${lines[i].trim().slice(0, 120)}`);
        console.error('');
        findings++;
      }
    }
  }
}

async function scanDir(dir, isDist) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await scanDir(fullPath, isDist);
    } else if (entry.isFile()) {
      if (SKIP_FILES.has(entry.name)) continue;
      if (SKIP_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
      if (SKIP_PATTERNS.some(p => p.test(entry.name))) continue;
      await scanFile(fullPath, isDist);
    }
  }
}

console.log('Scanning for secrets...');
await scanDir('dist', true);
await scanDir('public', false);
await scanDir('src', false);
await scanDir('scripts', false);

if (findings > 0) {
  console.error(`\nFOUND ${findings} potential secret(s). Build blocked.`);
  process.exit(1);
} else {
  console.log('No secrets found. Build is clean.');
}
