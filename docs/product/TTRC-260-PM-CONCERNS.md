# TTRC-260 Product Manager Concerns & Go/No-Go Criteria

**Feature**: Mozilla Readability Scraper with Three-Tier Fallback
**Status**: In TEST Monitoring
**Target PROD Date**: TBD (pending 48h TEST monitoring)
**Created**: 2025-11-09

---

## Executive Summary

Mozilla Readability scraper implemented and working on TEST. **Limited test data (7 successful scrapes)** requires extended monitoring before PROD deployment to validate:
- Success rate >70% across all sources
- Memory stability over 48+ hours
- Cost impact assessment
- NYT/WaPo extraction validation

---

## 🚨 Blockers for PROD Deployment

### 1. Insufficient Test Data ⚠️
**Current**: 7 PBS scrapes (100% success)
**Missing**: NYT, WaPo, CSM, Reuters, AP validation
**Impact**: Unknown production behavior, could fail at scale

**Resolution**: Run on TEST for 48-72 hours, collect metrics by source

### 2. Success Rate Unvalidated ⚠️
**Target**: >70% overall success rate
**Current**: Unknown (sample too small)
**Impact**: May not meet quality requirements

**Resolution**: Calculate success rate after 48h monitoring:
```
Success Rate = (Readability + Regex successes) / Total attempts * 100
Target: >70%
```

### 3. No Production Monitoring Plan ⚠️
**Missing**:
- Success rate tracking (manual or dashboard)
- Memory usage alerts
- Cost tracking alerts
- Incident response runbook

**Impact**: Silent failures, budget overruns, slow incident response

**Resolution**: Define monitoring approach (manual log analysis or dashboard)

### 4. Rollback Not Tested ⚠️
**Risk**: Long recovery time if production issues found
**Resolution**: Test rollback using `SCRAPE_DOMAINS=""` env var before PROD deploy

---

## ✅ Go/No-Go Criteria for PROD

**Must Pass All:**
1. ✅ Success rate >70% (Readability + Regex combined)
2. ✅ Memory stable <300MB for 48+ hours
3. ✅ Zero worker crashes
4. ✅ Cost increase <$5/month
5. ✅ At least 3 sources validated (PBS ✅, need 2 more)
6. ✅ Rollback tested and working

**Current Status**: ❌ 1/6 criteria met (only PBS validated)

---

## 📊 Expected Metrics (Post-48h Monitoring)

### Success Rates by Source (Target >70%)
- CSM: TBD (expected 80-90%, clean HTML)
- PBS: **100%** ✅ (7/7 successful)
- ProPublica: TBD (failed 404 in test)
- Reuters: TBD (not yet triggered)
- AP News: TBD (not yet triggered)
- Politico: 0% (blocks automation, expected)
- NYT: TBD (paywalled, may extract partial)
- WaPo: TBD (paywalled, may extract partial)

**Overall Target**: >70% across non-blocking sources

### Performance Benchmarks
- Scrape latency: 700-2000ms (acceptable)
- Memory per scrape: 2-5MB (acceptable)
- Memory growth: <100MB/day (acceptable)

### Cost Impact
- **Before**: $20/month (OpenAI only)
- **After**: $20-25/month (minimal increase expected)
- **Budget**: $50/month hard cap

---

## 🎯 Decision Framework

### Deploy to PROD If:
- Success rate >70%
- Memory stable
- Cost <$25/month
- No critical bugs
- Rollback tested

### Stay on TEST If:
- Success rate <70%
- Memory leaks detected
- Cost >$30/month
- Critical bugs found
- Rollback fails

### Rollback PROD If:
- Success rate drops to <50%
- Memory >500MB
- Cost >$40/month
- Worker crashes
- HTTP 429 rate limit errors

---

## 📋 Open Questions

1. **What's acceptable for paywalled sites?**
   - NYT/WaPo may fail or extract partial content
   - Is RSS fallback acceptable for these?
   - **Decision needed**: Remove from allow-list or accept lower success?

2. **Should we add more non-paywalled sources?**
   - Current: CSM, PBS, ProPublica (3 public sources)
   - Could add: BBC, Guardian, NPR
   - **Trade-off**: More sources = better coverage, but more maintenance

3. **What's our monitoring strategy?**
   - Manual log analysis (cheap, manual effort)
   - Supabase dashboard (requires setup)
   - External monitoring (Datadog, costs money)
   - **Decision needed**: Choose monitoring approach

4. **When do we consider this feature "done"?**
   - PROD deployed? Or...
   - 70% success rate achieved? Or...
   - Zero incidents for 30 days?
   - **Decision needed**: Define "done" criteria

---

## 💡 Future Enhancements (Post-Launch)

**Priority 1: Monitoring Dashboard**
- Success rate by source (real-time)
- Memory usage graph
- Cost tracking
- Alert configuration

**Priority 2: Adaptive Rate Limiting**
- Detect 429 errors
- Back off automatically per host
- Resume when rate limit clears

**Priority 3: Source Quality Scoring**
- Track success rate by domain
- Auto-disable low-performing sources
- Alert when source quality degrades

**Priority 4: JavaScript Rendering**
- For JS-heavy sites (PBS occasionally fails)
- Requires Playwright/Puppeteer (expensive)
- Cost/benefit analysis needed

---

## 📚 References

**JIRA**: [TTRC-260](https://ajwolfe37.atlassian.net/browse/TTRC-260)
**Implementation Plan**: `/docs/plans/2025-11-09-ttrc-260-implementation.md`
**Deployment Guide**: `/docs/deployments/DEPLOYMENT-TTRC-260-mozilla-readability.md`
**Code Patterns**: `/docs/code-patterns.md`

---

**Last Updated**: 2025-11-09
**Next Review**: After 48h TEST monitoring
**Owner**: Josh (Product Manager)
