// Barrel re-export — will be removed once all importers are updated to direct imports
// This file exists for backwards compatibility during the transition

// Stories prompts (enrich-stories-inline.js imports these directly from ./prompts/stories.js)
export { SYSTEM_PROMPT, ENHANCED_SYSTEM_PROMPT, buildUserPayload } from './prompts/stories.js';
