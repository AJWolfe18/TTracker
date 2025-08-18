# Commit Message

Fix admin dashboard to use dynamic environment detection

## Changes Made:
1. **admin-supabase.html** - Now loads supabase-browser-config.js for dynamic environment detection
2. **admin-supabase.html** - Uses window.SUPABASE_CONFIG instead of hardcoded production URLs
3. **admin-supabase.html** - Added TEST badge to show when running against test database
4. **test-admin-config.html** - Created test file to verify configuration

## Problem Fixed:
- Admin panel was hardcoded to production database even on test branch
- Now properly detects environment and connects to correct database
- Test environment shows clear TEST indicator

## Testing:
1. Visit /test-admin-config.html to verify configuration
2. Visit /admin-supabase.html to see it connect to correct database
3. Check console for confirmation message about which DB is being used
