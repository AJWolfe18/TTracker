# Test Folder Structure

This folder contains test files that should ONLY exist on the test branch.

## Directory Structure:

```
test/
├── phase2-verification/     # Phase 2 test files
├── phase4-testing/          # Phase 4 test files
│   ├── test-phase4.html    # Manual testing page for Phase 4 features
│   └── qa-automated-tests.html  # Automated QA checks
└── README.md               # This file
```

## Important Notes:

1. **These files should NEVER be cherry-picked to main/production**
2. **Test files are only for the test branch and test environment**
3. **To access test files on deployed test site:**
   - `https://test--taupe-capybara-0ff2ed.netlify.app/test/phase4-testing/test-phase4.html`
   - `https://test--taupe-capybara-0ff2ed.netlify.app/test/phase4-testing/qa-automated-tests.html`

## Why Separate Test Folder?

- **Clear separation** - Test files don't mix with production code
- **Easier to exclude** - Can easily skip entire `/test` folder when deploying
- **Better organization** - Each phase has its own test subfolder
- **Prevents accidents** - Less likely to accidentally deploy test files

## When Cherry-Picking to Main:

Only cherry-pick files from `/public` folder, specifically:
- `public/dashboard.js` (or other production files)

Never cherry-pick anything from `/test` folder.
