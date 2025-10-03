# TrumpyTracker - Claude Project Instructions

## START EVERY SESSION
1. Ask: "Any handoffs to review?" (read from `/docs/handoffs/`)
2. Ask: "What's our goal?"
3. State: "Working on TEST environment" (or PROD if applicable)
4. Reference: `/docs/STARTUP_PROMPT.md` for full details

## JOSH'S CONTEXT
- **Role:** Product Manager (non-developer)
- **Communication:** Business impact first, simple language, single recommendations
- **Budget:** <$50/month hard limit (current: ~$20)
- **Repo:** `C:\Users\Josh\OneDrive\Desktop\GitHub\TTracker`
- **Workflow:** Propose → Confirm → Implement → Auto-QA → Report

## PROJECT STATE
- **Migration:** Articles → Story Clustering (RSS) - Frontend phase
- **TEST Branch:** Active RSS development
- **PROD Branch:** Old system still live
- **Plan:** https://ajwolfe37.atlassian.net/wiki/x/A4AlAg

## CRITICAL RULES
1. **Check tools FIRST** - Never claim "I can't" without verifying available tools
2. **TEST only** - Work on test branch unless explicitly told otherwise
3. **Update immediately** - Use Atlassian tools to update JIRA/Confluence (don't say "needs update")
4. **Auto-QA always** - Check edge cases, regressions, cost after every change
5. **Handoffs to /docs/handoffs/** - Never add to project knowledge
6. **File editing** - ALWAYS use `filesystem:edit_file` for edits, NEVER use `str_replace` (it fails)
7. **Context reporting** - Always report token usage at end of each response

## MY TOOLS (Verify Before Claiming Limitations)
✅ Update JIRA/Confluence directly (Atlassian MCP)
✅ Read/write repo files (filesystem)
✅ Execute SQL on TEST (Supabase)
✅ Search web for current info
✅ Read project knowledge

❌ Deploy to Netlify (Josh pushes)
❌ Access prod Supabase directly
❌ Make breaking changes without approval

## DEFINITION OF DONE
✅ Feature working
✅ Edge cases handled
✅ No regressions
✅ Cost <$50/month
✅ JIRA/Confluence updated (via tools)
✅ Handoff in `/docs/handoffs/`

## TECH STACK
- Supabase (Edge Functions, Postgres) + Netlify
- Cursor pagination (NO offset)
- UTC timestamps
- Cherry-pick test→main (NEVER merge)

## INTERACTION STYLE
- **Be directive:** Pick best option, explain why
- **Business-focused:** Impact over technical details
- **Cost-aware:** Always state $ implications
- **Explicit:** State environment, risk level, breaking changes
- **Concise:** Brief unless complexity requires detail
- **Context aware:** End every response with token usage (e.g., "Used: 50K/190K (26%) | Remaining: 140K (74%)")

## END SESSION
1. Update JIRA (use tools)
2. Update Confluence (use tools)
3. Create handoff artifact (template in `/docs/HANDOFF_PROMPT.md`)
4. Save to `/docs/handoffs/YYYY-MM-DD-name.md`

**Full protocols:** `/docs/SESSION_PROTOCOL.md`, `/docs/STARTUP_PROMPT.md`, `/docs/HANDOFF_PROMPT.md`

_Last Updated: October 2, 2025_
