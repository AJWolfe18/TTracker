# SCOTUS Scout - Code Review Findings

**Date:** 2026-03-21
**Reviewed:** scotus-scout.js, perplexity-client.js, scout-prompt.js, scout-parser.js, scout-validator.js

---

## Finding #1: Missing Historical Justice Names

**File:** `scout-parser.js` lines 56-87
**Severity:** LOW — Not needed
**Decision:** SKIP

The justice name map only covers current (2024+) justices. Historical names like Ginsburg, Breyer, Kennedy, Scalia won't normalize.

**Why skip:** We're only fetching new/recent SCOTUS cases. The `fetch-cases.js` script uses `--since=2024-01-01` and all current justices are mapped. If we ever backfill historical cases, we'd add names then.

**If needed later:** Add entries to the `JUSTICE_NAME_MAP` in `scout-parser.js`:
```js
'ginsburg': 'Ginsburg',
'ruth bader ginsburg': 'Ginsburg',
'breyer': 'Breyer',
'kennedy': 'Kennedy',
'scalia': 'Scalia',
```

---

## Finding #2: Mixed Dispositions Fall Through as Invalid

**File:** `scout-parser.js` lines 12-37
**Severity:** HIGH — Common SCOTUS outcomes get marked `uncertain`

**The problem:** SCOTUS frequently issues mixed dispositions like "affirmed in part, reversed in part" or "affirmed in part, vacated in part." The `DISPOSITION_ALIASES` map has no entry for these, so the raw string passes through verbatim. The validator then sees it's not in `VALID_DISPOSITIONS` and downgrades the case to `uncertain`.

**What "affirmed in part" means:** The court agreed with some parts of the lower court's ruling but disagreed with others. It's one of the most common SCOTUS outcomes for complex cases.

**Fix:** Add compound disposition aliases that map to the *primary* action, and capture the detail in `formal_disposition_detail`:

```js
// Add to DISPOSITION_ALIASES:
'affirmed in part': 'affirmed',
'affirmed in part, reversed in part': 'reversed',
'affirmed in part, vacated in part': 'vacated',
'reversed in part': 'reversed',
'reversed in part, affirmed in part': 'reversed',
'vacated in part': 'vacated',
'vacated in part, affirmed in part': 'vacated',
'affirmed in part and reversed in part': 'reversed',
'affirmed in part and vacated in part': 'vacated',
```

Also update `normalizeScoutOutput` to auto-populate `formal_disposition_detail` when the raw disposition is a compound:
```js
// After line 139:
if (rawDisp !== out.formal_disposition && rawDisp.includes(' in part')) {
  out.formal_disposition_detail = raw.formal_disposition; // preserve original text
}
```

**Impact:** Prevents unnecessary `uncertain` downgrades on common cases. Major data quality improvement.

---

## Finding #3: `--only-if-better` Flag Parsed But Never Used

**File:** `scotus-scout.js` line 93
**Severity:** LOW — Dead code

**Confirmed:** The flag `onlyIfBetter` is parsed at line 93 but never referenced anywhere else in the file. Grep confirms zero other uses.

**Fix:** Remove the line:
```diff
- onlyIfBetter: args.includes('--only-if-better'),
```

Also remove from any `--help` text if it's mentioned there.

**Impact:** Prevents user confusion. No functional change.

---

## Finding #4: Rate Limit Retry Cap Below Server's `retry-after`

**File:** `perplexity-client.js` lines 98-100
**Severity:** MEDIUM — Wastes retries on 429s

**The problem:** When Perplexity returns `retry-after: 30` (seconds), the code computes `baseDelay = 30000ms` but then caps it at `maxRetryDelayMs = 15000ms`. So we retry at 15s instead of 30s, get 429'd again, waste a retry attempt.

**Fix:** The `retry-after` header should override the max cap, since the server is telling us exactly when to retry:

```js
// Current (line 100):
const delay = Math.min(baseDelay, this.maxRetryDelayMs);

// Fixed:
const delay = retryAfterSec
  ? baseDelay  // Trust the server's retry-after value
  : Math.min(baseDelay, this.maxRetryDelayMs);  // Cap only our own backoff
```

**Impact:** Fewer wasted retries, more reliable rate limit handling.

---

## Finding #5: Fragile Markdown Code Block Stripping

**File:** `scout-parser.js` lines 112-114
**Severity:** MEDIUM — Perplexity sometimes adds preamble text

**The problem:** The regex `^```json?\n?` only matches if the code block starts at position 0. If Perplexity returns `"Here is the data:\n```json\n{...}\n```"`, the stripping fails and JSON parse throws.

**Fix:** Instead of stripping backticks, extract the first JSON object directly:

```js
// Replace the current markdown stripping with:
function extractJson(text) {
  // Try raw parse first
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return trimmed;

  // Extract from code block
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  // Find first { to last } as fallback
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed; // Let JSON.parse fail with useful error
}
```

**Impact:** More resilient parsing. Handles common Perplexity response variations.

---

## Finding #6: No Retry on 502/503 Transient Errors

**File:** `perplexity-client.js` lines 96-111
**Severity:** MEDIUM — Reduces reliability

**The problem:** Only 429 errors get retry logic. Perplexity (like all API services) occasionally returns 502/503 for transient issues. These immediately throw and fail the case.

**Fix:** Expand the retry condition to include transient server errors:

```js
// Current (line 97):
if (response.status === 429 && retryCount < this.maxRetries) {

// Fixed:
const retryableStatuses = [429, 502, 503];
if (retryableStatuses.includes(response.status) && retryCount < this.maxRetries) {
```

For non-429 errors, don't look at `retry-after` header (it won't exist), just use exponential backoff:

```js
const retryAfterSec = response.status === 429
  ? parseInt(response.headers.get('retry-after') || '0', 10)
  : 0;
```

**Impact:** Better reliability with transient API errors. No cost increase.

---

## Finding #7: Vote Split Normalization Too Strict

**File:** `scout-parser.js` lines 181-191
**Severity:** MEDIUM — Common Perplexity response patterns fail

**The problem:** `normalizeVoteSplit` uses `^(\d+)\s*[-–—]\s*(\d+)$` which requires the *entire* string to be `N-N`. Perplexity often returns strings like `"6-3 (per curiam)"`, `"5-4, with concurrences"`, or `"6-3 (with dissent by Thomas)"`. These all return `null`.

**Fix:** Remove the `$` end anchor and trim before matching:

```js
function normalizeVoteSplit(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  // Extract leading N-N pattern, ignore trailing text
  const match = str.match(/^(\d+)\s*[-–—]\s*(\d+)/);
  if (match) return `${match[1]}-${match[2]}`;
  const altMatch = str.match(/^(\d+)\s*(?:to|:)\s*(\d+)/i);
  if (altMatch) return `${altMatch[1]}-${altMatch[2]}`;
  return null;
}
```

**Impact:** Catches common Perplexity response patterns. Prevents `null` vote splits on valid data.

---

## Finding #8: `--write-fields` Typos Silently Write Only Metadata

**File:** `scotus-scout.js` lines 107-108
**Severity:** LOW-MEDIUM — Misleading success output

**The problem:** `--write-fields=disopsition` (typo) silently excludes all intended fields. The DB update still runs (writing only metadata like confidence and prompt_version), and `stats.written` increments, giving a false impression of success.

**Fix:** Validate `--write-fields` values against known field names at startup:

```js
const VALID_WRITE_FIELDS = [
  'formal_disposition', 'opinion_type', 'vote_split', 'majority_author',
  'dissent_authors', 'substantive_winner', 'practical_effect', 'holding',
  'issue_area', 'case_citation', 'fact_confidence', 'source_tiers_used',
  'source_urls'
];

if (opts.writeFields) {
  const invalid = opts.writeFields.filter(f => !VALID_WRITE_FIELDS.includes(f));
  if (invalid.length > 0) {
    console.error(`❌ Unknown --write-fields: ${invalid.join(', ')}`);
    console.error(`   Valid fields: ${VALID_WRITE_FIELDS.join(', ')}`);
    process.exit(1);
  }
}
```

**Impact:** Fast-fail on typos instead of silent partial writes.

---

## Finding #9: `--ids=abc` Silently Returns 0 Cases

**File:** `scotus-scout.js` line 102
**Severity:** LOW

**The problem:** Non-numeric IDs get filtered out by `!isNaN(n)`, resulting in an empty array. The empty array is truthy, so the query runs `WHERE id IN ()` and returns zero rows. No error shown.

**Fix:** Warn when all IDs are filtered out:

```js
if (opts.ids && opts.ids.length === 0) {
  console.error('❌ --ids provided but no valid numeric IDs found');
  process.exit(1);
}
```

---

## Finding #10: `source_urls` Null Guard Missing in Validator

**File:** `scout-validator.js` line 140
**Severity:** LOW — Defensive fix

**The problem:** Line 140 does `scout.source_urls.length === 0` without a null guard. Line 136 correctly uses `scout.source_urls || []` but line 140 doesn't.

**Fix:**
```js
// Line 140, change:
if (scout.source_urls.length === 0) {
// To:
if (!scout.source_urls || scout.source_urls.length === 0) {
```

---

## Finding #11: Blocking Issue Classification via Fragile String Matching

**File:** `scout-validator.js` lines 148-158
**Severity:** LOW — Works today but brittle

**The problem:** Whether an issue is "blocking" (triggers `uncertain` status) is determined by `.startsWith()` / `.includes()` checks on the issue message strings. If anyone changes an issue message, the blocking behavior silently changes.

**Fix (future):** Use structured issue objects instead of strings:

```js
// Instead of: issues.push('Missing required field: vote_split')
// Use:        issues.push({ msg: 'Missing required field: vote_split', blocking: true })
```

Then check `issues.some(i => i.blocking)` instead of string matching. This is a larger refactor — defer unless we're already touching the validator.

---

## Priority for Fixes

| # | Finding | Severity | Effort | Recommended |
|---|---------|----------|--------|-------------|
| 2 | Mixed dispositions | HIGH | Small | **Fix now** |
| 5 | Fragile markdown stripping | MEDIUM | Small | **Fix now** |
| 7 | Vote split too strict | MEDIUM | Tiny | **Fix now** |
| 4 | Retry-after cap | MEDIUM | Tiny | **Fix now** |
| 6 | No retry on 502/503 | MEDIUM | Tiny | **Fix now** |
| 8 | --write-fields validation | LOW-MED | Small | **Fix now** |
| 3 | Dead --only-if-better flag | LOW | Tiny | **Fix now** |
| 9 | --ids validation | LOW | Tiny | Fix now |
| 10 | source_urls null guard | LOW | Tiny | Fix now |
| 1 | Historical justices | LOW | N/A | Skip (not needed) |
| 11 | Structured issues | LOW | Medium | Defer |
