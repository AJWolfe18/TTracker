# Handoff: Product Analytics v1 — PRD, Plan, and Carding (Epic 254)

**Date:** August 23, 2026 (afternoon session — distinct from the morning Tracker-deploy handoff)
**Session type:** Planning/docs only — no code changed, nothing to QA
**ADO:** Epic 254 → Bug 558 + Stories 559–563 (all New)

---

## What happened

Started as "are the news summaries too short?" and became the full product-analytics program.

1. **Summary-length investigation:** story summaries in the DB are healthy (380–560 chars, matches the 2–3 sentence prompt spec); the feed cards truncate to 180 chars in `src/lib/adapter.ts:81` (`truncateDek`), detail pages show full text. Decision: don't touch summary length until metrics show whether readers click through to sources. No change made.
2. **Analytics audit:** the React app has ONLY GA4 page views; the legacy pages' rich `shared.js` events never made it over. Newsletter signups: `newsletter_subscribers` on PROD (TEST has 0; PROD count needs a SQL-editor query or GA4 event check).
3. **Wrote the PRD + plan** for Product Analytics v1 (PostHog + GA4), survived **five rounds of desktop-Codex review** (P1 bugs → wording polish; convergence achieved). Key catches fixed: flag-key naming (`feedback`, not `ff_feedback`), the missed React newsletter path (`Footer.tsx`/`newsletter.ts`), `card_open` implementability (Home.tsx closure, Card untouched), migration idempotency, PII/privacy consistency, script-level (not config-level) analytics gating.
4. **Found a live bug:** GA4's script + config fire unconditionally on every surface — **TEST/localhost pageviews pollute PROD GA4 today**. Extracted as Bug ADO-558, ships first.
5. **Feedback button de-scoped by Josh:** message-only popup, React app only, honeypot + rate limits (no email, no category, no Turnstile, no legacy include). Notification = PostHog daily-digest alert on `feedback_submit` emailing Josh; junk rows are inert.
6. **Carded everything** under existing Epic 254 (old ADO-258 turned out already Closed; its shared.js scope shipped. The old `docs/features/analytics/plan.md` status table is stale — kept untouched; new plan is `plan-product-analytics-v1.md`).
7. **Phase 0 done:** PostHog US cloud project **572949**, no payment method attached (= billing-cap equivalent), replay 10% with default mask-everything, repo-watch declined, `phc_` key posted as a comment on ADO-559.

## Where things live

- **PRD:** `docs/features/analytics/prd.md` — §0 is the resolved-decisions checklist (all answered; don't re-ask Josh)
- **Plan:** `docs/features/analytics/plan-product-analytics-v1.md` — 5 phases, one session each
- **Cards:** 558 (GA4 gate bug, fully self-contained), 559 (P1 bootstrap — key in latest comment), 560 (P2 events), 561 (P3 feedback popup), 562 (P4 funnel/dashboards — dashboards via claude-in-chrome per Josh), 563 (P5 PROD rollout — supervised session)
- Docs were committed to `test` via the **GitHub contents API** because the local worktree belonged to a concurrent ADO-554 session — local tree was never touched (one accidental overwrite of the old tracked `plan.md` was restored via `git checkout --`).

## Execution decisions (Josh)

- **Opus runs 558–562**, one story per session, one PR to `test` per ticket, `@codex review` on each. **No subagents** (standing ban). **Fable takes 563** (PROD deploy, supervised) and anything that goes sideways. Build sessions should use an isolated worktree.
- Cost: $0/month total (PostHog free tier can't bill — no card attached; GA4 free).

## Kickoff prompt for the next session (Opus)

```
/start-work ADO-558 + ADO-559 (Product Analytics v1, Epic 254 kickoff).

Read docs/features/analytics/prd.md (section 0 first - all decisions are resolved, don't re-ask) and docs/features/analytics/plan-product-analytics-v1.md, both on the test branch. The PostHog project key and account details are in ADO-559's latest comment.

Execute in order:
1. ADO-558 (Bug, self-contained in the card): gate GA4 at script level on hostname === 'trumpytracker.com' - conditional script injection in index.html, App.tsx config call, and live legacy pages. AC: zero analytics network calls off-PROD.
2. ADO-559 (plan Phase 1): PostHog snippet (same hostname gate, no npm dep), src/lib/analytics.ts typed wrapper with per-event property maps, GA4 dual-fire, shared.js ALLOWED_PARAMS updates.

Rules: work in an isolated worktree (another session may own the main tree). Deliver one PR to test per ticket - 558's PR first, then 559's - and comment @codex review on each; do not push directly to test. No subagents. Run npm run qa:smoke before each PR. Verify every AC against actual output before moving any card past Active.
```

## Loose ends / watch items

- ADO-259 (Pre-Commerce + Search Intelligence) left open, untouched by this project.
- PROD newsletter subscriber count still unchecked (Josh: `SELECT COUNT(*), MIN(created_at), MAX(created_at) FROM newsletter_subscribers;` in the PROD SQL editor).
- Perf metrics (web-vitals, API timing, cache) = first fast-follow after v1 (PRD §9).
- 2-week north-star check card gets created at 563's deploy time (it's in 563's AC).
