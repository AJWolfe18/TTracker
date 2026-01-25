# 2026-01-24: ADO-300 Clamp/Retry Implementation Complete

**ADO-300** moved to Testing. Implemented clamp/retry/publish override for SCOTUS enrichment:

- Migration 072 adds `clamp_reason`, `publish_override`, `facts_model_used`, `retry_reason`
- `clampAndLabel()` routes cert/procedural cases to Sidestepping
- `enforceEditorialConstraints()` enforces label constraints post-Pass 2
- Retry ladder: gpt-4o-mini -> gpt-4o fallback
- Sidestepping forbidden when merits disposition + clear winner

**Next steps:**
1. Apply migration 072 to TEST DB
2. Reset a few enriched cases to `pending` to test the new logic
3. Run `node scripts/scotus/enrich-scotus.js --limit=10` and verify clamp fields populate
4. Check Sidestepping rate (baseline: 57%, target: 15-25%)
5. If verified, move ADO-300 to Ready for Prod
