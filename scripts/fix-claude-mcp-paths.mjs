#!/usr/bin/env node
/**
 * Fix Claude Code MCP Path Mismatch on Windows
 *
 * Problem: Claude Code on Windows creates duplicate project entries in ~/.claude.json
 * with different path formats (backslash vs forward slash). MCP servers get stored
 * under one format but read from another, causing "No MCP servers configured".
 *
 * Solution: This script merges duplicate project entries by normalizing paths.
 *
 * Usage:
 *   node scripts/fix-claude-mcp-paths.mjs           # Fix and report
 *   node scripts/fix-claude-mcp-paths.mjs --check   # Check only, don't fix
 *   node scripts/fix-claude-mcp-paths.mjs --quiet   # Fix silently (for .bashrc)
 *
 * Add to .bashrc for automatic fixing:
 *   node /c/Users/Josh/OneDrive/Desktop/GitHub/TTracker/scripts/fix-claude-mcp-paths.mjs --quiet 2>/dev/null
 */

import fs from 'fs';
import path from 'path';

const CLAUDE_CONFIG = path.join(process.env.HOME || process.env.USERPROFILE, '.claude.json');
const CHECK_ONLY = process.argv.includes('--check');
const QUIET = process.argv.includes('--quiet');

function log(...args) {
  if (!QUIET) console.log(...args);
}

function normalizePath(p) {
  // Convert to forward slashes and lowercase drive letter for consistent comparison
  return p.replace(/\\/g, '/').replace(/^([A-Z]):/, (m, letter) => letter.toLowerCase() + ':');
}

function main() {
  if (!fs.existsSync(CLAUDE_CONFIG)) {
    log('No ~/.claude.json found');
    return;
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(CLAUDE_CONFIG, 'utf8'));
  } catch (e) {
    log('Error reading config:', e.message);
    return;
  }

  if (!config.projects) {
    log('No projects in config');
    return;
  }

  // Group projects by normalized path
  const groups = {};
  for (const [key, value] of Object.entries(config.projects)) {
    const normalized = normalizePath(key);
    if (!groups[normalized]) {
      groups[normalized] = [];
    }
    groups[normalized].push({ key, value });
  }

  // Find duplicates
  const duplicates = Object.entries(groups).filter(([, entries]) => entries.length > 1);

  if (duplicates.length === 0) {
    log('✓ No duplicate project entries found');
    return;
  }

  log(`Found ${duplicates.length} project(s) with duplicate entries:\n`);

  let fixesApplied = 0;
  for (const [normalized, entries] of duplicates) {
    log(`Project: ${normalized}`);

    // Find the "best" entry (most MCP servers, highest onboarding count)
    let best = entries[0];
    for (const entry of entries) {
      const bestServers = Object.keys(best.value.mcpServers || {}).length;
      const entryServers = Object.keys(entry.value.mcpServers || {}).length;
      const bestOnboarding = best.value.projectOnboardingSeenCount || 0;
      const entryOnboarding = entry.value.projectOnboardingSeenCount || 0;

      if (entryServers > bestServers ||
          (entryServers === bestServers && entryOnboarding > bestOnboarding)) {
        best = entry;
      }
    }

    log(`  Best source: ${best.key}`);
    log(`    - MCP servers: ${Object.keys(best.value.mcpServers || {}).length}`);
    log(`    - Onboarding count: ${best.value.projectOnboardingSeenCount || 0}`);

    // Merge MCP servers from best to all other entries
    for (const entry of entries) {
      if (entry.key !== best.key) {
        const beforeServers = Object.keys(entry.value.mcpServers || {}).length;
        const bestServers = best.value.mcpServers || {};

        // Merge (best wins on conflicts)
        entry.value.mcpServers = { ...entry.value.mcpServers, ...bestServers };

        const afterServers = Object.keys(entry.value.mcpServers).length;

        if (afterServers > beforeServers) {
          log(`  Copied to: ${entry.key}`);
          log(`    - MCP servers: ${beforeServers} → ${afterServers}`);
          fixesApplied++;
        }
      }
    }
    log('');
  }

  if (CHECK_ONLY) {
    log(`Would apply ${fixesApplied} fixes. Run without --check to apply.`);
    return;
  }

  if (fixesApplied > 0) {
    // Backup first
    const backupPath = CLAUDE_CONFIG + '.backup';
    fs.copyFileSync(CLAUDE_CONFIG, backupPath);

    // Write fixed config
    fs.writeFileSync(CLAUDE_CONFIG, JSON.stringify(config, null, 2));
    log(`✓ Applied ${fixesApplied} fixes`);
    log(`  Backup saved to: ${backupPath}`);
    log('\nRestart Claude Code to pick up the changes.');
  } else {
    log('✓ All entries already synchronized');
  }
}

main();
