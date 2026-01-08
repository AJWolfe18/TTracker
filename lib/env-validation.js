// lib/env-validation.js
// Centralized environment validation - fail closed on misconfiguration
// TTRC-362: PROD Hardening

const PROD_REF = "osjbulmltfpcoldydexg";
const TEST_REF = "wnrjrywpcadwutfykflu";

function parseProjectRef(url) {
  const ref = (url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i) || [])[1];
  if (!ref) throw new Error(`Could not parse Supabase project ref from URL: ${url}`);
  return ref;
}

/**
 * Validates environment configuration. Throws on misconfiguration.
 * @param {Object} options
 * @param {boolean} options.requireServiceKey - Require SUPABASE_SERVICE_KEY
 * @param {boolean} options.requireAnonKey - Require SUPABASE_ANON_KEY
 * @returns {{ TARGET_ENV: string, SUPABASE_URL: string, ref: string }}
 */
export function validateEnv(options = {}) {
  const { requireServiceKey = false, requireAnonKey = false } = options;

  // Support both TARGET_ENV (new) and ENVIRONMENT (legacy workflows)
  const TARGET_ENV = process.env.TARGET_ENV || process.env.ENVIRONMENT;
  if (!TARGET_ENV) throw new Error("Missing TARGET_ENV or ENVIRONMENT (prod|test)");
  if (TARGET_ENV !== "prod" && TARGET_ENV !== "test") {
    throw new Error(`Invalid TARGET_ENV="${TARGET_ENV}" (must be "prod" or "test")`);
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");

  const ref = parseProjectRef(SUPABASE_URL);

  if (TARGET_ENV === "prod" && ref !== PROD_REF) {
    throw new Error(`TARGET_ENV=prod but project ref=${ref} (expected ${PROD_REF})`);
  }
  if (TARGET_ENV === "test" && ref !== TEST_REF) {
    throw new Error(`TARGET_ENV=test but project ref=${ref} (expected ${TEST_REF})`);
  }

  if (requireServiceKey && !process.env.SUPABASE_SERVICE_KEY) {
    throw new Error("Missing SUPABASE_SERVICE_KEY");
  }
  if (requireAnonKey && !process.env.SUPABASE_ANON_KEY) {
    throw new Error("Missing SUPABASE_ANON_KEY");
  }

  return { TARGET_ENV, SUPABASE_URL, ref };
}

export { PROD_REF, TEST_REF };
