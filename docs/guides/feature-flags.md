# Feature Flags Guide

## Overview

Feature flags allow you to deploy code to PROD without activating it for users. This decouples **deployment** (code in PROD) from **release** (users can see it).

**Benefits:**
- Ship code to PROD early and often (no 748-commit gaps)
- Test features on PROD with flags before public release
- Instant rollback = flip flag off (no code revert)
- Work on multiple features without blocking each other

---

## Quick Start

### 1. Add the script to your page

```html
<script src="shared/feature-flags.js"></script>
```

### 2. Initialize on page load

```javascript
await FeatureFlags.init();
```

### 3. Check flags in your code

```javascript
if (FeatureFlags.isEnabled('scotus')) {
  // Show SCOTUS nav item
  document.getElementById('scotus-nav').style.display = 'block';
}

if (FeatureFlags.isEnabled('tone_v2')) {
  // Use new tone labels
  label = getToneV2Label(alarmLevel);
} else {
  // Use legacy labels
  label = getLegacySeverityLabel(severity);
}
```

---

## How It Works

### Environment Detection

The system auto-detects environment from hostname:

| Hostname | Environment | Flags File |
|----------|-------------|------------|
| `trumpytracker.com` | PROD | `flags-prod.json` |
| `*.netlify.app` | TEST | `flags-test.json` |
| `localhost` | TEST | `flags-test.json` |

### Flag Files

**TEST** (`public/shared/flags-test.json`):
```json
{
  "scotus": true,
  "pardons": true,
  "tone_v2": true
}
```

**PROD** (`public/shared/flags-prod.json`):
```json
{
  "scotus": false,
  "pardons": true,
  "tone_v2": false
}
```

### URL Overrides (Testing)

Override any flag via query parameter:

```
https://trumpytracker.com/?ff_scotus=true
https://trumpytracker.com/?ff_tone_v2=true&ff_scotus=true
```

This lets you test features on PROD before flipping the flag for everyone.

---

## Adding a New Feature Flag

### Step 1: Add to both flag files

```json
// flags-test.json - enable for testing
{
  "my_new_feature": true
}

// flags-prod.json - disable until verified
{
  "my_new_feature": false
}
```

### Step 2: Use in code

```javascript
if (FeatureFlags.isEnabled('my_new_feature')) {
  renderNewFeature();
} else {
  renderLegacyFeature(); // or nothing
}
```

### Step 3: Deploy to PROD

Code deploys with flag OFF - users see nothing different.

### Step 4: Test on PROD

Visit `trumpytracker.com/?ff_my_new_feature=true` to verify.

### Step 5: Flip the flag

Edit `flags-prod.json`, set `"my_new_feature": true`, deploy.

### Step 6: Clean up (optional)

After feature is stable, remove the flag check and delete from flag files.

---

## Version Migration Pattern (v1 → v2)

When replacing an existing feature with a new version:

### Planning Phase

Before coding, answer:
1. **Database**: New columns needed? Can old data coexist?
2. **Backend**: Can enrichment write to both old and new fields?
3. **Frontend**: Can we show v1 or v2 based on flag?
4. **Rollback**: If v2 breaks, can we flip back to v1?

### Implementation

**Database:**
```sql
-- Add new columns, keep old ones
ALTER TABLE stories ADD COLUMN alarm_level INT;
-- Don't delete severity column yet
```

**Backend (enrichment):**
```javascript
// Write to both during transition
story.alarm_level = calculateAlarmLevel();
story.severity = mapAlarmToLegacySeverity(story.alarm_level);
```

**Frontend:**
```javascript
if (FeatureFlags.isEnabled('tone_v2')) {
  // v2: Use alarm_level + new labels
  const label = toneSystem.labels[alarmLevel];
} else {
  // v1: Use severity + old labels
  const label = legacyLabels[severity];
}
```

### Rollout Sequence

1. **Week 1**: Deploy database migration (invisible)
2. **Week 1**: Deploy backend writing to both fields (invisible)
3. **Week 2**: Deploy frontend with flag OFF (invisible)
4. **Week 2**: Test on PROD with `?ff_tone_v2=true`
5. **Week 3**: Flip flag ON in `flags-prod.json`
6. **Week 4+**: Monitor, then clean up old code/columns

---

## Best Practices

### DO

- ✅ Default new features to OFF in PROD
- ✅ Test with URL override before flipping flag
- ✅ Keep flag names consistent with ADO feature names
- ✅ Clean up flags after feature is stable (avoid flag debt)
- ✅ Document flag purpose in the JSON comment field

### DON'T

- ❌ Use flags for bug fixes (just fix and deploy)
- ❌ Nest flag checks deeply (refactor if needed)
- ❌ Leave flags forever (clean up after 2-4 weeks stable)
- ❌ Use flags for A/B testing (that needs analytics, not just flags)

---

## API Reference

### `FeatureFlags.init()`

Initialize the system. Call once on page load.

```javascript
await FeatureFlags.init();
```

### `FeatureFlags.isEnabled(flagName)`

Check if a flag is enabled.

```javascript
if (FeatureFlags.isEnabled('scotus')) { ... }
```

### `FeatureFlags.getEnvironment()`

Get detected environment.

```javascript
const env = FeatureFlags.getEnvironment(); // 'prod' or 'test'
```

### `FeatureFlags.getAll()`

Get all flag values (for debugging).

```javascript
console.log(FeatureFlags.getAll());
// { scotus: true, pardons: true, tone_v2: false }
```

---

## Troubleshooting

### Flag not working

1. Check console for `[FeatureFlags]` logs
2. Verify `init()` was called before `isEnabled()`
3. Check flag name matches exactly (case-sensitive)
4. Try URL override to confirm flag logic works

### Wrong environment detected

Check hostname detection in console log:
```
[FeatureFlags] Initialized (prod): { scotus: false, ... }
```

If wrong, update `detectEnvironment()` in `feature-flags.js`.

### Flag file not loading

Check browser network tab for 404. Path may be wrong if page is nested (e.g., `/scotus/index.html`).

---

## File Locations

| File | Purpose |
|------|---------|
| `public/shared/feature-flags.js` | Flag loader/checker |
| `public/shared/flags-test.json` | TEST environment flags |
| `public/shared/flags-prod.json` | PROD environment flags |

---

**Last Updated:** 2026-01-24
**Related:** `docs/guides/prod-deployment-checklist.md`, `CLAUDE.md`
