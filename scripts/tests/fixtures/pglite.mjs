// Shared helpers for the PGlite migration tests (scripts/tests/*-pglite.test.mjs): load PGlite, read
// a migration file, and a tiny named-test runner.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// Line endings normalised so tests can search the text whether git checked it out with CRLF or LF.
export const migration = (file) => fs.readFileSync(path.join(repo, 'migrations', file), 'utf8').replace(/\r\n/g, '\n');

/**
 * PGlite, or exit 0 with a SKIP line when it is not installed (it is not a declared dependency, so a
 * machine without it must not fail qa:smoke).
 */
export async function pgliteOrSkip(testName) {
  try {
    // Bare specifier: Node walks up parent folders, so a git worktree finds the main checkout's copy.
    return (await import('@electric-sql/pglite')).PGlite;
  } catch {
    process.stdout.write(`${testName}: SKIP (@electric-sql/pglite not installed)\n`);
    process.exit(0);
  }
}

/**
 * Named tests that print "ok"/"FAIL" as they go. The first failure throws, which stops the file.
 * @returns {{test: (name: string, fn: () => Promise<void>) => Promise<void>, passed: () => number}}
 */
export function testRunner(out) {
  let passed = 0;
  return {
    test: async (name, fn) => {
      try { await fn(); passed += 1; out(`  ok  ${name}`); }
      catch (e) { out(`  FAIL ${name}`); throw e; }
    },
    passed: () => passed,
  };
}
