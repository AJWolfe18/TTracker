# Rating Determination Framework

## Overview

This framework ensures AI enrichment produces ratings and tones that accurately reflect the real-world impact of events. The core problem: GPT tends to pick dramatic ratings/tones without considering whether the outcome is actually good or bad for regular people.

**The fix:** Force reasoning BEFORE rating. Answer questions about the outcome, derive the rating from answers, then match tone to rating.

---

## The Core Pattern (All Content Types)

### Step 1: Assess the Outcome
Answer structured questions about who benefits and what the real-world impact is.

### Step 2: Derive the Rating
Use the answers to determine the appropriate rating. Don't pick a rating first and justify it later.

### Step 3: Match Tone to Rating
The opening line and overall tone MUST align with the rating. Cynical tone for bad outcomes, cautious optimism for good outcomes.

### Step 4: Sanity Check
Before outputting, verify: "Does my tone match my rating? Does my rating match my answers?"

---

## The Key Question: Who Really Benefits?

This is the foundation across all content types. Legal/political framing can obscure reality:

| Legal Framing | Real-World Reality |
|---------------|-------------------|
| "Defendant wins" | Could be regular person protected OR dangerous criminal walks |
| "Government loses" | Could be overreach checked OR necessary regulation gutted |
| "Corporation wins" | Almost always bad for regular people |
| "Case dismissed" | Could be frivolous suit rejected OR legitimate claim buried |

**The test:** If you removed all legal jargon, who's better off and who's worse off tomorrow?

---

## SCOTUS-Specific Framework

### Assessment Questions

**Q1: Who benefits in the real world?**
- (A) Regular people, the vulnerable, those facing injustice
- (B) Corporations, wealthy interests, or those in power
- (C) Bad actors exploiting a loophole (dangerous people walking free)
- (D) Nobody - the Court punted/avoided deciding

**Q2: What does this ruling actually DO?**
- (A) Protects rights, limits government/corporate overreach, fixes injustice
- (B) Guts protections, expands state/corporate power over individuals
- (C) Creates loopholes that will be abused by bad actors
- (D) Nothing meaningful - kicks the can, declares moot, remands endlessly

**Q3: How durable is this outcome?**
- (A) Strong precedent, hard to walk back, clear rule
- (B) Narrow ruling, fragile, easily distinguished in future cases
- (C) Non-decision, temporary, or explicitly limited

**Q4: What's the vote composition?**
- (A) Unanimous or near-unanimous (8-1, 9-0)
- (B) Typical ideological split (6-3 conservative, 5-4)
- (C) Unusual coalition (liberal + conservative agreement)

### Rating Derivation

| Answers | Rating | Label |
|---------|--------|-------|
| Q1=A, Q2=A, Q3=A | 0 | Democracy Wins |
| Q1=A, Q2=A, Q3=B | 1 | Crumbs from the Bench |
| Q1=D, Q2=D, any | 2 | Judicial Sidestepping |
| Q1=B/C, Q2=C, any | 3 | Institutional Sabotage |
| Q1=B, Q2=B, Q3=B | 4 | Rubber-stamping Tyranny |
| Q1=B, Q2=B, Q3=A | 5 | Constitutional Crisis |

### Edge Cases

**"Defendant wins" but it's bad:**
- Serial killer walks on technicality → Q1=C, Q2=C → Level 2-3
- Corporation escapes liability → Q1=B → Level 3-5

**"Government loses" but it's good:**
- Prosecutorial overreach checked → Q1=A, Q2=A → Level 0-1
- Surveillance program limited → Q1=A, Q2=A → Level 0-1

**"Government loses" but it's bad:**
- Environmental regulation gutted → Q1=B, Q2=B → Level 4-5
- Consumer protection struck down → Q1=B, Q2=B → Level 4-5

### Tone Alignment

| Rating | Tone | Opening Should Feel Like |
|--------|------|-------------------------|
| 0 | Genuine, credit where due | "The system actually worked." |
| 1 | Cautiously optimistic, note fragility | "A win, but read the fine print." |
| 2 | Eye-roll, lazy bureaucracy | "They punted. Again." |
| 3 | Sardonic, explain the trick | "Sounds boring. That's the point." |
| 4 | Angry, name victims | "Good news for cops who shoot first." |
| 5 | Alarm bells, name corrupt actors | "Leonard Leo's wishlist just got shorter." |

### Red Flags (Self-Correction Triggers)

If any of these are true, STOP and re-evaluate:

- [ ] Rating is 3-5 but Q1 answer was "regular people benefit"
- [ ] Rating is 0-1 but Q1 answer was "corporations/powerful benefit"
- [ ] Unanimous decision but framed as controversial (Level 4-5)
- [ ] Jackson/Sotomayor/Kagan authored majority protecting rights but rated 3-5
- [ ] Thomas/Alito authored majority expanding corporate power but rated 0-1
- [ ] Opening tone doesn't match rating (cynical opening + Level 0-1 rating)

---

## Pardons-Specific Framework

### Assessment Questions

**Q1: What's the connection to Trump?**
- (A) Documented financial payments (donations, business deals, memberships)
- (B) Direct relationship (inner circle, family, campaign staff, lawyers)
- (C) Network connection (knows someone who knows Trump, MAGA celebrity)
- (D) Fame only (celebrity advocacy, media attention)
- (E) Flattery only (praised Trump, no other connection)
- (F) No connection, appears merit-based

**Q2: Is there documented quid pro quo?**
- (A) Yes - payment timing correlates with pardon, FEC records show pattern
- (B) Likely - circumstantial but strong (Mar-a-Lago member, major donor)
- (C) Unclear - connection exists but no clear exchange
- (D) No - appears to be genuine clemency case

**Q3: What was the original offense?**
- (A) Nonviolent, arguably unjust sentence
- (B) White collar / financial crimes
- (C) Violent crime with victims
- (D) Political crimes (Jan 6, fake electors, etc.)

**Q4: Who advocated for this pardon?**
- (A) Criminal justice reform groups (non-Trump aligned)
- (B) Trump allies (Alice Johnson network, GOP politicians)
- (C) Celebrity advocacy
- (D) Family/personal connections
- (E) No known advocacy

### Rating Derivation

| Answers | Rating | Label |
|---------|--------|-------|
| Q1=A, Q2=A/B | 5 | Pay 2 Win |
| Q1=B, Q2=B/C | 4 | Cronies-in-Chief |
| Q1=C, any | 3 | The Party Favor |
| Q1=D, Q2=C/D | 2 | The PR Stunt |
| Q1=E, Q2=D | 1 | The Ego Discount |
| Q1=F, Q2=D, Q3=A, Q4=A | 0 | Actual Mercy |

### Special Cases

**Jan 6 / Fake Electors:**
- Always Level 4-5 regardless of individual connection
- Focus on: impunity signal, permission for future actors, threat to rule of law
- Tone: systemic danger, not individual corruption

**Group Pardons:**
- Rate the group's collective connection, not individuals
- Focus on the MESSAGE being sent

---

## Stories-Specific Framework

### Assessment Questions

**Q1: Who is harmed by this action/event?**
- (A) Democracy, voting rights, rule of law
- (B) Specific vulnerable groups (immigrants, poor, minorities)
- (C) General public (healthcare, environment, economy)
- (D) Political opponents only
- (E) Nobody / self-inflicted harm only

**Q2: What's the scale of impact?**
- (A) Systemic - changes how government/institutions work
- (B) Policy - affects millions through law/regulation
- (C) Significant - affects thousands, notable harm
- (D) Limited - affects few, mostly political theater
- (E) Symbolic - embarrassing but no real impact

**Q3: Is this criminal or just shitty?**
- (A) Clearly criminal (fraud, bribery, incitement)
- (B) Likely criminal (under investigation, evidence strong)
- (C) Corrupt but legal (self-dealing, nepotism, grift)
- (D) Hypocritical / embarrassing
- (E) Standard political behavior

**Q4: Is this new or pattern?**
- (A) Escalation of known pattern
- (B) New revelation of existing behavior
- (C) First instance of this type
- (D) Ongoing / expected behavior

### Rating Derivation

| Answers | Severity |
|---------|----------|
| Q1=A, Q2=A, Q3=A/B | Critical |
| Q1=B/C, Q2=B, Q3=A/B/C | Severe |
| Q1=B/C/D, Q2=C, Q3=C | Moderate |
| Q1=D/E, Q2=D/E, Q3=D/E | Minor |

---

## Implementation Notes

### For Prompt Engineering

Include this framework in the system prompt, but condensed:

```
BEFORE assigning a rating, answer:
1. Who benefits in the real world - regular people or the powerful?
2. Does this protect rights or erode them?
3. Is this durable or fragile?

THEN derive rating from answers:
- People benefit + rights protected → Level 0-1
- Powerful benefit + rights eroded → Level 4-5
- System failure / punt / loophole → Level 2-3

THEN write summary with tone matching that rating.

SANITY CHECK before output:
- Does opening tone match rating?
- Would the rating change if you re-read your Q1 answer?
```

### For Validation

After enrichment, we can programmatically check for red flags:
- `who_wins` contains "defendants" or "individuals" but `ruling_impact_level` >= 3
- `who_loses` contains "government" or "prosecution" but `ruling_impact_level` >= 3
- Majority author is liberal justice but rating is 4-5 for rights-protecting decision

### For Human Review

Flag cases where:
- Rating and tone seem misaligned
- Outcome language contradicts rating
- Edge cases that don't fit the matrix

---

## Why This Matters

Without this framework, GPT tends to:
1. Pick dramatic ratings because they sound more engaging
2. Apply cynical tone to everything (it's a political accountability site)
3. Miss that "defendant wins" can be good when it protects rights
4. Miss that "government loses" can be bad when it guts protections

The framework forces: **Reason first, rate second, verify third.**

---

## Revision History

- 2026-01-25: Initial framework created based on Barrett v. United States analysis
