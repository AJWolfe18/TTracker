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
  // Attribute-only element, e.g. <guid isPermaLink="false"></guid> (Democracy
  // Docket, ADO-581): xml2js yields a null-prototype object with only `$`, and
  // String() on it THROWS "Cannot convert object to primitive value" rather than
  // returning "[object Object]". Any other object is not a value either.
  typeof v === 'object' ? '' :
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
 * The article text an RSS/Atom item carries: the longest of its text fields.
 * rss-parser puts full text in different places per feed format - RSS 2.0 in
 * content:encoded, Atom (Vox, The Atlantic) and Arc feeds (Votebeat) in `content`,
 * while `summary`/`description` are often a one-line teaser. Reading a fixed
 * order without `content` stored 64 of 21,824 chars for The Atlantic and nothing
 * for Votebeat (ADO-597, October 2, 2026). Longest wins, so a feed that sends a
 * teaser in one field and the body in another always yields the body.
 * @param {Object} item - Parsed rss-parser item
 * @returns {string}
 */
export const pickItemText = (item) =>
  [item?.['content:encoded'], item?.contentEncoded, item?.content, item?.description, item?.summary]
    .map(toStr)
    .reduce((best, s) => (s.length > best.length ? s : best), '');

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
