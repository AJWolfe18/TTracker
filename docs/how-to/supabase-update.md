# How to: update data in Supabase (TEST vs PROD)

> **Default target for "enrich" / "backfill" is PROD**, not TEST, unless told otherwise (~99% of the time). TEST data rarely matters.

## Read (cheap, egress-aware)
- MCP: `mcp__supabase-test__postgrestRequest`. Always `select=id,field1,field2` (never `select=*`) and add `limit=10` for exploration.
- **Never** select `embedding` (6KB/row) or `content` (5KB+/row) unless computing similarity — egress costs real money (5GB/mo free, then $0.09/GB).

## Write — one row / ad hoc
- TEST: MCP `postgrestRequest` with PATCH/POST.
- PROD: use the PROD project ref; confirm scope before writing.

## Bulk / backfill
1. **State egress + $ impact first.** Fetching 1,800 articles with embeddings ≈ 5–7GB.
2. Check the `budgets` table — if `spent_usd > $5.00` today, HALT enrichment.
3. Prefer `execute_sql` (SQL run server-side) over fetching rows to the client.

## Gotchas (these have bitten us)
- `limit=0` means **NO LIMIT** (returns ALL rows), not zero.
- HTTP **416** = offset exceeded total count → treat as empty page (Content-Range still valid).
- NOT NULL array columns (`receipts_timeline`, `source_urls`) — send `[]`, never `null`.
- `enriched_at` lock trigger blocks PATCH when new `prompt_version` ≤ old (lexicographic) — null the fields first to re-enrich.
- PROD EO IDs are strings (`eo_<ts>_<suffix>`); SCOTUS uses integer IDs — `encodeURIComponent` EO IDs in URLs.

## Project refs
- TEST: `wnrjrywpcadwutfykflu` (TrumpyTracker-Test)
- PROD: `osjbulmltfpcoldydexg` (TrumpyTracker)
