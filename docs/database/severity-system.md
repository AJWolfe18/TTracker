# Severity System Implementation Guide
*Last Updated: September 5, 2025*

## Current 4-Tier Severity System

As of September 5, 2025, TrumpyTracker uses a 4-tier severity system for categorizing political entries and executive orders based on their threat level to democracy and impact on society.

## Database Values & Display Labels

### Political Entries
| Database Value | In-App Display | Share Display | Criteria |
|----------------|----------------|---------------|----------|
| `critical` | Fucking Treason 🔴 | Democracy Under Attack | Direct threats to democracy, election stealing, authoritarian power grabs |
| `high` | Criminal Bullshit 🟠 | Criminal Corruption | Clear criminal activity, policies that harm/kill people |
| `medium` | Swamp Shit 🟡 | Swamp Business | Standard corruption, grift, nepotism |
| `low` | Clown Show 🟢 | Political Circus | Incompetence, stupidity, embarrassments |

### Executive Orders
Uses same database values but with EO-specific impact types:
| Database Value | Impact Type | Display Label |
|----------------|-------------|---------------|
| `critical` | fascist_power_grab | Fascist Power Grab 🔴 |
| `high` | authoritarian_overreach | Authoritarian Overreach 🟠 |
| `medium` | corrupt_grift | Corrupt Grift 🟡 |
| `low` | performative_bullshit | Performative Bullshit 🟢 |

## Implementation Details

### 1. Initial Severity Assignment
Location: `scripts/daily-tracker-supabase.js`

```javascript
function assessSeverity(title, description) {
    const content = `${title} ${description}`.toLowerCase();
    
    // CRITICAL keywords (need to add)
    const criticalSeverity = [
        'overturn election', 'steal election', 'coup', 'insurrection',
        'suspend constitution', 'martial law', 'dictatorship'
    ];
    
    // HIGH severity keywords  
    const highSeverity = [
        'arrest', 'indictment', 'conviction', 'felony', 'fraud', 
        'corruption', 'constitutional crisis', 'impeachment'
    ];
    
    // MEDIUM severity keywords
    const mediumSeverity = [
        'investigation', 'subpoena', 'lawsuit', 'hearing', 
        'testimony', 'controversy', 'conflict', 'ethics'
    ];
    
    if (criticalSeverity.some(keyword => content.includes(keyword))) {
        return 'critical';
    } else if (highSeverity.some(keyword => content.includes(keyword))) {
        return 'high';
    } else if (mediumSeverity.some(keyword => content.includes(keyword))) {
        return 'medium';
    } else {
        return 'low';
    }
}
```

### 2. AI Re-Analysis During Spicy Summary
Location: `scripts/spicy-summaries-integration.js`

The AI analyzes content more deeply and can upgrade severity based on context:

**CRITICAL (Fucking Treason 🔴)**
- Attempts to overturn/steal elections
- Attacking voting rights or voter access
- Threatening political violence or civil war
- Dismantling democratic institutions
- Packing courts with extremists
- Authoritarian power grabs

**HIGH/SEVERE (Criminal Bullshit 🟠)**
- Policies that will directly kill or harm people
- Healthcare cuts affecting life-saving treatment
- Clear criminal activity (not just shady)
- Inciting violence or terrorism
- Massive corruption with real victims
- Environmental disasters for profit

**MEDIUM/MODERATE (Swamp Shit 🟡)**
- Self-dealing and profiteering
- Standard political corruption
- Nepotism and cronyism
- Corporate bootlicking
- Campaign finance violations
- Lying for political gain

**LOW/MINOR (Clown Show 🟢)**
- Incompetence and stupidity
- Twitter tantrums
- Obvious hypocrisy
- Self-owns and contradictions
- Embarrassing gaffes
- Just being an asshole

### 3. Admin Dashboard Display
Location: `public/admin-supabase.html`

The admin panel should display both the database value and the user-facing label:

```javascript
// Filter buttons showing all 4 tiers
<button className="filter-chip severity-critical">
    Critical <span className="filter-count">{filterCounts.critical}</span>
</button>
<button className="filter-chip severity-high">
    High <span className="filter-count">{filterCounts.high}</span>
</button>
<button className="filter-chip severity-medium">
    Medium <span className="filter-count">{filterCounts.medium}</span>
</button>
<button className="filter-chip severity-low">
    Low <span className="filter-count">{filterCounts.low}</span>
</button>
```

### 4. Public Dashboard Display
Location: `public/dashboard-components.js`

```javascript
function getSeverityLabel(entry) {
    // Use severity_label_inapp if available (has emoji)
    if (entry.severity_label_inapp) {
        return entry.severity_label_inapp;
    }
    
    // Fallback to mapping
    const severityMap = {
        'critical': 'Fucking Treason 🔴',
        'high': 'Criminal Bullshit 🟠',
        'medium': 'Swamp Shit 🟡',
        'low': 'Clown Show 🟢'
    };
    
    return severityMap[entry.severity] || entry.severity;
}
```

## Migration Notes

### Database Migration (Completed Sept 5, 2025)
```sql
-- Remove old 3-tier constraint
ALTER TABLE political_entries 
DROP CONSTRAINT political_entries_severity_check;

-- Add new 4-tier constraint
ALTER TABLE political_entries 
ADD CONSTRAINT political_entries_severity_check 
CHECK (severity IN ('critical', 'high', 'medium', 'low'));

-- Same for executive_orders
ALTER TABLE executive_orders 
DROP CONSTRAINT executive_orders_severity_rating_check;

ALTER TABLE executive_orders 
ADD CONSTRAINT executive_orders_severity_rating_check 
CHECK (severity_rating IN ('critical', 'high', 'medium', 'low'));
```

### Code Updates Still Needed
1. ✅ Database constraints updated
2. ⚠️ Update `assessSeverity()` to detect 'critical' keywords
3. ⚠️ Update `spicy-summaries-integration.js` to assign 'critical'
4. ⚠️ Update admin filters to show 4 options
5. ⚠️ Update dashboard filters to handle 'critical'

## Testing Checklist

- [ ] New article with democracy threat gets 'critical' severity
- [ ] Spicy summary correctly assigns "Fucking Treason 🔴"
- [ ] Admin panel shows all 4 filter options
- [ ] Public dashboard displays correct labels
- [ ] Database accepts 'critical' value without error
- [ ] Existing entries still display correctly

## Rollback Plan

If issues occur, revert to 3-tier system:
```sql
-- Revert any 'critical' entries to 'high'
UPDATE political_entries SET severity = 'high' WHERE severity = 'critical';
UPDATE executive_orders SET severity_rating = 'high' WHERE severity_rating = 'critical';

-- Restore 3-tier constraint
ALTER TABLE political_entries 
DROP CONSTRAINT political_entries_severity_check;

ALTER TABLE political_entries 
ADD CONSTRAINT political_entries_severity_check 
CHECK (severity IN ('high', 'medium', 'low'));
```