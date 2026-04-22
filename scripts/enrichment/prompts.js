// Barrel re-export — will be removed once all importers are updated to direct imports
// This file exists for backwards compatibility during the transition

// Stories prompts (used by enrich-stories-inline.js, job-queue-worker.js)
export { SYSTEM_PROMPT, ENHANCED_SYSTEM_PROMPT, buildUserPayload } from './prompts/stories.js';
