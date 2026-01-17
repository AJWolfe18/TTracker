# TrumpyTracker Business Logic Mapping Document

## Severity System Mapping

### Database Values → Display Labels

The system uses a 4-tier severity system with different labels for different contexts:

#### Database Storage
```sql
-- stories table
severity: 'critical' | 'severe' | 'moderate' | 'minor'

-- Note: Some legacy data might have 'high' | 'medium' | 'low'
-- Migration needed to standardize
```

#### In-App Display (Spicy Labels)
```javascript
const SEVERITY_LABELS_IN_APP = {
  critical: "Fucking Treason 🔴",
  severe: "Criminal Bullshit 🟠", 
  moderate: "Swamp Shit 🟡",
  minor: "Clown Show 🟢"
};
```

#### Shareable Display (Public-Friendly)
```javascript
const SEVERITY_LABELS_SHAREABLE = {
  critical: "Democracy Under Attack",
  severe: "Criminal Corruption",
  moderate: "Swamp Business", 
  minor: "Political Circus"
};
```

#### Color Mapping
```javascript
const SEVERITY_COLORS = {
  critical: {
    bg: "#fee2e2",      // red-100
    text: "#7f1d1d",    // red-900
    border: "#dc2626",  // red-600
    emoji: "🔴"
  },
  severe: {
    bg: "#fed7aa",      // orange-100
    text: "#7c2d12",    // orange-900
    border: "#ea580c",  // orange-600
    emoji: "🟠"
  },
  moderate: {
    bg: "#fef3c7",      // yellow-100
    text: "#713f12",    // yellow-900
    border: "#f59e0b",  // yellow-600
    emoji: "🟡"
  },
  minor: {
    bg: "#d1fae5",      // green-100
    text: "#064e3b",    // green-900
    border: "#10b981",  // green-600
    emoji: "🟢"
  }
};
```

### Severity Determination Rules

#### Critical (Fucking Treason)
**Triggers:**
- Attempts to overturn/steal elections
- Attacking voting rights or voter access
- Threatening political violence or civil war
- Dismantling democratic institutions
- Packing courts with extremists
- Authoritarian power grabs

#### Severe (Criminal Bullshit)
**Triggers:**
- Policies that will directly kill or harm people
- Healthcare cuts affecting life-saving treatment
- Clear criminal activity (not just shady)
- Inciting violence or terrorism
- Massive corruption with real victims
- Environmental disasters for profit

#### Moderate (Swamp Shit)
**Triggers:**
- Self-dealing and profiteering
- Standard political corruption
- Nepotism and cronyism
- Corporate bootlicking
- Campaign finance violations
- Lying for political gain

#### Minor (Clown Show)
**Triggers:**
- Incompetence and stupidity
- Twitter tantrums
- Obvious hypocrisy
- Self-owns and contradictions
- Embarrassing gaffes
- Just being an asshole

## Topic Categories Mapping

### Database Storage → Display Labels

```javascript
const TOPIC_DISPLAY_NAMES = {
  // Core Political Topics
  "democracy": "Democracy & Elections",
  "corruption": "Corruption & Graft",
  "justice": "Justice & Law",
  "policy": "Policy & Legislation",
  "foreign": "Foreign Policy",
  
  // Specific Actors
  "trump": "Trump & Family",
  "doge": "DOGE & Efficiency",
  "musk": "Elon Musk",
  
  // Agencies
  "doj": "DOJ & Law Enforcement",
  "courts": "Courts & Judges",
  "agencies": "Federal Agencies",
  
  // Issues
  "immigration": "Immigration",
  "healthcare": "Healthcare",
  "environment": "Environment",
  "economy": "Economy & Trade",
  "military": "Military & Defense"
};
```

## Source Tier System

### Tier 1 (Most Trusted)
```javascript
const TIER_1_SOURCES = [
  "reuters.com",
  "apnews.com",
  "bloomberg.com",
  "wsj.com"
];
```

### Tier 2 (Mainstream)
```javascript
const TIER_2_SOURCES = [
  "cnn.com",
  "nytimes.com",
  "washingtonpost.com",
  "theguardian.com",
  "bbc.com",
  "npr.org",
  "politico.com"
];
```

### Tier 3 (Partisan/Opinion)
```javascript
const TIER_3_SOURCES = [
  "foxnews.com",
  "msnbc.com",
  "huffpost.com",
  "breitbart.com",
  "dailykos.com",
  "nationalreview.com"
];
```

**Primary Source Selection Logic:**
1. Choose highest tier source
2. If multiple in same tier, choose most recent
3. If same tier and time, choose longest article

## Content Type Classification

```javascript
const CONTENT_TYPES = {
  "news_report": {
    label: "News",
    icon: "📰",
    includeInCount: true
  },
  "opinion": {
    label: "Opinion",
    icon: "💭",
    includeInCount: false  // Don't count in source count
  },
  "analysis": {
    label: "Analysis",
    icon: "📊",
    includeInCount: true
  },
  "editorial": {
    label: "Editorial",
    icon: "✍️",
    includeInCount: false
  }
};
```

## Time Display Rules

```javascript
function getTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - new Date(timestamp)) / 1000);
  
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  
  // After a week, show actual date
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });
}
```

## Story Status Rules

### Active → Closed Transition
- No new articles for 72 hours
- Manually closed by admin
- Story older than 30 days

### Closed → Active Transition
- New article matches closed story (>60% similarity)
- Manually reopened by admin
- Related breaking news

## Source Count Display

```javascript
function getSourceCountDisplay(story) {
  const uniqueSources = new Set(
    story.articles
      .filter(a => a.content_type === 'news_report' || a.content_type === 'analysis')
      .map(a => a.source_domain)
  );
  
  const totalArticles = story.articles.length;
  const sourceCount = uniqueSources.size;
  
  // Display format
  if (sourceCount === 1) {
    return `${totalArticles} ${totalArticles === 1 ? 'article' : 'articles'}`;
  } else {
    return `${sourceCount} sources, ${totalArticles} articles`;
  }
}
```

## URL Handling

### Canonical URL Generation
```javascript
function canonicalizeUrl(url) {
  // Remove protocol
  let canonical = url.replace(/^https?:\/\//, '');
  
  // Remove www
  canonical = canonical.replace(/^www\./, '');
  
  // Remove trailing slash
  canonical = canonical.replace(/\/$/, '');
  
  // Remove common tracking parameters
  canonical = canonical.replace(/[?&](utm_[^&]*|ref=[^&]*|source=[^&]*)/g, '');
  
  // Remove fragment
  canonical = canonical.replace(/#.*$/, '');
  
  return canonical.toLowerCase();
}
```

### URL Hash Generation
```javascript
function generateUrlHash(url, publishedDate) {
  const canonical = canonicalizeUrl(url);
  const dateStr = new Date(publishedDate).toISOString().split('T')[0];
  
  // Composite hash: URL + Date
  return crypto
    .createHash('md5')
    .update(`${canonical}|${dateStr}`)
    .digest('hex');
}
```

## Share Text Templates

### X/Twitter Template
```javascript
function getTwitterShareText(story) {
  const severity = SEVERITY_LABELS_SHAREABLE[story.severity];
  const headline = story.primary_headline;
  const spicyExcerpt = story.summary_spicy?.substring(0, 200) || headline;
  
  return `${severity}: ${spicyExcerpt}... via @TrumpyTracker`;
}
```

### Facebook Template
```javascript
function getFacebookShareData(story) {
  return {
    title: story.primary_headline,
    description: story.summary_spicy?.substring(0, 155),
    image: 'https://trumpytracker.com/og-image.png'
  };
}
```

### Copy Link Template
```javascript
function getCopyText(story) {
  const severity = SEVERITY_LABELS_IN_APP[story.severity];
  return `${severity}\n\n${story.primary_headline}\n\n${story.summary_spicy}\n\nRead more: https://trumpytracker.com/story/${story.id}`;
}
```

## Pagination Cursor Logic

```javascript
// Cursor encoding
function encodeCursor(lastItem) {
  const cursorData = {
    id: lastItem.id,
    last_updated_at: lastItem.last_updated_at
  };
  return Buffer.from(JSON.stringify(cursorData)).toString('base64');
}

// Cursor decoding
function decodeCursor(cursor) {
  try {
    const json = Buffer.from(cursor, 'base64').toString('utf-8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}
```

## Cache TTL Rules

```javascript
const CACHE_DURATIONS = {
  activeStories: 5 * 60 * 1000,      // 5 minutes
  storyDetail: 10 * 60 * 1000,       // 10 minutes
  timelineSearch: 2 * 60 * 1000,     // 2 minutes
  topicList: 60 * 60 * 1000,         // 1 hour
  staticAssets: 24 * 60 * 60 * 1000  // 24 hours
};
```

## Error Message Mapping

```javascript
const ERROR_MESSAGES = {
  NETWORK_ERROR: "Can't connect to TrumpyTracker. Check your internet connection.",
  RATE_LIMIT: "Whoa there! You're reading too fast. Take a breath and try again in a minute.",
  SERVER_ERROR: "Our servers are having a moment. We're on it!",
  NOT_FOUND: "That story seems to have vanished. It might have been deleted or archived.",
  UNAUTHORIZED: "You need to be logged in to do that.",
  INVALID_FILTER: "Those filters don't make sense. Try different options.",
  NO_RESULTS: "No stories match your search. Try different keywords or clear filters."
};
```

## Feature Flags

```javascript
const FEATURE_FLAGS = {
  showNeutralSummary: false,  // Hidden for MVP
  enableSharing: true,         // Launch with sharing
  showOpinions: false,         // Hidden for MVP
  enableTimeline: true,        // Launch with timeline
  showTopics: true,            // Show topic tags
  infiniteScroll: true,        // Use infinite scroll
  virtualScrolling: false,     // Not for MVP
  showAds: false              // No ads at launch
};
```

## Pardon Corruption Level System

### Database Values → Display Labels

#### Database Storage
```sql
-- pardons table
corruption_level: 1 | 2 | 3 | 4 | 5
primary_connection_type: 'major_donor' | 'political_ally' | 'family' |
  'business_associate' | 'celebrity' | 'jan6_defendant' | 'fake_electors' |
  'mar_a_lago_vip' | 'campaign_staff' | 'wealthy_unknown' | 'no_connection'
```

#### Spicy Labels (In-App Display)
```javascript
const CORRUPTION_LABELS_SPICY = {
  5: "Paid-to-Play 💰",
  4: "Loyalty Reward 🎖️",
  3: "Swamp Royalty 👑",
  2: "Celebrity Request ⭐",
  1: "Broken Clock 🔧"
};
```

#### Neutral Labels (For Exports/Sharing)
```javascript
const CORRUPTION_LABELS_NEUTRAL = {
  5: "Direct Financial Connection",
  4: "Service to Trump",
  3: "Swamp Access",
  2: "Public Campaign",
  1: "Legitimate Clemency"
};
```

#### Color Mapping
```javascript
const CORRUPTION_COLORS = {
  5: { bg: "#fee2e2", text: "#7f1d1d", border: "#dc2626" }, // red
  4: { bg: "#fed7aa", text: "#7c2d12", border: "#ea580c" }, // orange
  3: { bg: "#fef3c7", text: "#713f12", border: "#f59e0b" }, // yellow
  2: { bg: "#e0e7ff", text: "#3730a3", border: "#6366f1" }, // indigo
  1: { bg: "#d1fae5", text: "#064e3b", border: "#10b981" }  // green
};
```

### Corruption Level Determination Rules

#### Level 5: Paid-to-Play
**Triggers:**
- Documented donations to Trump campaign/PAC/legal fund/inauguration
- Direct financial relationship (business deals, loans)
- Payment timing correlates with pardon timing
- FEC records show pattern
- Mar-a-Lago membership with clear access-for-benefit pattern

**Evidence types:** FEC filings, inauguration fund records, business contracts, membership records

#### Level 4: Loyalty Reward
**Triggers:**
- Committed crimes FOR Trump (Jan 6 defendants, fake electors)
- Refused to flip/testify against Trump
- Inner circle who served Trump (Rudy Giuliani, cabinet members)
- Family members
- Campaign staff who took legal risk for Trump
- Could testify against Trump (pardon = potential silence)

**Evidence types:** Jan 6 charges, fake elector indictments, cooperation refusals, employment records

**Tone rule:** Profanity allowed. These people committed crimes to help Trump or refused to hold him accountable.

#### Level 3: Swamp Royalty
**Triggers:**
- Rich unknown person with no documented Trump connection (wealthy_unknown)
- "Weaponized DOJ" or "political persecution" claims
- Political ally (endorsed Trump, fundraised, etc.)
- Lobbyist or industry connection
- Pardon covers up related wrongdoing
- Benefits Republican political interests
- Standard political favor-trading
- Campaign promises to pardon in exchange for votes

**Evidence types:** Endorsements, campaign appearances, lobbying records, wealth indicators

**Note:** This is the DEFAULT when no clear reason is found. Rich people don't get pardons for no reason.

#### Level 2: Celebrity Request
**Triggers:**
- High-profile advocacy campaign
- Media attention drove the pardon
- No direct Trump connection found
- Legitimate policy argument may exist
- Fame provided access that others don't have

**Evidence types:** Media coverage, advocacy campaigns, public statements

**Tone rule:** No profanity. Critique the system, not the individual.

#### Level 1: Broken Clock (RARE)
**Triggers:**
- Criminal justice reform case with bipartisan support
- Disproportionate original sentence (documented)
- Reform organizations actively advocated
- Actually defensible on merits
- REQUIRES positive evidence of legitimacy

**Evidence types:** Sentencing records, bipartisan advocacy, reform organization support

**Tone rule:** Acknowledge legitimacy. Can express cautious approval. Contrast with corrupt pardons.

**CRITICAL:** Level 1 should be RARE. Do not default here. Requires POSITIVE evidence of legitimacy, not just "no connection found."

### Connection Type Taxonomy

```javascript
const CONNECTION_TYPES = {
  major_donor: "Documented donations to Trump/GOP campaigns or funds",
  political_ally: "Endorsed, campaigned for, or politically aligned with Trump",
  family: "Trump family member or extended family",
  business_associate: "Business relationship with Trump Organization",
  celebrity: "Famous person with media platform and public advocacy",
  jan6_defendant: "Charged in January 6 investigation",
  fake_electors: "Involved in fake electors scheme",
  mar_a_lago_vip: "Known Mar-a-Lago member or frequent guest",
  campaign_staff: "Worked on Trump campaign in official capacity",
  wealthy_unknown: "Rich person with no documented Trump connection (default to Level 3)",
  no_connection: "No documented Trump relationship found (requires Level 1 legitimacy evidence)"
};
```

### Edge Case Handling

#### Multiple Connections
When multiple connection types exist, prioritize in this order:
1. Documented donations (most concrete, hardest to dispute)
2. Business relationships (verifiable through records)
3. Inner circle role (establishes access and motive)
4. Political alignment (public record)
5. Social access (circumstantial but notable)

**Rule:** Stack the receipts. Multiple angles strengthen the case.

#### Level/Type Mismatch
Trust corruption_level as primary driver (it's based on full research).
Use connection_type to inform framing and vocabulary, not override level.

#### No Connection + High Corruption
If `no_connection` but corruption level 3-5, do NOT invent a connection.
Frame as: system critique + what Trump gains politically, based ONLY on stated facts.

#### Insurrection Pardons (Jan 6, Fake Electors)
Focus on impunity signal and deterrence removal, not individual details.
Frame as: permission for future actors, message to supporters, threat to rule of law.

#### Group Pardons
Focus on the group's collective connection, not individuals.
Frame as categorical decision and signal to future actors.

#### Missing Information
- Prefer omitting missing details over calling them out
- If noting absence: "No public justification cited" (not "Not in record")
- Never fill gaps with inference

### Profanity Rules

```javascript
const PROFANITY_ALLOWED = {
  5: true,   // Paid-to-Play - full spice
  4: true,   // Loyalty Reward - allowed (crimes FOR Trump)
  3: false,  // Swamp Royalty - sardonic, not profane
  2: false,  // Celebrity Request - measured
  1: false   // Broken Clock - respectful acknowledgment
};
```

## SCOTUS Ruling Impact System

### Database Values → Display Labels

#### Database Storage
```sql
-- scotus_cases table (future - migration 050)
ruling_impact_level: 0 | 1 | 2 | 3 | 4 | 5
ruling_label: 'Constitutional Crisis' | 'Rubber-stamping Tyranny' |
  'Institutional Sabotage' | 'Judicial Sidestepping' |
  'Crumbs from the Bench' | 'Democracy Wins'
```

#### Spicy Labels (In-App Display)
```javascript
const RULING_IMPACT_LABELS = {
  5: "Constitutional Crisis 🔴",
  4: "Rubber-stamping Tyranny 🟠",
  3: "Institutional Sabotage 🟡",
  2: "Judicial Sidestepping 🔵",
  1: "Crumbs from the Bench ⚪",
  0: "Democracy Wins 🟢"
};
```

#### Color Mapping
```javascript
const RULING_IMPACT_COLORS = {
  5: { bg: "#fee2e2", text: "#7f1d1d", border: "#dc2626", emoji: "🔴" }, // red
  4: { bg: "#fed7aa", text: "#7c2d12", border: "#ea580c", emoji: "🟠" }, // orange
  3: { bg: "#fef3c7", text: "#713f12", border: "#f59e0b", emoji: "🟡" }, // yellow
  2: { bg: "#dbeafe", text: "#1e3a8a", border: "#3b82f6", emoji: "🔵" }, // blue
  1: { bg: "#f3f4f6", text: "#374151", border: "#9ca3af", emoji: "⚪" }, // gray
  0: { bg: "#d1fae5", text: "#064e3b", border: "#10b981", emoji: "🟢" }  // green
};
```

### Ruling Impact Level Determination Rules

#### Level 5: Constitutional Crisis
**Triggers:**
- Precedent overturned (Roe, Chevron, etc.)
- Raw power or billionaire money replaces the law
- Federalist Society wishlist fulfilled
- Dark money groups (Leonard Leo, Koch network) directly benefit

**Tone:** Alarm bells. Name who killed what precedent and who profits. Profanity allowed.

#### Level 4: Rubber-stamping Tyranny
**Triggers:**
- Court green-lights police violence, surveillance, state overreach
- Executive power grabs blessed
- Immunity expanded for those in power
- Victims have less recourse

**Tone:** Angry. Focus on the victims. Name the power they just blessed. Profanity allowed.

#### Level 3: Institutional Sabotage
**Triggers:**
- Technical, "boring" legal moves that gut rights
- Standing denied to avoid ruling
- Burden of proof shifted against plaintiffs
- Regulatory gaps opened for corporations
- Rights exist on paper but can't be used

**Tone:** Sardonic/Snarky. Explain the "trick" - how this technical move screws people.

#### Level 2: Judicial Sidestepping
**Triggers:**
- Case punted, avoided, kicked the can
- Declared moot conveniently
- Remanded to lower court (years more litigation)
- Narrow ruling that decides nothing
- Non-decision benefits status quo (usually bad)

**Tone:** Eye-roll. Lazy employees energy. Explain what they refused to decide.

#### Level 1: Crumbs from the Bench
**Triggers:**
- Win for the people, but narrow/fragile/temporary
- Limiting language could undo it
- Concurrence signals future trouble
- Easily distinguished in future cases

**Tone:** Cautiously skeptical. Credit the win, then flag why it might not last.

#### Level 0: Democracy Wins (RARE)
**Triggers:**
- Rare win where the system protects the vulnerable
- Strong ruling that's hard to walk back
- Corporate/government interests actually lost
- Constitution worked as intended

**Tone:** Sincere. Credit where due. Note why this actually protects people.

**CRITICAL:** Level 0 should be RARE. Requires genuinely good outcome, not just "not terrible."

### Issue Area Special Pools

Certain issue areas override level-based framing:

```javascript
const SPECIAL_ISSUE_AREAS = {
  voting_rights: "VRA, gerrymandering, voter access - frame around who can't vote",
  agency_power: "Chevron, regulations, expertise - frame around regulatory gaps"
};
```

### Profanity Rules

```javascript
const SCOTUS_PROFANITY_ALLOWED = {
  5: true,   // Constitutional Crisis - full spice
  4: true,   // Rubber-stamping Tyranny - allowed
  3: false,  // Institutional Sabotage - sardonic, not profane
  2: false,  // Judicial Sidestepping - eye-roll tone
  1: false,  // Crumbs from the Bench - cautious
  0: false   // Democracy Wins - sincere
};
```

### Tone & Style Rules

1. **FOLLOW THE MONEY**: Name Federalist Society, Leonard Leo, Koch, Harlan Crow when relevant
2. **HUMAN COST**: Always explain impact on wallet, body, or freedom (YOUR rights, not abstract)
3. **NO LEGALESE**: Translate legal jargon to plain English
4. **NO BOTH-SIDES**: Pro-people, anti-fascist editorial perspective
5. **EVIDENCE ANCHORED**: Cite [syllabus], [majority], [dissent] for claims

### Key Difference from Pardons

| Aspect | Pardons | SCOTUS |
|--------|---------|--------|
| Scale direction | 1 (good) → 5 (corrupt) | 0 (good) → 5 (crisis) |
| Level 0 | N/A | Democracy Wins |
| Default assumption | Corruption unless proven otherwise | Institutional bias unless proven otherwise |
| Evidence source | FEC, business records, testimony | Syllabus, majority opinion, dissent |

---

This document should be updated as business logic evolves.