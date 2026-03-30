# ADO-456: Scout Promoted to Testing (Mar 27)

Scout v7 gold-set dry run: 23/24 perfect match. All 5 promotion gates passed. ADO-456 moved Active → Testing. Commit 0c4e25a pushed to test.

## What Changed (0c4e25a)
- **3 code review fixes**: JSON.parse try-catch in GPT cross-check, override_applied counter guard, removed unnecessary GPT trigger on missing vote_split
- **New enum**: `affirmed_and_remanded` added to extractor, parser, prompt
- **Gold truth corrections**: SF v EPA (118) reversed→reversed_and_remanded, Horn (137) affirmed→affirmed_and_remanded
- **4 non-blocking items** logged for future work (silent degradation flag, partial joiner window, GVR window docs, double DB fetch)

## Next: ADO-457 (Scout Live Run)
State: New. AC summary:
- Field-level comparison report across all cases
- Live writes limited to Scout-owned fact fields only
- Rollback data for every write
- 0 uncertain cases silently written
- Pass 2 Writer fields untouched
- Budget tracked in budgets table
- Cost < $1.50 for full run
