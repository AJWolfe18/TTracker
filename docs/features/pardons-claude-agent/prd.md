# PRD: Claude Pardons Enrichment Agent

**Status:** Planning
**Created:** 2026-05-28
**Author:** Josh + Claude Code
**Related ADO:** Epic ADO-516 (parent: Epic 109 Trump Pardons Tracker)
**Pattern:** Mirrors SCOTUS Claude Agent (ADO-467) and EO Claude Agent (ADO-476)

---

## 1. Problem Statement

The current pardons enrichment pipeline uses Perplexity Sonar for research + GPT-4o-mini for editorial tone. This two-phase pipeline has systemic quality problems:

### Research Quality Failures (Perplexity)

| Problem | Evidence | Impact |
|---------|----------|--------|
| **Empty crime descriptions** | 116/118 PROD pardons have NULL `crime_description` | Users see "offense: unknown" for nearly every pardon |
| **Missed connections** | 69/118 at corruption_level 1 with `no_connection` | FACE Act protesters (campaign promise = L3), Juan Orlando Hernandez (geopolitical favor = L3-4) rated as L1 |
| **Wrong corruption levels** | Tina Peters at L3 (should be L4 — Trump personally threatened CO SoS) | Corruption meter misleads users on the most egregious cases |
| **No crime context** | `crime_description` column exists but nothing writes to it | The "what they did" section of every pardon card is empty |

### What's NOT Broken

The corruption level **scale itself** is solid (lines 123-132 of `perplexity-research.js`):
- L5 = Money (donations, PAC) — correct mechanism
- L4 = Direct Trump relationship — correct mechanism
- L3 = Network (MAGA world, GOP allies) — correct mechanism
- L2 = Celebrity/fame — correct mechanism
- L1 = Flattery only — correct mechanism
- L0 = Actual mercy — correct mechanism

The problem is Perplexity's research quality — it misses connections that a reasoning model with web access would find.

### Specific Wrong Ratings (Audit Sample)

| Pardon | Current | Correct | Why |
|--------|---------|---------|-----|
| Tina Peters | L3 | L4 | Trump personally called CO Secretary of State to threaten; she was his election fraud crusader |
| 23 FACE Act protesters | L1 | L3 | Campaign promise — "vote for me, I'll free you" = network mechanism |
| Juan Orlando Hernandez | L1 | L3-4 | Former Honduras president; geopolitical favor, drug trafficking conviction |
| Suzanne Kaye | L1 | L3 | Jan 6 participant, MAGA network connection |
| Multiple "credit where it's due" L1s | L1 | L0 | If genuinely no Trump connection AND meritorious, should be L0 (actual mercy) |

---

## 2. Solution

Replace the Perplexity + GPT pipeline with a single Claude Code cloud scheduled agent — the same architecture that solved identical problems for SCOTUS (60% contradiction rate → 0% in one prompt) and EOs (88% level-4 saturation → natural distribution).

### Why This Works

1. **Single-pass reasoning:** Claude reads web sources, extracts facts, AND writes editorial in one pass. No handoff between research and tone phases means no information loss.
2. **Web research built in:** Claude can search for and read news articles, FEC records, court documents — the same research Perplexity does, but with better reasoning about what the evidence means.
3. **Crime description filled:** The agent writes `crime_description` as part of its standard enrichment — closing the biggest data gap.
4. **Corruption calibration:** Gold set examples + anti-default-bias rules prevent the L1 flatline that Perplexity produces.
5. **$0 marginal cost:** Cloud agents run on the Claude Code subscription. Eliminates ~$1-2/month Perplexity + GPT costs.

### What Changes for Users

| Before | After |
|--------|-------|
| "Offense: unknown" on most cards | Every pardon has a readable crime description |
| 69/118 pardons show "Broken Clock" (L1) | Corruption levels reflect actual mechanisms (L3-4 for network/direct connections) |
| Generic "no connection" for political pardons | Specific connection explanations with sourced evidence |
| Empty pattern_analysis on some cards | Every pardon has pattern context linking it to broader pardon strategy |
| Two separate AI pipelines (Perplexity → GPT) | One agent, one pass, no handoff errors |

---

## 3. Scope

### In Scope

- **Pardons enrichment agent prompt** with gold set calibration
- **Observability table** (`pardons_enrichment_log`) for run tracking
- **Cloud trigger** (daily schedule, manual runs)
- **Admin dashboard updates** — add `crime_description` edit field to pardons admin tab
- **PROD re-enrichment** of all ~118 pardons with new agent
- **Retire legacy scripts** (perplexity-research.js, enrich-pardons.js, pardons-gpt-prompt.js, pardons-variation-pools.js, research-pardons.yml, enrich-pardons.yml)

### Out of Scope

- DOJ scraper changes (works fine, keeps running)
- New pardon ingestion (DOJ scraper + daily agent handles this)
- Frontend UI changes (existing pardons UI is fine)
- Connection network visualization (future feature)

---

## 4. Architecture

```
DOJ Clemency Page
    ↓ (daily GitHub Action on main — UNCHANGED)
pardons-tracker.yml → scrape-doj-pardons.js
    ↓ Inserts raw pardons with research_status='pending'
    ↓
    ↓ (daily cloud agent — NEW, replaces Perplexity+GPT)
    ↓
Claude Agent (Opus 4.6, Anthropic cloud)
    ├── Connects: Supabase PostgREST via Bash/curl (service key in env vars)
    ├── Checks: pardons_enrichment_log for overlapping runs
    ├── Logs: POST run start to pardons_enrichment_log (status='running')
    ├── Reads: GET pardons WHERE enriched_at IS NULL OR needs re-enrichment
    ├── Researches: WebFetch news articles, FEC records, court docs for each pardon
    ├── Reasons: single-pass research + fact extraction + editorial
    ├── Writes: PATCH enrichment fields to pardons
    ├── Logs: PATCH run completion to pardons_enrichment_log
    └── Auto-publishes: sets is_public=true (same as EO/SCOTUS agents)
    ↓
Admin Review (Josh)
    ├── Reviews via admin dashboard Pardons tab
    ├── Edits crime_description, corruption_level if needed
    └── Flags issues for prompt iteration
```

### Key Differences from SCOTUS/EO Pattern

| Aspect | SCOTUS/EO | Pardons |
|--------|-----------|---------|
| Source text | In-DB opinion/FR text | Web research (agent fetches externally) |
| Research phase | Agent reads stored text | Agent searches web for connections, FEC data, news |
| crime_description | N/A | NEW field the agent must populate |
| corruption_level | alarm_level (0-5 in EO) | corruption_level (0-5, already exists) |
| Tone voice | "The Betrayal" / "The Power Grab" | "The Transaction" |
| Volume | SCOTUS: 0-5/day, EO: 0-3/day | Pardons: 0-5/day (batch pardons are rarer) |

---

## 5. Agent Enrichment Fields

### Fields the Agent Writes

| Field | Type | Description |
|-------|------|-------------|
| `crime_description` | TEXT | Human-readable description of the crime (NEW — currently empty) |
| `primary_connection_type` | TEXT | Enum: mar_a_lago_vip, major_donor, family, etc. |
| `secondary_connection_types` | TEXT[] | Additional connections |
| `corruption_level` | SMALLINT | 0-5 scale per corruption level guide |
| `trump_connection_detail` | TEXT | 2-3 sentence explanation of relationship |
| `donation_amount_usd` | NUMERIC | Campaign/PAC donation if found |
| `receipts_timeline` | JSONB | Array of timeline events with sources |
| `summary_neutral` | TEXT | Factual 2-3 sentence summary |
| `summary_spicy` | TEXT | "The Transaction" editorial voice |
| `why_it_matters` | TEXT | Pattern analysis — how this fits broader strategy |
| `pattern_analysis` | TEXT | Cross-pardon patterns |
| `source_urls` | JSONB | Array of source URLs used |
| `enriched_at` | TIMESTAMPTZ | Timestamp of enrichment |
| `is_public` | BOOLEAN | Set to true (auto-publish) |
| `needs_review` | BOOLEAN | True when corruption_level = 0 or confidence is low |

### Fields the Agent NEVER Writes

| Field | Why |
|-------|-----|
| `recipient_name` | Set by DOJ scraper |
| `pardon_date` | Set by DOJ scraper |
| `clemency_type` | Set by DOJ scraper |
| `offense_raw` | Set by DOJ scraper |
| `source_system` / `source_key` | Set by DOJ scraper |
| `research_status` | Legacy field from Perplexity pipeline |

---

## 6. Success Criteria

### Must-Have (Launch Gate)

- [ ] **100% crime_description coverage** — every enriched pardon has a non-empty crime_description
- [ ] **Zero L1 pardons with documented connections** — if Perplexity was wrong, agent must find the real connection
- [ ] **Gold set accuracy** — 5 pardons at levels 0-5 match expected corruption level within ±1
- [ ] **No fabricated connections** — every claim sourced from web research (agent cites sources)
- [ ] **Tone compliance** — "The Transaction" voice, banned openings respected, profanity only at L4-5

### Nice-to-Have (Post-Launch)

- [ ] **Receipts timeline populated** for ≥80% of pardons
- [ ] **donation_amount_usd populated** for all major_donor connections

**Note:** Admin `crime_description` editing is already supported in the pardons admin tab (EditPardonModal, `PARDON_ALLOWED_FIELDS`). No additional work needed.

---

## 7. Cost Analysis

### Current Pipeline Cost

| Component | Cost/Pardon | Monthly |
|-----------|-------------|---------|
| Perplexity Sonar research | ~$0.0065 | ~$1/mo |
| GPT-4o-mini enrichment | ~$0.003 | ~$0.50/mo |
| **Total** | ~$0.01 | **~$1.50/mo** |

### Claude Agent Cost

| Component | Cost |
|-----------|------|
| Cloud agent runs | $0 (Claude Code subscription) |
| **Net savings** | **~$1.50/month** |

Cost savings are modest since pardons volume is low, but the quality improvement is the real win — this isn't a cost play, it's a quality play.

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Agent web research finds wrong person | Gold set validation + needs_review flag for uncertain matches |
| Agent can't access FEC/PACER data | Fallback to news sources; flag gaps with needs_review=true |
| Corruption level still defaults to L1 | Anti-default-bias rules in prompt; distribution quota check |
| Daily DOJ scraper creates pardons agent can't research yet | Agent skips pardons < 24h old (let news coverage accumulate) |
| PR #94 not merged (auto-publish fix) | Must merge before PROD agent deployment |

---

## 9. Dependencies

- **PR #94** (auto-publish fix) — must be merged to main before PROD agent goes live
- **Admin pardons tab** — already exists (`admin-pardons` edge function), needs `crime_description` added to edit modal
- **PROD pardons data** — ~118 pardons, all need re-enrichment with new agent

---

## 10. Timeline Estimate

| Story | Effort | Sessions |
|-------|--------|----------|
| S1: Observability table | Small | 0.5 |
| S2: Prompt + gold set validation | Medium | 1 |
| S3: Cloud trigger + TEST validation | Small | 0.5 |
| S4: Admin tab crime_description | Small | 0.5 |
| S5: PROD re-enrichment | Medium | 1-2 |
| S6: Retire legacy scripts | Small | 0.5 |
| **Total** | | **4-5 sessions** |

---

**Last Updated:** 2026-05-28
**Maintained by:** Josh + Claude Code
