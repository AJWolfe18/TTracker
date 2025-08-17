# TEST BRANCH MARKER

⚠️ **THIS FILE MUST REMAIN IN THE ROOT DIRECTORY** ⚠️

This file enables test environment detection for TrumpyTracker.

## Purpose
The presence of this file in the root directory triggers:
- ✅ Connection to TEST database instead of production
- ✅ Display of red "TEST ENVIRONMENT" badge on the interface  
- ✅ Use of test Supabase credentials
- ✅ Isolation from production data

## Critical Rules
1. **DO NOT DELETE** this file on the test branch
2. **DO NOT MOVE** this file to any subfolder
3. **NEVER CHERRY-PICK** this file to main branch
4. **NEVER MERGE** test branch into main (use cherry-pick for specific commits)

## How It Works
The `supabase-browser-config.js` and other config files check for the existence of this file to determine which environment to use.

## If This File Is Missing
- Test site will connect to PRODUCTION database ⚠️
- Data corruption risk! 
- No visual indication you're on test environment

---
**Branch:** test  
**Auto-deploys to:** https://test--taupe-capybara-0ff2ed.netlify.app/  
**Test Database:** wnrjrywpcadwutfykflu.supabase.co  

*This file was created on the test branch and should ONLY exist here.*