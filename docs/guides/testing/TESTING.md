# TrumpyTracker Testing Guide

## Overview

This guide covers testing procedures for TrumpyTracker, including unit tests, integration tests, manual testing, and quality assurance processes.

## Testing Philosophy

- **Test First**: Develop features on test branch before production
- **Real Data**: Use production data copies for realistic testing
- **Automated Checks**: GitHub Actions for continuous validation
- **Manual Verification**: Human review for content quality

## Test Environment

### Environment URLs

**Production:**
- Site: https://trumpytracker.com
- Database: osjbulmltfpcoldydexg.supabase.co

**Test:**
- Site: https://test--taupe-capybara-0ff2ed.netlify.app/
- Database: wnrjrywpcadwutfykflu.supabase.co

### Test Branch Workflow

1. **Create feature on test branch:**
```bash
git checkout test
git pull origin test
# Make changes
git add .
git commit -m "Test: Add new feature"
git push origin test
```

2. **Verify on test site**
3. **Cherry-pick to production:**
```bash
git checkout main
git cherry-pick COMMIT_HASH
git push origin main
```

## Testing Checklist

### Pre-Deployment Testing

- [ ] Code runs locally without errors
- [ ] No console errors in browser
- [ ] Mobile responsive design works
- [ ] All links functional
- [ ] Forms submit correctly
- [ ] Data displays properly
- [ ] Filters work as expected
- [ ] Search functionality works

### Post-Deployment Testing

- [ ] Site loads correctly
- [ ] Data fetches from database
- [ ] Admin functions work
- [ ] GitHub Actions run successfully
- [ ] No JavaScript errors
- [ ] Performance acceptable (<3s load)
- [ ] SSL certificate valid

## Automated Testing

### GitHub Actions Tests

**Daily Tracker Test:**
```bash
# Run locally
node scripts/daily-tracker-supabase.js
```

**Executive Orders Test:**
```bash
# Run locally  
node scripts/executive-orders-tracker-supabase.js
```

**Manual Article Test:**
```bash
# Test with sample URL
node scripts/manual-article-processor.js
```

### Database Tests

**Connection Test:**
```javascript
// test-connection.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function testConnection() {
  const { data, error } = await supabase
    .from('political_entries')
    .select('count')
    .limit(1);
    
  if (error) {
    console.error('Connection failed:', error);
  } else {
    console.log('Connection successful');
  }
}

testConnection();
```

**Data Integrity Test:**
```sql
-- Check for duplicates
SELECT source_url, COUNT(*) 
FROM political_entries 
GROUP BY source_url 
HAVING COUNT(*) > 1;

-- Check for missing required fields
SELECT * FROM political_entries 
WHERE title IS NULL 
   OR description IS NULL 
   OR date IS NULL;

-- Check date consistency
SELECT * FROM political_entries 
WHERE date > CURRENT_DATE;
```

## Manual Testing Procedures

### Dashboard Testing

1. **Load Testing:**
   - Open dashboard
   - Verify data loads within 3 seconds
   - Check all sections populate

2. **Filter Testing:**
   - Test each category filter
   - Test severity filters
   - Test date range filter
   - Test search functionality
   - Verify filter combinations work

3. **Responsive Testing:**
   - Desktop (1920x1080)
   - Tablet (768x1024)
   - Mobile (375x667)
   - Check layout doesn't break
   - Verify touch interactions work

### Admin Panel Testing

1. **Authentication:**
   - Verify access control works
   - Test with wrong credentials
   - Check session persistence

2. **Article Submission:**
   - Submit valid article URL
   - Submit invalid URL
   - Test duplicate detection
   - Verify queue processing

3. **Queue Management:**
   - View pending items
   - View failed items
   - Delete queue items
   - Clear entire queue

4. **Data Management:**
   - Archive old entries
   - Restore archived entries
   - Edit existing entries
   - Delete entries (if enabled)

### API Testing

**Test with cURL:**
```bash
# Test political entries endpoint
curl -X GET \
  'https://osjbulmltfpcoldydexg.supabase.co/rest/v1/political_entries?limit=5' \
  -H 'apikey: YOUR_ANON_KEY' \
  -H 'Authorization: Bearer YOUR_ANON_KEY'

# Test executive orders endpoint  
curl -X GET \
  'https://osjbulmltfpcoldydexg.supabase.co/rest/v1/executive_orders?limit=5' \
  -H 'apikey: YOUR_ANON_KEY' \
  -H 'Authorization: Bearer YOUR_ANON_KEY'
```

**Test with JavaScript:**
```javascript
// Test API response time
async function testAPIPerformance() {
  const start = Date.now();
  
  const response = await fetch(
    'https://osjbulmltfpcoldydexg.supabase.co/rest/v1/political_entries?limit=100',
    {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    }
  );
  
  const data = await response.json();
  const duration = Date.now() - start;
  
  console.log(`API call took ${duration}ms`);
  console.log(`Returned ${data.length} entries`);
  
  if (duration > 1000) {
    console.warn('API response slow!');
  }
}
```

## Performance Testing

### Load Time Targets

| Metric | Target | Maximum |
|--------|--------|---------|
| First Contentful Paint | <1.5s | <2.5s |
| Largest Contentful Paint | <2.5s | <4s |
| Time to Interactive | <3s | <5s |
| Total Page Size | <1MB | <2MB |

### Testing Tools

1. **Google Lighthouse:**
   - Run in Chrome DevTools
   - Check Performance score (>90)
   - Check Accessibility score (>95)
   - Check SEO score (>90)

2. **WebPageTest:**
   - Test from multiple locations
   - Check waterfall chart
   - Verify caching works

3. **Browser DevTools:**
   - Network tab for requests
   - Performance tab for profiling
   - Console for errors

## Content Quality Testing

### AI Output Validation

1. **Accuracy Check:**
   - Verify sources are real
   - Check dates are correct
   - Validate actor attribution
   - Confirm category assignment

2. **Relevance Check:**
   - Entry matches tracking criteria
   - Political relevance confirmed
   - Not duplicate content
   - Appropriate severity level

3. **Quality Check:**
   - Title is clear and concise
   - Description is informative
   - No AI hallucinations
   - Grammar and spelling correct

### Source Verification

**Verified Sources:**
- Reuters, AP, BBC
- Major newspapers (NYT, WaPo, WSJ)
- Government sites (.gov)
- Court documents

**Unverified Sources:**
- Social media posts
- Blogs
- Opinion pieces
- Unrecognized domains

## Security Testing

### Input Validation

```javascript
// Test XSS prevention
const testInputs = [
  '<script>alert("XSS")</script>',
  'javascript:alert("XSS")',
  '<img src=x onerror=alert("XSS")>',
  '"; DROP TABLE political_entries; --'
];

testInputs.forEach(input => {
  // Submit through forms
  // Verify sanitization works
});
```

### API Security

1. **Test unauthorized access:**
```bash
# Try without API key
curl https://osjbulmltfpcoldydexg.supabase.co/rest/v1/political_entries

# Try with wrong key
curl -H "apikey: wrong-key" https://...
```

2. **Test rate limiting:**
```javascript
// Hammer the API
for (let i = 0; i < 1000; i++) {
  fetch(API_URL).then(r => console.log(i, r.status));
}
```

## Browser Compatibility

### Supported Browsers

| Browser | Minimum Version | Testing Priority |
|---------|----------------|------------------|
| Chrome | 90+ | High |
| Firefox | 88+ | High |
| Safari | 14+ | Medium |
| Edge | 90+ | Medium |
| Mobile Safari | iOS 14+ | High |
| Chrome Mobile | Android 10+ | High |

### Testing Checklist

- [ ] Layout renders correctly
- [ ] JavaScript executes
- [ ] Fonts load properly
- [ ] Images display
- [ ] Forms functional
- [ ] No console errors

## Regression Testing

### After Each Deploy

1. **Core Functionality:**
   - Dashboard loads
   - Data displays
   - Filters work
   - Search works

2. **Admin Functions:**
   - Login works
   - Submission works
   - Queue accessible

3. **Automation:**
   - GitHub Actions run
   - Data updates daily

### Weekly Regression

Full test of all features:
- All dashboard features
- All admin features
- All API endpoints
- Performance benchmarks
- Security checks

## Test Data Management

### Creating Test Data

```javascript
// Generate test entries
function createTestEntry(index) {
  return {
    date: new Date().toISOString().split('T')[0],
    actor: `Test Actor ${index}`,
    category: 'Government Oversight',
    title: `Test Entry ${index}`,
    description: `Test description for entry ${index}`,
    source: 'Test Source',
    source_url: `https://example.com/test${index}`,
    verified: true,
    severity: 'medium'
  };
}

// Insert test data
async function insertTestData(count = 10) {
  const entries = Array.from({length: count}, (_, i) => createTestEntry(i));
  
  const { error } = await supabase
    .from('political_entries')
    .insert(entries);
    
  if (error) console.error(error);
  else console.log(`Inserted ${count} test entries`);
}
```

### Cleaning Test Data

```sql
-- Remove test entries
DELETE FROM political_entries 
WHERE actor LIKE 'Test Actor%';

-- Reset auto-increment
ALTER SEQUENCE political_entries_id_seq RESTART WITH 1;
```

## Bug Reporting

### Bug Report Template

```markdown
**Bug Description:**
Clear description of the issue

**Steps to Reproduce:**
1. Go to...
2. Click on...
3. See error

**Expected Behavior:**
What should happen

**Actual Behavior:**
What actually happens

**Screenshots:**
If applicable

**Environment:**
- Browser:
- Device:
- Environment: Production/Test

**Additional Context:**
Any other relevant information
```

### Severity Levels

- **Critical**: Site down, data loss, security breach
- **High**: Major feature broken, significant UX issue
- **Medium**: Minor feature broken, workaround exists
- **Low**: Cosmetic issue, enhancement request

## Test Automation Roadmap

### Current State
- Manual testing for most features
- GitHub Actions for automation
- Basic health checks

### Future Improvements
1. Add Jest unit tests
2. Implement Cypress E2E tests
3. Add visual regression testing
4. Create load testing suite
5. Implement continuous monitoring

---

*Last Updated: August 17, 2025*
*Testing Version: 1.0*