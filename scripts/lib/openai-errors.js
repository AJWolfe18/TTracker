/**
 * Shared OpenAI error classification for fatal auth/payment failures.
 * Used by rss-tracker, entity extraction, topic extraction, and backfill scripts.
 */

export function isFatalOpenAIError(error) {
  const status = error?.status;
  const type = error?.type || '';

  if (status === 401 || status === 402 || status === 403) return true;

  if (['authentication_error', 'permission_error', 'insufficient_quota',
       'organization_invalid'].includes(type)) return true;

  const msg = (error?.message || '').toLowerCase();
  if (msg.includes('exceeded your current quota') ||
      msg.includes('insufficient_quota')) return true;

  return false;
}
