# Security Checklist

**When to use:**
- Before every PR to main (quick scan)
- Quarterly deep review
- After changes to: auth, API keys, Edge Functions, database permissions

---

## Quick PR Checklist (2 min)

Before merging to main:

- [ ] No secrets in code (API keys, passwords, tokens)
- [ ] No `.env` files committed
- [ ] No `console.log` with sensitive data
- [ ] Parameterized queries (no string concatenation in SQL)

---

## Secrets Management

### Environment Variables

**NEVER commit these:**
- `.env`, `.env.local`, `.env.production`
- `credentials.json`, `serviceAccountKey.json`
- Any file with API keys or tokens

**Where secrets should live:**
| Secret | Location |
|--------|----------|
| OpenAI API key | GitHub Secrets → `OPENAI_API_KEY` |
| Supabase service role | GitHub Secrets → `SUPABASE_SERVICE_ROLE_KEY` |
| Supabase URL | GitHub Secrets → `SUPABASE_URL` |
| Supabase anon key | Can be in code (public by design) |

### Checking for Leaked Secrets

```bash
# Search for potential secrets in codebase
grep -r "sk-" --include="*.js" --include="*.ts" .
grep -r "eyJ" --include="*.js" --include="*.ts" .  # JWT tokens
grep -r "password" --include="*.js" --include="*.ts" .
```

**If secrets were committed:** They're compromised. Rotate immediately, even if removed from code.

---

## Database Security (Supabase)

### Row Level Security (RLS)

**Check RLS is enabled on sensitive tables:**
```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public';
```

**Current tables that should have RLS:**
- `budgets` - internal cost tracking
- `job_queue` - internal processing

**Tables that can be public (read-only):**
- `stories` - public content
- `articles` - public content
- `feed_registry` - public metadata

### Query Safety

**Good - Parameterized:**
```javascript
const { data } = await supabase
  .from('stories')
  .select('*')
  .eq('id', storyId);  // Parameter, not string concat
```

**Bad - SQL Injection Risk:**
```javascript
// NEVER DO THIS
const query = `SELECT * FROM stories WHERE id = ${storyId}`;
```

---

## Edge Functions Security

### CORS Headers

All Edge Functions must include:
```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',  // Or specific domain
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
```

### Input Validation

**Always validate incoming data:**
```typescript
const { url } = await req.json();

if (!url || typeof url !== 'string') {
  return new Response(JSON.stringify({ error: 'Invalid URL' }), {
    status: 400,
    headers: corsHeaders
  });
}

// Validate URL format
try {
  new URL(url);
} catch {
  return new Response(JSON.stringify({ error: 'Malformed URL' }), {
    status: 400,
    headers: corsHeaders
  });
}
```

### Rate Limiting

Consider for public endpoints:
- `articles-manual` - manual article submission
- `stories-search` - search endpoint

---

## Frontend Security

### No Secrets in Client Code

**Check public/ folder:**
```bash
grep -r "sk-" public/
grep -r "service_role" public/
```

Only the Supabase **anon key** should appear in frontend code.

### XSS Prevention

When rendering user content:
```javascript
// Good - textContent (safe)
element.textContent = userInput;

// Bad - innerHTML with user data (XSS risk)
element.innerHTML = userInput;  // NEVER with untrusted data
```

---

## Git Repository

### .gitignore Check

Ensure these patterns are in `.gitignore`:
```
.env
.env.*
*.pem
*.key
credentials.json
serviceAccountKey.json
```

### Branch Protection

Main branch should have:
- [x] Require PR reviews
- [x] Block direct pushes
- [x] Require status checks (AI code review)

---

## Quarterly Deep Review

Every 3 months, check:

1. **Rotate API keys** (OpenAI, any external services)
2. **Review GitHub Secrets** - remove unused
3. **Audit RLS policies** - still appropriate?
4. **Check npm dependencies** - `npm audit`
5. **Review Edge Function permissions** - minimal access?
6. **Search commit history** for accidentally committed secrets

### Dependency Audit

```bash
npm audit
npm audit fix  # Auto-fix if safe
```

---

## Incident Response

**If a secret is exposed:**

1. **Rotate immediately** - don't wait
2. **Check usage** - review logs for unauthorized access
3. **Update GitHub Secrets** with new values
4. **Redeploy** affected services
5. **Document** what happened and how

---

**Last Updated:** 2026-01-10
