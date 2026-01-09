# TrumpyTracker Documentation

## Quick Start
- **New to project?** Read `/docs/architecture/ARCHITECTURE.md`
- **Starting work?** Read `/docs/STARTUP_PROMPT.md`
- **Need a handoff?** Use template in `/docs/HANDOFF_PROMPT.md`
- **Full protocol?** See `/docs/SESSION_PROTOCOL.md`

## Documentation Structure
- `/handoffs/` - Session summaries (not in project knowledge)
- `/architecture/` - System design and structure
- `/database/` - Schemas, migrations, data models
- `/guides/` - How-to guides organized by topic
- `/api/` - API documentation and specifications
- `/reference/` - Quick reference and troubleshooting
- `/archive/` - Superseded documents (for reference only)
- `/plans/` - Implementation plans

**Do NOT create docs in /docs/ root** - use appropriate subdirectories above.

## Key Documents
**For Claude:**
- `PROJECT_INSTRUCTIONS.md` - Condensed startup instructions
- `STARTUP_PROMPT.md` - Full session start checklist
- `HANDOFF_PROMPT.md` - Session end template
- `SESSION_PROTOCOL.md` - Complete workflow details

**For Development:**
- `architecture/ARCHITECTURE.md` - System overview
- `guides/deployment/production-deployment-checklist.md` - Deploy to prod
- `database/database-schema.md` - Database structure
- `reference/TROUBLESHOOTING.md` - Common issues

## Finding Documents
- **Architecture decisions?** → `/architecture/`
- **How to do X?** → `/guides/[category]/`
- **API reference?** → `/api/`
- **Past session?** → `/handoffs/YYYY-MM-DD-name.md`
- **Database schema?** → `/database/`
- **Something broken?** → `/reference/TROUBLESHOOTING.md`

_Last Updated: January 8, 2026_
