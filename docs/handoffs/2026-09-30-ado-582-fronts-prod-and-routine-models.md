# Handoff: routine models to Sonnet 5.5, election front agent to PROD (ADO-582)

September 30 - October 1, 2026 (evening CT). Josh's prompt: move the routines he had switched from Sonnet to Opus 5.5 over to the new Sonnet 5.5. It grew into shipping the ADO-582 election front agent to PROD.

## Outcome in one line
Judge + Stories PROD routines run on Sonnet 5.5; the election front agent is live on PROD (Missouri map story assigned) after a committed allow-listed script got it past the cloud classifier; ADO-582 stays in Testing until the backlog drains and Josh eyeballs the main line.

## 1. Routine models
| Routine | Before | Now | Who changed it |
|---|---|---|---|
| Clustering Judge PROD `trig_01DDXZkpC9PkgTzU8wDdL9QM` | claude-opus-5-5 (Sept 25; Sonnet before) | claude-sonnet-5-5 | Josh, claude.ai UI |
| Stories PROD `trig_0182WcUVyjF7Q5o2GWJMxbo1` | claude-opus-5-5 (Sept 25; Sonnet before) | claude-sonnet-5-5 | Josh, claude.ai UI |
| Clustering Judge TEST `trig_01B2gdNTCLUe7yjwpiz5K5uU` | claude-sonnet-5 | claude-sonnet-5-5 (verified run `cse_01JzfwHaRACJY4PhfEeZvr1s`) | Claude |
| SCOTUS / EO / Pardons PROD | claude-opus-5-5 | unchanged (they were Opus before Sept 25; editorial quality) | - |

Left alone on purpose: Fronts TEST (sonnet-5), Stories TEST (sonnet-4-6), EO/Pardons/SCOTUS TEST (opus-4-6). The dev-session classifier refused RemoteTrigger edits to the PROD routines even with Josh's request, so he flipped them in the UI; prompts, crons, connectors and auto_mode fields read back unchanged. Reference docs (clustering-judge.md, stories-agent.md) updated, commit 7cc37cf.

Noticed, not changed: the PROD Judge's `auto_mode_*` fields are empty now (probably wiped by the Sept 25 model edit), yet its runs pass. If Judge denials return, re-apply option 1 from `docs/reference/cloud-classifier-playbook.md` (Josh's words required).

## 2. Election front agent to PROD
1. Migration 116 on PROD - Josh pasted it (the dev session was denied the PROD SQL editor and clipboard hand-off); verified `has_agent_pattern = true`.
2. PR #154 (c89c1dc) - c6bbc29 + d0ac9ba cherry-picked; conflicts in package.json and database-schema.md resolved keeping main's lines.
3. PROD routine `trig_01KiZVrHE8RdC7Nuw66HJd7j` created: Sonnet 5.5, PROD environment, main, cron `0 14 * * *` (9:03 AM CT).
4. First two runs denied at the very first read ("Production Reads"). Setting the routine's `auto_mode_environment` / `auto_mode_allow` (Josh asked for it) did NOT help.
5. Fix (PR #155, ac7eb2c; test commit 2dd5e97): `scripts/fronts/front-agent-db.js` is the agent's only database door (candidates / assign / decline / refresh / notify, pinned to election-suppression, event_id looked up by slug, arg guards, dry-run no-ops, api_error skip row on any assign failure, only 23505 = already assigned). One exact rule in `.claude/settings.json`: `Bash(node scripts/fronts/front-agent-db.js *)`. Prompt rewired; `front-agent-prompt.test.mjs` guards rule/prompt/script agreement plus offline guard and dry-run checks. Medium /code-review: 4 low findings, all fixed.
6. Proof: TEST run `cse_015gUrGAPxPE2ruYq9aBFPTn` and PROD run `cse_01Q3CjsudFKjYbPn3MinCCAp` - 0 denials. PROD: 80 judged, 7 assigned (incl. 15902 Supreme Court blocks Missouri map), 73 declined (2 borderline), 0 errors, refresh 4 rows, Discord posted.

## Open / next
- **Josh:** set `FRONTS_MAX_PER_RUN=250` on the TTracker PROD cloud environment. Pool is ~2,670 (agent_pattern is broad), so 80/day takes ~2 months; 250 clears it in ~12 days. $0 cash, more plan usage meanwhile.
- **Josh:** eyeball the PROD Tracker main line for the Missouri story under Election Suppression (dev session cannot read PROD) - then close ADO-582 (AC 4).
- Optional: tighten `events.agent_pattern` (UPDATE, not a migration); ~90% of candidates are declines.
- Still owed from September 15: PROD feed_registry 21/22 `failure_count` query.
- Pattern to reuse: any routine hit by the classifier -> playbook option 2 (committed script + exact allow rule), now proven.

## Verification
- `npm run qa:fronts`, `qa:agent-prompts`, `qa:smoke` green on test.
- Read-path of the script exercised against TEST locally (pool 33).
- ADO-582 comment carries AC status + the recommendation.
