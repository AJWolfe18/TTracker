/**
 * Safe primitive coercion for RSS parser objects
 * 
 * RSS parsers (rss-parser, xml2js) convert XML attributes and namespaced fields
 * into nested objects like:
 * - <guid isPermaLink="true">...</guid> → { _: "...", $: { isPermaLink: "true" } }
 * - <category domain="...">Politics</category> → { _: "Politics", $: { domain: "..." } }
 * 
 * These helpers safely extract primitive values to prevent:
 * - "Cannot convert object to primitive value" errors during string interpolation
 * - "[object Object]" appearing in logs/database fields
 * 
 * Created: 2025-11-15
 * Related: TTRC-268, TTRC-272 (Guardian/NYT/PBS RSS feed failures)
 */

/**
 * Safely convert any value to a string primitive
 * @param {*} v - Value to convert (may be primitive, object, array, null)
 * @returns {string} - Primitive string (never an object)
 */
export const toStr = (v) =>
  v == null ? '' :
  typeof v === 'string' ? v :
  (typeof v === 'object' && typeof v._ === 'string') ? v._ :
  (typeof v === 'object' && typeof v['#'] === 'string') ? v['#'] :
  (typeof v?.$?.href === 'string') ? v.$.href :
  (typeof v?.$?.url === 'string') ? v.$.url :
  String(v);

/**
 * Safely convert any value to a boolean
 * Common RSS boolean patterns: "true", "false", "1", "0", "yes", "no"
 * @param {*} v - Value to convert (may be object with _ property)
 * @returns {boolean}
 */
export const toBool = (v) => {
  const s = toStr(v).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
};

/**
 * Safely convert array to array of string primitives
 * @param {*} xs - Value to convert (should be array, but handles non-arrays safely)
 * @returns {string[]} - Array of primitive strings
 */
export const toStrArray = (xs) => Array.isArray(xs) ? xs.map(toStr) : [];

/**
 * Safe JSON.stringify that handles BigInt and other non-serializable types
 * Use for debug logging when you need to dump entire objects
 * @param {*} obj - Object to serialize
 * @returns {string} - JSON string
 */
export const safeJson = (obj) =>
  JSON.stringify(obj, (k, v) => (typeof v === 'bigint' ? String(v) : v));
