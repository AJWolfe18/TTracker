// Barrel re-export — will be removed once all importers are updated to direct imports
// This file exists for backwards compatibility during the transition

// Stories prompts (used by enrich-stories-inline.js, job-queue-worker.js)
export { SYSTEM_PROMPT, ENHANCED_SYSTEM_PROMPT, buildUserPayload } from './prompts/stories.js';

// Executive Orders prompts (used by enrich-executive-orders.js, test-eo-prompt.js)
export { EO_ENRICHMENT_PROMPT, buildEOPayload } from './prompts/executive-orders.js';

// Pardons prompts (used by enrich-pardons.js)
export { PARDONS_ENRICHMENT_PROMPT, buildPardonPayload } from './prompts/pardons.js';
