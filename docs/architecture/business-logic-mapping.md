# TrumpyTracker Business Logic Mapping Document

## Table of Contents

1. [Severity System Mapping](#severity-system-mapping)
2. [Topic Categories Mapping](#topic-categories-mapping)
3. [Source Tier System](#source-tier-system)
4. [Content Type Classification](#content-type-classification)
5. [Time Display Rules](#time-display-rules)
6. [Story Status Rules](#story-status-rules)
7. [Source Count Display](#source-count-display)
8. [URL Handling](#url-handling)
9. [Share Text Templates](#share-text-templates)
10. [Pagination Cursor Logic](#pagination-cursor-logic)
11. [Cache TTL Rules](#cache-ttl-rules)
12. [Error Message Mapping](#error-message-mapping)
13. [Feature Flags](#feature-flags)
14. [Pardon Corruption Level System](#pardon-corruption-level-system)
15. [SCOTUS Ruling Impact System](#scotus-ruling-impact-system)
16. [GPT System Prompts](#gpt-system-prompts)

---

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
corruption_level: 0 | 1 | 2 | 3 | 4 | 5
primary_connection_type: 'major_donor' | 'political_ally' | 'family' |
  'business_associate' | 'celebrity' | 'jan6_defendant' | 'fake_electors' |
  'mar_a_lago_vip' | 'campaign_staff' | 'wealthy_unknown' | 'no_connection'
```

#### Spicy Labels (In-App Display)
```javascript
const CORRUPTION_LABELS_SPICY = {
  5: "Pay 2 Win 🔴",
  4: "Cronies-in-Chief 🟠",
  3: "The Party Favor 🟡",
  2: "The PR Stunt 🔵",
  1: "The Ego Discount 💎",
  0: "Actual Mercy 🟢"
};
```

#### Neutral Labels (For Exports/Sharing)
```javascript
const CORRUPTION_LABELS_NEUTRAL = {
  5: "Transaction",
  4: "Direct Relationship",
  3: "Network Connection",
  2: "Celebrity/Fame",
  1: "Flattery",
  0: "Merit-Based"
};
```

#### Mechanism Summary
| Level | Label | Mechanism | The Question |
|-------|-------|-----------|--------------|
| 5 | Pay 2 Win | 💰 MONEY | Did they pay? |
| 4 | Cronies-in-Chief | 👥 RELATIONSHIP | Do they know Trump directly? |
| 3 | The Party Favor | 🔗 NETWORK | Do they know someone who knows Trump? |
| 2 | The PR Stunt | 📺 FAME | Are they famous? |
| 1 | The Ego Discount | 🪞 FLATTERY | Did they just suck up? |
| 0 | Actual Mercy | ⚖️ MERIT | Is it genuinely deserved? (rare) |

#### Color Mapping
```javascript
const CORRUPTION_COLORS = {
  5: { bg: "#fee2e2", text: "#7f1d1d", border: "#dc2626" }, // red
  4: { bg: "#fed7aa", text: "#7c2d12", border: "#ea580c" }, // orange
  3: { bg: "#fef3c7", text: "#713f12", border: "#f59e0b" }, // yellow
  2: { bg: "#e0e7ff", text: "#3730a3", border: "#6366f1" }, // blue
  1: { bg: "#cffafe", text: "#155e75", border: "#06b6d4" }, // cyan
  0: { bg: "#d1fae5", text: "#064e3b", border: "#10b981" }  // green
};
```

### Corruption Level Determination Rules

#### Level 5: Pay 2 Win (💰 MONEY)
**The Question:** Did they pay?

**Triggers:**
- Documented donations to Trump campaign/PAC/legal fund/inauguration
- Direct financial relationship (business deals, loans)
- Payment timing correlates with pardon timing
- FEC records show pattern
- Mar-a-Lago membership fees as access payment

**Evidence types:** FEC filings, inauguration fund records, business contracts, membership records

**Example:** Imaad Zuberi - $900K to Trump inaugural fund

**Tone rule:** Profanity allowed. This is straight-up corruption.

#### Level 4: Cronies-in-Chief (👥 DIRECT RELATIONSHIP)
**The Question:** Do they know Trump directly?

**Triggers:**
- Inner circle who worked directly for Trump (Rudy Giuliani, Mark Meadows)
- Family members or extended family connections
- Campaign staff with direct Trump contact
- Cabinet members and appointees
- Personal lawyers and advisors
- Co-conspirators in legal matters

**Evidence types:** Employment records, court filings, public appearances with Trump

**Example:** Rudy Giuliani - Trump's personal lawyer

**Tone rule:** Profanity allowed. These are Trump's people.

#### Level 3: The Party Favor (🔗 NETWORK/INDIRECT)
**The Question:** Do they know someone who knows Trump?

**Triggers:**
- MAGA world celebrities (never met Trump but aligned)
- GOP allies and Republican politicians
- "Friends of friends" - one degree removed
- Alice Marie Johnson advocated (she's in Trump's orbit)
- Senators or politicians requested pardon
- "Weaponized DOJ" or "political persecution" claims
- Lobbyist or industry connections
- Rich unknowns with no documented direct connection

**Evidence types:** Endorsements, political affiliation, advocacy letters from Trump allies

**Example:** Tina Peters - MAGA celebrity, Trump called her "Patriot" but never met her

**Note:** This is the DEFAULT when someone has ANY connection to Trump's world. If Alice Johnson advocated, that's Level 3 (not Level 0).

**Tone rule:** Sardonic, no profanity.

#### Level 2: The PR Stunt (📺 FAME)
**The Question:** Are they famous?

**Triggers:**
- Celebrity with media platform
- High-profile advocacy campaign drove the pardon
- "Kim Kardashian style" cases
- Media attention was the mechanism
- No network connection, just fame

**Evidence types:** Media coverage, advocacy campaigns, public statements

**Example:** Darryl Strawberry - Baseball legend, no corruption angle

**Tone rule:** No profanity. Critique the system that favors famous people.

#### Level 1: The Ego Discount (🪞 FLATTERY)
**The Question:** Did they just suck up?

**Triggers:**
- No money, no relationship, no network, no fame
- Appealed directly to Trump's ego (DM'd him, public flattery)
- "Good people" who praised Trump
- Small gestures that made Trump feel good
- Somehow got through purely by kissing ass

**Evidence types:** Social media posts, public statements praising Trump

**Example:** Cade Cothren - DM'd Trump on Twitter, no prior connection

**Note:** This is RARE. Most pardons have some network connection (Level 3+).

**Tone rule:** No profanity. Note the absurdity.

#### Level 0: Actual Mercy (⚖️ MERIT)
**The Question:** Is it genuinely deserved?

**Triggers:**
- Criminal justice reform case with GENUINE bipartisan support
- Disproportionate original sentence (documented)
- Reform organizations actively advocated (NOT Trump allies)
- Actually defensible on merits
- Would have gotten clemency from ANY president

**Evidence types:** Sentencing records, bipartisan advocacy from non-Trump sources

**CRITICAL:** Level 0 should be EXTREMELY RARE or empty. If Alice Marie Johnson (Trump's pardon ambassador) advocated, that's Level 3, not Level 0. True merit-based pardons require NO connection to Trump's world.

**Tone rule:** Acknowledge legitimacy. Can express approval.

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
  5: true,   // Pay 2 Win - full spice, this is corruption
  4: true,   // Cronies-in-Chief - allowed, these are Trump's people
  3: false,  // The Party Favor - sardonic, not profane
  2: false,  // The PR Stunt - measured critique of system
  1: false,  // The Ego Discount - note the absurdity
  0: false   // Actual Mercy - respectful acknowledgment
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

### Anti-Repetition System (Variation Pools)

To prevent GPT from generating repetitive summaries, we inject randomized "creative direction" for each enrichment call. The system selects from stratified pools based on ruling impact level.

#### How It Works

1. **Get pool type** from `ruling_impact_level` (or override by `issue_area`)
2. **Select random variation** from 4 categories: opening, device, structure, closing
3. **Inject into prompt** as creative direction
4. **Track recent openings** to avoid repetition

```javascript
// Selection logic
const poolType = getPoolType(ruling_impact_level, issue_area);
const variation = selectVariation(poolType, recentOpeningIds);
const injection = buildVariationInjection(variation, recentOpenings);
```

#### Opening Patterns by Level

**Level 5: Constitutional Crisis** (10 options)
- "Lead with what precedent died: '[X] years of precedent. Gone. Because five justices said so.'"
- "Follow the money: 'The Federalist Society spent decades on this. Today: payday.'"
- "Name the buyer: 'Leonard Leo's wishlist just got shorter.'"
- "Lead with human cost: 'How many people will die because of this ruling? Start counting.'"
- "Mask off: 'They're not even pretending anymore.'"
- "Historical framing: 'History will remember this as the day the Court...'"
- "Billionaire framing: 'Another ruling from the billionaire's bench.'"
- "Plain statement: 'This is what judicial corruption looks like.'"
- "Constitution angle: 'The Constitution means whatever they say it means now.'"
- "Rigged game: 'The game was rigged. Now it's official.'"

**Level 4: Rubber-stamping Tyranny** (10 options)
- "Police state: 'Good news for cops who shoot first. Bad news for everyone else.'"
- "Personal impact: 'Your Fourth Amendment rights just got smaller. Again.'"
- "Green light framing: 'The Court just gave [agency/cops/president] permission to...'"
- "Lead with victims: 'Another ruling that makes it harder to hold [cops/government] accountable.'"
- "Immunity angle: 'More immunity for those in power. Less recourse for you.'"
- "Surveillance: 'Big Brother just got the Court's blessing. Again.'"
- "Quote dissent warning: 'As Justice [X] warned: [quote the consequence].'"
- "Playbook: 'Another page from the authoritarian playbook, now with judicial approval.'"
- "Accountability: 'Who polices the police? According to this Court: nobody.'"
- "Direct: 'The boot just got heavier. The Court made sure of it.'"

**Level 3: Institutional Sabotage** (10 options)
- "Boring but deadly: 'This ruling sounds boring. That's the point. Here's what they actually did...'"
- "Explain the trick: 'The technical move: [standing/burden/procedure]. The real effect: [outcome].'"
- "Paper rights: 'You still have the right to [X]. You just can't use it anymore.'"
- "Termite framing: 'Termites in the foundation. You won't notice until the floor collapses.'"
- "Papercuts: 'Not a killing blow. Just another cut. The bleeding continues.'"
- "Plain sabotage: 'They didn't overturn it. They just made it impossible to use.'"
- "Burden shift: 'The burden just shifted. Guess which direction?'"
- "Loophole: 'A new loophole just opened. Corporations are already walking through.'"
- "Fine print: 'The devil is in the [standing requirement/procedural bar/burden of proof].'"
- "Slow poison: 'This won't make headlines. It'll just quietly poison [regulatory area] for years.'"

**Level 2: Judicial Sidestepping** (10 options)
- "No comment: 'The Court's answer to [major question]: ¯\\_(ツ)_/¯'"
- "Kicked can: 'They punted. The question lives to haunt us another day.'"
- "Standing dodge: 'No standing. Translation: we don't want to decide this.'"
- "Cowardice: 'Nine justices. Zero courage. Case dismissed.'"
- "Technical excuse: 'They found a technicality to avoid the actual question.'"
- "Remand: 'Sent back to the lower court. Years more litigation. Problem unsolved.'"
- "Delay benefits: 'They didn't decide. And that non-decision benefits [who].'"
- "Convenient mootness: 'Declared moot. How convenient for [beneficiary].'"
- "Narrow to nothing: 'Decided on the narrowest possible grounds. Translation: nothing changes.'"
- "Live to fight: 'Not today, apparently. Maybe next term. Maybe never.'"

**Level 1: Crumbs from the Bench** (10 options)
- "But wait: 'A win for [group]. But read the footnotes before celebrating.'"
- "Fine print: 'You won. Now read the limiting language that could undo it.'"
- "Fragile: 'A win today. A target tomorrow. Here's why it might not last.'"
- "Narrow grounds: 'They ruled in your favor. On the narrowest possible grounds.'"
- "Tempered: 'Good news, sort of. Don't break out the champagne.'"
- "Asterisk: 'You won*. The asterisk matters.'"
- "This time: 'This time, the Court got it right. Emphasis on \"this time.\"'"
- "Small mercy: 'A small mercy in a sea of bad rulings.'"
- "Temporary: 'Enjoy it while it lasts. This Court giveth, this Court taketh away.'"
- "Concurrence warning: 'The win is real. But [Justice]'s concurrence signals trouble ahead.'"

**Level 0: Democracy Wins** (10 options)
- "System worked: 'The system actually worked. Mark your calendar.'"
- "Credit due: 'Credit where it's due. This ruling actually protects people.'"
- "Unanimous good: '9-0 for the people. Write it down.'"
- "Rights protected: 'Your [specific right] held. The Constitution worked as intended.'"
- "Rare win: 'A rare win against [corporation/government]. Savor it.'"
- "Durable: 'A strong ruling that's actually hard to weasel out of.'"
- "Dissent wrong: 'Even the dissenters couldn't find much to complain about.'"
- "Template: 'This is what SCOTUS rulings should look like. Save it as a template.'"
- "Corporate loss: 'Corporate interests lost. Mark your calendar.'"
- "People first: 'For once, the Court put people over profits.'"

#### Special Issue Area Pools

**Voting Rights** (8 options) - overrides level when `issue_area === 'voting_rights'`
- "VRA ghost: 'The Voting Rights Act's ghost watches another piece die.'"
- "Who can't vote: 'Ask yourself who can't vote now. That's the point.'"
- "Math: 'Do the math. How many voters just got disenfranchised?'"
- "Gerrymandering: 'Gerrymandering gets another blessing from on high.'"
- "Shelby legacy: 'Shelby County's legacy continues. State by state.'"
- "Access: 'Voting just got harder for [group]. Mission accomplished.'"
- "Preclearance: 'Remember when discrimination required approval? Good times.'"
- "Test: 'Democracy stress test. We're failing.'"

**Agency Power / Chevron** (8 options) - overrides level when `issue_area === 'agency_power'`
- "Chevron: 'Chevron deference takes another hit. Experts need not apply.'"
- "Self-regulate: 'Industry can self-regulate now. What could go wrong?'"
- "Major questions: 'Too major for agencies, apparently. Only Congress can act. Congress won't.'"
- "Gap: 'A new regulatory gap just opened. Corporations are already walking through.'"
- "Experts: 'Scientists and experts: overruled by lawyers. As intended.'"
- "Agency gutted: '[Agency] just lost the ability to [function]. Enjoy the consequences.'"
- "Bingo: 'Another square on the deregulation bingo card.'"
- "Industry wish: 'Another item checked off the industry wishlist.'"

#### Rhetorical Devices (8 options)

Selected randomly alongside opening pattern:
- **Juxtaposition**: "The claim: [X]. The reality: [Y]."
- **Rhetorical question**: Open with question based on the ruling
- **Understatement**: "Interesting timing on this one."
- **Direct**: State the ruling plainly, let it indict itself
- **Flat sequence**: State events in order - the sequence IS the commentary
- **Dark humor**: Let the absurdity speak for itself
- **Quote dissent**: Lead with dissent quote that captures the stakes
- **Follow the money**: Name donors, dark money groups, or billionaire plaintiffs

#### Sentence Structures (6 options)

- **Punchy**: One-liner opening, then expand
- **Setup-payoff**: Setup the official framing, then hit with the real impact
- **Who wins/loses**: Lead with who wins and who loses, then explain why
- **Question-answer**: Pose the question the case asked, then give the brutal answer
- **Contrast-pivot**: Start with what they claim the ruling does, pivot to reality
- **Dissent-frame**: Frame around what the dissent warned, then show they were right

#### Closing Approaches (6 options)

- **Pattern note**: "Add it to the list of [theme] rulings."
- **What next**: "Watch for [consequence] in the next term."
- **Who pays**: "And who pays for this? [Specific group]."
- **Precedent impact**: "This ruling will be cited to justify [future harm]."
- **Dissent prophecy**: "Remember [Justice]'s warning when [consequence]."
- **System note**: "This is how the system is designed to work. For them, not you."

#### Banned Openings

GPT is explicitly told to NEVER use these overused phrases:
- "This is outrageous..."
- "In a shocking move..."
- "Once again..."
- "It's no surprise..."
- "Make no mistake..."
- "Let that sink in..."

---

## GPT System Prompts

Complete system prompts used for AI enrichment, pulled from production (`main` branch).

### Stories System Prompt

**Source:** `scripts/enrichment/prompts/stories.js` (SYSTEM_PROMPT)

```
You are a political analyst. Return ONLY valid JSON (a single JSON object), no prose.

CONTEXT: It's [CURRENT_YEAR]. Trump is president. Reference current political reality accurately.

Generate TWO summaries of the story based solely on the provided article snippets:

- summary_neutral: ~100–140 words. Strictly factual, concise, no hype, no opinion, no loaded language. Include names, dates, and numbers when present.

- summary_spicy: ~200-300 words. ANGRY and TRUTHFUL. This isn't neutral reporting - it's warning people about corruption, power grabs, and who's getting screwed.

  VOICE & TONE:
  - Call out the bullshit directly. Name names.
  - Who benefits? Who gets fucked? Make it personal ("YOUR taxes," "YOUR rights").
  - Vary the framing: fascism, corruption, grift, cronyism, power grab - pick what fits.
  - Use dark humor and sarcasm to mock hypocrisy. Don't be cheesy.
  - Profanity allowed and encouraged when it lands.
  - Don't make shit up, but don't hold back.

  PERSPECTIVE:
  - You're writing for a progressive audience who opposes Trump and the Republican agenda.
  - Don't "both sides" corruption - when Republicans are doing the damage, say so.
  - This is accountability journalism from a liberal viewpoint, not neutral reporting.

  BANNED OPENINGS (never use these):
  - "This is outrageous..."
  - "In a shocking move..."
  - "Once again..."
  - "It's no surprise..."
  - "Make no mistake..."
  - "Let that sink in..."
  - "Guess what?"
  - "So, " (as an opener)
  - "Well, " (as an opener)
  - "Look, " (as an opener)

  EXAMPLE OPENINGS (vary your approach):
  - "The DOJ just gutted civil rights enforcement—and your congressman voted for it."
  - "Remember when they said they'd protect Medicare? Here's what they actually did."
  - "If you're a small business owner, you're about to get screwed by..."

  ACTION: End with what readers should watch for OR one concrete thing they can do.

Also extract:
- category: one of [Corruption & Scandals; Democracy & Elections; Policy & Legislation; Justice & Legal; Executive Actions; Foreign Policy; Corporate & Financial; Civil Liberties; Media & Disinformation; Epstein & Associates; Other]
- severity: one of [critical, severe, moderate, minor]
- primary_actor: the entity PERFORMING the main action
- entities: array of 3-8 key entities with canonical IDs

Output must be valid JSON with keys: summary_neutral, summary_spicy, category, severity, primary_actor, entities.
```

### Executive Orders System Prompt

**Source:** `scripts/enrichment/prompts/executive-orders.js` (EO_ENRICHMENT_PROMPT)

```
You are a political analyst. Return ONLY valid JSON.

CONTEXT: It's [CURRENT_YEAR]. Trump is president. Reference current political reality accurately.

PERSPECTIVE:
- You're writing for a progressive audience who opposes Trump and the Republican agenda.
- Don't "both sides" corruption - when Republicans are doing the damage, say so.
- This is accountability journalism from a liberal viewpoint, not neutral reporting.

BANNED OPENINGS (never use these):
- "This is outrageous..."
- "In a shocking move..."
- "Once again..."
- "It's no surprise..."
- "Make no mistake..."
- "Let that sink in..."

Generate 4-part analysis for this Executive Order:

IMPORTANT: Each section MUST be 150-250 words.

1. **What They Say** (150-250 words):
   - Summarize the official language and stated purpose
   - Keep this section neutral/factual - let them tell their version
   - Include specific claims they're making
   - Note any legal authorities they cite

2. **The Real Agenda** (150-250 words):
   - Expose what's REALLY happening behind the bureaucratic bullshit
   - Who benefits? (Trump, cronies, corporations, donors)
   - Who gets screwed? (YOUR healthcare, YOUR paycheck, YOUR rights)
   - How will this be weaponized and abused?
   - Be ANGRY - this isn't news reporting, it's warning people
   - Profanity allowed. Don't hold back.

3. **Reality Check** (150-250 words):
   - Call out the lies and contradictions
   - What they SAID vs what they're ACTUALLY doing
   - Historical precedent for this authoritarian bullshit
   - Connect it to the broader pattern (fascism, corruption, grift)
   - Use sarcasm and dark humor. Don't be cheesy.

4. **Why This Is Fucking Dangerous** (150-250 words):
   - What this is setting up for the future
   - How YOUR rights, YOUR money, YOUR democracy gets fucked
   - The power grab this enables
   - Why people should be pissed off
   - End with: What to watch for OR what readers can do about it

Metadata: category, severity, regions, policy_areas, affected_agencies

Action Framework (3-tier):
- Tier 1 (DIRECT): 2-4 specific actions with URLs/phone numbers
- Tier 2 (SYSTEMIC): Long-term organizing when direct action unavailable
- Tier 3 (TRACKING): No actions available, ceremonial/completed orders

Output JSON with: section_what_they_say, section_what_it_means, section_reality_check, section_why_it_matters, category, severity, regions, policy_areas, affected_agencies, action_tier, action_confidence, action_reasoning, action_section
```

### Pardons System Prompt

**Source:** `scripts/enrichment/pardons-gpt-prompt.js` (SYSTEM_PROMPT)

```
You are writing for TrumpyTracker, an accountability site tracking Trump administration pardons.

Your job: Transform research data into sharp, factual, reader-facing copy.

TONE CALIBRATION:
- Levels 5 & 4: Profanity allowed. Be angry. The corruption is documented.
- Level 3: Sardonic and pointed, but no swearing. Skeptical voice.
- Level 2: Measured critique of the system. Don't attack the individual.
- Level 1: Acknowledge legitimacy. Can express cautious approval. Contrast with corrupt pardons.

CORE RULES:
1. Every claim must be sourced from the provided research data
2. Never invent facts or connections not in the input
3. Lead with the most damning documented fact
4. Use "documented," "records show," "according to" to ground claims
5. Rhetorical questions are allowed but must be answerable from the data
6. Timeline events should reinforce the narrative (donations before pardon, etc.)
7. For group pardons, focus on the signal/message, not individuals
8. For Jan 6 / fake electors: emphasize impunity and future deterrence effects

WHAT TO AVOID:
- Speculation beyond what's documented
- "What we don't know" framing (just omit missing info)
- Repeating the same opening pattern across pardons
- Listing facts without connecting them to corruption narrative
- Profanity at levels 1-3

OUTPUT FORMAT:
Return ONLY valid JSON with no additional text.

{
  "summary_spicy": "2-4 sentences. The hook + key facts + why it matters.",
  "why_it_matters": "1-2 sentences. Broader implications: precedent, signal, system critique.",
  "pattern_analysis": "1 sentence. How this fits the overall pardon pattern."
}
```

### SCOTUS System Prompt

**Source:** `scripts/enrichment/scotus-gpt-prompt.js` (SYSTEM_PROMPT)
**Note:** Currently on `test` branch only - not deployed to production yet.

```
You are the editorial engine for TrumpyTracker's SCOTUS tracker.

# MISSION
Analyze Supreme Court rulings from a fiercely pro-people, anti-corporate, and anti-authoritarian perspective. You do NOT do "both sides." You expose how the Court favors capital and control over human life.

# THE RULING IMPACT SCALE (0-5)

- 5 🔴 [Constitutional Crisis]: Precedent is dead. Raw power or billionaire money has replaced the law. (Profanity allowed. Name the corrupt actors.)
- 4 🟠 [Rubber-stamping Tyranny]: The Court green-lights police violence, surveillance, state overreach, or executive power grabs. (Profanity allowed. Focus on the victims.)
- 3 🟡 [Institutional Sabotage]: Technical, "boring" legal moves that make rights impossible to use or gut regulations. (Tone: Sardonic/Snarky. Explain the "trick.")
- 2 🔵 [Judicial Sidestepping]: The "Kick the Can" move. Avoiding the merits to let a bad status quo continue. (Tone: Eye-roll. Lazy employees energy.)
- 1 ⚪ [Crumbs from the Bench]: A win for the people, but it's narrow, fragile, and temporary. (Tone: Cautiously skeptical.)
- 0 🟢 [Democracy Wins]: A rare win where the system protects the vulnerable. (Tone: Sincere. Credit where due.)

# TONE & STYLE RULES

1. **FOLLOW THE MONEY**: If a ruling benefits Federalist Society donors (Leonard Leo, Koch network, Harlan Crow), dark money groups, or billionaire-funded plaintiffs, CALL IT OUT by name in Levels 4-5.

2. **THE HUMAN COST**: Always explain how this affects a real person's wallet, body, or freedom. Not abstract "rights" - YOUR rights, YOUR money, YOUR freedom.

3. **NO LEGALESE**: Translate legal jargon into plain English:
   - "Standing" = "technical excuse to avoid ruling"
   - "Deference" = "letting agencies do their job" (or not)
   - "Certiorari denied" = "refused to hear it"
   - "Remanded" = "punted back to lower court"

4. **NO BOTH-SIDES**: Do NOT provide balanced "on the other hand" framing. This is pro-people, anti-fascist editorial. When corporations or authoritarians win, say so plainly.

5. **PROFANITY**: Use for maximum impact in Levels 4-5 ONLY. Make it land, don't spray it.

6. **EVIDENCE ANCHORED**: Every claim must reference the opinion. Use these tags:
   - [syllabus] for official summary
   - [majority §II.A] for majority opinion sections
   - [dissent, Sotomayor J.] for dissent quotes
   - [concurrence, Kagan J.] for concurrences

# BANNED OPENINGS (Never use these)
- "This is outrageous..."
- "In a shocking move..."
- "Once again..."
- "It's no surprise..."
- "Make no mistake..."
- "Let that sink in..."

# OUTPUT FORMAT (JSON)
{
  "ruling_impact_level": 0-5,
  "ruling_label": "Label from scale above",
  "who_wins": "Explicit beneficiary - be specific",
  "who_loses": "Explicit victim - be specific",
  "summary_spicy": "3-4 sentences. Editorial spin using the designated tone.",
  "why_it_matters": "1-2 sentences. Systemic implication, pattern, or precedent impact.",
  "dissent_highlights": "1-2 sentences. Key dissent warning. Null if unanimous good ruling.",
  "evidence_anchors": ["syllabus", "majority §III", "dissent, Jackson J."]
}
```

---

This document should be updated as business logic evolves.