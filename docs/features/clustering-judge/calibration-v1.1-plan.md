# ADO-539: Judge Calibration v1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Judge re-hedging the same pairs every run, and license two merge patterns it currently hedges on (same-cycle analysis pieces, format variants of one occasion) — without giving up merge precision.

**Architecture:** Three coordinated changes: (1) SQL verdict memory in `get_clustering_judge_candidates` (migration 106) so already-judged pairs are skipped until article membership changes; (2) two new merge rules in `prompt-v1.md` Section 4 (licensed inference + format variants), version bump to `judge-v1.1`; (3) gold set grows 3 Josh-verified ground-truth pairs (gs-209..211) and `judge-dryrun.js` re-scores everything under v1.1 as the precision gate.

**Tech Stack:** PostgreSQL (Supabase migration, SQL Editor apply), Markdown prompt (read by the cloud agent from main at run time), Node (gold set + dry-run scorer, no API calls, $0).

**Cost:** $0 new recurring spend. Expected small *savings*: fewer re-judged pairs → fewer tokens per Judge run (3×/day Sonnet). Dry-run gate is offline ($0 — verdicts are produced by the executing Claude session, not API calls).

## Global Constraints

- Precision gate (from the 539 card, verbatim): "prompt changes must be validated against the gold set (scripts/evals) — precision holds >=98% baseline while the hedge patterns above flip to merge."
- The keep traps must stay keep under v1.1: gs-168, gs-189 (chain-of-events), gs-012, gs-063 (recurring formats), gs-001, gs-002, gs-005..gs-010. Any flip = FAIL, fix the rule wording, re-score.
- Default-DENY stays the stance; v1.1 only narrows what counts as "doubt". Do not re-litigate Josh's binding merge ruling (gold set `meta.verification_status`).
- All DB work TEST-first. Migration applied to PROD manually by Josh in the SQL Editor (never `apply-migrations.js`).
- No embeddings leave the DB (egress rule #11) — the verdict-memory filter is pure SQL on `clustering_judge_log` + `article_story`.
- Gold-set ids are sparse and never renumbered; new entries are gs-209, gs-210, gs-211.
- No Python. `mcp__filesystem__edit_file` or Edit tool for file edits.

---

### Task 1: Migration 106 — verdict memory in the candidate RPC

**Files:**
- Create: `migrations/106_judge_verdict_memory.sql`
- Reference: `migrations/100_clustering_judge.sql:255-341` (current Part D body — the rollback target)

**Interfaces:**
- Produces: same RPC signature `get_clustering_judge_candidates(p_min_sim float8 DEFAULT 0.83, p_days int DEFAULT 7, p_max_pairs int DEFAULT 30)` — arity unchanged, so existing grants and the agent's Step 2 call keep working untouched.
- Behavior change: a pair is EXCLUDED when a live (`dry_run = false`) `clustering_judge_log` verdict for that pair is newer than the latest `article_story.matched_at` on either side. New article attached since the verdict → pair resurfaces.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- Migration 106: Judge verdict memory (ADO-539)
-- ============================================================================
-- Problem: the candidate RPC has no verdict memory — the Gaza pair 13257/13295 was
-- judged uncertain 6x, Blanche pairs 6x/4x (2026-08-05 analysis on the ADO-539 card).
-- Fix: skip pairs whose latest LIVE verdict (dry_run=false; includes source='manual',
-- includes verdict='unmerge' — a human unmerge is an authoritative "keep separate")
-- is NEWER than the latest article_story.matched_at on either side. A new article
-- attaching to either story reopens the pair.
-- Rollback: re-run migration 100 PART D (restores the previous function body).
-- Idempotent: CREATE OR REPLACE + IF NOT EXISTS. Same arity → ACLs preserved,
-- no re-grant needed; NOTIFY included anyway (harmless).

-- Partial index so the NOT EXISTS probe is cheap. LEAST/GREATEST are immutable on
-- bigint. Heartbeat rows (both ids NULL) are excluded by the predicate.
CREATE INDEX IF NOT EXISTS idx_judge_log_pair_live
  ON public.clustering_judge_log (
    LEAST(story_id_a, story_id_b),
    GREATEST(story_id_a, story_id_b),
    created_at DESC
  )
  WHERE dry_run = false AND story_id_a IS NOT NULL AND story_id_b IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_clustering_judge_candidates(
  p_min_sim   DOUBLE PRECISION DEFAULT 0.83,
  p_days      INT DEFAULT 7,
  p_max_pairs INT DEFAULT 30
)
RETURNS TABLE (
  story_id_a       BIGINT,
  story_id_b       BIGINT,
  headline_a       TEXT,
  headline_b       TEXT,
  centroid_sim     DOUBLE PRECISION,
  shared_entities  TEXT[],
  shared_slugs     TEXT[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
  WITH stopwords AS (
    SELECT ARRAY[
      'US-TRUMP','US-BIDEN','LOC-USA','ORG-WHITE-HOUSE','ORG-DEM','ORG-GOP',
      'ORG-CONGRESS','ORG-SENATE','ORG-HOUSE','ORG-SUPREME-COURT','ORG-DOJ',
      'ORG-FBI','LOC-WASHINGTON'
    ]::text[] AS words
  ),
  recent AS (
    SELECT id, primary_headline, centroid_embedding_v1,
           COALESCE(top_entities, ARRAY[]::text[]) AS top_entities,
           COALESCE(topic_slugs, ARRAY[]::text[])  AS topic_slugs
    FROM stories
    WHERE status = 'active'
      AND merged_into_story_id IS NULL
      AND centroid_embedding_v1 IS NOT NULL
      AND first_seen_at >= NOW() - (p_days || ' days')::interval
  )
  SELECT
    a.id AS story_id_a,
    b.id AS story_id_b,
    a.primary_headline AS headline_a,
    b.primary_headline AS headline_b,
    (1 - (a.centroid_embedding_v1 <=> b.centroid_embedding_v1))::double precision AS centroid_sim,
    ARRAY(
      SELECT e FROM unnest(a.top_entities) e
      WHERE e = ANY(b.top_entities) AND e <> ALL(sw.words)
    ) AS shared_entities,
    ARRAY(
      SELECT s FROM unnest(a.topic_slugs) s
      WHERE s = ANY(b.topic_slugs)
    ) AS shared_slugs
  FROM recent a
  JOIN recent b ON a.id < b.id
  CROSS JOIN stopwords sw
  WHERE (1 - (a.centroid_embedding_v1 <=> b.centroid_embedding_v1)) >= p_min_sim
    -- ADO-539 verdict memory: skip pairs with a live verdict newer than the latest
    -- membership change on either side. (a.id < b.id from the join, so LEAST/GREATEST
    -- on the log row normalizes stored order — manual rows may store either order.)
    AND NOT EXISTS (
      SELECT 1
      FROM clustering_judge_log l
      WHERE l.dry_run = false
        AND l.story_id_a IS NOT NULL AND l.story_id_b IS NOT NULL
        AND LEAST(l.story_id_a, l.story_id_b) = a.id
        AND GREATEST(l.story_id_a, l.story_id_b) = b.id
        AND l.created_at > COALESCE(
          (SELECT max(m.matched_at) FROM article_story m
           WHERE m.story_id = a.id OR m.story_id = b.id),
          '-infinity'::timestamptz
        )
    )
  ORDER BY
    (CASE WHEN EXISTS (
        SELECT 1 FROM unnest(a.top_entities) e
        WHERE e = ANY(b.top_entities) AND e <> ALL(sw.words)
      ) OR (a.topic_slugs && b.topic_slugs) THEN 0 ELSE 1 END),
    centroid_sim DESC
  LIMIT p_max_pairs;
$$;

COMMENT ON FUNCTION public.get_clustering_judge_candidates(DOUBLE PRECISION, INT, INT) IS
  'ADO-533/539: last-N-day active story pairs with centroid cosine >= p_min_sim, capped. Recall-first (entity/slug are context). Verdict memory (539): pairs with a live verdict newer than the latest article_story.matched_at on either side are skipped until membership changes. No embedding egress. service_role only.';

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Apply on TEST** — paste into the Supabase SQL Editor (TEST project `wnrjrywpcadwutfykflu`) or apply via `mcp__supabase-test` SQL. Decline any dashboard "Enable RLS" suggestion (known dashboard gotcha).

- [ ] **Step 3: Fixture test on TEST** — run these via Supabase TEST MCP, in order:

```sql
-- (a) Baseline: note the top pair returned (call it A_ID/B_ID; skip test if 0 rows —
--     then synthesize: pick any two active stories from the RPC with p_min_sim lowered, e.g. 0.75)
SELECT * FROM get_clustering_judge_candidates(0.75, 14, 5);

-- (b) Insert a LIVE keep verdict for that pair, dated now (newer than any matched_at)
INSERT INTO clustering_judge_log (source, run_id, story_id_a, story_id_b, verdict, confidence, rationale, merged, dry_run)
VALUES ('judge-agent', 'ado-539-fixture', <A_ID>, <B_ID>, 'keep', 0.9, 'ADO-539 fixture', false, false);

-- (c) Re-run (a): the pair MUST be gone.                          → PASS/FAIL
-- (d) Reopen check: bump one membership timestamp past the verdict
UPDATE article_story SET matched_at = NOW()
WHERE story_id = <A_ID>
  AND article_id = (SELECT article_id FROM article_story WHERE story_id = <A_ID> LIMIT 1);
-- (e) Re-run (a): the pair MUST be back.                          → PASS/FAIL
-- (f) Dry-run rows don't suppress: flip the fixture row to dry_run=true, re-run (a), pair still back. → PASS/FAIL
UPDATE clustering_judge_log SET dry_run = true WHERE run_id = 'ado-539-fixture';
-- (g) Clean up
DELETE FROM clustering_judge_log WHERE run_id = 'ado-539-fixture';
```

All three PASS/FAIL checks must pass. (Heartbeat rows are excluded by the `IS NOT NULL` predicate — no separate test needed, but eyeball that a heartbeat row exists on TEST and the RPC still returns rows.)

- [ ] **Step 4: Commit**

```bash
git add migrations/106_judge_verdict_memory.sql
git commit -m "feat: migration 106 — Judge verdict memory in candidate RPC (ADO-539)"
```

---

### Task 2: Prompt v1.1 — licensed inference + format variants

**Files:**
- Modify: `docs/features/clustering-judge/prompt-v1.md` (Section 4 ~line 309-345, Section 8 ~line 390)

**Interfaces:**
- Produces: `prompt_version: judge-v1.1` — the PROD cloud agent reads this file from **main** at run time (bootstrap `git reset --hard origin/main`), so nothing ships until the PR merges. No RemoteTrigger update needed (no mode/env change).

- [ ] **Step 1: Add the two v1.1 rules to Section 4.** Insert AFTER the `merge` (same_event) bullet list (after the July 4th line, before the `keep` block):

```markdown
**Licensed inference (v1.1):** analysis, explainer, op-ed, and reaction pieces routinely do NOT
restate the trigger event's specifics — that is a genre convention, not evidence of a different
event. If (a) both sides sit in the same news cycle, (b) they are the same saga/subject, and
(c) there is exactly ONE plausible occurrence in the window that the vaguer side can be about,
then vague framing is NOT doubt: verdict `merge`. "B lacks specifics" alone is never a reason
to hedge. (Ground truth: pairs 13324/13327 and 13362/13383 hedged this way on PROD; Josh
manually merged both on 2026-08-05.) If there are TWO plausible referent occurrences in the
window, that IS doubt — stay `uncertain`.

**Format variants of ONE occasion (v1.1):** previews, "how to watch" guides, WATCH/video clips,
liveblogs, and timeline recaps of a single scheduled occasion are the SAME event as the occasion
itself — merge them into it. (Ground truth: 13128→13123 was eventually merged after hedging
twice.) Do NOT confuse this with the recurring-format `keep` rule below: a weekly segment or a
per-state Live Results template repeating across DIFFERENT occasions stays `keep`; a preview and
the event it previews are ONE occasion.
```

- [ ] **Step 2: Recalibrate the default-DENY costing note.** In the Section 4 "Default DENY." paragraph, replace the sentence fragment "(worse — though reversible via the tombstone, it still corrupts the record until someone catches it)" with:

```markdown
(worse — but since ADO-537, reversal is one click in the admin Judge tab via `unmerge_story`,
so treat wrong-merge cost as moderate, not catastrophic)
```

Keep the rest of the paragraph (including "Never merge to 'tidy up.'") unchanged — the stance stays default-DENY; only the cost calibration changes.

- [ ] **Step 3: Bump Section 8 metadata.** Change `- `prompt_version`: `judge-v1``  to  `- `prompt_version`: `judge-v1.1``, and append a line: `- v1.1 (ADO-539): licensed-inference + format-variant merge rules; verdict memory moved into the candidate RPC (migration 106).`

- [ ] **Step 4: Commit**

```bash
git add docs/features/clustering-judge/prompt-v1.md
git commit -m "feat: Judge prompt v1.1 — licensed inference + format-variant rules (ADO-539)"
```

---

### Task 3: Gold set — 3 ground-truth pairs (gs-209..211)

**Files:**
- Modify: `scripts/evals/clustering-gold-set.json` (append entries; update `meta.counts`)

**Interfaces:**
- Produces: entries `gs-209` (13324/13327), `gs-210` (13362/13383), `gs-211` (13123/13128), all `pair_type: "story_story"`, `label: "same_event"`, `difficulty: "hard"` — consumed by Task 4's dry-run scorer.
- Schema: story_story shape per `meta.schema_note` — both sides story-shaped (`headline`/`top_entities`/`topic_slugs`/`article_titles`, NO `a.title`), `replay.centroid_sim_raw` instead of `embed_sim`. The deterministic replay (`clustering-eval.js`) auto-skips story_story pairs, so `qa:clustering-eval` metrics are untouched.

- [ ] **Step 1: Pull evidence from PROD (read-only, tiny egress).** Headlines + `centroid_sim` come from the judge-log rows (service_role via the `admin-judge-log` edge function, or from the analysis already pasted on the ADO-539 card). Member-article titles: the losers (13327, 13383, 13128) are tombstoned and their `article_story` rows were repointed, so recover each side's titles via the merge audit snapshot:

```bash
# loser side titles (per pair) — snapshot ids are TEXT art-<uuid>
curl -s "${SUPABASE_URL}/rest/v1/story_merge_audit?loser_id=eq.13327&select=loser_article_ids,survivor_id" -H "apikey: ${KEY}" -H "Authorization: Bearer ${KEY}"
curl -s "${SUPABASE_URL}/rest/v1/articles?id=in.(<ids from above>)&select=id,title,source_name,published_at" -H "apikey: ${KEY}" -H "Authorization: Bearer ${KEY}"
# survivor side titles = its current article_story members MINUS the loser snapshot ids
curl -s "${SUPABASE_URL}/rest/v1/article_story?story_id=eq.13324&select=article_id,articles(title)" -H "apikey: ${KEY}" -H "Authorization: Bearer ${KEY}"
# story fields for both sides (tombstones still hold their row data)
curl -s "${SUPABASE_URL}/rest/v1/stories?id=in.(13324,13327,13362,13383,13123,13128)&select=id,primary_headline,top_entities,topic_slugs,first_seen_at,last_updated_at" -H "apikey: ${KEY}" -H "Authorization: Bearer ${KEY}"
```

PROD service-role calls: run read-only via the established pattern (anon key works for `stories`/`articles`/`article_story` reads if granted; `story_merge_audit` needs service_role — if no local PROD key, pull those two loser-snapshot queries through the Supabase dashboard SQL editor and paste results). Never write to PROD from local.

- [ ] **Step 2: Append the three entries.** Template (fill every field from Step 1's data; keep id order; `verified: true` since Josh's manual merges ARE the verification):

```json
{
  "id": "gs-209",
  "pair_type": "story_story",
  "label": "same_event",
  "difficulty": "hard",
  "source": "ado-539-ground-truth",
  "notes": "'B lacks specifics' hedge pattern — Judge hedged, Josh manually merged 2026-08-05 (ADO-537 round-trip pair). v1.1 licensed-inference rule target.",
  "a": { "story_id": 13324, "headline": "<from stories row>", "top_entities": [...], "topic_slugs": [...], "article_titles": [...], "date_range": "<first_seen_at> → <last_updated_at>" },
  "b": { "story_id": 13327, "headline": "<from stories row>", "top_entities": [...], "topic_slugs": [...], "article_titles": [...], "date_range": "..." },
  "replay": { "centroid_sim_raw": <from judge log / card analysis> }
}
```

gs-210 notes: `"'B lacks specifics' hedge pattern — Josh manual merge 13383→13362 (7 articles). Licensed-inference target."`
gs-211 notes: `"Format-variant hedge — Judge hedged twice on 13128 vs 13123 then merged anyway. v1.1 format-variant rule target."`

- [ ] **Step 3: Update `meta.counts`** (+3 same_event, +3 hard, +3 story_story) and add to `meta.verification_status`: `"gs-209..211 (ADO-539): Josh-verified ground truth via manual PROD merges 2026-08-05."`

- [ ] **Step 4: Validate JSON + run the untouched-metrics check**

```bash
node -e "const g=require('./scripts/evals/clustering-gold-set.json'); const n=g.entries.filter(e=>['gs-209','gs-210','gs-211'].includes(e.id)); if(n.length!==3) throw new Error('missing entries'); console.log('ok', g.entries.length, 'entries')"
npm run qa:clustering-eval   # must still pass — story_story pairs are skipped by the replay
```

- [ ] **Step 5: Commit**

```bash
git add scripts/evals/clustering-gold-set.json
git commit -m "feat: gold set gs-209..211 — Josh-verified hedge-pattern ground truth (ADO-539)"
```

---

### Task 4: Dry-run re-score under v1.1 — THE PRECISION GATE

**Files:**
- Modify: `scripts/evals/judge-dryrun.js` (VERDICTS map ~line 37-73; header comment)

**Interfaces:**
- Consumes: gs-209..211 from Task 3; v1.1 Section 4 rules from Task 2.
- Produces: the gate evidence for the ADO card — agreement %, merge-class precision, trap audit.

- [ ] **Step 1: Re-judge ALL pairs under v1.1.** The executing Claude session applies the v1.1 Section 4 criteria (read the updated prompt first) to every pair currently in VERDICTS **plus** gs-209..211, from each pair's gold evidence (article_titles + headlines + entities). Update the VERDICTS map in place. Requirements:
  - gs-209, gs-210: `merge` via licensed inference (one plausible referent, same cycle).
  - gs-211: `merge` via format-variant rule.
  - Every existing keep trap (gs-001, gs-002, gs-005, gs-006, gs-008, gs-009, gs-010, gs-012, gs-063, gs-168, gs-189) must independently re-derive as `keep` — if v1.1's wording makes any of them arguable, that is a FAIL: tighten the rule text in prompt-v1.md (Task 2) and re-judge. Do not "keep the old verdict without re-deriving" — the point is testing the new rules for bleed.
  - Update the header comment: coverage is now 33 pairs, verdicts produced under `judge-v1.1`.

- [ ] **Step 2: Run the scorer**

```bash
node scripts/evals/judge-dryrun.js
```

Expected (GATE — all three required):
- `Verdict agreement with gold labels: 33/33 (100.0%)`
- `Merge-class: precision=100.0%` (≥98% is the hard floor; at 33 pairs a single FP = 95.8% = FAIL)
- `--- DISAGREEMENTS ---` section absent.

- [ ] **Step 3: Commit**

```bash
git add scripts/evals/judge-dryrun.js
git commit -m "feat: judge dry-run re-scored under v1.1 — 33/33, precision gate passed (ADO-539)"
```

---

### Task 5: Review, QA, push to test

- [ ] **Step 1: Two-pass code review** — `Task(feature-dev:code-reviewer)` then `Agent(superpowers:code-reviewer)` over migration 106 + prompt diff + gold set + dryrun. Fix Critical/Important findings.
- [ ] **Step 2: QA** — `npm run qa:smoke` (includes `qa:clustering-eval`). Must be fully green.
- [ ] **Step 3: Push** — `git push origin test`.
- [ ] **Step 4: ADO** — move 539 → Testing via ado-agent, comment with the gate numbers (33/33, precision 100%) and fixture-test results from Task 1 Step 3.

---

### Task 6: PROD deploy + live verification

- [ ] **Step 1: Deployment branch** — `git checkout -b deploy/ado-539-judge-v1.1 origin/main`, cherry-pick the 4 commits (migration, prompt, gold set, dryrun). Check `.claude/test-only-paths.md` (none of these files are listed as of 2026-08-06). Expect clean picks — all 4 files are now in sync on main after PR #111.
- [ ] **Step 2: PR to main** — `gh pr create`, comment `@codex review`, wait for checks + AI review, verify blockers (if any) against actual code before acting, `gh pr merge --squash`.
- [ ] **Step 3: Josh applies migration 106 on PROD** — SQL Editor, PROD project `osjbulmltfpcoldydexg`. Verify: `SELECT indexname FROM pg_indexes WHERE indexname='idx_judge_log_pair_live';` returns 1 row, and `SELECT proname FROM pg_proc WHERE proname='get_clustering_judge_candidates';` still 1 row. Re-run the security advisor on PROD (house rule after any SECURITY DEFINER touch).
- [ ] **Step 4: Live verification (next 24h = 3 Judge runs).** Success criteria:
  - The 13 known re-hedge pairs (Gaza 13257/13295, Blanche pairs, etc.) do NOT reappear in `clustering_judge_log` unless a new article attached (check: `SELECT story_id_a, story_id_b, count(*) FROM clustering_judge_log WHERE created_at > <deploy time> AND verdict='uncertain' GROUP BY 1,2 HAVING count(*) > 1;` → expect 0 rows).
  - Uncertain-per-run drops vs the ~30-per-window baseline; Discord digests shrink.
  - No precision incident: spot-check every `merged=true` row in the window against member titles (same discipline as the Tier A audit).
- [ ] **Step 5: Close out** — AC verification against the card (every pattern addressed: re-judging ✓ migration 106, licensed inference ✓ prompt, format variants ✓ prompt, gate ✓ Task 4 numbers, live verify ✓ Step 4), then 539 → Closed via ado-agent with evidence. Update `docs/reference/clustering-judge.md` if it states v1 behavior for candidates (check §candidate generation). `/end-work`.

**Rollback:** migration → re-run migration 100 Part D (old body, same signature — restores no-memory behavior; the index can stay). Prompt → `git revert` the squash commit on a new PR; the agent's bootstrap picks up the old prompt on its next run. Both are independent — either can roll back alone.

---

## Self-review notes (done at plan time)

- All three card patterns map to tasks (1=re-judging, 2=both prompt rules, 3+4=gate); live verification covers the card's "Gate" sentence.
- Verdict-memory design decision: `dry_run=false` rows only (dry-run validation must never suppress live judging); `unmerge` rows DO suppress (human "keep separate" is authoritative); reopen trigger is `article_story.matched_at`, which the attach path stamps on every new membership.
- Known risk: licensed-inference wording could bleed into chain-of-events keeps (gs-189 is literally "later comment on the bill" — same saga, arguably one referent). The rule's guard is "(c) exactly ONE plausible occurrence" + the chain-of-events keep block still standing above it; Task 4 Step 1 forces an independent re-derivation of gs-189 to catch bleed. If it flips, add an explicit carve-out: "a later reaction to an EARLIER beat in a chain is chain-of-events (keep), not licensed inference."
