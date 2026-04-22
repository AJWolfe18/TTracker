# Legacy Script Retirement Plan

**Tickets:** ADO-473 (SCOTUS) + ADO-482 (EO)
**Goal:** Delete all GPT-4o-mini enrichment scripts replaced by Claude Code cloud agents
**Scope:** 21 files across both domains, 1 session

## Files to Delete

### ADO-473: SCOTUS Legacy (14 files)

**Core enrichment pipeline (7 scripts):**
| File | Why Dead |
|---|---|
| `scripts/enrichment/scotus-fact-extraction.js` | GPT fact extraction → replaced by Claude agent |
| `scripts/enrichment/scotus-gpt-prompt.js` | GPT prompt template → replaced by prompt-v1.md |
| `scripts/enrichment/scotus-qa-layer-b.js` | GPT QA validation → agent handles inline |
| `scripts/enrichment/scotus-qa-validators.js` | Validator helpers for GPT QA → dead |
| `scripts/enrichment/scotus-drift-validation.js` | Drift checking for GPT output → dead |
| `scripts/enrichment/scotus-style-patterns.js` | Tone variation for GPT → replaced by tone-system.json in agent prompt |
| `scripts/enrichment/scotus-variation-pools.js` | Opening pools for GPT → replaced by Opening Variety Rule in prompt |

**Scout subsystem (4 scripts — never integrated, abandoned):**
| File | Why Dead |
|---|---|
| `scripts/enrichment/scotus-scout.js` | Perplexity-based fact extraction, orphaned |
| `scripts/scotus/scout-parser.js` | Only called by scotus-scout.js |
| `scripts/scotus/scout-prompt.js` | Only called by scotus-scout.js |
| `scripts/scotus/scout-validator.js` | Only called by scotus-scout.js |

**Tests for dead code (2 files):**
| File | Why Dead |
|---|---|
| `scripts/enrichment/scotus-qa-layer-b.test.js` | Tests deleted code |
| `scripts/enrichment/scotus-qa-validators.test.js` | Tests deleted code |

**Workflow (1 file):**
| File | Why Dead |
|---|---|
| `.github/workflows/enrich-scotus.yml` | Manual GPT enrichment trigger → Claude agent handles all enrichment |

### ADO-482: EO Legacy (7 files)

**Core enrichment pipeline (4 scripts):**
| File | Why Dead |
|---|---|
| `scripts/enrichment/enrich-executive-orders.js` | GPT enrichment → replaced by Claude agent |
| `scripts/enrichment/prompts/executive-orders.js` | GPT prompt template → replaced by prompt-v1.md |
| `scripts/enrichment/eo-style-patterns.js` | Tone variation for GPT → dead |
| `scripts/enrichment/eo-variation-pools.js` | Opening pools for GPT → dead |

**Debug script (1 file):**
| File | Why Dead |
|---|---|
| `scripts/test-eo-prompt.js` | Manual GPT prompt tester → dead |

**Workflows (2 files — partial):**
| File | Action |
|---|---|
| `.github/workflows/test-executive-orders.yml` | DELETE entirely — still calls enrich-executive-orders.js |
| `.github/workflows/executive-orders-tracker.yml` | EDIT — remove disabled enrichment step block (lines 63-69), keep import step |

## Pre-Delete Checklist

- [ ] Verify `enrich-scotus.js` is in lint-prod-refs.yml allowlist → remove from allowlist
- [ ] Verify no npm scripts in package.json reference any of these files
- [ ] `grep -r` for each filename across the codebase to catch any missed imports
- [ ] Check if any test suites (qa:smoke etc.) import these files

## Execution Order

1. **Delete all 19 standalone files** (scripts + tests)
2. **Edit** `executive-orders-tracker.yml` — remove enrichment block, keep import
3. **Delete** `test-executive-orders.yml` and `enrich-scotus.yml` workflows
4. **Edit** `.github/workflows/lint-prod-refs.yml` — remove enrich-scotus.js from allowlist
5. **Edit** `package.json` — remove any scripts referencing deleted files
6. **Run** `npm run qa:smoke` — verify nothing breaks
7. **Commit, push, PR to main**

## Risk Assessment

**Low risk.** All these files are either:
- Orphaned (Scout system — never called)
- Disabled (EO enrichment step already commented out)
- Superseded (SCOTUS enrichment fully handled by cloud agent since 2026-04-05)

The only active caller is `enrich-scotus.yml` workflow, which is manual-trigger-only and hasn't been used since the Claude agent went live. Deleting it removes the risk of someone accidentally running the old GPT pipeline.

## Cost Savings

Retiring these scripts eliminates the last pathway to accidental OpenAI API charges for SCOTUS/EO enrichment. Estimated savings: ~$5-10/month if the old pipeline were ever triggered.
