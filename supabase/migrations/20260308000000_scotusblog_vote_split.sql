-- ADO-438: Simplified pipeline — vote_split storage + invariant check columns
-- vote_split from SCOTUSblog case file pages (e.g., "6-3", "9-0")
-- vote_split_source tracks provenance: 'scotusblog', 'courtlistener', 'gpt_extraction', null
-- invariant_passed/invariant_failures replace the old QA validator stack

ALTER TABLE scotus_cases
  ADD COLUMN IF NOT EXISTS scotusblog_vote_split TEXT,
  ADD COLUMN IF NOT EXISTS vote_split_source TEXT,
  ADD COLUMN IF NOT EXISTS invariant_passed BOOLEAN,
  ADD COLUMN IF NOT EXISTS invariant_failures JSONB;

COMMENT ON COLUMN scotus_cases.scotusblog_vote_split IS 'Vote split from SCOTUSblog case file page (e.g., "6-3")';
COMMENT ON COLUMN scotus_cases.vote_split_source IS 'Provenance of vote_split: scotusblog, courtlistener, gpt_extraction, or null';
COMMENT ON COLUMN scotus_cases.invariant_passed IS 'ADO-438: Whether all 7 invariant checks passed';
COMMENT ON COLUMN scotus_cases.invariant_failures IS 'ADO-438: Array of {code, detail} for failed invariant checks';
