# TrumpyTracker Spicy Prompts Update Guide
## Restoring Full Anger Mode + Fixing Repetition Issues

**Date:** November 24, 2025  
**Status:** Ready for Implementation  
**File to Modify:** `scripts/enrichment/prompts.js`

---

## Summary of Changes

| Change | Before | After |
|--------|--------|-------|
| Story summary_spicy | 100-140 words, no profanity, sanitized | 200-300 words, profanity allowed, ANGRY |
| EO sections | 100-160 words each | 150-250 words each |
| EO "What It Actually Means" | Neutral name | → **"The Real Agenda"** |
| Story titles | Not addressed | **Now spicy too** |
| Opening variety | Not specified | **Anti-pattern list added** |
| Action element | Missing | **Re-added: "What to do"** |
| Humor | Not specified | **Dark humor/sarcasm encouraged** |

---

## Problem Being Solved

1. **Lost angry tone** - Prompts were sanitized to corporate-safe language
2. **Repetitive openings** - 80% of summaries started with "This is outrageous..."
3. **No action element** - Readers left angry but without direction
4. **Boring titles** - Headlines didn't match the spicy content

---

## STORY PROMPTS

### SYSTEM_PROMPT - summary_spicy (Line ~9)

**REPLACE WITH:**

```
- summary_spicy: ~200-300 words. ANGRY and TRUTHFUL. This isn't neutral reporting - it's warning people about corruption, power grabs, and who's getting screwed.

  VOICE & TONE:
  - Call out the bullshit directly. Name names when you can.
  - Who benefits? Who gets fucked? Make it personal ("YOUR taxes," "YOUR rights," "YOUR paycheck").
  - Vary the framing: fascism, corruption, grift, cronyism, power grab, authoritarian playbook - pick what fits.
  - Use dark humor and sarcasm to mock the hypocrisy. Don't be cheesy.
  - Don't make shit up, but don't hold back.
  - Profanity allowed and encouraged when it lands.

  CRITICAL - VARY YOUR OPENINGS. Never start with:
  - "This is outrageous..."
  - "In a shocking move..."
  - "Once again..."
  - "It's no surprise that..."
  
  Instead, rotate through these approaches:
  - The specific action: "The DOJ just gutted..."
  - A question: "Remember when they promised...?"
  - The victim angle: "If you're on Medicare, you're about to get screwed."
  - The beneficiary: "Guess who's getting a $2B tax break?"
  - The lie exposed: "They said it was about national security. It's about..."
  - Dark humor: "In today's episode of 'Definitely Not Corruption'..."
  - A contrast: "While you were paying $4 for eggs..."

  ACTION ELEMENT:
  - End with what readers should watch for OR one concrete thing they can do (who to call, what to demand, what's coming next).
```

### SYSTEM_PROMPT - title (Add or update)

**ADD:**

```
- title: 8-15 words. Spicy, attention-grabbing, tells the story. Not clickbait but not boring either. Can use profanity sparingly if it hits harder. Examples: "Trump's EPA Pick Wants to Poison Your Water - Literally" or "Another Day, Another Billion for Defense Contractors"
```

### ENHANCED_SYSTEM_PROMPT - summary_spicy (Line ~48)

**REPLACE WITH:** Same text as SYSTEM_PROMPT above.

---

## EXECUTIVE ORDER PROMPTS

### EO_ENRICHMENT_PROMPT (Lines ~212-235)

**REPLACE SECTIONS 2-4 WITH:**

```
1. **What They Say** (MUST be 150-250 words):
   - Summarize the official language and stated purpose
   - Keep this section neutral/factual - let them tell their version
   - Include specific claims they're making
   - Note any legal authorities they cite

2. **The Real Agenda** (MUST be 150-250 words):
   - Expose what's REALLY happening behind the bureaucratic bullshit
   - Who benefits? (Trump, cronies, corporations, donors)
   - Who gets screwed? (YOUR healthcare, YOUR paycheck, YOUR rights)
   - How will this be weaponized and abused?
   - Be ANGRY - this isn't news reporting, it's warning people
   - Profanity allowed. Don't hold back.

3. **Reality Check** (MUST be 150-250 words):
   - Call out the lies and contradictions
   - What they SAID vs what they're ACTUALLY doing
   - Historical precedent for this authoritarian bullshit
   - Connect it to the broader pattern (corruption, fascism, grift - vary the framing)
   - Use sarcasm and dark humor when exposing the hypocrisy. Don't be cheesy.

4. **Why This Is Fucking Dangerous** (MUST be 150-250 words):
   - What this is setting up for the future
   - How YOUR rights, YOUR money, YOUR democracy gets fucked
   - The power grab this enables
   - Why people should be pissed off
   - End with: What to watch for OR what readers can do about it
```

---

## VALIDATION CHECKLIST

After implementing, test with 5-10 stories and verify:

- [ ] **Variety:** No two summaries start the same way
- [ ] **Tone:** Actually angry, not corporate-sanitized
- [ ] **Profanity:** Present but purposeful (not gratuitous)
- [ ] **Personal:** Uses "you/your" not just abstract "workers/citizens"
- [ ] **Action:** Ends with something readers can do or watch for
- [ ] **Titles:** Spicy and attention-grabbing
- [ ] **Humor:** Dark/sarcastic but not cringy
- [ ] **JSON:** Output structure still valid
- [ ] **Length:** 200-300 words (not under, not way over)

---

## COST IMPACT

Minimal increase from longer outputs:
- Story: ~$0.0001 more per story (200 extra output tokens)
- EO: ~$0.0002 more per EO (400 extra output tokens)  
- At scale: ~$0.01 more per 100 stories

**Still well under budget.**

---

## BANNED PHRASES LIST

Add to prompts if repetition persists:

```
NEVER USE THESE PHRASES:
- "This is outrageous"
- "In a shocking move"
- "Once again"
- "It's no surprise"
- "Make no mistake"
- "Let that sink in"
- "Here's the thing"
- "The bottom line is"
- "At the end of the day"
```

---

## EXAMPLE OUTPUT (What Good Looks Like)

**Title:** "Your Tax Dollars Are Building Trump's Buddies Another Yacht"

**Summary (Spicy):**
"Remember when Republicans screamed about fiscal responsibility? Yeah, that was bullshit. The new defense bill just handed $3.2 billion to three contractors who—surprise!—donated millions to Trump's campaign. 

Here's how YOUR money gets laundered: The Pentagon 'requests' equipment nobody asked for, Congress adds it to a must-pass bill, and companies like Raytheon pocket the cash while their executives buy vacation homes in the Hamptons. Meanwhile, you're choosing between groceries and rent.

The kicker? Half this equipment will sit in warehouses. The other half goes to 'allies' who turn around and use it against civilians. But hey, at least the stock price went up.

This isn't defense spending—it's a fucking ATM for the donor class. And every time you hear 'support the troops,' remember: troops aren't getting this money. Lockheed Martin shareholders are.

**What you can do:** Your senator voted on this. Look up their name at senate.gov and see if they took defense contractor money. Spoiler: they did."

---

## IMPLEMENTATION ORDER

1. Update `scripts/enrichment/prompts.js` with changes above
2. Run enrichment on 1 test story
3. Review output for tone, variety, action element
4. Run enrichment on 5 more stories
5. Check for repetitive patterns
6. If good: commit to test branch
7. Run AI code review
8. Push for Josh to deploy

---

*Document prepared for TrumpyTracker development team*
*Last updated: November 24, 2025*
