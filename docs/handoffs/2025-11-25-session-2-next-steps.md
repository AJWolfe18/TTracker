# Next Steps - Pick Up Here

**Date:** 2025-11-25
**Context:** Session ran out near end of TTRC-119 + investigation

---

## COMPLETED This Session

- [x] TTRC-119: EO prompt updated with PERSPECTIVE + BANNED OPENINGS
- [x] AI code review passed, RSS pipeline ran successfully
- [x] Summary quality verified - progressive voice working
- [x] Created TTRC-293 (quotable line feature - future)
- [x] Created `docs/PRODUCT_VISION.md`
- [x] TTRC-119 → Done

---

## NEEDS INVESTIGATION

### 1. EO Tracker - Missing November EOs

**Problem:** 4 new EOs published in November not in our database:
- Nov 25: Modifying Tariffs (Agricultural) 
- Nov 19: Fostering Future for Children
- Nov 7: Two China tariff EOs

**Root Cause Theory:** 
- Tracker uses `publication_date` with 3-day lookback
- Gov shutdown may have delayed Federal Register publishing
- If published > 3 days ago and we missed that window, EOs slip through

**Next Steps:**
1. Check Federal Register for actual publication dates vs signing dates
2. Consider increasing `EO_LOOKBACK_DAYS` to 7 or 14 in prod
3. Or run a one-time backfill: set `EO_LOOKBACK_DAYS=90` and trigger manually

**Quick Fix:** Manually trigger EO tracker on test with 90-day lookback to catch missing EOs

### 2. Feed `last_fetched_at` Not Updating

**Problem:** Most feeds show `last_fetched_at = null` even though articles ARE flowing
**Impact:** Cosmetic - monitoring only, not blocking
**Action:** Create bug ticket or quick fix

### 3. CSM Feed - 2 Failures

**Status:** Feed is working (tested), failures were transient
**Action:** No immediate action needed - will self-heal

### 4. QA Idempotency Test Failing

**Problem:** `qa:idempotency` expects 1 job, gets 3 (upsert not deduping)
**Impact:** Pre-existing, unrelated to prompt changes
**Action:** Create bug ticket for job queue dedup

---

## Commands to Resume

```bash
# Check EO tracker logs
gh run view 19676809841 --log

# Trigger EO tracker with extended lookback (TEST)
gh workflow run "Track Executive Orders" --ref test

# Check what EOs Federal Register has
curl "https://www.federalregister.gov/api/v1/documents.json?conditions[presidential_document_type]=executive_order&conditions[publication_date][gte]=2025-11-01&fields[]=executive_order_number&fields[]=title&fields[]=publication_date&fields[]=signing_date"
```

---

## Files Changed This Session

| File | Status |
|------|--------|
| `scripts/enrichment/prompts.js` | ✅ Committed (858e2f0) |
| `docs/PRODUCT_VISION.md` | ✅ Created (not committed) |
| `docs/handoffs/2025-11-25-ttrc-119-complete.md` | ✅ Created (not committed) |

**Note:** Product vision + handoff docs created but not committed yet.
