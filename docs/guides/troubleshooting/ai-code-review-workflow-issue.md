# AI Code Review Workflow Troubleshooting

**Date**: 2025-10-08
**Issue**: AI Code Review workflow not triggering on pull_request events
**Status**: UNRESOLVED (multiple attempted fixes)
**Workflow File**: `.github/workflows/ai-code-review.yml`
**Workflow ID**: 195709221 (suspected to be cached)

## Summary

The AI Code Review workflow is configured to run automatically on pull request events (`opened`, `synchronize`, `reopened`) but fails to trigger when PRs are created or updated. The workflow only appears to run on `push` events (which then fail). A fresh workflow file (`ai-code-review-v2.yml`) has been created to test if the issue is related to GitHub Actions caching the old/broken workflow ID.

## Timeline of Debugging Attempts

### Attempt 1: Branch Configuration (FAILED)
**Problem**: Workflow only configured for `main` branch by default, PR #5 targets `test` branch
**Action**: Added `branches: [main, test]` to pull_request trigger
**Location**: Initially tried on `test` branch (ineffective)
**Result**: FAILED - Workflow changes must be on base branch for GitHub to recognize them

### Attempt 2: Workflow Changes on Main Branch (FAILED)
**Problem**: Workflow changes on test branch not recognized
**Action**: Pushed workflow changes to `main` branch with `branches: [main, test]`
**Commit**: `137726e` on main
**Result**: FAILED - Workflow still not triggering on pull_request events

### Attempt 3: Manual Workflow Trigger (FAILED)
**Problem**: Tried to manually trigger workflow to force refresh
**Action**: Attempted `gh workflow run` via GitHub Actions UI
**Error**: "Workflow does not have 'workflow_dispatch' trigger"
**Note**: Workflow DOES have workflow_dispatch, but only accepts pr_number input
**Result**: FAILED - Cannot manually trigger without PR context

### Attempt 4: Close/Reopen PR #5 (FAILED - Multiple Times)
**Problem**: GitHub not picking up workflow changes
**Action**: Closed and reopened PR #5 multiple times to trigger pull_request events
**Result**: FAILED - Only "Test Real RSS Pipeline" workflow triggers, AI review never appears

### Attempt 5: Manual Workflow File Edit on GitHub (FAILED)
**Problem**: Suspected GitHub UI cache issue
**Action**: User manually edited workflow file on GitHub web interface to force refresh
**Result**: FAILED - Exposed YAML syntax error on line 106

### Attempt 6: Fix YAML Syntax Error (PARTIAL SUCCESS)
**Problem**: Line 106 had triple backticks and JSON with curly braces inside heredoc
**Error**: "unexpected end of the stream within a flow collection"
**Root Cause**: YAML parser interpreting `{}` as flow collections instead of literal text
**Action**:
- Created branch `fix/workflow-yaml-syntax` from main
- Removed problematic JSON example entirely
- Replaced with plain text description
- Created PR #7, merged to main

**Original (BROKEN)**:
```yaml
Output format (JSON in markdown code block):
```json
{
  "BLOCKERS": [...],
  "NON_BLOCKING": [...]
}
```
If nothing to report, return empty arrays for both sections.
EOF
```

**Fixed (WORKING YAML)**:
```yaml
Output format: Return JSON with two arrays - BLOCKERS and NON_BLOCKING.
Each finding should have: file, lines, type, why, and patch fields.
If nothing to report, return empty arrays for both sections.
EOF
```

**Result**: PARTIAL SUCCESS - YAML now valid, but workflow still not triggering

### Attempt 7: Verify Workflow Status via API (CONFIRMED ISSUE)
**Problem**: Need to confirm workflow is actually broken, not just UI issue
**Action**: Used GitHub API to list workflow runs filtered by event type

**Evidence of Issue**:
```bash
# Check pull_request event runs
$ gh api "repos/AJWolfe18/TTracker/actions/runs?event=pull_request" --jq '.workflow_runs[].name'
Test Real RSS Pipeline
Test Real RSS Pipeline
# AI Code Review is MISSING - it never runs on pull_request events

# Check push event runs
$ gh api "repos/AJWolfe18/TTracker/actions/runs?event=push" --jq '.workflow_runs[].name'
AI Code Review (Latest Commit Only)  # Only appears here
Test Real RSS Pipeline
```

**Result**: CONFIRMED - Workflow never triggers on pull_request events, only on push

## Current Hypothesis

**Root Cause**: GitHub Actions has cached the old/broken workflow configuration (Workflow ID: 195709221)

**Supporting Evidence**:
1. Workflow file is valid YAML (verified after syntax fix)
2. Workflow has correct branch targeting: `branches: [main, test]`
3. Workflow is on main branch (where it needs to be)
4. Identical RSS workflow triggers correctly on pull_request events
5. AI review workflow only appears in push event runs (where it fails)
6. Multiple close/reopen cycles did not refresh the workflow
7. Manual workflow file edits did not refresh the workflow

**GitHub Actions Caching Behavior**:
- GitHub caches workflow configurations by workflow ID
- Cache refresh is not immediate when workflow files change
- Cache may persist for 30-60 minutes or longer
- Creating a new workflow file generates a fresh workflow ID

## Current Configuration

### Workflow Trigger (Correct)
```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened]
    branches: [main, test]  # Supports both main and test PRs
  workflow_dispatch:
    inputs:
      pr_number:
        description: 'PR number to review'
        required: true
        type: number
```

### Workflow Permissions (Correct)
```yaml
permissions:
  contents: read
  pull-requests: write
```

### Workflow Environment (Correct)
```yaml
env:
  LLM_API_BASE: https://api.openai.com/v1
  LLM_MODEL: gpt-5
  MAX_CHUNK_BYTES: "60000"
```

## Errors Encountered

### Error 1: YAML Syntax Error (RESOLVED)
**Line**: 106
**Error Message**: "unexpected end of the stream within a flow collection"
**Cause**: Triple backticks and JSON curly braces `{}` inside heredoc
**Fix**: Removed JSON example, replaced with plain text description
**Status**: ✅ RESOLVED

### Error 2: Workflow Not Triggering (UNRESOLVED)
**Symptom**: Workflow never appears in pull_request event runs
**Cause**: Suspected GitHub Actions cache holding stale workflow config
**Status**: ❌ UNRESOLVED

### Error 3: Permission Denied for Main Branch (RESOLVED)
**Error**: "Permission to use Bash with command git checkout main has been denied"
**Fix**: User granted permission via Claude Code settings
**Status**: ✅ RESOLVED

### Error 4: Merge Conflicts on PR #6 (RESOLVED)
**Cause**: Test branch diverged significantly from main
**Fix**: Aborted merge, closed PR #6, edited directly on main
**Status**: ✅ RESOLVED

## Recommended Next Steps

### Immediate Action (DONE)
1. ✅ Create new workflow file with different name: `ai-code-review-v2.yml`
2. ✅ Push to main branch to ensure GitHub recognizes it
3. ⏳ Test by creating a new PR to test branch
4. ⏳ Verify new workflow triggers on pull_request events

### Short-term Solutions (If New Workflow Works)
1. Disable or delete old `ai-code-review.yml` file
2. Update any documentation references to point to v2 workflow
3. Monitor v2 workflow for stability

### Long-term Solutions (If Issue Persists)
1. **Wait for GitHub Cache Expiration** (30-60 minutes minimum)
   - Sometimes cache persists for hours or even 24+ hours
   - GitHub does not provide cache invalidation API

2. **Contact GitHub Support** (if >24 hours)
   - Provide workflow ID: 195709221
   - Provide repository: AJWolfe18/TTracker
   - Describe caching issue and all attempted fixes

3. **Temporary Manual Trigger Workaround**
   - Use `workflow_dispatch` with PR number
   - Command: `gh workflow run ai-code-review.yml -f pr_number=X`
   - Requires manual intervention for each PR

4. **Alternative: Use GitHub Apps or Actions Bot**
   - Consider third-party code review GitHub Apps
   - Or create custom action that triggers via issue_comment event

## Testing Plan for New Workflow

### Step 1: Create Test PR
```bash
git checkout test
git checkout -b test/workflow-v2-trigger
echo "# Test commit for v2 workflow" >> README.md
git add README.md
git commit -m "test: trigger ai-code-review-v2 workflow"
git push -u origin test/workflow-v2-trigger
gh pr create --base test --title "Test: AI Review v2 Workflow" --body "Testing new v2 workflow file"
```

### Step 2: Verify Workflow Triggers
```bash
# Wait 30 seconds, then check
gh api "repos/AJWolfe18/TTracker/actions/runs?event=pull_request" --jq '.workflow_runs[] | select(.name | contains("v2")) | {name, conclusion, status}'
```

### Step 3: Expected Success Criteria
- ✅ "AI Code Review v2" appears in pull_request event runs
- ✅ Workflow status is "queued" or "in_progress" or "completed"
- ✅ PR comment posted with review results
- ✅ "ai-reviewed" label added to PR

### Step 4: If V2 Fails
- Check workflow file for YAML syntax errors
- Check GitHub Actions logs for error messages
- Verify OPENAI_API_KEY secret is set
- Verify gh CLI is available in runner

## Key Learnings

### GitHub Actions Workflow Trigger Requirements
1. **Workflow file location matters**: Must be on base branch for pull_request events
2. **Branch targeting**: Use `branches: [main, test]` to support multiple base branches
3. **YAML syntax in heredocs**: Cannot use backticks or unescaped braces inside heredocs
4. **Workflow caching**: GitHub caches workflow configs, changes may not apply immediately
5. **Event filtering**: `pull_request` events only trigger if workflow exists on base branch

### YAML Syntax Gotchas
1. **Heredoc delimiters**: `<<'EOF'` prevents variable expansion, but backticks still break
2. **Flow collections**: Curly braces `{}` are interpreted as YAML flow syntax
3. **Multiline strings**: Use `|` or `>` for clean multiline, not heredocs with complex content

### Process Improvements
1. **Test workflow files in isolation**: Create minimal test workflow to verify triggers
2. **Use workflow_dispatch for testing**: Allows manual trigger without waiting for events
3. **Monitor via API**: Don't rely on GitHub UI, use API to verify runs
4. **Version workflow files**: Use v2, v3 naming to avoid cache issues when debugging

## Related Documentation

- **Process Doc**: `/docs/CLAUDE_CODE_STARTUP.md`
- **Implementation Guide**: `/docs/TTRC-148-implementation-guide.md`
- **GitHub Actions Workflow Syntax**: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions
- **GitHub Actions Events**: https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows

## Questions for GitHub Support (If Needed)

1. Why does workflow ID 195709221 only trigger on push events, not pull_request events?
2. How long does GitHub Actions cache workflow configurations?
3. Is there a way to force invalidate workflow cache for a specific workflow ID?
4. Can you confirm if workflow ID 195709221 has a corrupted or stale cache entry?

## Contact Information

**Repository**: AJWolfe18/TTracker
**Workflow ID (Old)**: 195709221
**Workflow File (Old)**: `.github/workflows/ai-code-review.yml`
**Workflow File (New)**: `.github/workflows/ai-code-review-v2.yml`
**Last Updated**: 2025-10-08
