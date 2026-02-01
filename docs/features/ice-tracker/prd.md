# PRD: ICE Accountability Tracker

**Status:** Decisions Made, Ready for ADO Epic
**Created:** 2026-01-24
**Author:** Josh + Claude
**Related ADO:** [Epic 298 - ICE Accountability Tracker](https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/298)

---

## 1. Overview

### Problem Statement
ICE and DHS are conducting mass deportations, detaining US citizens, killing people, and violating constitutional rights - but there's no single destination that tracks this accountability systematically. Information is scattered across:
- News stories that fade after 24-48 hours
- Congressional reports buried in committee documents
- Activist trackers with limited reach
- Social media posts that get taken down

**The administration's narrative:** "We're deporting dangerous criminals"
**The reality:** 73% of ICE detainees have no criminal conviction. Only 5% have violent convictions.

Nobody is exposing this gap in one comprehensive, persistent place with historical context and action pathways.

### Solution
An **ICE Accountability Tracker** section within TrumpyTracker that:
1. **Stats Dashboard** - Year-over-year deportation data, criminal vs non-criminal breakdown, deaths in detention
2. **Incident Database** - Structured tracking of abuses, violations, and deaths (not just news stories)
3. **The Lies vs Reality** - Fact-checking the administration's claims against actual data
4. **Action Pathways** - Turn rage into something useful: know your rights, report ICE, support legal defense

---

## 2. The Damning Data (Core Narrative)

### "They're Deporting Criminals" - The Lie

| Claim | Reality | Source |
|-------|---------|--------|
| "Targeting dangerous criminals" | 73% have NO criminal conviction | [TRAC Reports](https://tracreports.org/immigration/quickfacts/) |
| "Violent offenders" | Only 5% have violent convictions | [Cato Institute](https://www.cato.org/blog/5-ice-detainees-have-violent-convictions-73-no-convictions) |
| "We don't deport citizens" | 170+ US citizens illegally detained | [ProPublica](https://www.propublica.org/article/immigration-dhs-american-citizens-arrested-detained-against-will) |

### Immigrants Commit LESS Crime Than Citizens

| Population | Violent Crime Arrest Rate | Property Crime Rate |
|------------|--------------------------|---------------------|
| US-born citizens | 213 per 100K | 165 per 100K |
| Undocumented immigrants | 96 per 100K | 38 per 100K |
| **Difference** | **2.2x HIGHER for citizens** | **4.3x HIGHER for citizens** |

Source: [National Institute of Justice](https://nij.ojp.gov/topics/articles/undocumented-immigrant-offending-rate-lower-us-born-citizen-rate), Texas data 2012-2018

**150-year study finding:** Immigrants have been less likely to be incarcerated than US-born since 1870. Today they're 60% less likely. ([Northwestern/NBER](https://news.northwestern.edu/stories/2024/03/immigrants-are-significantly-less-likely-to-commit-crimes-than-the-us-born))

### Historical Deportation Context

| President | Peak Annual Deportations | Context |
|-----------|-------------------------|---------|
| Obama | 409,849 (2012) | Called "Deporter in Chief" |
| Trump 1.0 | ~260,000 max | Lower than Obama |
| Biden | 778,000 (FY24) | Title 42 + Title 8 combined |
| Trump 2.0 | 340,000 (FY25 est) | +25% over FY24, interior focus |

Sources: [Migration Policy Institute](https://www.migrationpolicy.org/article/biden-deportation-record), [Newsweek](https://www.newsweek.com/immigrant-deportations-removals-trump-biden-obama-compared-chart-2026835)

### Deaths and Violence

- **32 people died in ICE detention in 2025** - more than the last 4 years combined
- ICE killed Renee Good in Minneapolis (Jan 2026)
- 2,500% surge in non-criminal detainees since Jan 2025 (945 → 24,644)

---

## 3. Scope

### In Scope (MVP)

**Phase 1: Stats Dashboard**
- Year-over-year deportation graphs (Obama → Trump 1 → Biden → Trump 2)
- Criminal vs non-criminal breakdown (the killer visual)
- Immigrant crime rate vs citizen crime rate comparison
- Deaths in detention by year
- Detention population over time
- Data sourced from TRAC + Deportation Data Project

**Phase 2: Incident Database**
- Structured incident tracking (not just news stories)
- Manual curation initially (Josh reviews and adds)
- Incident types: deaths, US citizen detentions, violence by ICE, rights violations
- Evidence linking (YouTube embeds, external video links)
- Outcome tracking (ongoing, released, deported, died)

**Phase 3: Automated Feed + Curation**
- RSS from ACLU, House Oversight, TRAC
- Keyword filtering for ICE/DHS content
- Review queue for Josh to promote to incident database

**Phase 4: Action Integration**
- Rapid Response Network directory by state
- Know Your Rights resources (ILRC Red Cards in 39 languages)
- Legal defense fund links
- Contact your rep templates

### Out of Scope (Future)
- Real-time crowdsourced reporting (verification complexity)
- Video hosting (will link/embed only)
- Partnership with TRAC/Deportation Data Project (later opportunity)
- ICE agent database (legal/ethical concerns)

---

## 4. Incident Types

### Core Categories

| Type | Database Value | Description | Example |
|------|---------------|-------------|---------|
| **Death in Detention** | `death_detention` | Person dies while in ICE custody | Medical neglect, suicide, violence |
| **ICE Killing** | `ice_killing` | ICE agent kills someone | Renee Good (Minneapolis) |
| **US Citizen Detained** | `citizen_detained` | American citizen wrongfully held | 170+ documented cases |
| **US Citizen Deported** | `citizen_deported` | American citizen removed from country | Chanthila Souvannarath to Laos |
| **Court Order Violated** | `court_order_violated` | ICE ignores federal court ruling | Deportation despite stay order |
| **Sensitive Location Raid** | `sensitive_location` | Church, school, hospital, courthouse | LA church raid, pastor held at gunpoint |
| **Rights Violation** | `rights_violation` | Constitutional rights ignored | Warrantless entry, recording suppressed |
| **Agent Violence** | `agent_violence` | Excessive force, shootings, assaults | Less-lethal weapons on peaceful people |
| **Vehicle Incident** | `vehicle_incident` | ICE causes accident, points guns during traffic stop | Road rage incidents |
| **Family Separation** | `family_separation` | Children separated from parents | 10-year-old with brain cancer deported |
| **Medical Neglect** | `medical_neglect` | Denial of medical care in detention | Deaths from treatable conditions |
| **Agent Arrested** | `agent_arrested` | ICE agent charged with crime | Abuse, stalking, corruption |

### Blue City Targeting Pattern
Track geographic distribution with emphasis on:
- Sanctuary city raids (political targeting)
- Blue state operations
- Collaboration vs non-collaboration jurisdictions

---

## 5. Data Sources

### Statistics (Automated/Bulk Import)

| Source | What It Provides | Update Frequency | URL |
|--------|-----------------|------------------|-----|
| **TRAC Immigration** | Detention population, arrest data, criminal breakdown | Monthly | [tracreports.org](https://tracreports.org/immigration/) |
| **Deportation Data Project** | Historical ICE/CBP data (2012-2025), downloadable | Quarterly | [deportationdata.org](https://deportationdata.org/data.html) |
| **ICE.gov Statistics** | Official dashboards (spin-filtered) | Quarterly | [ice.gov/statistics](https://www.ice.gov/statistics) |
| **Cato Institute** | Criminal conviction analysis | Per study | [cato.org](https://www.cato.org/blog/5-ice-detainees-have-violent-convictions-73-no-convictions) |

### Incidents (RSS/Curated)

| Source | What It Provides | Method |
|--------|-----------------|--------|
| **House Oversight Democrats** | Verified misconduct reports, US citizen cases | RSS/scrape |
| **ACLU Press Releases** | Litigation, rights violations, policy challenges | RSS |
| **ProPublica** | Investigative deep dives | RSS |
| **The Intercept** | ICE violence documentation | RSS |
| **Wikipedia - Deaths/Detentions page** | Backfill of documented incidents | One-time seed |

### Backfill Sources
- [Wikipedia: Deaths, detentions and deportations of American citizens](https://en.wikipedia.org/wiki/Deaths,_detentions_and_deportations_of_American_citizens_in_the_second_Trump_administration)
- [ProPublica: 170+ US Citizens Detained](https://www.propublica.org/article/immigration-dhs-american-citizens-arrested-detained-against-will)
- [ACLU photographer retaliation cases](https://www.aclu.org/news/free-speech/photographer-retaliation-foia)
- [The Intercept LA raids documentation](https://theintercept.com/2025/07/07/ice-raids-la-violence-video-bystanders/)

---

## 6. User Experience

### Navigation
- **Location:** New tab in TrumpyTracker after existing tabs
- **URL:** `/?tab=ice` or `/ice-tracker`
- **Tab Label:** "ICE Tracker" or "ICE Accountability"

### Stats Dashboard (Phase 1)

```
┌─────────────────────────────────────────────────────────────────┐
│  ICE ACCOUNTABILITY TRACKER                                      │
│  "They say criminals. The data says otherwise."                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  THE LIE VS THE REALITY                                   │   │
│  │                                                           │   │
│  │  [PIE CHART]                                             │   │
│  │  73% No conviction                                       │   │
│  │  22% Non-violent conviction                              │   │
│  │  5% Violent conviction                                   │   │
│  │                                                           │   │
│  │  Source: TRAC Immigration, Nov 2025                      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  WHO COMMITS MORE CRIME?                                  │   │
│  │                                                           │   │
│  │  [BAR CHART: Arrest rates per 100K]                      │   │
│  │  Violent: Citizens 213 | Immigrants 96                   │   │
│  │  Property: Citizens 165 | Immigrants 38                  │   │
│  │  Drug: Citizens 337 | Immigrants 135                     │   │
│  │                                                           │   │
│  │  US-born citizens are 2-4x MORE likely to be arrested    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  DEPORTATIONS BY PRESIDENT (Annual)                       │   │
│  │                                                           │   │
│  │  [LINE/BAR CHART]                                        │   │
│  │  2009-2016: Obama (peak 410K in 2012)                   │   │
│  │  2017-2020: Trump 1 (peak 260K)                         │   │
│  │  2021-2024: Biden (peak 778K in 2024)                   │   │
│  │  2025+: Trump 2 (340K est FY25)                         │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  DEATHS IN DETENTION                                      │   │
│  │                                                           │   │
│  │  2025: 32 deaths (more than last 4 years combined)       │   │
│  │  [BAR CHART by year]                                     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Incident Timeline (Phase 2)

```
┌─────────────────────────────────────────────────────────────────┐
│  INCIDENT TRACKER                                                │
│                                                                  │
│  [Filters: All | Deaths | Citizens | Violence | Rights]         │
│  [State: All States ▼]                                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ [ICE KILLING]                              Jan 7, 2026   │   │
│  │                                                           │   │
│  │ Renee Good killed by ICE agent in Minneapolis            │   │
│  │                                                           │   │
│  │ ICE agent Jonathan Ross shot and killed Renee Good       │   │
│  │ during an operation. A pastor was detained while         │   │
│  │ observing the protest that followed.                     │   │
│  │                                                           │   │
│  │ 📍 Minneapolis, MN  |  Outcome: DEATH                    │   │
│  │ [View Video] [View Sources]                              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ [US CITIZEN DEPORTED]                      Dec 2025      │   │
│  │                                                           │   │
│  │ Chanthila Souvannarath deported despite court order      │   │
│  │                                                           │   │
│  │ ICE deported him to Laos despite a federal court ruling  │   │
│  │ that recognized his substantial claim to citizenship.    │   │
│  │                                                           │   │
│  │ 📍 Location Unknown  |  Outcome: DEPORTED                │   │
│  │ [View Sources]                                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Action Section (Phase 4)

```
┌─────────────────────────────────────────────────────────────────┐
│  WHAT YOU CAN DO                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  🚨 SEE ICE ACTIVITY?                                           │
│  Report to your local Rapid Response Network:                   │
│  [Select State ▼]                                               │
│  Hotline: (XXX) XXX-XXXX                                        │
│                                                                  │
│  📋 KNOW YOUR RIGHTS                                            │
│  - Don't open the door without a judicial warrant               │
│  - You have the right to remain silent                          │
│  - You have the right to a lawyer                               │
│  [Download Red Cards - 39 languages]                            │
│                                                                  │
│  💪 SUPPORT LEGAL DEFENSE                                        │
│  - ACLU Immigrants' Rights Project                              │
│  - National Immigrant Justice Center                            │
│  - Immigrant Legal Resource Center                              │
│                                                                  │
│  📱 SAFELY DOCUMENT ICE                                          │
│  Recording ICE is legal. Here's how to do it safely:            │
│  [How to Film ICE]                                              │
│                                                                  │
│  📞 CONTACT YOUR REPRESENTATIVES                                 │
│  [Find Your Rep] [Pre-written Templates]                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. Curation Workflow

### Hybrid Model: Automated Feed + Manual Curation

```
RSS Sources (ACLU, House Oversight, TRAC, news)
    ↓
Keyword Filter (ICE, DHS, deportation, detention, CBP)
    ↓
Review Queue (Josh sees potential incidents)
    ↓
Promote → Structured Incident Entry
    ├── Add incident type
    ├── Add location, date
    ├── Add victim info (if known)
    ├── Add evidence links (YouTube, news)
    ├── Set outcome
    └── Publish to tracker
```

### Manual Entry (Things Josh Sees)
Simple admin form to add:
- What happened (headline + summary)
- When and where
- Incident type (dropdown)
- Evidence links
- Source links
- Outcome status

### Verification Standard
- **Vetted sources:** House Oversight, ACLU, major news → auto-verified
- **Social media finds:** Josh reviews, marks as "reported" until confirmed
- Badge shows verification status

---

## 8. Embedding vs Hosting (Decision)

**Decision: EMBED ONLY, NO HOSTING**

| Platform | Approach | Notes |
|----------|----------|-------|
| YouTube | Embed (iframe) | Stable, no liability |
| Twitter/X | Link only | Embeds unreliable post-Musk |
| TikTok | Embed or link | Embeds work reasonably well |
| Facebook | Link only | SDK required, annoying |

**Why linking is fine:**
- No storage costs
- No legal liability
- No bandwidth costs
- If removed, we document "removed by platform" (that's data too)

---

## 9. Success Metrics

### Primary (User Engagement)

| Metric | Target | Why It Matters |
|--------|--------|---------------|
| Page visits | 1,000+/month | Are people finding this? |
| Time on page | 3+ minutes | Are they engaging with data? |
| Action clicks | 10%+ of visitors | Are they taking action? |
| Shares | 5%+ of visitors | Is it viral-worthy? |
| Return visitors | 25%+ | Is it a destination? |

### Secondary (Content)

| Metric | Target |
|--------|--------|
| Incidents tracked | 50+ in first month |
| Data freshness | Stats updated quarterly |
| Backfill completeness | All 2025 major incidents |
| Action resources | All 50 states covered |

---

## 10. Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Tab name** | "ICE Tracker" | Clean, clear, matches other trackers |
| **Incident backfill** | 2025 only | Focus on current administration |
| **Stats backfill** | Obama → present | Historical context matters for graphs |
| **First chart** | Criminal breakdown pie | The killer visual - 73% no conviction |
| **Geographic** | National, track blue city pattern | They're targeting sanctuary cities |
| **Agent database** | No | Too legally risky |
| **Crowdsourcing** | Future (vetted sources first) | Start with quality over quantity |
| **Embedding** | YouTube embed, others link | Safe, no hosting liability |

## 11. Open Questions (Remaining)

1. **Chart priority after criminal breakdown:** Deportations by president? Deaths? Crime rate comparison?

2. **Incident priority for backfill:** Start with deaths? US citizens? Most viral cases?

---

## 12. Related Resources

### Existing Trackers
- [House Oversight ICE Tracker](https://oversightdemocrats.house.gov/news/press-releases/oversight-democrats-statement-new-tool-document-ice-misconduct-across-country)
- [ICE List Wiki](https://icelist.is/)
- [People Over Papers](https://laist.com/brief/news/a-site-tracking-ice-raids-is-overwhelmed-with-users-seeking-help-and-sharing-updates)

### Data Sources
- [TRAC Immigration](https://tracreports.org/immigration/)
- [Deportation Data Project](https://deportationdata.org/data.html)
- [ILRC State Map](https://www.ilrc.org/state-map-immigration-enforcement-2024)

### Action Resources
- [ILRC Know Your Rights](https://www.ilrc.org/community-resources/know-your-rights)
- [National Immigrant Justice Center](https://immigrantjustice.org/for-immigrants/know-your-rights/ice-encounter/)
- [ACLU Recording Rights](https://www.aclu.org/news/free-speech/photographer-retaliation-foia)

---

## 13. Next Steps

1. ~~**Create ADO Epic** for ICE Tracker feature~~ ✅ Created
2. ~~**Create Tech Spec** with database schema, API design~~ ✅ See `tech-spec.md`
3. **Phase 1 Stories:** Stats dashboard implementation
4. **Backfill Planning:** Identify priority incidents to seed database
