# Supabase CLI & Edge Functions Setup Guide

## Prerequisites Installation

### 1. Install Node.js (if not already installed)
- Download from: https://nodejs.org/
- Verify: `node --version` (should be v18 or higher)

### 2. Install Supabase CLI

#### Windows (using npm):
```bash
npm install -g supabase
```

#### Alternative (using Scoop):
```bash
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
```

### 3. Verify Installation
```bash
supabase --version
```

## Project Setup

### 1. Initialize Supabase in Project
```bash
cd C:\Users\Josh\OneDrive\Desktop\GitHub\TTracker
supabase init
```

This will create:
- `supabase/` directory
- `supabase/config.toml` configuration file

### 2. Link to Your Project

#### For TEST Environment:
```bash
supabase link --project-ref wnrjrywpcadwutfykflu
```

#### For PRODUCTION Environment (later):
```bash
supabase link --project-ref osjbulmltfpcoldydexg
```

You'll be prompted to enter your database password.

### 3. Pull Remote Schema (Optional)
```bash
supabase db pull
```

This creates a migration file with your current schema.

## Edge Functions Setup

### 1. Create Functions Directory
The `supabase init` command should have created `supabase/functions/` directory.

### 2. Create Function Endpoints
We'll create these functions:
- `stories-active` - GET active stories
- `stories-detail` - GET story by ID
- `stories-search` - GET search/filter stories
- `articles-manual` - POST manual submission

### 3. Environment Variables Setup

Create `.env.local` file in project root:
```env
# Test Environment
SUPABASE_URL=https://wnrjrywpcadwutfykflu.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InducmpyeXdwY2Fkd3V0ZnlrZmx1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyMjA3MzcsImV4cCI6MjA3MDc5NjczN30.n-4DboHQSivt5GWx7X5wuaUsdmjsuJe0VgB18V-GxU4
SUPABASE_SERVICE_KEY=<get from Supabase dashboard>
ADMIN_API_KEY=<generate a secure key>
```

### 4. Get Service Key
1. Go to https://app.supabase.com
2. Select your project (wnrjrywpcadwutfykflu for test)
3. Go to Settings → API
4. Copy the `service_role` key (keep this secret!)

## Local Development

### 1. Start Supabase Locally
```bash
supabase start
```

This starts:
- Local Postgres database
- Local Auth server
- Local Storage server
- Local Edge Functions server

### 2. Serve Functions Locally
```bash
supabase functions serve
```

Functions will be available at:
- http://localhost:54321/functions/v1/[function-name]

### 3. Test a Function
```bash
curl http://localhost:54321/functions/v1/stories-active
```

## Deployment

### 1. Deploy a Single Function
```bash
supabase functions deploy stories-active
```

### 2. Deploy All Functions
```bash
supabase functions deploy
```

### 3. Set Production Secrets
```bash
supabase secrets set ADMIN_API_KEY=your-secret-key
supabase secrets set OPENAI_API_KEY=your-openai-key
```

## Testing Deployed Functions

### Test URL (after deployment):
```
https://wnrjrywpcadwutfykflu.supabase.co/functions/v1/stories-active
```

### With Authentication:
```bash
curl https://wnrjrywpcadwutfykflu.supabase.co/functions/v1/stories-active \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

## Troubleshooting

### Common Issues:

1. **"supabase: command not found"**
   - Restart terminal after installation
   - Check PATH includes npm global directory

2. **"Project not linked"**
   - Run `supabase link --project-ref YOUR_PROJECT_REF`

3. **"Authentication failed"**
   - Check your API keys are correct
   - Ensure you're using the right environment keys

4. **CORS errors**
   - Edge Functions handle CORS automatically
   - Check you're using the correct URL format

## Next Steps

1. Run the migration scripts on test database
2. Create the Edge Function files
3. Test locally with `supabase functions serve`
4. Deploy to test environment
5. Test with real data

## Useful Commands Reference

```bash
# Check status
supabase status

# View logs
supabase functions logs stories-active

# Reset local database
supabase db reset

# Stop local services
supabase stop
```