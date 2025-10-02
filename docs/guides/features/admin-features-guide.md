# Admin Dashboard Features Documentation

## Overview
The TrumpyTracker admin dashboard provides comprehensive management capabilities for political entries and executive orders.

## Key Features Added (December 19, 2024)

### 1. Manual Article Processor
- **Location**: Green "📰 Process Article" button in the search bar
- **Function**: Triggers GitHub Actions workflow to process articles with Playwright fallback
- **Usage**:
  1. Click "Process Article" button
  2. Enter article URL in the modal
  3. Click "Process Article" to submit
  4. Check GitHub Actions for processing status

### 2. Edit Functionality
- **Location**: "✏️ Edit" button on each entry card (top-right corner)
- **Function**: Opens modal to edit all entry fields
- **Features**:
  - Adaptive modal that shows different fields based on entry type
  - Political entries: Shows Actor field
  - Executive orders: Shows Order Number field
  - All changes saved directly to database

### 3. Test Environment Workflows
Manual GitHub Actions workflows for test environment:
- `test-manual-article.yml`: Process articles in test
- `test-daily-tracker.yml`: Run daily tracker in test
- `test-executive-orders.yml`: Run executive orders tracker in test

Access via: GitHub → Actions → Select workflow → Run workflow

## Entry Types & Fields

### Political Entries
- Date
- Title
- Actor (required)
- Category
- Description
- Source URL
- Source Name
- Severity (low/medium/high)

### Executive Orders
- Date
- Title
- Order Number
- Category
- Summary
- Federal Register URL
- Severity Rating (low/medium/high)

## Testing Checklist

### Before Any Changes
1. Create backup of current admin file
2. Test in test environment first
3. Document what features exist before modification

### After Changes
1. Verify manual article processor button appears
2. Test manual article submission modal
3. Verify edit buttons on all entries
4. Test editing a political entry
5. Test editing an executive order
6. Verify archive/restore still works
7. Test search functionality
8. Check filters work correctly
9. Verify pagination works

## Known Issues & Solutions

### Issue: Features Missing After Updates
**Prevention**: Always test for existing functionality before making changes
**Solution**: This update restored missing features with enhanced React implementation

### Issue: Test Workflows Not Running
**Solution**: Use manual dispatch from GitHub Actions UI
**Note**: Test workflows intentionally don't run automatically to save costs

## Technical Implementation

### Modal System
- Single adaptive modal component
- Dynamically shows/hides fields based on entry type
- Form validation ensures required fields
- Real-time saving to Supabase

### GitHub Integration
- Manual article processor uses repository_dispatch
- Requires GitHub PAT with repo permissions
- Triggers appropriate workflow based on environment

### Database Operations
- Uses SERVICE_ROLE_KEY for admin operations
- Maintains RLS policies for security
- Separate handling for political_entries and executive_orders tables

## Commit Message for This Update
```
Restore admin functionality: manual article processor & edit features

- Added manual article processor button with modal UI
- Implemented edit functionality for all entries
- Created adaptive modal for both entry types
- Added test environment workflows for manual testing
- Enhanced UI with better visual hierarchy
- Maintained all existing functionality (archive, search, filters)
```

## Next Steps
1. Test all functionality in test environment
2. Cherry-pick to production if tests pass
3. Consider implementing Playwright tests (TT-85)
4. Add visual regression testing for UI changes
