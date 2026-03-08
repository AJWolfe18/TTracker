# ADO-438: Simplified Pipeline — Session 1 Complete

**ADO-438** Session 1 done. Added bypass flags (default ON) for consensus merge, drift validation, QA validators, and Layer B LLM QA (~1,700 lines bypassed). Added 7 invariant checks (~60 lines) as replacement. Added SCOTUSblog vote_split DB storage + severity bounds Rule 7. Migration applied to TEST DB.

**Audit findings:** Layer A validators: 2/34 catch rate (1 false positive). Layer B: never ran. Consensus: 0 disagreements found. Drift: only fires on cert/procedural (already handled by cert skip).

**Rollback:** Set `SCOTUS_SKIP_CONSENSUS=false`, `SCOTUS_SKIP_DRIFT=false`, `SCOTUS_SKIP_QA_VALIDATORS=false`, `SCOTUS_SKIP_LAYER_B=false` to re-enable old code.

**Next:** Session 2 — Run v9 on 10 gold + 10 non-gold + 5 edge cases, compare vs v8, pull output for Josh review.
