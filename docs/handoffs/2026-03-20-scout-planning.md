# Scout Feature Planning — Handoff (Mar 20)

## Decision Made

**Use Perplexity (not GPT) as the Scout agent** for SCOTUS fact-checking. Rationale: GPT is the thing getting dispositions wrong — using it to check itself defeats the purpose. Perplexity has web search built in, can pull ground truth from SCOTUSblog, Oyez, Wikipedia. Already have a production Perplexity client (`scripts/enrichment/perplexity-research.js`) with retries, cost tracking, and input sanitization ready to reuse.

## What to Build

**`scripts/enrichment/scotus-scout.js`** — Perplexity-powered fact-checker for SCOTUS cases.

### Architecture
1. **Scout queries Perplexity** with case name + docket number
2. **Returns structured fact sheet**: disposition, vote split, majority author, dissent authors, holding
3. **Compare against GPT Pass 1 output** — flag disagreements
4. **Feed Scout facts into existing Pass 2 Writer** (already built)

### Dry Run Plan
- Run against the 6 known-bad disposition cases: Kirtz (51), Wullschleger (64), Horn (137), Bowe (285), Riley (224), Bondi (131)
- Compare Scout fact sheet vs gold set truth
- Cost: ~$0.005/query × 6 = ~$0.03 total
- No DB writes (dry run only)

### Key Files to Read
- `scripts/enrichment/perplexity-research.js` — Reuse client pattern (PerplexityClient class, sanitization, retries)
- `tests/scotus-gold-truth.json` — Gold set with expected values
- `docs/features/scotus-enrichment/ado-439-validation-report.md` — Known failures
- `docs/features/scotus-enrichment/ado-438-unified-agent-plan.md` — Full agent plan
- `scripts/enrichment/scotus-fact-extraction.js` — Current Pass 1 (what Scout replaces)

### Reuse from Pardons Client
- `PerplexityClient` class (API wrapper, exponential backoff on 429)
- `sanitizeForPrompt()` for input safety
- Cost tracking pattern (adapt `pardon_research_costs` → `scotus_research_costs` or shared table)
- Error logging with retry count
- Temperature 0.3 for factual accuracy

## Cost
- Dry run: ~$0.03
- Full 145 cases: ~$0.73
- Per-case ongoing: ~$0.005

## Status
- ADO-438 context (unified agent plan)
- No code written yet — next session builds the Scout
