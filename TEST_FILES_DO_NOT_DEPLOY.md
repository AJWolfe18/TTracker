# TEST BRANCH ONLY FILES - DO NOT CHERRY-PICK TO MAIN

## Files that should NEVER go to production:

### Test Folder Structure (NEVER deploy):
```
test/
├── phase2-verification/
├── phase4-testing/
│   ├── test-phase4.html
│   └── qa-automated-tests.html
└── README.md
```

### Other Test-Only Files:
- `TEST_BRANCH_MARKER.md` - Test branch identifier
- `supabase-config-test.js` - Test environment config
- Any file in `/test` folder
- Any file starting with `test-*`

## Files Safe to Cherry-Pick:
- `public/dashboard.js` - Main dashboard code (Phase 4 improvements)
- Other files in `/public` that aren't test files

## Cherry-Pick Command for Phase 4:
When ready to deploy Phase 4 to production, use:
```bash
# First, get the commit hash for the Phase 4 changes
git log --oneline

# Cherry-pick ONLY the dashboard.js changes
git checkout main
git cherry-pick <commit-hash>

# If the commit includes test files, reset them:
git reset HEAD public/test-phase4.html
git reset HEAD public/qa-automated-tests.html
git checkout -- public/test-phase4.html
git checkout -- public/qa-automated-tests.html
```

## Important:
- ALWAYS review files before cherry-picking
- NEVER merge test branch into main
- Test files can break production
