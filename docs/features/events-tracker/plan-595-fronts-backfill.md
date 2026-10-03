# ADO-595: new fronts and the 2-year backfill

October 2, 2026. Card: ADO-595 (epic 543). Related: ADO-592 (all-fronts agent), ADO-547 (admin fronts UI), ADO-548 (front pages).

Josh asked for fronts on Hegseth's Pentagon, Kushner's deals, Israel (elections and AIPAC, pushing the US toward Iran, Gaza) and RFK Jr., with the important stories going back about 2 years and a way to add things by hand later.

## 0. Open decisions (Josh)

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| D1 | Approve the backfill approach in section 3 and split it into two cards (B1 importer, B2 manual add folded into ADO-547) | Yes | B1, B2 |
| D2 | Tiers for the three new or widened fronts. All are major at alarm 4 today. Promote any to flagship (alarm 5)? | Israel & Gaza to flagship once the backfill lands (Gaza deaths, the Iran war push); the other two stay major | Nothing (one-line UPDATE) |
| D3 | Where backfilled stories on the Iran war, the Maduro raid and the National Guard deployments go. They appear in the Hegseth and Israel seeds. | Iran war stays on Iran (the sweep already does this). Maduro raid and Guard deployments become loose ends unless Hegseth or the Pentagon is the actor in the headline (the sweep already does this too). No change needed, just confirm. | B1 import list |
| D4 | The Hegseth seed has three rows on the Pentagon's dispute with Anthropic (February to March 2026). Anthropic makes Claude, so Claude has a conflict of interest here. Keep, reword or drop them? | Josh decides; Claude does not have a view on this one | B1 import list |
| D5 | Kennedy Center takeover as its own front? About 30 TEST stories (renaming, board purge, artists leaving), all loose ends today and kept out of RFK on purpose. | Yes, as a later card | Nothing |
| D6 | PROD apply: `2026-10-02-ado-595-new-fronts.sql` FIRST, then `2026-10-01-ado-592-hegseth-pentagon-front.sql`. Each file is a read-only pre-check, ONE apply block (BEGIN to COMMIT: write, sweep and refresh in one transaction; nothing is saved if any step fails), then a read-only result. If the apply block errors, run `ROLLBACK;` on its own before anything else; the failed transaction otherwise blocks every later command on that connection. Order matters: Hegseth's one-time sweep can only lose to fronts that already exist, so run first it would take stories Israel or RFK should win. | Claude loads each block in the SQL Editor, Josh presses Run | PROD fronts |

Decided October 2, 2026 (Josh): Hegseth's Pentagon goes flagship, title kept, boat strikes stay inside. Kushner's front becomes "The Envoys' Deals" (Kushner + Witkoff). The Israel front covers elections and AIPAC, pushing the US toward Iran, and Gaza.

## 1. What this card shipped

| Front | Slug | Tier / alarm | Sweep priority | TEST stories | TEST main line |
|---|---|---|---|---|---|
| Hegseth's Pentagon | hegseth-pentagon | flagship / 5 | 90 | 62 | 5 |
| The Envoys' Deals (was Kushner's Deals) | kushners-deals | major / 4 | 20 | 1 | 1 |
| Israel & Gaza (new) | israel-gaza | major / 4 | 75 | 37 | 5 |
| RFK Jr.'s HHS (new) | rfk-hhs | major / 4 | 85 | 21 | 4 |

- Sweeps, co-words and agent patterns, with the reasoning, are in the header of `scripts/maintenance/2026-10-02-ado-595-new-fronts.sql`. That file is the PROD paste.
- An Iran headline goes to Israel (priority 75 beats Iran's 80) only when Israel or Netanyahu is pushing the US in it:
  - "Netanyahu urges Trump to strike Iran" and "Trump pressured by Netanyahu" land on Israel.
  - "US and Israel strike Iran" and "Iran pushes back after Israeli strikes" stay on Iran.
  - A story can belong to only one front, so this is the only way to cover "pulling us into Iran" without emptying the Iran front.
- Envoys sweeps Kushner, Witkoff or Affinity only next to a specific money phrase, and never crypto (that stays on Trump Crypto).
  - Money phrases that count: money, investors, fundraising, private equity, a Saudi/Qatari/Emirati/Abu Dhabi/Gulf/foreign/sovereign fund or money, financial empire or financial ties, business deals, conflict of interest, ethics, probe, hotel, resort, disclosure, windfall, PIF, Electronic Arts.
  - A bare "deal", "billion", "million", "invest", "conflict", a country name or "Gulf" does NOT count. So diplomacy ("Witkoff says Iran deal is close", "Kushner unveils $112 billion Gaza reconstruction plan") waits for the ADO-592 agent's judgment.
  - The authoritative list is the `k_coword` constant in the SQL file.
- RFK sweeps RFK, Robert F. Kennedy, Secretary Kennedy, MAHA, ACIP, CDC, HHS, Tylenol and so on. It excludes the Kennedy Center, the other Kennedys (a bare "Kennedy" is left for the agent, because of Sen. John Kennedy), JFK, RFK Stadium and former health secretaries.
- Reviews:
  - Two medium code-review rounds found 7 over-broad rules; all were fixed.
  - Cowork's review found two problems in the PROD files, now fixed:
    - The apply was five separate pastes, which could leave a front public but half-built. It is now one transaction.
    - The priority check was advisory only. Each file now refuses to run on a clash.
  - Cowork also found the Hegseth-first order problem.
  - Tested in `scripts/tests/fronts-sql-pglite.test.mjs` (44 headlines, idempotency, all-or-nothing, priority guards, rollback; 21 checks), plus TEST.
- TEST is thin for these fronts because its RSS window is short. On PROD the same sweeps will file far more (PROD has about 15,000 stories). Either way, nothing before our RSS start date exists in the database. That is what section 3 fixes.
- Cost: $0 (regex SQL, no AI calls).

## 2. Research done (October 2, 2026)

Four parallel research passes:
- **Seed timelines:** `seeds/2026-10-02-hegseth-rfk.md` (54 + 49 entries) and `seeds/2026-10-02-envoys-israel.md` (48 + 60 entries). Each row has a date, a neutral headline, a suggested alarm and 1 or 2 source URLs. Unverified dates and weak sources are tagged in the files. Each front also has a search-term list and a false-positive list; the sweeps above use them.
- **What the code can do today:** below.
- **Where historical news can come from:** below.

**What exists today (code check):**
- The only "manual add" (`supabase/functions/articles-manual`) is dead code. It writes to the retired `political_entries` table, stamps today's date and never clusters. The admin "Submit article" button is disabled. `CLAUDE.md` still points people at it (fix with B2).
- The real ingest path, the `upsert_article_and_enqueue_jobs` RPC (migration 032), takes a caller-supplied publish date. A story created from an old article keeps that date (`first_seen_at = article.published_at`), and the Tracker sorts and dates by `first_seen_at`. **A 2025 story lands on its 2025 date, not today's.**
- Blockers for old articles:
  - `get_unclustered_articles` only returns articles from the last 30 days (migration 042), so old articles are never clustered.
  - The RSS fetcher drops items older than 96 hours.
  - No clustering path has a time bound, so a 2025 article can attach to a live 2026 story. There are three attach paths in `scripts/rss/hybrid-clustering.js`:
    - the same-run exact-title dedupe (TTRC-323, `seenTitlesThisRun`, about line 750), which runs before any candidate check;
    - the DB candidate entity and similarity blocks (`candidate-generation.js`);
    - the same-run batch-cache fallback (TTRC-336, `batchStoriesThisRun`, about line 1511).
  - Attaching an article sets the story's `last_updated_at` to now, which bumps it to the top of /news.
  - `attachToStory` (about lines 1744 and 1784) treats any attach to a `stale` story as a reopen. It sets `lifecycle_state = 'growing'` and increments `reopen_count`, and the gained article re-queues the story for enrichment (migration 117).
- No admin UI exists to create a front or to file or move a story (ADO-547, still New). Today both are done in SQL.
- The Stories agent enriches any unenriched story regardless of age (about 480 a day of capacity) and needs the stored excerpt. Embeddings and entity extraction use OpenAI (about $1 per 1,500 articles).

**Where historical news can come from:**

| Source | Verdict |
|---|---|
| Wikipedia citations (MediaWiki API) | **Best seed source.** The Hegseth article alone has 162 dated citations with url, date and title. $0. We take facts (URL, date, title), never prose. |
| Claude agent with web search | **Fills the gaps** Wikipedia covers poorly (HHS sequence, FARA influencer contracts). $0 cash. Every URL needs an HTTP and date check: agents can garble links. |
| GDELT DOC 2.0 | Works back to 2017, title and URL only, but throttles hard (blocked after about 3 calls). Optional gap-checker only. |
| Google News RSS search | Works for date windows but returns Google redirect links that break dedupe; against its terms. Skip. |
| Guardian / NYT APIs | Their terms ban AI use. Skip. (Guardian's plain topic RSS feeds are fine for the ongoing catch.) |
| Paid news APIs | None with 20 months of depth for under $50. Skip. |

## 3. Recommended backfill (needs D1)

Three layers:

1. **Seed list (done for these 4 fronts):** a dated milestone list per front, in `seeds/`. Josh skims it once. For future fronts, the same step is a Node script over Wikipedia citations plus one agent pass.
2. **B1 - Importer (new card):** a script that takes the seed rows' URLs, checks each one, fetches an excerpt (5,000 characters max, compliance rule), and inserts it through `upsert_article_and_enqueue_jobs` with the real publish date. Then it embeds, extracts and clusters each article directly (bypassing the 30-day filter).
   - **Hard requirements (from the Cowork review, October 2, 2026; each needs its own unit test):**
     - **URL safety (SSRF).** B1 runs as a script, but B2 runs the same fetch server-side, so one shared fetcher enforces all of this:
       - `https` (or `http`) only.
       - Host on an approved news-domain allowlist, built from the seeds' outlets and editable in one place.
       - DNS resolved and every address rejected if it is private, loopback, link-local, unique-local, multicast or cloud metadata (169.254.169.254, IPv4 and IPv6).
       - Redirects followed by hand (at most 3), with each hop re-checked against the rules above.
       - Connect and total timeouts (about 10 seconds).
       - A response-size cap (stop reading at about 2 MB).
       - Content type `text/html` or `application/xhtml+xml` only.
       - No cookies or credentials sent.
       - A plain "HTTP and date check" is not enough.
     - **Historical-date guard on every attach path, in backfill mode.** An article may attach only to a story whose own dates are within about 7 days of the article's `published_at`; otherwise it creates a new story. The guard covers all three paths: the exact-title dedupe (TTRC-323), the candidate entity and similarity blocks, and the batch-cache fallback (TTRC-336). Otherwise identical or similar headlines from different years merge.
     - **No reopen from an old article.** In backfill mode, `attachToStory` must:
       - leave `lifecycle_state` alone and not increment `reopen_count`;
       - set `last_updated_at` to `GREATEST(last_updated_at, article.published_at)`, never now();
       - not re-queue a live story for enrichment. The date guard already keeps old articles off live stories; this is the second line of defence.
     - **Test-first:** a fixture with a 2025 article whose title exactly matches a 2026 story must create a new 2025 story, not attach.
   - The Stories agent then enriches the new stories (alarm, summaries) on its normal schedule.
   - The sweep files them with `assign-fronts.js --all`. Each front's opening moves back to its true 2025 start, which is the point; check the main line after.
   - Scale: about 200 milestones x 2 to 3 articles = 400 to 600 articles across the 4 fronts.
   - Cost: about $0.50 of OpenAI, plus about 1 to 2 days of Stories-agent capacity (Claude plan, $0 cash).
3. **B2 - Manual add (fold into ADO-547):** an admin "Add article" form (URL, publish date, optional front) that calls the same importer path as B1, plus "file / move story to front".
   - It uses the B1 fetcher with all its URL-safety rules; an admin-only form is still server-side fetching of a typed URL.
   - Adding a domain to the allowlist is an explicit admin action, never automatic. This replaces the dead `articles-manual` endpoint. It is how Josh adds anything the seeds missed, old or new.
4. **Ongoing catch:**
   - The regular RSS feeds plus these sweeps keep catching new stories.
   - ADO-592 brings the agent to every front (its patterns for these fronts are already set).
   - Optional: Guardian topic RSS feeds (for example `/us-news/pete-hegseth/rss`) as extra feeds, each with a `feed_compliance_rules` row.

**Risks:**
- Paywalled sources (WaPo, WSJ, NYT) return teasers, so the importer should prefer AP, Reuters, NPR, PBS and ProPublica copies.
- Agent-found URLs must pass the URL-safety rules, an allowlist check and a date check against the page's own published time.
- Old articles merging into, or reopening, live stories (fixed by the B1 date guard on all three attach paths, plus the no-reopen rule).
- Every backfilled story still passes the normal enrichment gate before it shows publicly.
