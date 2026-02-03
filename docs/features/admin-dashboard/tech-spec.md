# Admin Dashboard - Technical Specification

**Document Version:** 1.1
**Created:** 2026-02-01
**Updated:** 2026-02-02
**Status:** Reviewed - Ready for Implementation
**Epic:** TTRC-18 (Admin Dashboard)

**For product requirements, see:** [PRD.md](./PRD.md)

---

## Key Technical Decisions (2026-02-02 Review)

- **Re-enrichment:** Edge function with 30-60 sec execution, spinner feedback on row
- **History retention:** 90 days, cleanup job needed
- **Optimistic locking:** Use `last_updated_at` (not `updated_at`) for stories
- **Schema access:** Use RPC functions (not direct schema.table references)
- **Environment indicator:** Detect via Supabase URL, render in header

---

## 1. Architecture Decision

### Approach: Extend admin-supabase.html

**Decision:** Extend existing `admin-supabase.html` with tabbed navigation

**Rationale:**
- Existing patterns, auth flow, React setup already working
- No build system complexity
- Faster to implement

**Trade-offs:**
- Single file getting large (~75KB already)
- Mitigation: Split into logical tabs/sections

**Alternative Rejected:** New SPA with build system
- Would require deployment changes
- More work for same functionality

---

## 2. Component Structure

```
admin-supabase.html (entry point)
├── Header
│   ├── Environment Title ("PROD Admin Dashboard" / "Test Admin Dashboard")
│   └── BudgetIndicator
│
├── Tab Navigation
│   ├── Home (Dashboard)
│   │   ├── SystemHealthPanel
│   │   ├── NeedsAttentionPanel
│   │   ├── TodayActivityPanel
│   │   └── QuickActionsPanel
│   │
│   ├── Stories Tab
│   ├── Pardons Tab
│   ├── SCOTUS Tab
│   ├── Executive Orders Tab
│   └── Feeds Tab
│
├── Shared Components
│   ├── EditModal (generic, field-driven)
│   ├── ReEnrichButton (with spinner state)
│   ├── BudgetIndicator
│   ├── StatusBadge
│   ├── DataTable (cursor-based pagination, sort, filter)
│   ├── UndoToast (10-sec countdown)
│   ├── DraftPublishedTabs (for pardons/SCOTUS)
│   └── EnvironmentBadge
│
└── API Layer
    ├── Supabase REST queries
    ├── Edge function calls (admin-stats, trigger-enrichment)
    └── RPC calls (log_content_change, undo_content_change)
```

**Note:** Articles are accessed via Story detail view, not as separate tab.

---

## 3. Database Schema Changes

### 3.1 Content History Table (Undo Support)

```sql
-- Migration: xxx_admin_content_history.sql
CREATE SCHEMA IF NOT EXISTS admin;

CREATE TABLE admin.content_history (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,        -- 'story', 'article', 'pardon', 'eo', 'feed'
  entity_id TEXT NOT NULL,          -- ID as text (handles bigint and uuid)
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by TEXT,                  -- GitHub username
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  change_source TEXT DEFAULT 'admin' -- 'admin', 'pipeline', 'api'
);

CREATE INDEX idx_content_history_entity
ON admin.content_history(entity_type, entity_id, changed_at DESC);

CREATE INDEX idx_content_history_changed_at
ON admin.content_history(changed_at DESC);

-- RLS: Only service_role can access
ALTER TABLE admin.content_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON admin.content_history
  FOR ALL USING (auth.role() = 'service_role');
```

### 3.2 Admin Action Audit Log

```sql
-- Migration: xxx_admin_action_log.sql
CREATE TABLE admin.action_log (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID,                  -- Group related actions
  user_id TEXT NOT NULL,            -- GitHub username
  action TEXT NOT NULL,             -- 'create', 'update', 'delete', 're-enrich', 'bulk_update'
  entity_type TEXT NOT NULL,        -- 'story', 'article', 'pardon', 'eo', 'feed'
  entity_id TEXT,                   -- Single entity
  entity_ids TEXT[],                -- For bulk operations
  details JSONB,                    -- Action-specific metadata
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_action_log_user ON admin.action_log(user_id, created_at DESC);
CREATE INDEX idx_action_log_entity ON admin.action_log(entity_type, entity_id);
CREATE INDEX idx_action_log_created ON admin.action_log(created_at DESC);

-- RLS: Only service_role can access
ALTER TABLE admin.action_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON admin.action_log
  FOR ALL USING (auth.role() = 'service_role');
```

### 3.3 Story Quality Flags

```sql
-- Migration: xxx_story_review_flags.sql
ALTER TABLE stories ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT FALSE;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS review_reason TEXT;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

CREATE INDEX idx_stories_needs_review ON stories(needs_review) WHERE needs_review = TRUE;

-- Auto-flag trigger (optional - can also be done in application)
CREATE OR REPLACE FUNCTION flag_story_for_review()
RETURNS TRIGGER AS $$
BEGIN
  -- Flag if summary too short
  IF NEW.summary_neutral IS NOT NULL AND LENGTH(NEW.summary_neutral) < 50 THEN
    NEW.needs_review := TRUE;
    NEW.review_reason := COALESCE(NEW.review_reason || '; ', '') || 'Summary too short';
  END IF;

  -- Flag if low confidence
  IF NEW.confidence_score IS NOT NULL AND NEW.confidence_score < 0.5 THEN
    NEW.needs_review := TRUE;
    NEW.review_reason := COALESCE(NEW.review_reason || '; ', '') || 'Low confidence score';
  END IF;

  -- Flag if enrichment failed
  IF NEW.enrichment_failure_count > 0 THEN
    NEW.needs_review := TRUE;
    NEW.review_reason := COALESCE(NEW.review_reason || '; ', '') || 'Enrichment failed';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER story_review_flag_trigger
  BEFORE INSERT OR UPDATE ON stories
  FOR EACH ROW EXECUTE FUNCTION flag_story_for_review();
```

---

## 4. RPC Functions

### 4.1 Get Admin Stats

```sql
CREATE OR REPLACE FUNCTION get_admin_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'stories', jsonb_build_object(
      'active_count', (SELECT COUNT(*) FROM stories WHERE status = 'active'),
      'needs_review', (SELECT COUNT(*) FROM stories WHERE needs_review = TRUE),
      'enrichment_failed', (SELECT COUNT(*) FROM stories WHERE enrichment_failure_count > 0),
      'created_today', (SELECT COUNT(*) FROM stories WHERE first_seen_at > NOW() - INTERVAL '24 hours')
    ),
    'articles', jsonb_build_object(
      'total_count', (SELECT COUNT(*) FROM articles),
      'today_count', (SELECT COUNT(*) FROM articles WHERE fetched_at > NOW() - INTERVAL '24 hours')
    ),
    'feeds', jsonb_build_object(
      'total', (SELECT COUNT(*) FROM feed_registry),
      'active', (SELECT COUNT(*) FROM feed_registry WHERE is_active = TRUE AND failure_count < 5),
      'degraded', (SELECT COUNT(*) FROM feed_registry WHERE is_active = TRUE AND failure_count BETWEEN 1 AND 4),
      'failed', (SELECT COUNT(*) FROM feed_registry WHERE failure_count >= 5)
    ),
    'pardons', jsonb_build_object(
      'total', (SELECT COUNT(*) FROM pardons),
      'published', (SELECT COUNT(*) FROM pardons WHERE is_public = TRUE),
      'draft', (SELECT COUNT(*) FROM pardons WHERE is_public = FALSE),
      'needs_review', (SELECT COUNT(*) FROM pardons WHERE needs_review = TRUE)
    ),
    'scotus', jsonb_build_object(
      'total', (SELECT COUNT(*) FROM scotus_cases),
      'published', (SELECT COUNT(*) FROM scotus_cases WHERE is_public = TRUE),
      'draft', (SELECT COUNT(*) FROM scotus_cases WHERE is_public = FALSE)
    ),
    'executive_orders', jsonb_build_object(
      'total', (SELECT COUNT(*) FROM executive_orders)
    ),
    'budget', (
      SELECT jsonb_build_object(
        'day', day,
        'spent_usd', spent_usd,
        'cap_usd', cap_usd,
        'openai_calls', openai_calls
      )
      FROM budgets
      WHERE day = CURRENT_DATE
    )
  ) INTO result;

  RETURN result;
END;
$$;
```

### 4.2 Trigger Story Re-enrichment

```sql
CREATE OR REPLACE FUNCTION trigger_story_reenrich(p_story_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_story stories%ROWTYPE;
BEGIN
  -- Get current story state
  SELECT * INTO v_story FROM stories WHERE id = p_story_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Story not found');
  END IF;

  -- Clear enrichment timestamp to trigger re-enrichment on next pipeline run
  UPDATE stories
  SET last_enriched_at = NULL,
      enrichment_status = 'pending',
      enrichment_failure_count = 0
  WHERE id = p_story_id;

  RETURN jsonb_build_object(
    'success', true,
    'story_id', p_story_id,
    'message', 'Story queued for re-enrichment'
  );
END;
$$;
```

### 4.3 Trigger Pardon Re-enrichment

```sql
CREATE OR REPLACE FUNCTION trigger_pardon_reenrich(
  p_pardon_id bigint,
  p_new_version text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_version text;
  v_new_version text;
BEGIN
  -- Get current version
  SELECT enrichment_prompt_version INTO v_current_version
  FROM pardons WHERE id = p_pardon_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pardon not found');
  END IF;

  -- Determine new version
  v_new_version := COALESCE(p_new_version, 'v' || (COALESCE(SUBSTRING(v_current_version FROM 2)::int, 0) + 1)::text);

  -- Update to trigger re-enrichment
  UPDATE pardons
  SET enrichment_prompt_version = v_new_version,
      enriched_at = NULL
  WHERE id = p_pardon_id;

  RETURN jsonb_build_object(
    'success', true,
    'pardon_id', p_pardon_id,
    'old_version', v_current_version,
    'new_version', v_new_version
  );
END;
$$;
```

### 4.4 Log Admin Action

```sql
CREATE OR REPLACE FUNCTION log_admin_action(
  p_user_id text,
  p_action text,
  p_entity_type text,
  p_entity_id text DEFAULT NULL,
  p_entity_ids text[] DEFAULT NULL,
  p_details jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO admin.action_log (
    user_id, action, entity_type, entity_id, entity_ids, details
  ) VALUES (
    p_user_id, p_action, p_entity_type, p_entity_id, p_entity_ids, p_details
  );
END;
$$;
```

### 4.5 Log Content History

```sql
CREATE OR REPLACE FUNCTION log_content_change(
  p_entity_type text,
  p_entity_id text,
  p_field_name text,
  p_old_value text,
  p_new_value text,
  p_changed_by text,
  p_change_source text DEFAULT 'admin'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO admin.content_history (
    entity_type, entity_id, field_name,
    old_value, new_value, changed_by, change_source
  ) VALUES (
    p_entity_type, p_entity_id, p_field_name,
    p_old_value, p_new_value, p_changed_by, p_change_source
  );
END;
$$;
```

### 4.5 Undo Last Change

```sql
CREATE OR REPLACE FUNCTION undo_content_change(
  p_entity_type text,
  p_entity_id text,
  p_changed_by text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_history admin.content_history%ROWTYPE;
  v_table_name text;
BEGIN
  -- Get most recent change for this entity
  SELECT * INTO v_history
  FROM admin.content_history
  WHERE entity_type = p_entity_type
    AND entity_id = p_entity_id
  ORDER BY changed_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No history found');
  END IF;

  -- Map entity type to table name
  v_table_name := CASE p_entity_type
    WHEN 'story' THEN 'stories'
    WHEN 'pardon' THEN 'pardons'
    WHEN 'scotus' THEN 'scotus_cases'
    WHEN 'eo' THEN 'executive_orders'
    WHEN 'feed' THEN 'feed_registry'
    WHEN 'article' THEN 'articles'
    ELSE NULL
  END;

  IF v_table_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unknown entity type');
  END IF;

  -- Execute the undo (articles use TEXT id, others use BIGINT)
  IF p_entity_type = 'article' THEN
    EXECUTE format(
      'UPDATE %I SET %I = $1 WHERE id = $2',
      v_table_name, v_history.field_name
    ) USING v_history.old_value, p_entity_id;
  ELSE
    EXECUTE format(
      'UPDATE %I SET %I = $1 WHERE id = $2',
      v_table_name, v_history.field_name
    ) USING v_history.old_value, p_entity_id::bigint;
  END IF;

  -- Log the undo as a new change
  INSERT INTO admin.content_history (
    entity_type, entity_id, field_name,
    old_value, new_value, changed_by, change_source
  ) VALUES (
    p_entity_type, p_entity_id, v_history.field_name,
    v_history.new_value, v_history.old_value, p_changed_by, 'undo'
  );

  RETURN jsonb_build_object(
    'success', true,
    'field', v_history.field_name,
    'restored_value', v_history.old_value
  );
END;
$$;
```

---

## 5. Edge Functions

### 5.1 Admin Stats Endpoint

```typescript
// supabase/functions/admin-stats/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, validateAdminAuth } from '../_shared/auth.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Validate admin auth
    const authResult = await validateAdminAuth(req)
    if (!authResult.valid) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data, error } = await supabase.rpc('get_admin_stats')

    if (error) throw error

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
```

### 5.2 Trigger Re-enrichment Endpoint

```typescript
// supabase/functions/trigger-enrichment/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, validateAdminAuth } from '../_shared/auth.ts'

const COSTS = {
  story: 0.003,
  pardon: 0.005,
  scotus: 0.01,
  eo: 0.008,
  article_entities: 0.0003
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authResult = await validateAdminAuth(req)
    if (!authResult.valid) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { entity_type, entity_id } = await req.json()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Check budget
    const { data: budget } = await supabase
      .from('budgets')
      .select('spent_usd, cap_usd')
      .eq('day', new Date().toISOString().split('T')[0])
      .single()

    const cost = COSTS[entity_type] || 0.003
    if (budget && budget.spent_usd + cost > budget.cap_usd) {
      return new Response(JSON.stringify({
        error: 'Daily budget exceeded',
        spent: budget.spent_usd,
        cap: budget.cap_usd
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Trigger re-enrichment based on type
    let result
    switch (entity_type) {
      case 'story':
        result = await supabase.rpc('trigger_story_reenrich', { p_story_id: entity_id })
        break
      case 'pardon':
        result = await supabase.rpc('trigger_pardon_reenrich', { p_pardon_id: entity_id })
        break
      case 'scotus':
        // Clear enrichment to trigger re-enrichment
        await supabase
          .from('scotus_cases')
          .update({ enriched_at: null, prompt_version: null })
          .eq('id', entity_id)
        result = { data: { success: true, scotus_id: entity_id } }
        break
      case 'eo':
        // Bump prompt version for EO
        await supabase
          .from('executive_orders')
          .update({ enriched_at: null })
          .eq('id', entity_id)
        result = { data: { success: true, eo_id: entity_id } }
        break
      default:
        throw new Error(`Unknown entity type: ${entity_type}`)
    }

    // Log the action via RPC (can't use schema.table in REST API)
    await supabase.rpc('log_admin_action', {
      p_user_id: authResult.user,
      p_action: 're-enrich',
      p_entity_type: entity_type,
      p_entity_id: String(entity_id),
      p_details: { estimated_cost: cost }
    })

    return new Response(JSON.stringify({
      ...result.data,
      estimated_cost: cost
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
```

---

## 6. Frontend Implementation Patterns

### 6.1 Optimistic Locking

```javascript
// Table-specific timestamp column mapping
const TIMESTAMP_COLUMNS = {
  stories: 'last_updated_at',
  pardons: 'updated_at',
  scotus_cases: 'updated_at',
  executive_orders: 'updated_at',  // May need to add this column
  feed_registry: 'last_fetched_at',
  articles: 'fetched_at'
};

// Before save, check if record was modified
async function saveWithOptimisticLock(table, id, updates, originalTimestamp) {
  const timestampCol = TIMESTAMP_COLUMNS[table] || 'updated_at';

  // First check current state
  const { data: current, error: checkError } = await supabase
    .from(table)
    .select(timestampCol)
    .eq('id', id)
    .single();

  if (checkError) throw checkError;

  // Compare timestamps
  if (current[timestampCol] !== originalTimestamp) {
    throw new Error(
      'This record was modified by another process while you were editing. ' +
      'Please refresh and try again.'
    );
  }

  // Proceed with update
  const { data, error } = await supabase
    .from(table)
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}
```

### 6.2 Content History Logging

```javascript
// Log changes before update
async function updateWithHistory(table, id, updates, currentValues, userId) {
  // Log each changed field
  for (const [field, newValue] of Object.entries(updates)) {
    const oldValue = currentValues[field];
    if (oldValue !== newValue) {
      await supabase.rpc('log_content_change', {
        p_entity_type: table,
        p_entity_id: String(id),
        p_field_name: field,
        p_old_value: String(oldValue),
        p_new_value: String(newValue),
        p_changed_by: userId
      });
    }
  }

  // Then perform update
  return await supabase
    .from(table)
    .update(updates)
    .eq('id', id)
    .select()
    .single();
}
```

### 6.3 Bulk Operation Safety

```javascript
const MAX_BULK_ITEMS = 50;
const CONFIRM_THRESHOLD = 20;

async function bulkReEnrich(items, entityType, costPerItem) {
  // Validate count
  if (items.length > MAX_BULK_ITEMS) {
    throw new Error(`Maximum ${MAX_BULK_ITEMS} items allowed. You selected ${items.length}.`);
  }

  // Calculate cost
  const totalCost = items.length * costPerItem;

  // Require typed confirmation for large batches
  if (items.length > CONFIRM_THRESHOLD) {
    const confirmation = prompt(
      `You are about to re-enrich ${items.length} items.\n` +
      `Estimated cost: $${totalCost.toFixed(2)}\n\n` +
      `Type "CONFIRM" to proceed:`
    );
    if (confirmation !== 'CONFIRM') {
      throw new Error('Operation cancelled');
    }
  }

  // Check budget
  const { data: budget } = await supabase
    .from('budgets')
    .select('spent_usd, cap_usd')
    .eq('day', new Date().toISOString().split('T')[0])
    .single();

  if (budget && budget.spent_usd + totalCost > budget.cap_usd) {
    throw new Error(
      `This operation would exceed daily budget. ` +
      `Current: $${budget.spent_usd.toFixed(2)}, ` +
      `Cost: $${totalCost.toFixed(2)}, ` +
      `Cap: $${budget.cap_usd.toFixed(2)}`
    );
  }

  // Process items
  const results = [];
  for (const item of items) {
    const result = await triggerReEnrich(entityType, item.id);
    results.push(result);
  }

  return results;
}
```

### 6.4 Environment Detection

```javascript
// Detect environment from Supabase URL
function getEnvironment() {
  const url = window.SUPABASE_URL || '';

  // TEST project ref: wnrjrywpcadwutfykflu
  // PROD project ref: osjbulmltfpcoldydexg
  if (url.includes('wnrjrywpcadwutfykflu')) {
    return { name: 'Test', isProd: false };
  }
  if (url.includes('osjbulmltfpcoldydexg')) {
    return { name: 'PROD', isProd: true };
  }

  // Fallback: check for 'test' in URL
  return url.toLowerCase().includes('test')
    ? { name: 'Test', isProd: false }
    : { name: 'PROD', isProd: true };
}

// Render header with environment
function AdminHeader() {
  const env = getEnvironment();
  const headerClass = env.isProd ? 'admin-header-prod' : 'admin-header-test';

  return (
    <header className={headerClass}>
      <h1>{env.name} Admin Dashboard</h1>
      <BudgetIndicator />
    </header>
  );
}
```

**CSS:**
```css
.admin-header-prod {
  background: #1e3a5f;  /* Dark blue */
}
.admin-header-test {
  background: #5f4b1e;  /* Dark orange/brown */
}
```

### 6.5 Undo Toast Component

```javascript
function UndoToast({ entityType, entityId, fieldName, onUndo, onDismiss }) {
  const [timeLeft, setTimeLeft] = React.useState(10);

  React.useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          onDismiss();
          return 0;
        }
        return t - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="undo-toast">
      <span>Updated {fieldName}</span>
      <button onClick={onUndo}>Undo ({timeLeft}s)</button>
      <button onClick={onDismiss}>×</button>
    </div>
  );
}
```

---

## 7. Discord Alerting

### GitHub Workflow Addition

```yaml
# Add to .github/workflows/rss-tracker-prod.yml
# After the main job steps:

- name: Notify Discord on failure
  if: failure()
  run: |
    curl -H "Content-Type: application/json" \
      -d "{
        \"embeds\": [{
          \"title\": \"Pipeline Failed\",
          \"description\": \"RSS Pipeline failed on ${{ github.ref_name }}\",
          \"color\": 15158332,
          \"fields\": [
            {\"name\": \"Workflow\", \"value\": \"${{ github.workflow }}\", \"inline\": true},
            {\"name\": \"Branch\", \"value\": \"${{ github.ref_name }}\", \"inline\": true}
          ],
          \"url\": \"${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}\"
        }]
      }" \
      ${{ secrets.DISCORD_WEBHOOK_URL }}

- name: Notify Discord on success (optional)
  if: success()
  run: |
    curl -H "Content-Type: application/json" \
      -d "{\"content\": \"✅ RSS Pipeline completed successfully\"}" \
      ${{ secrets.DISCORD_WEBHOOK_URL }}
```

### Setup Instructions

1. In Discord: Server Settings → Integrations → Webhooks → New Webhook
2. Name it "TTracker Alerts" and select channel
3. Copy webhook URL
4. In GitHub: Settings → Secrets → Actions → New repository secret
5. Name: `DISCORD_WEBHOOK_URL`, Value: paste webhook URL

---

## 8. API Contracts

### GET /admin-stats

**Response:**
```json
{
  "stories": {
    "active_count": 2700,
    "needs_review": 3,
    "enrichment_failed": 2,
    "created_today": 12
  },
  "articles": {
    "total_count": 3100,
    "today_count": 45
  },
  "feeds": {
    "total": 18,
    "active": 18,
    "degraded": 0,
    "failed": 0
  },
  "pardons": {
    "total": 50,
    "published": 45,
    "draft": 5,
    "needs_review": 2
  },
  "scotus": {
    "total": 12,
    "published": 8,
    "draft": 4
  },
  "executive_orders": {
    "total": 190
  },
  "budget": {
    "day": "2026-02-02",
    "spent_usd": 2.47,
    "cap_usd": 5.00,
    "openai_calls": 823
  }
}
```

### POST /trigger-enrichment

**Request:**
```json
{
  "entity_type": "story",
  "entity_id": 123
}
```

**Response (success):**
```json
{
  "success": true,
  "story_id": 123,
  "message": "Story queued for re-enrichment",
  "estimated_cost": 0.003
}
```

**Response (budget exceeded):**
```json
{
  "error": "Daily budget exceeded",
  "spent": 4.87,
  "cap": 5.00
}
```

---

## 9. Testing Checklist

### Unit Tests
- [ ] Optimistic locking detects conflicts (uses correct timestamp column)
- [ ] Content history logs all field changes for all entity types
- [ ] Undo restores previous value for all entity types
- [ ] Bulk operation caps enforced (50 max, CONFIRM for >20)
- [ ] Budget check blocks over-limit operations
- [ ] Environment detection works for both TEST and PROD URLs

### Integration Tests
- [ ] Admin stats returns correct counts for all content types
- [ ] Re-enrichment triggers update correct fields (stories, pardons, SCOTUS, EOs)
- [ ] Discord webhook fires on failure
- [ ] Audit log captures all actions via RPC

### Manual QA
- [ ] Edit story → Undo toast appears → Undo works within 10 sec
- [ ] Edit while pipeline runs → Conflict detected on save
- [ ] Bulk re-enrich 25 items → "CONFIRM" typed confirmation required
- [ ] Re-enrich when budget exceeded → Blocked with message
- [ ] Re-enrich → Spinner shows on row → Toast on completion
- [ ] Test vs Prod header text displays correctly

---

## 10. Migration Order

**Phase 1 (Home Dashboard):**
1. `xxx_admin_schema.sql` - Create admin schema

**Phase 2 (Stories):**
2. `xxx_admin_content_history.sql` - Content history table (90-day retention)
3. `xxx_admin_action_log.sql` - Action audit log
4. `xxx_story_review_flags.sql` - Story quality flags (needs_review column)
5. `xxx_admin_rpc_functions.sql` - All RPC functions

**Deploy Edge Functions (Phase 2):**
1. `admin-stats` - Stats endpoint
2. `trigger-enrichment` - Re-enrichment trigger

**History Cleanup Job (add after Phase 2):**
```sql
-- Run weekly to enforce 90-day retention
DELETE FROM admin.content_history
WHERE changed_at < NOW() - INTERVAL '90 days';

DELETE FROM admin.action_log
WHERE created_at < NOW() - INTERVAL '90 days';
```

---

## 11. Testing Checklist Updates

### Environment Tests
- [ ] Test environment shows "Test Admin Dashboard" header
- [ ] Prod environment shows "PROD Admin Dashboard" header
- [ ] Header styling differs between environments

### SCOTUS Tests
- [ ] SCOTUS tab loads and paginates
- [ ] SCOTUS edit modal shows all fields
- [ ] SCOTUS re-enrichment triggers correctly
- [ ] SCOTUS draft/published filter works

---

**Last Updated:** 2026-02-02
