# ADO-480 — Admin EO Tab Plan (v3.3 — final)

**Status:** LOCKED — ready to build. Decisions baked in (§3). One accepted technical debt item (see §4.7 Accepted Technical Debt) — explicitly NOT a build blocker.
**Parent Epic:** ADO-476 (EO Claude Agent)
**Reference precedent:** ADO-340 (SCOTUS admin tab). Not a drop-in port — schema differs materially; migration required to align.

## 0. Why this is v3.2

v3.1 passed a superpowers code review that found 5 blockers and 9 important gaps. v3.2 resolves each:

- **B1 → §3 D5, §4.2, §6.1**: Re-enrich sets `prompt_version = NULL, enriched_at = NULL` (both pass the existing `prevent_enriched_at_update` trigger because `NULL < anything` evaluates to NULL, not TRUE). No trigger modification and no prompt update required.
- **B2 → §4.7**: Migration adds `BEFORE UPDATE` trigger that auto-sets `updated_at = NOW()` on `executive_orders`, so optimistic locking via CAS works.
- **B3 → §4.6**: Auth is `x-admin-password` header (SCOTUS parity), not `password` in body.
- **B4 → §4.7, §5.1**: Migration filename is `092_eo_admin_publish_gate.sql` (matches repo numeric convention).
- **B5 → §4.2, §5.4**: Re-enrich is allowed from unenriched state (natural "retry" for failed agent runs).
- **I1 → §4.1**: `counts_by_subtab` always reflects filters + sub-tab predicate (filtered denominators).
- **I2 → §4.7, §4.2**: Sync trigger also sets `is_public = false` when it flips `needs_manual_review` to true (re-flag auto-unpublishes; admin re-reviews before re-publishing).
- **I3 → §4.7, §5.1**: `severity_rating` mapping in shared helper `supabase/functions/_shared/eo-severity.ts`; imported by admin edge function (agent already encodes its own mapping in prompt — we accept the duplication rather than churn the prompt).
- **I4 → §4.2, §5.2, §6.1**: `action_tier = 'tracking'` always implies `action_section = null`. Server auto-nulls on update.
- **I5 → §4.7**: Confirmed — `public/admin-supabase.html` is already behind admin-password auth gate; no leak. Remains out of scope.
- **I6 → §4.3**: Bulk publish response matches SCOTUS shape `{success, published[], skipped[], failed[], summary}`.
- **I7**: Resolved by I2 trigger change.
- **I8 → §7**: CI coupling-check language dropped; protected by code review discipline instead.
- **I9 → §5.1**: Build sequence explicitly orders migration → `admin-stats` update, not vice versa.

---

## Earlier revision history (v3 addressing v2 feedback)

1. Decisions in §3 were framed as pending — now recorded as resolved with rationale
2. Flagged → publish acknowledgment wasn't durable — now modeled via a row-level `needs_manual_review` column synced from the log via DB trigger
3. `severity_rating` was both editable and derived — resolved: server-derived only
4. `verified` / `archived` "managed via row buttons" with no such buttons defined — claim removed; those fields are out of scope
5. Bulk publish bypassed optimistic lock — per-row result model with conflicts reported back
6. "Latest log row per EO" had no tiebreaker — locked to `ORDER BY created_at DESC, id DESC`
7. `is_public` migration/backfill was in Risks — promoted to explicit Migration Contract (§4.7)

---

## 1. Schema Reality (ground truth — verified against TEST DB)

### 1a. `docs/database/database-schema.md` is stale

Line 319 lists 9 columns for `executive_orders`. Actual table has ~50. Updating the schema doc is part of the implementation session build sequence (§5.1), not a blocker to starting.

### 1b. Full column inventory, annotated

**Agent-writes (v1 prompt, canonical post-migration):**

| Column | Type | Source | Notes |
|---|---|---|---|
| `section_what_they_say` | text NOT NULL | agent | 150-200 words, neutral |
| `section_what_it_means` | text NOT NULL | agent | 150-200 words, editorial |
| `section_reality_check` | text NOT NULL | agent | 100-150 words |
| `section_why_it_matters` | text NOT NULL | agent | 100-150 words |
| `alarm_level` | smallint 0-5 | agent | Canonical severity, drives frontend labels via tone-system.json |
| `severity_rating` | varchar | **server-derived** | `critical`/`high`/`medium`/`low`/null — always recomputed from `alarm_level` on write (never directly editable by admin) |
| `category` | enum (10 values) | agent | `immigration_border`, `environment_energy`, `health_care`, `education`, `justice_civil_rights_voting`, `natsec_foreign`, `economy_jobs_taxes`, `technology_data_privacy`, `infra_housing_transport`, `gov_ops_workforce` |
| `regions` | text[] NOT NULL | agent | ≤ 3 entries |
| `policy_areas` | text[] NOT NULL | agent | ≤ 3 entries, Title Case |
| `affected_agencies` | text[] NOT NULL | agent | ≤ 3 entries, standard acronyms |
| `action_tier` | text | agent | `direct` / `systemic` / `tracking` |
| `action_confidence` | int | agent | 1-10 |
| `action_reasoning` | text NOT NULL | agent | One-sentence explanation |
| `action_section` | jsonb | agent | `{title, actions[]}` when direct/systemic; **null** when tracking. JSONB IS used on this table — schema doc is wrong. |
| `enriched_at` | timestamptz | agent | |
| `prompt_version` | text | agent | `v1` for agent-written rows |
| `enrichment_meta` | jsonb | agent | `{model, source, enriched_at, prompt_version, signing_statement_used}` |

**System fields (pre-existing):**

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `order_number` | varchar | EO number, e.g. "14338" |
| `date` | date | Signing date |
| `title` | text | |
| `source_url` | text | Federal Register URL |
| `created_at`, `updated_at`, `added_at` | timestamptz | |
| `archived` | bool | Exists, not touched by this ticket |
| `archive_reason` | text | Exists, not touched by this ticket |
| `verified` | bool | Exists, not touched by this ticket |

**Added by this ticket's migration (§4.7):**

| Column | Type | Notes |
|---|---|---|
| `is_public` | bool NOT NULL DEFAULT false | Publish gate. Canonical for "is this EO visible on the public site?" |
| `needs_manual_review` | bool NOT NULL DEFAULT false | Row-level flag. Synced from log via trigger on agent runs. Cleared by publish. Canonical for "Needs Review" tab predicate. |

**Legacy fields (old GPT pipeline, dead weight — dropped in ADO-481 per §3 D6):**

`summary`, `spicy_summary`, `shareable_hook`, `severity_label_inapp`, `severity_label_share`, `eo_impact_type`, `agencies_affected`, `impact_areas`, `severity`, `policy_direction`, `implementation_timeline`, `implementation_status`, `impact_score`, `legal_challenges`, `related_orders`, `description`, `federal_register_url`, `pdf_url`, `citation`, `publication_date`, `document_number`, `source`, `type`

This admin tab ignores all of them (never selects, never shows, never writes).

### 1c. `executive_orders_enrichment_log` (ADO-477, migration 20260415000000)

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `eo_id` | int | FK → `executive_orders.id` ON DELETE CASCADE |
| `prompt_version` | text | |
| `run_id` | text | Links rows from same agent run |
| `status` | text CHECK | `running` / `completed` / `failed` |
| `duration_ms` | int | |
| `needs_manual_review` | bool default false | **Historical** per-run flag — log is audit trail, not canonical for tab predicate |
| `notes` | text | |
| `created_at` | timestamptz | |

Indexes: `created_at DESC`, `(eo_id, created_at DESC)`. RLS enabled, service_role only.

---

## 2. Acknowledgment Model (the v2 durability fix)

v2 proposed: "publish = acknowledgment of the flag." That only worked if we stored acknowledgment somewhere durable, which we didn't.

**v3 model:**

- `needs_manual_review` on `executive_orders` (row-level, canonical for tab predicate)
- `needs_manual_review` on `executive_orders_enrichment_log` (per-run audit record)
- DB trigger on log `INSERT OR UPDATE OF status` when `NEW.status = 'completed'`: syncs `executive_orders.needs_manual_review = NEW.needs_manual_review`
- Publish action sets `executive_orders.needs_manual_review = false` (durable acknowledgment)
- Re-enrich runs the agent; new log row gets written with whatever the agent flags; trigger fires; row-level flag updates
- Unpublish does NOT touch `needs_manual_review` — an acknowledged EO stays acknowledged after unpublish

Result: flagged → publish → unpublish → stays unflagged (until next re-enrichment re-flags it). That's the durable acknowledgment the v2 review asked for.

Trade-off accepted: the log table is immutable history. Publish acknowledgment is recorded by the state of `executive_orders.needs_manual_review` + the implicit `is_public = true` transition at a given timestamp. If we later want full audit of "who acknowledged when," that's a follow-up ticket for an `admin_actions` log table.

---

## 3. Decisions (resolved, baked in)

| # | Question | Decision | Rationale |
|---|---|---|---|
| D1 | Publish gate | **Add `is_public` column (SCOTUS parity)** | Migration cost is one-time; admin UX consistency is worth it. `verified` keeps existing factual-accuracy meaning. |
| D2 | Explicit `enrichment_status` column | **No — derive from `prompt_version`** | Minimal surface. `prompt_version = 'v1'` = enriched; log failures visible via log table. |
| D3 | Explicit `qa_status` column | **No — skip** | Folded into publish action. Revisit if Josh actually uses qa_status on SCOTUS. |
| D4 | Needs-review state source | **Row-level `needs_manual_review` column, synced from log via trigger** | Fixes v2 durability gap; §2 above. |
| D5 | Re-enrich mechanism | **Set `prompt_version = NULL` + `enriched_at = NULL` + `is_public = false` in one UPDATE. Next cron picks up via existing agent filter (`prompt_version.is.null` or `enriched_at.is.null`). Immediate RemoteTrigger-based re-run is a follow-up ticket.** | NULL values pass the existing `prevent_enriched_at_update` trigger (NULL comparisons return NULL, trigger's IF doesn't raise). No prompt update or trigger modification required. Must-Have vs Nice-To-Have. |
| D6 | Legacy column drop timing | **ADO-481, after PROD re-enrichment** | Preserves rollback option if re-enrichment goes wrong. Admin tab ignores them either way. |

---

## 4. Contracts

### 4.1 Tab predicates (explicit SQL)

Sub-tabs:

| Sub-tab | Predicate |
|---|---|
| **Needs Review** | `prompt_version = 'v1' AND is_public = false AND needs_manual_review = true` |
| **Unenriched** | `prompt_version IS DISTINCT FROM 'v1'` |
| **Unpublished** | `prompt_version = 'v1' AND is_public = false` (includes Needs Review as subset — UI de-dupes by showing "Needs Review" first in its own sub-tab) |
| **Published** | `is_public = true` |
| **Failed** | `prompt_version IS DISTINCT FROM 'v1' AND EXISTS (latest log row for this EO with status='failed')` |
| **All** | (no predicate) |

Row-level `needs_manual_review` is canonical for Needs Review — no latest-log join required for this predicate. (Log join is used only for Failed sub-tab and the run_log view, §4.5.)

Home tab card `executive_orders_needs_review`: same predicate as Needs Review sub-tab.

**Filter semantics (I1 fix):** `counts_by_subtab` ALWAYS reflects the current `filters` + `search` from the request. Every sub-tab count uses the same filter set as the active request. Switching sub-tabs does NOT recompute with different filters. UX implication: all sub-tab badges are "filtered counts" — e.g. if user filters `alarm_level=5`, the Needs Review badge shows "how many of the level-5 EOs currently need review," not the unfiltered total.

**Server invariant (tested in §6.1):** each `counts_by_subtab` value equals `COUNT(*)` of items returned when that sub-tab is paginated to completion with the same filters. Divergence = predicate bug.

### 4.2 State machine

States are derived (not stored as an enum) — composed from `is_public` + `prompt_version` + `needs_manual_review`:

```
   unenriched
  (prompt_version ≠ v1)
       │
       │ agent completes
       ▼
  enriched, unflagged                     enriched, flagged
  (v1, !public, !flagged) ◄─── agent run ─── (v1, !public, flagged)
       │ ▲                                         │
       │ │                                         │
    publish                                     publish
       │ │                                         │ (also clears flag)
       ▼ │ unpublish                               │
  published ──── re-enrich (reset prompt_version) ──┘
  (v1, public,            then agent re-runs
   may or may not
   reflag)
```

Allowed transitions:

| From | Action | To | Side effects |
|---|---|---|---|
| enriched, unflagged | publish | published | `is_public=true` |
| enriched, flagged | publish | published | `is_public=true` **AND `needs_manual_review=false`** (durable ack) |
| published | unpublish | enriched (current flag state preserved) | `is_public=false`; does NOT touch `needs_manual_review` |
| any enriched | re-enrich | unenriched | `prompt_version=NULL, enriched_at=NULL, is_public=false` in one UPDATE. Confirmation modal required. `needs_manual_review` left alone until next agent run fires sync trigger. |
| **unenriched (B5)** | **re-enrich** | **unenriched** | `enriched_at=NULL` (if set), `is_public=false`. Natural "retry failed run" affordance. No confirmation needed. |
| any with stale `action_tier=tracking` + non-null `action_section` | auto-normalize on any update (I4) | same state | Server sets `action_section=null` whenever the resolved `action_tier = 'tracking'` |
| any enriched | edit field | same state | Field-level update, no state change |

**Automatic sync trigger behavior (§4.7):**

When `executive_orders_enrichment_log.status` transitions into `'completed'` (and only then), the sync trigger:
1. Copies `log.needs_manual_review → executive_orders.needs_manual_review`
2. **If the new value is `true`, ALSO sets `is_public = false` (I2 fix)** — re-flagged content auto-unpublishes so admin must re-review before it re-appears on the public site

This closes the "published + flagged" state hole. State is always reachable from valid transitions; `is_public=true AND needs_manual_review=true` is impossible by invariant.

**Disallowed (server rejects with 400):**

- Setting `is_public=true` when `prompt_version != 'v1'` — can't publish unenriched
- Setting `is_public` AND `prompt_version` in the same `update` request — use `publish`/`re_enrich` action instead
- Directly setting `needs_manual_review` via `update` — only `publish` clears it; only the sync trigger sets it
- Directly setting `severity_rating` via `update` — server always recomputes from `alarm_level` via shared helper (§4.7 `eo-severity.ts`)
- Setting `action_tier = 'tracking'` with non-null `action_section` in the same payload — server auto-nulls `action_section` and the operation succeeds (soft rejection: the invariant is enforced by normalization, not a 400)
- Bulk re-enrich (not offered — blast radius)

### 4.3 Concurrency

**`updated_at` auto-increment (B2 fix):** The migration (§4.7) installs a `BEFORE UPDATE` trigger on `executive_orders` that sets `NEW.updated_at = NOW()`. This makes optimistic locking work — every write advances the timestamp. Without this trigger, two rapid admin writes could match the same `updated_at` and both succeed. (The `executive_orders` table today has no such trigger; the migration adds it.)

**Single-row mutations** (`update`, `publish`, `unpublish`, `re_enrich`):
- Request body includes `if_updated_at: <iso8601>`
- Server: `UPDATE ... WHERE id = $1 AND updated_at = $2 RETURNING *`
- Empty result → 409 Conflict, client must reload

**Bulk publish (I6 — matches SCOTUS response shape):**
- Request body: `{ items: [{id, if_updated_at}, ...] }` — each row carries its own expected `updated_at`
- Max 50 items per call
- Server iterates per-row with the same CAS pattern; returns:
  ```
  {
    success: true,
    published: [{id, new_updated_at}, ...],
    skipped:   [{id, current_updated_at, reason: "stale_updated_at" | "already_published"}, ...],
    failed:    [{id, reason: "not_enriched" | "db_error", message: "..."}, ...],
    summary: {
      total: number,
      published_count: number,
      skipped_count: number,
      failed_count: number,
    }
  }
  ```
- Shape intentionally mirrors `admin-update-scotus` bulk response (file: `supabase/functions/admin-update-scotus/index.ts:477-488`) so the admin dashboard frontend can share rendering logic.
- Frontend: after bulk publish, if `skipped.length + failed.length > 0`, show modal listing them with option to reload and retry. No silent partial success.

### 4.4 Latest-log tiebreaker (for Failed sub-tab and run log view)

When querying "latest log row per EO":
```sql
SELECT DISTINCT ON (eo_id) *
FROM executive_orders_enrichment_log
ORDER BY eo_id, created_at DESC, id DESC
```

Tiebreaker `id DESC` makes this deterministic even when two log rows share `created_at` to the millisecond.

### 4.5 Pagination contract

- **Default sort:** `date DESC, id DESC` (signing date newest first; id as tiebreaker)
- **Cursor payload:** `{date: "YYYY-MM-DD", id: <int>}` base64-encoded
- **Cursor validator:** regex `^\d{4}-\d{2}-\d{2}$` on `date`; positive int on `id`; reject malformed with 400
- **`date` is a DATE column, not timestamptz** — validator must reject ISO timestamps (SCOTUS had the inverse bug)
- **Page size:** 25 default, 100 max
- **Sort key parser:** use `lastIndexOf('-')` not `split('-')` to support underscored sort keys like `enriched_at-desc`
- **Load More:** `{items, next_cursor}` where `next_cursor` is null at end
- **Array change detection** (regions, policy_areas, affected_agencies, action_section.actions): sort both arrays then JSON.stringify compare, no spurious dirty state

### 4.6 Edge function I/O contracts

#### `admin-executive-orders` (list + run log)

**Authentication (B3 fix — SCOTUS parity):** Both edge functions require the `x-admin-password` HTTP header, verified via the shared `checkAdminPassword(req)` helper at `supabase/functions/_shared/auth.ts`. Password is NEVER sent in the request body (logged at higher risk). Matches all 24 call sites in `public/admin.html`.

Request:
```
POST /admin-executive-orders
headers: { "x-admin-password": <password> }
body: {
  action: "list" | "run_log" | "run_log_detail",
  // action=list
  subtab: "needs_review" | "unenriched" | "unpublished" | "published" | "failed" | "all",
  filters: {
    search?: string,           // matches order_number, title
    alarm_level?: number[],    // e.g. [4, 5]
    category?: string[],       // enum values
    prompt_version?: string[], // e.g. ["v1"]
    date_from?: string,        // YYYY-MM-DD
    date_to?: string,          // YYYY-MM-DD
  },
  sort?: "date-desc" | "date-asc" | "alarm_level-desc" | "enriched_at-desc",
  after?: string,              // base64 cursor
  limit?: number,              // 1..100 default 25
  // action=run_log_detail
  run_id: string,
}
```

Response:
```
// list
{
  items: EO[],                 // with latest_log joined per §4.4
  count: number,               // total matching predicate
  next_cursor: string | null,
  counts_by_subtab: {
    needs_review: number,
    unenriched: number,
    unpublished: number,
    published: number,
    failed: number,
    all: number,
  }
}

// run_log — each run aggregated from log rows grouped by run_id (50 most recent run_ids)
{ runs: [{
    run_id,                           // PK
    started_at,                       // MIN(created_at) WHERE run_id = X
    total_duration_ms,                // SUM(duration_ms) across all rows in run — total agent work time
    eos_processed,                    // COUNT(*) WHERE run_id = X AND status != 'running'
    eos_flagged,                      // COUNT(*) WHERE run_id = X AND needs_manual_review = true
    status_counts: {                  // COUNT(*) GROUP BY status
      running: number,
      completed: number,
      failed: number,
    }
}] }
// Aggregation SQL reference (executed server-side in edge function):
// SELECT run_id,
//        MIN(created_at) AS started_at,
//        COALESCE(SUM(duration_ms), 0) AS total_duration_ms,
//        COUNT(*) FILTER (WHERE status != 'running') AS eos_processed,
//        COUNT(*) FILTER (WHERE needs_manual_review = true) AS eos_flagged,
//        jsonb_build_object(
//          'running',   COUNT(*) FILTER (WHERE status = 'running'),
//          'completed', COUNT(*) FILTER (WHERE status = 'completed'),
//          'failed',    COUNT(*) FILTER (WHERE status = 'failed')
//        ) AS status_counts
//   FROM executive_orders_enrichment_log
//  GROUP BY run_id
//  ORDER BY MIN(created_at) DESC
//  LIMIT 50;

// run_log_detail — all log rows for one run_id, with EO title joined
{ runs: [{
    // all columns from executive_orders_enrichment_log (§1c)
    id, eo_id, prompt_version, run_id, status,
    duration_ms, needs_manual_review, notes, created_at,
    // joined from executive_orders via eo_id
    eo_title, eo_order_number,
}] }
```

#### `admin-update-executive-orders`

Request (same auth contract — `x-admin-password` header):
```
POST /admin-update-executive-orders
headers: { "x-admin-password": <password> }
body: {
  action: "update" | "publish" | "unpublish" | "re_enrich" | "bulk_publish",
  // update / publish / unpublish / re_enrich
  id: number,
  fields?: Partial<EO>,        // update only — editable allowlist per §5.2
  if_updated_at: string,       // ISO
  // bulk_publish
  items?: { id: number, if_updated_at: string }[],  // max 50
}
```

Server validation (§4.2 disallowed list). Response for single-row: `{ok: true, item: EO} | {ok: false, error: "reason"}`. Bulk response shape in §4.3.

### 4.7 Migration Contract (explicit — not risk-section language)

**Migration file (B4 fix):** `migrations/092_eo_admin_publish_gate.sql` — matches repo convention (sequential numeric prefix; last was `091_executive_orders_enrichment_log.sql`). The `scripts/apply-migrations.js` runner orders by this prefix; a datestamped filename would silently desync the numbering.

**Schema changes:**

```sql
BEGIN;

-- ─────────────────────────────────────────────────────────────
-- Column adds
-- ─────────────────────────────────────────────────────────────
ALTER TABLE executive_orders
  ADD COLUMN is_public boolean NOT NULL DEFAULT true,
  ADD COLUMN needs_manual_review boolean NOT NULL DEFAULT false;

-- Explicit backfill: every existing row stays visible on public site
UPDATE executive_orders SET is_public = true;

-- Future rows default to false (require admin publish)
ALTER TABLE executive_orders ALTER COLUMN is_public SET DEFAULT false;

-- ─────────────────────────────────────────────────────────────
-- B2: updated_at auto-increment trigger (enables optimistic locking CAS)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_eo_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER eo_set_updated_at
  BEFORE UPDATE ON executive_orders
  FOR EACH ROW
  EXECUTE FUNCTION set_eo_updated_at();

-- ─────────────────────────────────────────────────────────────
-- Sync trigger: log.needs_manual_review → executive_orders.needs_manual_review
-- I2 fix: re-flag also auto-unpublishes (closes "published + flagged" state hole)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sync_eo_needs_review_from_log()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE executive_orders
     SET needs_manual_review = NEW.needs_manual_review,
         -- I2: if this transition raises the flag, also yank from public site
         is_public = CASE
                       WHEN NEW.needs_manual_review = true THEN false
                       ELSE is_public
                     END
   WHERE id = NEW.eo_id;
  RETURN NEW;
END;
$$;

-- Two triggers (split INSERT vs UPDATE) to make the firing contract explicit.
-- INSERT: fires iff the inserted row is already 'completed'.
CREATE TRIGGER eo_log_sync_needs_review_insert
  AFTER INSERT ON executive_orders_enrichment_log
  FOR EACH ROW
  WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION sync_eo_needs_review_from_log();

-- UPDATE: fires iff status transitions INTO 'completed' from anything else.
-- Redundant 'completed' → 'completed' writes do not re-fire the sync.
CREATE TRIGGER eo_log_sync_needs_review_update
  AFTER UPDATE OF status ON executive_orders_enrichment_log
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
  EXECUTE FUNCTION sync_eo_needs_review_from_log();

-- Firing guarantee:
--   For any single agent run that creates one log row per EO, the sync fires
--   EXACTLY ONCE per EO on the first transition into 'completed' — regardless
--   of whether the agent does INSERT(running) → UPDATE(completed) or
--   INSERT(completed) directly. Redundant UPDATE(completed) writes are no-ops.
--   A failed→completed retry DOES re-fire (correct — new result deserves sync).

-- ─────────────────────────────────────────────────────────────
-- Indexes supporting tab predicates
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_eo_publish_state
  ON executive_orders (prompt_version, is_public, needs_manual_review);

COMMIT;
```

**Existing `lock_enriched_at` trigger (migration 023) — NOT modified.** The re-enrich path writes `prompt_version = NULL` and `enriched_at = NULL`. The existing trigger's checks:
- `IF NEW.prompt_version < OLD.prompt_version` — `NULL < 'v1'` returns NULL, not TRUE; trigger's `IF NULL THEN` does not raise
- `IF OLD.enriched_at IS NOT NULL AND NEW.enriched_at IS DISTINCT FROM OLD.enriched_at AND NOT (NEW.prompt_version > OLD.prompt_version)` — `NOT (NULL > 'v1')` = `NOT NULL` = NULL; the chained AND is NULL (not TRUE); doesn't raise

Subsequent agent enrichment writes `prompt_version = 'v1'`, `enriched_at = <new_ts>`. With `OLD.prompt_version = NULL` and `OLD.enriched_at = NULL`, both trigger checks short-circuit on NULL OLD values and pass. The re-enrich → enrichment cycle survives the trigger without modification.

**`severity_rating` shared helper (I3 fix):** New file `supabase/functions/_shared/eo-severity.ts`:

```typescript
// Maps alarm_level → severity_rating (legacy varchar used by public UI).
// Exported so admin edge functions and any future write-path code share one mapping.
export function deriveSeverityRating(alarmLevel: number | null): string | null {
  if (alarmLevel == null) return null;
  if (alarmLevel >= 5) return 'critical';
  if (alarmLevel === 4) return 'high';
  if (alarmLevel === 3) return 'medium';
  if (alarmLevel === 2) return 'low';
  return null; // 0 or 1
}
```

`admin-update-executive-orders` imports this and recomputes `severity_rating` on every write that changes `alarm_level`. We accept that the agent prompt has its own encoded mapping (currently matches) rather than churn the validated prompt.

**Coordinated frontend change (same PR):**

`public/eo-app.js:674` — the public EO list query must add `is_public=eq.true` so the public site shows only published rows post-migration:

```
executive_orders?select=...&is_public=eq.true&order=date.desc,id.desc&limit=500
```

**Public-read gate contract (applies to every current and future public-facing read):**

| Surface | Today | Required |
|---|---|---|
| Public list (`public/eo-app.js:674`) | Fetches directly via PostgREST, no filter | Must add `is_public=eq.true` |
| Public detail modal | **Renders from list data; no separate fetch** — list filter is sufficient | No separate change needed |
| Any future EO detail edge function | n/a | Must include `is_public=eq.true` in its query |
| Admin list / admin detail | n/a | Admin bypasses gate (sees everything) |
| `public/admin-supabase.html:699` (legacy admin page) | Fetches without filter | **Out of scope for this ticket** — legacy page, deleted separately |

Rule: any query that reads `executive_orders` from an unauthenticated context MUST filter `is_public=eq.true`.

**Accepted technical debt (explicit sign-off from Josh, 2026-04-17):** The `is_public` visibility gate is **client-enforced only** in this ticket. There is no server-side RLS policy on `executive_orders` preventing an unauthenticated PostgREST client from querying rows where `is_public=false` by omitting the filter. This is knowingly accepted because:
- The public site uses the `anon` key and the current query is the only unauthenticated EO reader
- Changing RLS on `executive_orders` has blast radius across every existing consumer
- No privacy-sensitive content sits on `is_public=false` rows (they're unpublished editorial, not PII)

Server-side enforcement (RLS policy `is_public=true` for anon role) is a **follow-up ticket**, NOT a blocker for ADO-480.

Without this coordinated change, the `is_public` column exists but the public site ignores it → everything stays public regardless of admin action → defeats the whole purpose.

**Backfill rationale:** all ~285 existing EOs have been visible on the public site. We don't want any to disappear at migration time. Backfill `is_public=true` preserves the existing visible set. Future agent-enriched EOs default to `false` and require explicit admin publish.

**PROD coordination (ADO-481):** same migration + same frontend change applied at the same time on PROD. After PROD re-enrichment (~285 EOs) completes, admin bulk-publishes them to restore visibility (or the deploy keeps the `is_public=true` backfill for the existing set and only newly-agent-re-enriched rows require publish — TBD in ADO-481 scope).

**Rollback:** migration is reversible with a `DROP COLUMN` / `DROP TRIGGER` script. Frontend rollback is a one-line revert.

---

## 5. Implementation Session

### 5.1 Build sequence

| Step | Work |
|---|---|
| 1 | Update `docs/database/database-schema.md` §executive_orders with §1b annotations |
| 2 | Write migration `092_eo_admin_publish_gate.sql` per §4.7 |
| 3 | **Apply migration to TEST DB first** (via Supabase Dashboard SQL Editor) — required before any edge function deploy below (I9: `admin-stats` reads `needs_manual_review`, which doesn't exist until migration lands) |
| 4 | Create shared helper `supabase/functions/_shared/eo-severity.ts` per §4.7 |
| 5 | New edge function `admin-executive-orders` implementing §4.6 (auth via `x-admin-password` header per B3) |
| 6 | New edge function `admin-update-executive-orders` implementing §4.6 + bulk shape per §4.3 + severity helper import |
| 7 | Update `admin-stats` edge function to include `executive_orders_needs_review` (uses pattern from `admin-stats/index.ts:170-177` for stories.needs_review — if the new column doesn't exist, fall back to 0 instead of erroring) |
| 8 | Deploy all three edge functions to TEST |
| 9 | Update `public/eo-app.js:674` to filter `is_public=eq.true` (coordinated with migration — MUST ship in same PR per §4.7 public-read gate contract) |
| 10 | `ExecutiveOrdersTab` + `EditExecutiveOrderModal` in `public/admin.html` (§5.3) |
| 11 | Home tab card wiring (`executive_orders_needs_review`) |
| 12 | Contract + unit tests (§6.1, §6.2) — wire into `npm run qa:smoke` |
| 13 | Two-pass code review (`feature-dev:code-reviewer` + `superpowers:code-reviewer`) |
| 14 | Live UX review with Josh |
| 15 | Fix findings, commit, push |

Fits one focused session (SCOTUS parallel did this scope in ADO-340 Session 2).

### 5.2 Editable field allowlist (server-enforced)

**Editable via inline modal:**

- Identity: `order_number`, `title`, `date`, `source_url`
- Editorial: `section_what_they_say`, `section_what_it_means`, `section_reality_check`, `section_why_it_matters`
- Metadata: `alarm_level` (0-5), `category` (enum), `regions` (array ≤3), `policy_areas` (array ≤3), `affected_agencies` (array ≤3)
- Action: `action_tier`, `action_confidence`, `action_reasoning`, `action_section` (JSONB)

**Cross-field invariant (I4 — server-normalized, not rejected):**

When any update resolves `action_tier = 'tracking'`, the server sets `action_section = NULL` in the same UPDATE (regardless of what the client sent). Admin doesn't need to remember this. Covers two cases:
1. Admin switches tier from `direct` → `tracking` and forgets to null the orphan action blob
2. Admin sends an update that sets `action_section` while `action_tier` is already `tracking`

**Display-only in modal (never sent in `fields` payload; server rejects if included):**

- `severity_rating` — server always recomputes from `alarm_level` (write-time: `severity_rating = map(alarm_level)`)
- `id`, `created_at`, `updated_at`, `added_at`
- `enriched_at`, `prompt_version`, `enrichment_meta`
- `is_public`, `needs_manual_review` — row-button managed (§5.4), not editable as fields
- Latest log row: `run_id`, `status`, `duration_ms`, `needs_manual_review`, `notes`

**Not surfaced at all (out of scope for this ticket):**

- `archived`, `archive_reason`, `verified` — these columns exist but no UX defined here. Future ticket if needed.

**Hidden entirely (legacy dead weight, dropped in ADO-481):**

- `summary`, `spicy_summary`, `shareable_hook`, `severity_label_inapp`, `severity_label_share`, `eo_impact_type`, `agencies_affected`, `impact_areas`, `severity`, `policy_direction`, `implementation_timeline`, `implementation_status`, `impact_score`, `legal_challenges`, `related_orders`, `description`, `federal_register_url`, `pdf_url`, `citation`, `publication_date`, `document_number`, `source`, `type`

### 5.3 Modal structure

| Section | Default | Fields |
|---|---|---|
| Identity | collapsed | order_number, title, date, source_url |
| Editorial | **open** | 4 `section_*` fields |
| Metadata | **open** | alarm_level, category, regions, policy_areas, affected_agencies, severity_rating (display) |
| Action | collapsed | action_tier, action_confidence, action_reasoning, action_section JSON editor |
| System | collapsed | read-only: id, timestamps, enriched_at, prompt_version, enrichment_meta, latest log row |

### 5.4 Row-level actions

| Button | Label | Visible when | Action |
|---|---|---|---|
| Publish | ▶ Publish | `!is_public && prompt_version === 'v1'` | POST `publish` (clears `needs_manual_review` if flagged) |
| Unpublish | Unpublish | `is_public` | POST `unpublish` |
| Re-enrich | ↻ Re-enrich | always (enriched **or unenriched** per B5) | Confirmation modal only if published; otherwise one-click. POST `re_enrich` (sets `prompt_version=NULL, enriched_at=NULL, is_public=false`). On unenriched/failed rows this is the natural "retry" affordance. |
| Edit | ✎ | always | Open modal |

No Reject button. No Archive/Verify buttons (out of scope).

---

## 6. Testing Strategy

### 6.1 Contract tests (edge functions)

File: `scripts/tests/admin-eo-contracts.test.mjs`. Runs against TEST DB with fixture EOs.

| Test | Assertion |
|---|---|
| List returns only matching predicate | 3 EOs (1 needs_review, 1 published, 1 unenriched) → `subtab=needs_review` returns only the first |
| Count matches paginated total | `count` == sum of item counts across paginated pages |
| `counts_by_subtab` invariant | Each sub-tab's count == `COUNT(*)` when fully paginated |
| Cursor roundtrip | Page 1 `next_cursor` → page 2 fetches correct rows, no overlap, no gaps |
| Sort by underscored key | `sort=enriched_at-desc` parses via `lastIndexOf('-')` |
| Date cursor validator | YYYY-MM-DD accepted; ISO timestamp rejected with 400 |
| Update with stale `if_updated_at` | 409 Conflict |
| Update rejects non-allowlisted field | 400 with field name |
| Update rejects `severity_rating` in payload | 400 (server-derived only) |
| Update rejects `is_public` in `fields` | 400 (use publish action) |
| Publish on unenriched row | 400, "cannot publish unenriched" |
| Publish on flagged row clears flag | Before: `needs_manual_review=true, is_public=false`. After: `needs_manual_review=false, is_public=true` |
| Unpublish does NOT clear flag | Publish flagged → unpublish → flag stays cleared (durable ack) |
| Re-enrich on published row atomically resets all three fields | Published row → re-enrich → `is_public=false, prompt_version=NULL, enriched_at=NULL` in same UPDATE |
| Re-enrich on unenriched row (B5) | Unenriched failed row → re-enrich → `enriched_at=NULL`, no error, returns 200 |
| Re-enrich survives existing `lock_enriched_at` trigger | Write `prompt_version=NULL, enriched_at=NULL` from `prompt_version='v1'` → no exception raised |
| Re-enrich followed by agent re-enrichment survives trigger | After re-enrich, agent write of `prompt_version='v1', enriched_at=<new_ts>` on row with `OLD.enriched_at=NULL` → no exception raised |
| Re-enrich does NOT touch `needs_manual_review` | Flag state preserved until next agent run fires sync trigger |
| `updated_at` auto-advances on every UPDATE (B2) | Sequential UPDATEs within same millisecond get distinct `updated_at` values — second one's CAS against first one's pre-value 409s |
| Severity helper mapping (I3) | 0→null, 1→null, 2→'low', 3→'medium', 4→'high', 5→'critical' |
| `severity_rating` server-recomputed on `alarm_level` change | Update `alarm_level` 2→5 → response shows `severity_rating='critical'` even if client sent different value |
| Re-flag auto-unpublishes (I2) | Insert log `status=completed, needs_manual_review=true` on a currently-published EO → `executive_orders.is_public` flips to false, `needs_manual_review` flips to true |
| Re-flag trigger is idempotent | Re-insert same log payload → row state unchanged (already at target values) |
| `action_tier='tracking'` normalizes `action_section` to null (I4) | Update setting `action_tier='tracking'` with non-null `action_section` → response shows `action_section=null` |
| `action_tier='direct'` preserves `action_section` | Update setting `action_tier='direct'` with valid `action_section` → `action_section` written unchanged |
| Trigger syncs log → row | Insert log row with `status=completed, needs_manual_review=true` → `executive_orders.needs_manual_review` flips to true |
| Trigger only fires on completed | `status=running` or `status=failed` → no sync |
| Trigger fires on running → completed transition | INSERT `status=running, needs_manual_review=true` (no sync) then UPDATE to `status=completed` → sync fires once, row flag updates |
| Trigger does not re-fire on redundant completed → completed | After first sync, a redundant UPDATE setting `status=completed` again → row-level flag not re-written (admin-cleared flag stays cleared) |
| Bulk publish > 50 | 400 |
| Bulk publish per-row CAS | 3 items, 1 stale → response `{published: [2 items], skipped: [1 item, reason: "stale_updated_at"], failed: []}` (SCOTUS-parity shape) |
| Bulk publish — unenriched item rejected per-row | Mix of 1 enriched + 1 unenriched → `{published: [1], skipped: [], failed: [{id, reason: "not_enriched"}]}` |
| Bulk publish — summary counts match arrays | `summary.published_count === published.length` (and same for skipped/failed) |
| Failed sub-tab uses latest log, not any log (N3) | EO with log history [failed, completed] → NOT in Failed; EO with [completed, failed] → IS in Failed |
| counts_by_subtab respects filters (I1) | Apply filter `alarm_level=[5]`; each `counts_by_subtab` value matches `COUNT(*)` of same-filtered pagination |
| Auth header required | Request without `x-admin-password` → 401 |
| Auth header wrong | Request with wrong password → 403 |
| Auth still works (SCOTUS parity) | Request with correct `x-admin-password` → 200 |
| Array change detection | Submit `regions: ['A','B']` when current is `['B','A']` → no-op dirty state |
| Latest-log tiebreaker | Two log rows same `created_at`, different `id` → higher `id` wins |

### 6.2 Unit tests

File: `scripts/tests/admin-eo-unit.test.mjs`. Pure functions.

- Cursor encode/decode
- Tab predicate builder
- Field allowlist filter
- Array sorted comparison
- `severity_rating` mapping function

### 6.3 Manual UX (last)

- All 6 sub-tabs load
- Filters combine correctly
- Edit modal: open, edit, save, stale-save conflict message
- Publish, unpublish, re-enrich behave per §5.4
- Bulk publish 5 items, including one stale → modal lists the conflict
- Run log tab: latest 50 runs, drill-down by run_id
- Home tab card updates after publish

### 6.4 Regression checks

- SCOTUS tab still works (shared `admin-stats` changes must not break SCOTUS home card)
- Public EO list still renders (new `is_public=eq.true` filter correctly applied, existing rows backfilled to true)
- Existing EO detail page still renders for published rows

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Migration runs but frontend not updated | §4.7 explicitly couples the migration SQL with the frontend change; §5.1 build step 9 (frontend filter) comes immediately after step 3 (migration). No CI enforcement — code review discipline catches it. If this becomes a recurring issue post-deploy, follow-up ticket adds a lint workflow. |
| Trigger misfires or double-fires | Two triggers (split INSERT / UPDATE, each with a WHEN clause) — INSERT fires only when row is inserted already-completed; UPDATE fires only on the first transition INTO `completed` from a different status. Redundant `completed→completed` writes do not re-fire. Firing guarantee is explicit in §4.7 SQL comments and tested in contract tests §6.1 ("Trigger only fires on completed", "Trigger syncs log → row"). |
| Unauthenticated direct PostgREST read bypasses `is_public` gate | **Accepted technical debt.** Client-side discipline enforced in this ticket (§4.7). Server-side RLS is a follow-up ticket, explicitly not a build blocker — rationale and Josh sign-off in §4.7 Accepted Technical Debt. |
| PROD deploy disappears EOs if backfill skipped | Backfill step is explicit in §4.7 migration SQL, not optional |
| Predicate drift between frontend/backend | Tab predicates defined once in §4.1, implemented once in edge function, frontend passes opaque subtab name |
| SCOTUS code reuse invites the old `split('-')` + cursor-validator bugs | Contract tests §6.1 catch both explicitly |
| Legacy columns accidentally returned in API | Edge function selects explicit allowlist — never `select=*` |

---

## 8. Out of scope

- PROD deployment (ADO-481)
- Dropping legacy columns from DB (ADO-481 after backfill)
- Retiring legacy GPT enrichment scripts (ADO-482)
- Reject workflow (Re-enrich covers it)
- Bulk re-enrich (blast-radius)
- Archive / Verify UX (fields exist, no UX this ticket)
- Immediate-trigger re-enrich via RemoteTrigger (follow-up)
- Admin actions audit log (future ticket if we need "who acknowledged when")

---

## 9. Definition of Done

- [ ] Migration `092_eo_admin_publish_gate.sql` applied to TEST (§4.7 SQL executed)
- [ ] Shared severity helper `supabase/functions/_shared/eo-severity.ts` created
- [ ] Schema doc updated (§1b annotations in `docs/database/database-schema.md`)
- [ ] `public/eo-app.js` filters `is_public=eq.true` on public list
- [ ] Two new edge functions deployed to TEST, implementing §4.6
- [ ] `admin-stats` updated with `executive_orders_needs_review`
- [ ] `ExecutiveOrdersTab` + `EditExecutiveOrderModal` in `public/admin.html`, row actions per §5.4
- [ ] Home tab card showing `executive_orders_needs_review`
- [ ] Contract tests §6.1 all green, wired into `npm run qa:smoke`
- [ ] Unit tests §6.2 all green
- [ ] Two-pass code review passed (feature-dev + superpowers)
- [ ] Live UX review with Josh — sign-off recorded
- [ ] ADO-480 → Testing state
