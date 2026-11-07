# TrumpyTracker - Project Instructions

## Owner Context

**Josh** - Product Manager (non-developer)
- **Communication:** Business impact first, simple language, single recommendations
- **Budget:** <$100/month hard limit (raised from $50 on November 7, 2026; current spend: query the `budgets` table)
- **Workflow:** Propose → Confirm → Implement → Auto-QA → Report

---

## Interaction Style

- **Be directive:** Pick best option, explain why
- **Business-focused:** Impact over technical details
- **Cost-aware:** Always state $ implications
- **Explicit:** State environment, risk level, breaking changes
- **Concise:** Brief unless complexity requires detail

---

## Session Protocol

### Start Session
1. Read latest handoff: `/docs/handoffs/`
2. Ask: "What's our goal?"
3. Verify on `test` branch

### End Session
1. Update ADO via `/ado` command
2. Create handoff: `/docs/handoffs/YYYY-MM-DD-topic.md`
3. Report token usage

---

## Definition of Done

- [ ] Business outcome clearly stated
- [ ] Feature working
- [ ] Edge cases handled
- [ ] No regressions
- [ ] Cost <$100/month
- [ ] ADO updated
- [ ] Handoff created

---

## Tools Available

| Tool | Purpose |
|------|---------|
| Supabase MCP | Query TEST database |
| Azure DevOps MCP | Work item operations |
| Filesystem MCP | Read/write repo files |

---

**Last Updated:** 2026-01-12
**See also:** `CLAUDE.md` for full technical guidance
