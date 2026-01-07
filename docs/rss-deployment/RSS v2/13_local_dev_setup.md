# Local Dev Setup

## Requirements
- Supabase project (TEST)
- Access to SQL editor
- Deno (Edge Functions) if developing worker locally

## Steps
1) Clone repo and open the `/ops/rss-v2` folder.
2) Apply migrations to TEST following `00_README.md` order.
3) For Edge development:
   - Install Deno (v1.45+)
   - Create an `.env` for local testing with `IFTTT_WEBHOOK_URL` (optional)
4) Run unit tests for helper functions (if applicable).

## Tips
- Use `07_post_deployment_verification.sql` after each change.
- Keep `08_rollback_procedures.sql` handy in case of mistakes during testing.
