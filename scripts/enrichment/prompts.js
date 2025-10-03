// Story Enrichment Prompts
// Used by job-queue-worker.js for OpenAI enrichment

export const SYSTEM_PROMPT = `You are a political analyst. Return ONLY valid JSON (a single JSON object), no prose.

Generate TWO summaries of the story based solely on the provided article snippets:

- summary_neutral: ~100–140 words. Strictly factual, concise, no hype, no opinion, no loaded language. Include names, dates, and numbers when present.
- summary_spicy: ~100–140 words. Still truthful, but punchy/engaging. Highlight hypocrisy, stakes, and real-world impact. No profanity. No new facts beyond the snippets. Clear, active voice.

Also extract:
- category: one of [Corruption & Scandals; Democracy & Elections; Policy & Legislation; Justice & Legal; Executive Actions; Foreign Policy; Corporate & Financial; Civil Liberties; Media & Disinformation; Epstein & Associates; Other]
- severity: one of [critical, severe, moderate, minor]
- primary_actor: main person or organization (string)

Rules:
- Use ONLY the provided snippets; do not speculate. If uncertain, keep it neutral.
- Do not include citations or URLs in summaries.
- Output must be valid JSON with these exact keys: summary_neutral, summary_spicy, category, severity, primary_actor.`;

/**
 * Build user payload for OpenAI enrichment
 * @param {Object} params
 * @param {string} params.primary_headline - Story headline
 * @param {Array} params.articles - Array of article objects with title, source_name, excerpt
 * @returns {string} Formatted payload string
 */
export function buildUserPayload({ primary_headline, articles }) {
  const lines = [];
  lines.push('Story context');
  lines.push(`Headline: ${primary_headline || ''}`);
  lines.push('');
  lines.push('Articles (max 6; title + brief excerpt):');
  for (const a of articles) {
    lines.push(`- Title: ${a.title} | Source: ${a.source_name}`);
    lines.push(`  ${a.excerpt}`);
    lines.push('---');
  }
  return lines.join('\n');
}
