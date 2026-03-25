/**
 * SCOTUS Scout Prompt Builder
 *
 * Builds the Perplexity query for fact extraction.
 * Instructs Scout to return structured JSON with source tiers and confidence.
 */

import { sanitizeForPrompt } from '../enrichment/perplexity-client.js';

// Version tracks prompt changes for reproducibility
export const SCOUT_PROMPT_VERSION = 'scout-v1.1';

// System prompt for Perplexity
export const SCOUT_SYSTEM_PROMPT =
  'You are a SCOTUS case fact-extraction assistant. Return ONLY valid JSON. ' +
  'Do not include markdown formatting, code blocks, or explanatory text. ' +
  'Prefer official SCOTUS opinion text or SCOTUSblog case page language for disposition. ' +
  'Do not infer missing fields from likely patterns — return null with low confidence instead.';

/**
 * Build the Scout query for a SCOTUS case
 * @param {object} caseData - { case_name, case_name_short, docket_number, term, decided_at }
 * @returns {string} The prompt to send to Perplexity
 */
export function buildScoutPrompt(caseData) {
  const name = sanitizeForPrompt(caseData.case_name || caseData.case_name_short || 'Unknown', 300);
  const shortName = sanitizeForPrompt(caseData.case_name_short || '', 100);
  const docket = sanitizeForPrompt(caseData.docket_number || '', 50);
  const term = sanitizeForPrompt(caseData.term || '', 10);
  const decided = sanitizeForPrompt(caseData.decided_at ? caseData.decided_at.split('T')[0] : '', 20);

  return `Research this U.S. Supreme Court case and return structured JSON with factual details.

CASE: ${name}
${shortName ? `SHORT NAME: ${shortName}` : ''}
${docket ? `DOCKET: ${docket}` : ''}
${term ? `TERM: ${term}` : ''}
${decided ? `DECIDED: ${decided}` : ''}

IMPORTANT RULES:
1. "Disposition" means the FORMAL action SCOTUS took on the lower court judgment (affirmed, reversed, vacated, etc.). It does NOT mean who won or what the practical effect was.
2. "substantive_winner" means who actually BENEFITS from the ruling — this may differ from the formal disposition direction.
3. "vote_split" must be numeric only (e.g. "7-2", "9-0"). Never include "per curiam" or other text in this field.
4. For unsigned or per curiam opinions, set majority_author to null and opinion_type to "per_curiam" or "unsigned_per_curiam".
5. Do NOT guess or infer fields you are uncertain about. Return null and set confidence to "low".
6. Prefer sourcing from: (a) the official SCOTUS opinion / slip opinion, (b) SCOTUSblog case page, (c) Oyez. Use Wikipedia only as supplementary.
7. "dissent_authors" must include ALL justices who dissented or joined a dissenting opinion — not just the justice who wrote the dissent. For example, if Thomas filed a dissent joined by Alito and Gorsuch, list all three: ["Thomas", "Alito", "Gorsuch"]. Also include justices who concurred in part and dissented in part.
8. Do NOT confuse "concurring in the judgment" or "concurring in part" with dissenting. A justice who concurs agrees with the RESULT. A justice who dissents disagrees with the result. If 2 justices concurred in part and 2 dissented, only list the 2 who dissented.
9. In a split decision (e.g. 5-4, 6-3), the number of dissenters MUST match the minority count. If the vote is 5-4, there must be exactly 4 dissent_authors. If dissent_authors is empty but vote_split shows a minority, something is wrong — check your sources again.

Return JSON with EXACTLY these fields:
{
  "status": "ok | uncertain | failed",
  "formal_disposition": "affirmed | reversed | vacated | remanded | reversed_and_remanded | vacated_and_remanded | dismissed | GVR",
  "formal_disposition_detail": "Free text for mixed/complex dispositions, or null if straightforward",
  "opinion_type": "majority | plurality | per_curiam | unsigned_per_curiam | DIG",
  "vote_split": "N-N format (e.g. 7-2)",
  "majority_author": "Last name of opinion author, or null for per curiam/unsigned",
  "dissent_authors": ["Last1", "Last2"] or [] (list ALL justices who dissented or joined ANY dissenting opinion, not just the author),
  "substantive_winner": "Who actually benefits from this ruling (1-2 sentences)",
  "practical_effect": "What changes in the real world as a result (1 sentence)",
  "holding": "What the Court held (1-2 sentences)",
  "issue_area": "constitutional_rights | criminal_procedure | civil_rights | first_amendment | due_process | federal_regulation | taxation | immigration | environmental | labor | voting_rights | executive_power | judicial_power | property | other",
  "case_citation": "e.g. 603 U.S. ___ (2024) if known, or null",
  "fact_confidence": {
    "formal_disposition": "high | medium | low",
    "vote_split": "high | medium | low",
    "majority_author": "high | medium | low",
    "dissent_authors": "high | medium | low",
    "substantive_winner": "high | medium | low"
  },
  "source_tiers_used": [1, 2, 3],
  "source_urls": ["url1", "url2"]
}

SOURCE TIER DEFINITIONS (report which you used):
- Tier 1: Official SCOTUS opinion / slip opinion (supremecourt.gov)
- Tier 2: SCOTUSblog, Oyez
- Tier 3: Wikipedia, news articles, other

STATUS RULES:
- "ok": All required fields present, you are confident in the core facts
- "uncertain": You found the case but some key facts are unclear or conflicting
- "failed": You could not find reliable information about this case

DISPOSITION ENUM (use exactly one):
"affirmed" | "reversed" | "vacated" | "remanded" | "reversed_and_remanded" | "vacated_and_remanded" | "dismissed" | "GVR"

If the disposition is mixed (e.g. "affirmed in part, reversed in part"), pick the PRIMARY action for formal_disposition and put the full description in formal_disposition_detail.`;
}
