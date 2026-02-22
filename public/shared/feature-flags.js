/**
 * Feature Flags System
 *
 * Auto-detects environment and loads appropriate flags.
 * Supports URL overrides for testing: ?ff_scotus=true
 *
 * Usage:
 *   await FeatureFlags.init();
 *   if (FeatureFlags.isEnabled('scotus')) { ... }
 */

const FeatureFlags = (function() {
  let flags = {};
  let initialized = false;
  let environment = 'unknown';

  /**
   * Detect environment from hostname
   */
  function detectEnvironment() {
    const hostname = window.location.hostname;

    // PROD: trumpytracker.com or www.trumpytracker.com
    if (hostname === 'trumpytracker.com' || hostname === 'www.trumpytracker.com') {
      return 'prod';
    }

    // TEST: Netlify preview/branch deploys or localhost
    if (hostname.includes('netlify') ||
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname.includes('test')) {
      return 'test';
    }

    // Default to test for safety (features hidden by default in prod)
    console.warn('[FeatureFlags] Unknown hostname, defaulting to test:', hostname);
    return 'test';
  }

  /**
   * Parse URL overrides (?ff_flagname=true/false)
   */
  function getUrlOverrides() {
    const overrides = {};
    const params = new URLSearchParams(window.location.search);

    for (const [key, value] of params.entries()) {
      if (key.startsWith('ff_')) {
        const flagName = key.substring(3); // Remove 'ff_' prefix
        overrides[flagName] = value === 'true' || value === '1';
      }
    }

    return overrides;
  }

  /**
   * Load flags from JSON file
   */
  async function loadFlags(env) {
    const filename = env === 'prod' ? 'flags-prod.json' : 'flags-test.json';
    const basePath = window.location.pathname.includes('/scotus') ||
                     window.location.pathname.includes('/pardons') ||
                     window.location.pathname.includes('/executive-orders')
                     ? '../shared/' : 'shared/';

    try {
      const response = await fetch(`${basePath}${filename}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('[FeatureFlags] Failed to load flags, using defaults:', error);
      // Safe defaults - everything off
      return {
        scotus: false,
        pardons: false,
        executive_orders: false,
        tone_v2: false
      };
    }
  }

  return {
    /**
     * Initialize the feature flag system
     * Call this once on page load
     */
    async init() {
      if (initialized) {
        return;
      }

      environment = detectEnvironment();
      flags = await loadFlags(environment);

      // Apply URL overrides
      const overrides = getUrlOverrides();
      for (const [key, value] of Object.entries(overrides)) {
        if (key in flags || key !== '_comment' && key !== '_updated') {
          console.log(`[FeatureFlags] URL override: ${key} = ${value}`);
          flags[key] = value;
        }
      }

      initialized = true;
      console.log(`[FeatureFlags] Initialized (${environment}):`,
        Object.fromEntries(Object.entries(flags).filter(([k]) => !k.startsWith('_')))
      );
    },

    /**
     * Check if a feature is enabled
     * @param {string} flagName - The flag to check
     * @returns {boolean} - True if enabled
     */
    isEnabled(flagName) {
      if (!initialized) {
        console.warn('[FeatureFlags] Not initialized, call init() first');
        return false;
      }
      return flags[flagName] === true;
    },

    /**
     * Get current environment
     * @returns {string} - 'prod' or 'test'
     */
    getEnvironment() {
      return environment;
    },

    /**
     * Get all flags (for debugging)
     * @returns {object} - All flag values
     */
    getAll() {
      return { ...flags };
    }
  };
})();

// Auto-init if loaded as module
if (typeof window !== 'undefined') {
  window.FeatureFlags = FeatureFlags;
}
