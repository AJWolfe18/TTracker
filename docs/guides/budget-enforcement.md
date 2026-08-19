# Budget Enforcement Reference

Hard limits and the "always state cost implications" rule live in `CLAUDE.md`. This doc holds the operational detail (moved from CLAUDE.md).

## Cost per Operation
- Story enrichment: ~$0.003/story (GPT-4o-mini)
- AI code review: $0.30-$1.00/PR (GPT-4o)
- Article scraping: Free (no API costs)
- Database queries: Free (within Supabase free tier)
- **Re-cluster job (1800 articles):** ~5-7GB egress ($0.18-0.63 overage)
- **MCP query (articles with content):** ~5KB per row
- **MCP query (articles with embeddings):** ~6KB per row

## Before Making OpenAI Calls
```sql
-- Check today's spend via Supabase MCP
SELECT spent_usd, openai_calls
FROM budgets
WHERE day = CURRENT_DATE;

-- If spent_usd > $5.00, HALT enrichment
-- Log warning and skip enrichment job
```

## Budget Monitoring
- Daily budget tracked in `budgets` table
- Auto-enforced in `rss-tracker-supabase.js`
- Manual check: Query budgets table before proposing new AI features
