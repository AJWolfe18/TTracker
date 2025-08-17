# TEST BRANCH MARKER

This file exists only on the test branch and is used for environment detection.

**DO NOT DELETE OR MOVE THIS FILE**

The presence of this file in the root directory triggers:
- Connection to test database instead of production
- Display of red "TEST" badge on the interface
- Use of test Supabase credentials

This file should NEVER be cherry-picked to the main branch.