# ADO-335: View All Stories with Search & Filters

**Status:** Testing | **Date:** 2026-02-03

Built the Stories tab in the admin dashboard (`public/admin.html`). Created `admin-stories` edge function (auth-gated, POST-only) with cursor-based pagination (25/page), headline search (ILIKE with wildcard escaping), and filters for status and enrichment state. Deployed to TEST Supabase. Click any story row to expand inline details. Also fixed the Supabase dashboard link in Quick Actions. Code reviewed and all issues addressed. Next: verify on test site (https://test--trumpytracker.netlify.app/admin.html), then Ready for Prod.
