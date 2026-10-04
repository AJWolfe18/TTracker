// Phone first-visit load test (ADO-605). Usage: PROFILE=fast|4g|slow-4g [URL_=https://...] [SHOTS=dir] node scripts/perf/phone-load.mjs
// Read-only; analytics requests are blocked so test loads are never counted as visitors.
import { chromium, devices } from 'playwright';

const PROFILES = {
  fast: null,
  '4g': { latency: 150, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8, cpu: 4 },
  'slow-4g': { latency: 300, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, cpu: 4 },
};
const profile = process.env.PROFILE || '4g';
const url = process.env.URL_ || 'https://trumpytracker.com/';
const shotDir = process.env.SHOTS;
// A mistyped profile must fail, not silently run unthrottled under a throttled-looking label.
if (!Object.hasOwn(PROFILES, profile)) {
  process.stderr.write(`Unknown PROFILE "${profile}". Use one of: ${Object.keys(PROFILES).join(', ')}\n`);
  process.exit(1);
}

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ ...devices['Galaxy S9+'] });
// Never count as a visitor: block analytics.
await ctx.route(/posthog|googletagmanager|google-analytics|analytics-gate/, (r) => r.abort());
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const p = PROFILES[profile];
if (p) {
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: p.latency, downloadThroughput: p.downloadThroughput, uploadThroughput: p.uploadThroughput });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu });
}

const t0 = Date.now();
const reqs = [];
page.on('requestfinished', async (req) => {
  const u = req.url();
  if (!/supabase\.co|trumpytracker\.com|fonts\./.test(u)) return;
  const tm = req.timing();
  // responseEnd is -1 for cached / memory-served responses: report those as zero-length, never negative.
  const end = tm.responseEnd >= 0 ? tm.startTime + tm.responseEnd : tm.startTime;
  reqs.push({ name: u.replace(/^https:\/\/[^/]+/, '').split('?')[0].slice(0, 50), host: new URL(u).host.split('.')[0], start: tm.startTime - t0, end: end - t0 });
});

await page.goto(url, { waitUntil: 'commit' });
const marks = {};
// First text paint of any kind, then the first real Tracker entry (a link to a story/case/EO/pardon).
await page.waitForFunction(() => document.body && document.body.innerText.trim().length > 20, null, { timeout: 60000 });
marks.firstText = Date.now() - t0;
await page.waitForSelector('a[href*="/detail/"], a[href*="/scotus/"], a[href*="/eos/"], a[href*="/pardons/"]', { timeout: 60000 });
marks.firstEntry = Date.now() - t0;
if (shotDir) await page.screenshot({ path: `${shotDir}/phone-${profile}.png` });
await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
marks.networkIdle = Date.now() - t0;
const nav = await page.evaluate(() => {
  const n = performance.getEntriesByType('navigation')[0];
  const fcp = performance.getEntriesByName('first-contentful-paint')[0];
  return { ttfb: Math.round(n.responseStart), domContentLoaded: Math.round(n.domContentLoadedEventEnd), fcp: fcp ? Math.round(fcp.startTime) : null };
});
process.stdout.write(`PROFILE ${profile}: first paint ${nav.fcp} ms | first text ${marks.firstText} ms | first Tracker entry ${marks.firstEntry} ms | everything done ${marks.networkIdle} ms\n`);
for (const r of reqs.sort((a, b) => a.start - b.start)) {
  process.stdout.write(`  ${String(Math.round(r.start)).padStart(5)} -> ${String(Math.round(r.end)).padStart(5)} ms  ${r.host.padEnd(20)} ${r.name}\n`);
}
await browser.close();
