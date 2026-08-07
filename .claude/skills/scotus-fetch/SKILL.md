---
name: scotus-fetch
description: Fetch SCOTUS cases from the CourtListener API into scotus_cases via scripts/scotus/fetch-cases.js. Use when fetching, backfilling, or resuming SCOTUS case data.
---

# Fetch SCOTUS Cases (CourtListener API)

**Script:** `scripts/scotus/fetch-cases.js`
**Requires:** `COURTLISTENER_API_TOKEN` environment variable

```bash
# Set once per shell (avoids repeating the secret in command history)
export COURTLISTENER_API_TOKEN=<token>

# Fetch recent cases (2024+) - limit to 20 for testing
node scripts/scotus/fetch-cases.js --since=2024-01-01 --limit=20

# Dry run (no database writes)
node scripts/scotus/fetch-cases.js --since=2024-01-01 --limit=5 --dry-run

# Resume from last sync state (for incremental fetches)
node scripts/scotus/fetch-cases.js --resume

# Check cases in database
SELECT id, case_name, term, decided_at, majority_author FROM scotus_cases ORDER BY decided_at DESC LIMIT 10;
```

**Notes:**
- Cases start with `is_public = false` (need enrichment/review before publishing)
- Sync state tracked in `scotus_sync_state` table (singleton)
- API rate limit: 5000 requests/hour with exponential backoff on 429
