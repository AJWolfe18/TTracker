# Admin Dashboard - Technical Specification

**Document Version:** 1.0
**Created:** 2026-02-01
**Status:** Draft
**Epic:** TTRC-18 (Admin Dashboard)

**For product requirements, see:** [PRD.md](./PRD.md)

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
├── Tab Navigation
│   ├── Home (Dashboard)
│   ├── Content Management
│   │   ├── Stories Tab
│   │   ├── Articles Tab
│   │   ├── Pardons Tab
│   │   ├── Executive Orders Tab (existing, enhance)
│   │   └── Feeds Tab (new)
│   │
│   └── System Health
│       ├── Overview Tab
│       ├── Feed Health Tab
│       ├── Job Queue Tab
│       ├── Budget Tab
│       └── Error Log Tab
│
├── Shared Components
│   ├── EditModal (generic, field-driven)
│   ├── ReEnrichButton
│   ├── BudgetIndicator
│   ├── StatusBadge
│   ├── DataTable (pagination, sort, filter)
│   └── UndoToast
│
└── API Layer
    ├── Supabase REST queries
    ├── Edge function calls
    └── Re-enrichment triggers
```

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

### 4.4 Log Content History

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
  v_sql text;
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

  -- Build and execute UPDATE statement
  -- Note: This is simplified - production would need table mapping
  CASE p_entity_type
    WHEN 'story' THEN
      EXECUTE format(
        'UPDATE stories SET %I = $1 WHERE id = $2',
        v_history.field_name
      ) USING v_history.old_value, p_entity_id::bigint;
    WHEN 'pardon' THEN
      EXECUTE format(
        'UPDATE pardons SET %I = $1 WHERE id = $2',
        v_history.field_name
      ) USING v_history.old_value, p_entity_id::bigint;
    -- Add other entity types as needed
  END CASE;

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
  eo: 0.015,
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
      case 'eo':
        // Bump prompt version for EO
        await supabase
          .from('executive_orders')
          .update({ prompt_version: 'v2', enriched_at: null })
          .eq('id', entity_id)
        result = { data: { success: true } }
        break
      default:
        throw new Error(`Unknown entity type: ${entity_type}`)
    }

    // Log the action
    await supabase.from('admin.action_log').insert({
      user_id: authResult.user,
      action: 're-enrich',
      entity_type,
      entity_id: String(entity_id),
      details: { estimated_cost: cost }
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
// Before save, check if record was modified
async function saveWithOptimisticLock(table, id, updates, originalUpdatedAt) {
  // First check current state
  const { data: current, error: checkError } = await supabase
    .from(table)
    .select('updated_at')
    .eq('id', id)
    .single();

  if (checkError) throw checkError;

  // Compare timestamps
  if (current.updated_at !== originalUpdatedAt) {
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

### 6.4 Undo Toast Component

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
  "budget": {
    "day": "2026-02-01",
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
- [ ] Optimistic locking detects conflicts
- [ ] Content history logs all field changes
- [ ] Undo restores previous value
- [ ] Bulk operation caps enforced
- [ ] Budget check blocks over-limit operations

### Integration Tests
- [ ] Admin stats returns correct counts
- [ ] Re-enrichment triggers update correct fields
- [ ] Discord webhook fires on failure
- [ ] Audit log captures all actions

### Manual QA
- [ ] Edit story → Undo works
- [ ] Edit while pipeline runs → Conflict detected
- [ ] Bulk re-enrich 25 items → Confirmation required
- [ ] Re-enrich when budget exceeded → Blocked with message

---

## 10. Migration Order

1. `xxx_admin_schema.sql` - Create admin schema
2. `xxx_admin_content_history.sql` - Content history table
3. `xxx_admin_action_log.sql` - Action audit log
4. `xxx_story_review_flags.sql` - Story quality flags
5. `xxx_admin_rpc_functions.sql` - All RPC functions

**Deploy Edge Functions:**
1. `admin-stats`
2. `trigger-enrichment`

---

**Last Updated:** 2026-02-01
