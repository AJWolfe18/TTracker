# TrumpyTracker Custom Commands Reference

Quick reference for all custom slash commands available in this project.

## 📋 TLDR - Available Commands

| Command | Usage | Purpose | Context Savings |
|---------|-------|---------|-----------------|
| `/jira` | `/jira TTRC-268 transition to Done` | JIRA operations via subagent | 20K → 100 tokens (99.5%) |
| `/validate` | `/validate` | Pre-commit validation checklist | Prevents mistakes |

---

## 🎯 How Commands Work

### What Are Slash Commands?

Custom slash commands are markdown files in `.claude/commands/` that define reusable prompts. When you type `/command-name`, Claude executes the prompt defined in that file.

### Location

- **Project commands** (shared with team): `.claude/commands/`
- **Personal commands** (just for you): `~/.claude/commands/`

### Creating New Commands

1. Create a markdown file: `.claude/commands/my-command.md`
2. Add frontmatter (optional):
   ```markdown
   ---
   description: Brief description of what this does
   ---
   ```
3. Write the prompt Claude should execute
4. Use arguments: `$ARGUMENTS`, `$1`, `$2`, etc.
5. Type `/my-command` to use it

---

## 📚 Command Details

### `/jira` - JIRA Operations

**Purpose:** Interact with JIRA tickets via subagent to prevent 20-30K token context bloat.

**Why Use This:**
- JIRA MCP tools return EVERYTHING (descriptions, comments, history, attachments)
- Single ticket query = 20-30K tokens in main conversation
- Subagent processes internally, returns ~100 token summary
- **Context savings: 99.5%**

**Usage Examples:**

```bash
# Get ticket status
/jira TTRC-268 get status

# Transition ticket
/jira TTRC-268 transition to Done

# Add comment
/jira TTRC-268 add comment "Fixed RSS duplicate bug"

# Create new ticket
/jira create story "Implement story reopening" in project TTRC

# Search tickets
/jira search "project = TTRC AND status = 'In Progress'"
```

**What You Get Back:**

```
✅ TTRC-268: Fix RSS duplicate articles
Status: In Progress → Done
Comment added: "Fixed url_hash composite key bug"
Notes: Had 3 linked tickets, all updated
```

**When to Use:**
- ✅ Any JIRA query or update
- ✅ When you need ticket status
- ✅ Before creating handoffs (check related tickets)

**When NOT to Use:**
- ❌ When you need full ticket history for analysis (rare)

**File:** `.claude/commands/jira.md`

---

### `/validate` - Pre-Commit Validation

**Purpose:** Run comprehensive validation checklist via subagent before committing code.

**Why Use This:**
- Catches common mistakes before they reach code review
- Ensures compliance with code-patterns.md
- Verifies cost implications
- Runs QA tests
- Checks security issues

**Usage:**

```bash
/validate
```

**What It Checks:**

1. **Code Quality** - No console.log, proper error handling
2. **Patterns** - Cursor pagination, timestamptz, IF NOT EXISTS
3. **Testing** - Runs QA suites, tests edge cases
4. **Database** - SQL injection, indexes, migrations
5. **Cost** - Budget verification, OpenAI impact
6. **Documentation** - Updates code-patterns.md, common-issues.md
7. **Security** - No secrets, input validation, CORS

**What You Get Back:**

```
✅ VALIDATION COMPLETE

Code Quality: ✅ Pass
Patterns: ✅ Pass
Testing: ✅ Pass (ran qa:smoke, tested 4 edge cases)
Database: ✅ Pass
Cost: ✅ $0.01 impact (well under budget)
Documentation: ✅ Updated code-patterns.md
Security: ✅ Pass

READY TO COMMIT: YES

Recommended commit message:
fix(rss): prevent duplicate articles via url_hash composite key
```

**When to Use:**
- ✅ Before every git commit
- ✅ After implementing new features
- ✅ After fixing bugs
- ✅ Before creating PRs

**When NOT to Use:**
- ❌ For documentation-only changes
- ❌ For config file updates (.env.example, etc.)

**File:** `.claude/commands/validate.md`

---

## 🛠️ Creating Your Own Commands

### Template

```markdown
---
description: Brief description for /help
---

# Command Title

Your prompt goes here. Claude will execute this when the command is invoked.

You can use:
- $ARGUMENTS - All arguments as a single string
- $1, $2, $3 - Individual arguments
- @filename - Include file contents
- !bash command - Run bash before processing

## Usage

/your-command arg1 arg2 arg3
```

### Example: Quick Handoff Review

Create `.claude/commands/review-handoff.md`:

```markdown
---
description: Review latest handoff and start session
---

# Session Startup

1. Read the latest handoff:
   ```bash
   ls -t docs/handoffs/ | head -1
   ```

2. Verify on test branch:
   ```bash
   git branch --show-current
   ```

3. Check for any critical issues in latest commits

4. Ask: "What should we work on today?"
```

**Usage:** `/review-handoff`

---

## 🔧 Built-in Commands (Reference)

These are always available (not custom):

| Command | Purpose |
|---------|---------|
| `/help` | List all available commands |
| `/clear` | Clear conversation history |
| `/model` | Change AI model (sonnet/opus/haiku) |
| `/cost` | Show token usage |
| `/sandbox` | Toggle sandbox mode |
| `/reset` | Reset to initial state |

Full list: Type `/help` in Claude Code

---

## 💡 Best Practices

### When to Create Commands

✅ **Good use cases:**
- Repetitive workflows (validation, PR creation)
- Multi-step processes (session startup, handoff creation)
- Context-heavy operations (JIRA queries)
- Team-shared workflows

❌ **Poor use cases:**
- One-off tasks
- Simple single questions
- Highly variable operations

### Naming Conventions

- Use lowercase: `/validate` not `/Validate`
- Use hyphens for multi-word: `/review-handoff`
- Keep short: `/jira` not `/jira-ticket-operations`
- Avoid conflicts with built-ins: Don't use `/help`, `/clear`, etc.

### Documentation

Every command should have:
- Frontmatter with description
- Clear usage examples
- Expected output format
- When to use / when not to use

---

## 📊 Context Impact

**Without Commands:**
- Manual JIRA query: 20-30K tokens
- Manual validation: 5-10K tokens (checking patterns, running tests)
- **Total per session: 25-40K tokens wasted on boilerplate**

**With Commands:**
- `/jira`: 100 tokens (99.5% savings)
- `/validate`: 500 tokens (95% savings)
- **Total per session: ~600 tokens on boilerplate**

**Savings: 98% reduction in boilerplate context**

---

## 🚀 Quick Start

**First time using commands?**

1. **Try `/jira` for your next JIRA update:**
   ```
   /jira TTRC-XXX transition to Done
   ```

2. **Try `/validate` before your next commit:**
   ```
   /validate
   ```

3. **Create your own command** for a repeated workflow

**Need help?** Check `.claude/commands/` to see the source files or ask Claude: "Show me how to create a custom command for X"

---

## 📝 Command Inventory

### Current Commands (2)
- ✅ `/jira` - JIRA operations (high value, saves 20K tokens)
- ✅ `/validate` - Pre-commit validation (quality of life)

### Potential Future Commands
- `/review-handoff` - Session startup routine
- `/create-pr` - PR creation workflow
- `/deploy-test` - Deploy to TEST environment
- `/check-budget` - Query current spend
- `/troubleshoot-rss` - RSS pipeline debugging

**Want to add a command?** Create `.claude/commands/your-name.md` and update this inventory.

---

**Last Updated:** 2025-11-16  
**Maintained by:** Josh + Claude Code  
**Location:** `.claude/commands/`
