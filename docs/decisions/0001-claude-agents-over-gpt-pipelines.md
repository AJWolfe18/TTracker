# 1. Claude cloud agents over GPT/Perplexity enrichment pipelines

- **Date:** 2026-05-30 (documenting a decision made across ADO-467 / ADO-476, Apr 2026)
- **Status:** Accepted

## Context
Per-domain GPT/Perplexity enrichment pipelines failed on tone and factual accuracy:
- **SCOTUS:** ~4,300 lines of enrichment scripts with a ~60% contradiction rate.
- **Executive Orders:** GPT-4o-mini rated ~88% of EOs at alarm level 4 (saturation), and fabricated motivations/cronyism not supported by the source.
- **Pardons:** Perplexity research missed connections; 116/118 records had empty `crime_description`.

Roughly two months of prompt iteration on the SCOTUS GPT pipeline did not resolve it — small-model failure modes (level saturation, fabricated specifics) don't respond reliably to prompt rules; the model "knows" the rule but drifts anyway.

## Decision
Replace per-domain GPT/Perplexity pipelines with **single-pass Claude Code cloud scheduled agents**, one per domain, sharing a common prompt skeleton (env setup, PostgREST-via-curl, gold set, voice, failure handling, invariants). Single-pass fact+editorial (splitting them was the root cause of SCOTUS contradictions). Agents never self-approve and never auto-publish without review.

SCOTUS shipped first (ADO-467), then EO (ADO-476); Pardons is planned (ADO-516) on the same pattern.

## Consequences
**Positive**
- SCOTUS: 116/116 cases enriched, 0 failures. EO: 250/250 enriched, backlog drained.
- ~$20/mo OpenAI/Perplexity cost eliminated; cloud agents are $0 marginal on the Anthropic subscription.
- One reusable prompt skeleton across all enrichment domains.

**Negative / watch-outs** (operational gotchas captured in memory `claude-agent-patterns`)
- Cloud-trigger git repo is cached between runs — bootstrap must `git reset --hard origin/<branch>`.
- WebFetch can't set custom headers — agents use Bash/curl for PostgREST.
- `prompt_version` string collisions between old-GPT and new-Claude output require allow-lists.

## Supersedes
SCOTUS Scout (ADO-455/456/457) and the legacy GPT/Perplexity enrichment scripts (retired via ADO-473/482).
