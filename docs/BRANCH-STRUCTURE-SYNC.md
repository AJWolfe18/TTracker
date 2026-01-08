# Branch Structure Synchronization Guide

## Issue: File Structure Mismatch Between Branches

### What Happened (August 2025)
When the test and main branches had different file structures, cherry-picking commits between them caused critical production failures.

### The Problem
**Test Branch Structure (OLD):**
```
TTracker/
├── daily-tracker-supabase.js        # Scripts in root
├── supabase-config-node.js         # Config in root
├── manual-article-processor.js      # Everything flat
└── TEST_BRANCH_MARKER.md
```

**Main Branch Structure (NEW):**
```
TTracker/
├── config/                          # Organized folders
│   └── supabase-config-node.js
├── scripts/
│   └── daily-tracker-supabase.js
└── (no TEST_BRANCH_MARKER)
```

### What Broke
1. **Import Paths Failed**
   - Script: `import { supabaseRequest } from './supabase-config-node.js'`
   - But file was in: `../config/supabase-config-node.js`
   - Result: Module not found errors

2. **GitHub Actions Failed**
   - Daily tracker couldn't find config files
   - Production automation stopped working
   - Manual intervention required

3. **Cherry-Pick Chaos**
   - Files landed in wrong directories
   - Duplicate files created
   - Git showed 50+ unexpected changes

## The Solution

### Step 1: Reorganize Test Branch
Moved all files to match main's structure:
```bash
# Config files → config/
supabase-config-*.js → config/

# Scripts → scripts/
daily-tracker-supabase.js → scripts/
executive-orders-tracker*.js → scripts/
manual-article-processor.js → scripts/

# Batch files → scripts/batch/
*.bat → scripts/batch/
```

### Step 2: Fix Import Paths
Updated all imports to use relative paths:
```javascript
// OLD (broken)
import { supabaseRequest } from './supabase-config-node.js';

// NEW (fixed)
import { supabaseRequest } from '../config/supabase-config-node.js';
```

### Step 3: Preserve Test Markers
Keep these ONLY on test branch:
- `TEST_BRANCH_MARKER.md` - Must stay in root
- Test-specific .bat files - Convenient for testing

## Prevention Guidelines

### Always Maintain Identical Structure
Both branches should have:
```
├── config/          # All configuration
├── scripts/         # All automation
│   └── batch/      # All batch files
├── public/         # All frontend
├── docs/           # All documentation
```

### Cherry-Pick Rules
1. **Never merge test → main** (would bring TEST_BRANCH_MARKER)
2. **Always cherry-pick specific commits**
3. **Check file locations after cherry-pick**
4. **Verify import paths still work**

### Test Environment Markers
**Only on test branch:**
- TEST_BRANCH_MARKER.md (root directory)
- Points to test database
- Shows red TEST badge

**Never on main branch:**
- No TEST_BRANCH_MARKER.md
- Uses production database
- No test indicators

## Quick Checks

### Before Cherry-Picking
```bash
# On test branch
ls scripts/        # Should have all .js files
ls config/        # Should have all config files

# On main branch  
ls scripts/        # Should match test structure
ls config/        # Should match test structure
```

### After Cherry-Picking
1. Check GitHub Desktop for unexpected file moves
2. Verify no TEST_BRANCH_MARKER on main
3. Test one script locally before pushing

### If Structure Gets Out of Sync Again
1. Choose main's structure as canonical
2. Reorganize test to match main
3. Fix all import paths
4. Test locally before committing
5. Document any new folder conventions

## Common Errors and Fixes

### Error: "Cannot find module './supabase-config-node.js'"
**Fix:** Change to `'../config/supabase-config-node.js'`

### Error: 50+ files showing as changed
**Fix:** You're comparing different structures. Reorganize first.

### Error: TEST badge showing on production
**Fix:** TEST_BRANCH_MARKER.md got onto main. Remove it immediately.

### Error: Test using production database
**Fix:** TEST_BRANCH_MARKER.md is missing from test branch. Add it back.

---

*Last Updated: August 19, 2025*
*Created after production incident caused by structure mismatch*