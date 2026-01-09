// File: scripts/tests/timeout-retry.js
// Purpose: Verify fetch timeout + retry with jitter works; no hangs
// Usage: node scripts/tests/timeout-retry.js

// Self-contained helpers mirroring production utilities
export async function withRetry(fn, tries = 3, base = 200) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) { last = e; await new Promise(r => setTimeout(r, base * 2 ** i + Math.floor(Math.random() * 100))); }
  }
  throw last;
}

export async function fetchWithTimeout(url, opts = {}, ms = 1000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort('timeout'), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal, redirect: 'follow' }); }
  finally { clearTimeout(t); }
}

async function mainTimeoutRetry() {
  const start = Date.now();
  let attempts = 0;
  try {
    await withRetry(async () => {
      attempts++;
      // 10.255.255.1 is a TEST-NET non-routable address; connection should fail/timeout quickly
      const res = await fetchWithTimeout('http://10.255.255.1:81', {}, 500);
      if (!res.ok) throw new Error('non-200');
    }, 3, 100);
    console.error('[FAIL] Unexpected success');
    process.exit(1);
  } catch (e) {
    const ms = Date.now() - start;
    console.log(`[OK] Timed out/failed after ${attempts} attempts in ~${ms}ms:`, (e && e.message) || e);
  }
}

await mainTimeoutRetry();
