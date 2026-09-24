# Handoff: ADO-590 scraper fix in PR #153, ADO-591 constraint verified on PROD (September 23, 2026, late)

All clock times are Central (CT). Session ran about 10:30 PM to 11:45 PM CT on September 23.
Previous handoff (same evening): `2026-09-23-pardons-reenrich-clemency-type-ado-588-closed.md`.

## Outcome in one line
ADO-590 is built and tested: the pardons scraper now types each row of a mixed DOJ section from its
warrant. It is on `test` and in PR #153 to main, waiting on Josh's local Codex review. ADO-591: PROD's
corruption_level rule is confirmed to allow 0-5 (AC 1 met); TEST turned out to still have the old
1-5 rule. Both cards stay Active. Nothing was written to PROD this session.

## 1. What Josh needs to do (in this order)

1. **TEST: apply migration 063.** When Josh left, the clipboard held `migrations/063_corruption_level_zero.sql`
   followed by the check query. It was never confirmed as run. If the clipboard has been overwritten,
   paste the file `migrations/063_corruption_level_zero.sql` and then the check query from item 2 below.
   Run it in the **TEST** SQL Editor and click **Run query** on the "Potential issue detected" dialog
   (the migration drops the old rule). The last result should be ONE row with `corruption_level >= 0`.
2. **PROD admin: review Suzula Bidon (id 147).** The agent scored her level 0 ("Actual Mercy"); PROD
   rejected 0 at the time, so she was saved as level 1 and held for review. If the write-up supports it,
   set her to 0 and publish. That save proves PROD accepts level 0 (ADO-591 AC 2) and is the review (AC 3).
3. **PR #153 (ADO-590): run Codex locally, then merge** (`gh pr merge 153 --squash`, merge commits are
   blocked). Paste any Codex findings into the next session and they get fixed without asking.
4. **Decide on the 17 mislabeled May 2025 pardons** (details in section 3). The recommendation is to run
   `scripts/maintenance/2026-09-23-ado-590-2025-mixed-section-types.sql` in the PROD SQL Editor.

## 2. Where the next session picks up
- If Josh reports step 1 done: nothing further for TEST (optionally re-run the check query to confirm).
- If step 2 is done: verify through the public site (anon REST, below) that Bidon is L0 if she was published,
  record AC 2 + AC 3 on ADO-591, move it to Closed. If she stays hidden, Josh's word is the evidence.
- If PR #153 merged: record the merge on ADO-590 and move it to Closed (all 4 AC were already recorded MET
  in a card comment). The next scheduled Track Pardons run on main uses the new code; nothing to deploy by hand.
- If Josh approves the 2025 fix: put the SQL file on the clipboard (Set-Clipboard), he runs it on PROD.
  Guard = exactly 17 rows or nothing changes. Then re-check with anon REST (15 of the 17 are public).
- Check the September re-enrichment queue (see section 4).

Read-only check query (both environments):
```sql
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.pardons'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%corruption_level%';
```
Note: Postgres prints `BETWEEN 0 AND 5` back as `(corruption_level >= 0) AND (corruption_level <= 5)`.

## 3. ADO-590: what was built
**Bug:** under "September 3, 2026 - 23 Pardons and 6 Commutations" the scraper took the type from the
heading and inserted all 29 rows as commutations.

**Fix** (`scripts/ingest/doj-pardons-scraper.js`): under a heading that names both types, each row is typed from:
1. the warrant link's `title` attribute on the DOJ page, e.g. `2026-09-03_Commutation_Warrant_Bloom` or
   `Pardon Warrant - Mark Bashaw_signed 5.28.25` (free, parsed with the page),
2. else the warrant PDF (fetched only for NEW rows, after the duplicate check): its Title metadata, then
   its download filename (Content-Disposition). If they disagree, the row is treated as untypeable,
3. else it is inserted as `pardon` and flagged: `recordSkip` with reason `clemency_type_unknown`
   (new in `scripts/lib/skip-reasons.js`), visible in admin → Skips tab.

A temporary warrant failure (network, timeout, HTTP 408/429/5xx) does NOT insert: the row is held for
the next run and an `api_error` skip is recorded. A dead link (other 4xx) or a non-PDF body is final and
takes the pardon + flag path, so a grant is never dropped forever.

**Evidence**
- Live dry run (`npm run ingest:pardons -- --dry-run`): 2026-09-03 = 23 pardon, 6 commutation;
  2025-05-28 = 16 + 6; 2025-05-29 = 1 + 2.
- All 54 live mixed-section warrants went through the PDF path: 54/54 agree with the link titles
  (51 typed by PDF Title, 3 by filename).
- `qa:pardons-parser` 18/18 (tests 10-17 new; `scripts/tests/doj-mixed-section-2026-09-03.fixture.html`
  is the verbatim September 3 table). `qa:smoke` exit 0 on test. The main-based deploy branch also
  passed 18/18 and gave the same dry-run split.
- Review: `/code-review medium` twice. Finding 1 (a failed download stored 'pardon' permanently) and
  finding 2 (404/non-PDF held a row forever) were both fixed. A suggestion to hide the 17 May 2025 rows
  in the data-fix SQL was NOT taken; the reason is written in the SQL file.

**Commits on test:** 2bb119c (fix), d56c403 (review fix), c5e3286 + 4bd42f5 (test-only 2025 SQL).
**PR #153** = 2bb119c + d56c403 cherry-picked onto main. Conflicts were resolved to main's side: the
test-only ADO-577 Discord alert (PR #151) and the ADO-572/582 skip reasons are NOT in it. After #151
merges, the scraper on main and test converge.

**Cost:** $0. At most one small PDF download per new row in a mixed section.

**Found while testing: 2025 data is wrong on PROD too.** The same bug hit May 28 and May 29, 2025. On PROD
all 22 May 28 rows and Hutchinson (May 29) are stored as commutations. Per the warrants, 17 are pardons:
Baisden, Bashaw, Julie Chrisley, Todd Chrisley, Gaulden, Grimm, Harris, James Kernan, Marlene Kernan,
Mansell, Moore, Rowland, Scott, Sittenfeld, Earl Smith, Tanner (May 28) and Hutchinson (May 29). The
real commutations are Duran, Hoover, Morgan, Garnett Smith, Valenzuela, Zuberi and the two Sotelos.
15 of the 17 are public. The SQL fix sets them to `pardon` and clears `enriched_at` so the agent
redoes their write-ups (5 per run). It leaves `is_public` alone, the same as the September fix.

## 4. ADO-591 status
- AC 1 MET (PROD): exactly one check, `pardons_corruption_level_check`, allowing 0 to 5. No old rule
  under another name, so no DROP was needed.
- TEST was still on the old 1-5 rule (step 1 of section 1).
- AC 2 and AC 3 wait on the Bidon review (step 2).

**September re-enrichment queue:** 11 of the 30 September rows were public at about 11:15 PM CT, the
same count as at 10:10 PM. Held rows can't be read from a dev session, so an empty queue can't be
confirmed from here. The daily 3 PM CT agent run keeps draining it; a manual run is
`RemoteTrigger run` on `trig_018LUznaUWwijFhMZLp8kYE2`.
Public check: anon REST `pardons?select=id,recipient_name,clemency_type,corruption_level&is_public=eq.true&pardon_date=gte.2026-09-01`
(the PROD anon key is in `src/lib/supabase.ts`).

## 5. Gotchas from this session
- The DOJ page's warrant links carry a `title` attribute with the warrant name and type (107 of 169 rows;
  every mixed-section row). It is the cheapest type signal; the PDF is only the fallback.
- Warrant PDFs are HP Scan + Acrobat. The Info dictionary is often inside a compressed object stream
  (`/Type/ObjStm`), so a raw text search for `/Title` finds nothing even when a Title exists. The 2025
  Title format is `2025-05-28 Pardon NAME`, without the word Warrant.
- Deploy-branch worktrees have no `node_modules`. To run a deploy branch's tests, `git show` the files
  into a scratch folder with a `mklink /J node_modules` junction to the repo's `node_modules`, then
  remove the junction with `cmd /c rmdir` (never `rm -rf`, which can follow it).
- Subagents: Josh allowed Opus agents this session, but `Agent`/`Task` are still denied in
  `.claude/settings.json`, so all work stayed inline. `/code-review` runs as a forked skill, which works.

## 6. Still open from earlier (unchanged)
PR #151 (ADO-577) awaiting Josh's Codex, TEST key rotation, ADO-587 discussion, Supabase DB-size quota
decision, EO 14426 Publish click.
