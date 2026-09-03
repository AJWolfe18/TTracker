/**
 * Discord webhook helper (send-only, no bot token).
 *
 * One place for every pipeline that pings Josh's Discord channel: social
 * drafts (ADO-572), new-work alerts from the fetchers (ADO-577). The channel
 * is the same DISCORD_WEBHOOK_URL secret the workflows and the Clustering
 * Judge already use.
 *
 * Contract: NEVER throws and NEVER blocks the caller's exit code. A missing
 * webhook URL is a silent no-op (local runs, TEST twins without the secret),
 * a failed POST logs one line and returns false.
 *
 *   import { postDiscord } from './lib/discord.js';
 *   await postDiscord({ title: 'SCOTUS fetch: 2 new cases', description: '...', color: COLORS.info });
 */

export const COLORS = Object.freeze({
  info:    3447003,   // blue   - new work landed
  warning: 16098851,  // amber  - needs a human (needs_manual_review, drafts waiting)
  error:   15158332,  // red    - failures (same red the workflow failure alerts use)
});

const MAX_DESCRIPTION = 4000; // Discord embed description cap is 4096

/**
 * @param {object} embed
 * @param {string} embed.title
 * @param {string} [embed.description]
 * @param {number} [embed.color]
 * @param {Array<{name:string,value:string,inline?:boolean}>} [embed.fields]
 * @param {object} [opts]
 * @param {string} [opts.webhookUrl]  defaults to process.env.DISCORD_WEBHOOK_URL
 * @param {typeof fetch} [opts.fetchImpl] injectable for tests
 * @returns {Promise<boolean>} true when Discord accepted the message
 */
export async function postDiscord(embed, { webhookUrl = process.env.DISCORD_WEBHOOK_URL, fetchImpl = globalThis.fetch } = {}) {
  if (!webhookUrl) return false;
  if (!embed || !embed.title) return false;
  const payload = {
    embeds: [{
      title: String(embed.title).slice(0, 256),
      description: embed.description ? String(embed.description).slice(0, MAX_DESCRIPTION) : undefined,
      color: embed.color ?? COLORS.info,
      fields: Array.isArray(embed.fields) ? embed.fields.slice(0, 25) : undefined,
      timestamp: new Date().toISOString(),
    }],
  };
  try {
    const res = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.warn(`[discord] webhook returned ${res.status} (non-blocking)`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[discord] webhook failed: ${err.message} (non-blocking)`);
    return false;
  }
}

/**
 * "a, b, c and 2 more" - keeps alert bodies short when a fetch lands a batch.
 */
export function summarizeList(items, max = 5) {
  const list = (items || []).filter(Boolean).map(String);
  if (list.length <= max) return list.join(', ');
  return `${list.slice(0, max).join(', ')} and ${list.length - max} more`;
}
