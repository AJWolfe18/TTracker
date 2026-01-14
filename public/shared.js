// TrumpyTracker Shared Utilities
// Shared helpers for app.js and eo-app.js

(function(global) {
  'use strict';

  // ===========================================
  // DEFENSIVE CONFIG CHECK
  // ===========================================
  // Fail-fast if config missing (prevents blank page debugging)
  if (!window.SUPABASE_CONFIG || !window.SUPABASE_CONFIG.SUPABASE_URL) {
    document.body.innerHTML = '<div style="padding:20px;color:red;font-family:monospace;background:#fff8f8;border:2px solid red;margin:20px;">' +
      '<h2>⚠️ Configuration Error</h2>' +
      '<p>SUPABASE_CONFIG is missing. Check that supabase-browser-config.js loads before shared.js.</p>' +
      '<p style="font-size:12px;color:#666;">Script load order must be: supabase-browser-config.js → shared.js → app.js</p></div>';
    throw new Error('SUPABASE_CONFIG not loaded - check script order in HTML');
  }

  // ===========================================
  // ARTICLE CACHING (with LRU eviction)
  // ===========================================
  const CACHE_MAX_SIZE = 50;
  const storyArticlesCache = new Map(); // Map preserves insertion order

  function getCachedArticles(storyId) {
    return storyArticlesCache.get(storyId);
  }

  function setCachedArticles(storyId, data) {
    // Evict oldest if at capacity
    if (storyArticlesCache.size >= CACHE_MAX_SIZE) {
      const oldest = storyArticlesCache.keys().next().value;
      storyArticlesCache.delete(oldest);
    }
    storyArticlesCache.set(storyId, data); // { articles, error, loading }
  }

  function clearArticlesCache() {
    storyArticlesCache.clear();
  }

  // ===========================================
  // URL / HISTORY HELPERS
  // ===========================================

  // Get URL param value
  function getUrlParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
  }

  // Set URL param (replaceState, doesn't add to history)
  function setUrlParam(name, value) {
    const params = new URLSearchParams(window.location.search);
    if (value === null || value === undefined || value === '') {
      params.delete(name);
    } else {
      params.set(name, value);
    }
    const newUrl = params.toString() ? `?${params.toString()}` : window.location.pathname;
    window.history.replaceState(window.history.state, '', newUrl);
  }

  // Push URL param (adds to history stack)
  function pushUrlParam(name, value, state = {}) {
    const params = new URLSearchParams(window.location.search);
    if (value === null || value === undefined || value === '') {
      params.delete(name);
    } else {
      params.set(name, value);
    }
    const newUrl = params.toString() ? `?${params.toString()}` : window.location.pathname;
    window.history.pushState(state, '', newUrl);
  }

  // Remove URL param (replaceState)
  function removeUrlParam(name) {
    const params = new URLSearchParams(window.location.search);
    params.delete(name);
    const newUrl = params.toString() ? `?${params.toString()}` : window.location.pathname;
    window.history.replaceState(window.history.state, '', newUrl);
  }

  // ===========================================
  // STORAGE HELPERS
  // ===========================================

  // localStorage (cross-session)
  function getLocalStorage(key, defaultValue = null) {
    try {
      const item = localStorage.getItem(key);
      return item !== null ? JSON.parse(item) : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  function setLocalStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore storage errors
    }
  }

  // sessionStorage (within session only)
  function getSessionStorage(key, defaultValue = null) {
    try {
      const item = sessionStorage.getItem(key);
      return item !== null ? JSON.parse(item) : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  function setSessionStorage(key, value) {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore storage errors
    }
  }

  // ===========================================
  // SCROLL LOCK (for modals)
  // ===========================================

  let scrollLockCount = 0;
  let savedScrollY = 0;

  function lockScroll() {
    if (scrollLockCount === 0) {
      savedScrollY = window.scrollY;
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = `-${savedScrollY}px`;
      document.body.style.width = '100%';
    }
    scrollLockCount++;
  }

  function unlockScroll() {
    scrollLockCount = Math.max(0, scrollLockCount - 1);
    if (scrollLockCount === 0) {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      window.scrollTo(0, savedScrollY);
    }
  }

  // ===========================================
  // PRIMARY SOURCE DETECTION
  // ===========================================

  function isPrimarySource(article, allArticles, junctionData) {
    // 1. If junction data has is_primary_source flag, use it
    if (junctionData) {
      const junction = junctionData.find(j =>
        j.article_id === article.id || j.articles?.id === article.id
      );
      if (junction?.is_primary_source === true) return true;
    }

    // 2. Otherwise: earliest published article wins
    if (!allArticles || allArticles.length === 0) return false;

    const validArticles = allArticles.filter(a => a.published_at);
    if (validArticles.length === 0) return false;

    const earliest = validArticles.reduce((a, b) =>
      new Date(a.published_at) < new Date(b.published_at) ? a : b
    );

    return article.id === earliest.id;
  }

  // ===========================================
  // DATA NORMALIZATION
  // ===========================================

  // Normalize severity to expected set
  function normalizeSeverity(severity) {
    if (!severity) return null;
    const lower = severity.toLowerCase();
    const map = {
      'critical': 'critical',
      'severe': 'severe',
      'moderate': 'moderate',
      'minor': 'minor',
      // Handle any alternate spellings
      'high': 'severe',
      'medium': 'moderate',
      'low': 'minor'
    };
    return map[lower] || null;
  }

  // Category display labels
  const CATEGORY_LABELS = {
    corruption_scandals: 'Corruption & Scandals',
    democracy_elections: 'Democracy & Elections',
    policy_legislation: 'Policy & Legislation',
    justice_legal: 'Justice & Legal',
    executive_actions: 'Executive Actions',
    foreign_policy: 'Foreign Policy',
    corporate_financial: 'Corporate & Financial',
    civil_liberties: 'Civil Liberties',
    media_disinformation: 'Media & Disinformation',
    epstein_associates: 'Epstein & Associates',
    other: 'Other'
  };

  function getCategoryLabel(category) {
    return CATEGORY_LABELS[category] || category || 'Uncategorized';
  }

  // Severity display labels (the spicy ones!)
  const SEVERITY_LABELS = {
    critical: 'Fucking Treason',
    severe: 'Criminal Bullshit',
    moderate: 'Swamp Shit',
    minor: 'Clown Show'
  };

  function getSeverityLabel(severity) {
    const normalized = normalizeSeverity(severity);
    return SEVERITY_LABELS[normalized] || '';
  }

  // ===========================================
  // DATE FORMATTING
  // ===========================================

  function timeAgo(isoDate) {
    if (!isoDate) return '';
    const ms = Date.now() - new Date(isoDate).getTime();
    if (!Number.isFinite(ms) || ms < 0) return '';
    const seconds = Math.max(1, Math.floor(ms / 1000));

    const intervals = [
      [31536000, 'y'],
      [2592000, 'mo'],
      [604800, 'w'],
      [86400, 'd'],
      [3600, 'h'],
      [60, 'm']
    ];

    for (const [sec, unit] of intervals) {
      if (seconds >= sec) {
        return `${Math.floor(seconds / sec)}${unit} ago`;
      }
    }
    return `${seconds}s ago`;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  function formatDateTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  // ===========================================
  // ACTOR NAME FORMATTING
  // ===========================================

  // Convert entity codes like "US-ERIC-ADAMS" to "Eric Adams"
  function formatActorName(actor) {
    if (!actor) return '';

    // Already clean name (no prefix pattern)
    if (!actor.includes('-') || actor.length < 4) {
      return actor;
    }

    // Known prefixes to strip
    const prefixes = ['US-', 'ORG-', 'INTL-', 'STATE-', 'GOV-'];
    let name = actor;

    for (const prefix of prefixes) {
      if (name.startsWith(prefix)) {
        name = name.slice(prefix.length);
        break;
      }
    }

    // Convert "ERIC-ADAMS" or "VAN-HOLLEN" to "Eric Adams" or "Van Hollen"
    return name
      .split('-')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
  }

  // ===========================================
  // SUPABASE REQUEST HELPER
  // ===========================================

  async function supabaseRequest(query) {
    const SUPABASE_URL = window.SUPABASE_CONFIG?.SUPABASE_URL || 'https://wnrjrywpcadwutfykflu.supabase.co';
    const SUPABASE_ANON_KEY = window.SUPABASE_CONFIG?.SUPABASE_ANON_KEY;

    const response = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Supabase error: ${response.status}`);
    }

    return response.json();
  }

  // ===========================================
  // ANALYTICS
  // ===========================================

  // PII-safe param allowlist - only these params are sent to GA4
  const ALLOWED_PARAMS = new Set([
    // outbound_click
    'target_type', 'source_domain', 'content_type', 'content_id',
    // detail_toggle
    'object_type', 'action', 'duration_ms', 'source',
    // content_interaction
    'type', 'page', 'from_tab', 'to_tab', 'location',
    // newsletter_signup
    'result', 'signup_source', 'signup_page', 'utm_source', 'utm_medium', 'utm_campaign',
    // search_action
    'has_results', 'result_count', 'term_len', 'term_hash',
    // error_logged
    'error_type', 'component',
    // merch tracking
    'method',
    // schema version
    'schema_v'
  ]);

  // Allowed transport types for beacon
  const ALLOWED_TRANSPORTS = new Set(['beacon', 'xhr', 'image']);

  /**
   * Track analytics event (Google Analytics) with PII protection
   * @param {string} eventName - Event name (e.g., 'outbound_click', 'detail_toggle')
   * @param {Object} eventParams - Event parameters
   * @param {Object} opts - Options (e.g., { transport_type: 'beacon' })
   */
  function trackEvent(eventName, eventParams = {}, opts = {}) {
    if (typeof gtag !== 'function') return;

    // Skip analytics on test environments
    const hostname = window.location.hostname;
    if (hostname.includes('test--') || hostname === 'localhost' || hostname === '127.0.0.1') {
      console.log('[Analytics:TEST]', eventName, eventParams);
      return;
    }

    // Build safe params with allowlist
    const safeParams = { schema_v: 1 };

    for (const [key, val] of Object.entries(eventParams)) {
      if (ALLOWED_PARAMS.has(key) && val !== undefined && val !== null) {
        safeParams[key] = val;
      } else if (!ALLOWED_PARAMS.has(key) && val !== undefined) {
        console.warn(`[Analytics] Blocked param: ${key}`);
      }
    }

    // Handle transport_type for beacon (special-cased)
    if (opts.transport_type && ALLOWED_TRANSPORTS.has(opts.transport_type)) {
      safeParams.transport_type = opts.transport_type;
    }

    gtag('event', eventName, safeParams);
  }

  /**
   * Track event only once per session (prevents noisy funnels)
   * @param {string} eventName - Event name
   * @param {Object} eventParams - Event parameters
   * @param {string} storageKey - Unique key for session storage (defaults to eventName)
   * @param {Object} opts - Options for trackEvent
   */
  function trackOncePerSession(eventName, eventParams = {}, storageKey = null, opts = {}) {
    const key = `tt_fired_${storageKey || eventName}`;
    if (sessionStorage.getItem(key)) return false; // Already fired

    trackEvent(eventName, eventParams, opts);
    sessionStorage.setItem(key, 'true');
    return true;
  }

  /**
   * Initialize scroll depth tracking for a page
   * Tracks 25%, 50%, 75%, 100% thresholds once per session
   * @param {string} pageName - Page identifier ('stories', 'eos', 'pardons')
   */
  function initScrollDepthTracking(pageName) {
    const thresholds = [25, 50, 75, 100];
    let timeout;

    const checkScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight <= 0) return;

      const scrollPercent = Math.round((scrollTop / docHeight) * 100);

      thresholds.forEach(threshold => {
        if (scrollPercent >= threshold) {
          trackOncePerSession('content_interaction', {
            type: `scroll_${threshold}`,
            page: pageName
          }, `scroll_${threshold}_${pageName}`);
        }
      });
    };

    // Debounce: prevents rapid-fire on mobile "flick" scrolls
    window.addEventListener('scroll', () => {
      clearTimeout(timeout);
      timeout = setTimeout(checkScroll, 150);
    }, { passive: true });

    // Check initial position
    checkScroll();
  }

  /**
   * Log an error event (sanitized, no PII)
   * @param {string} errorType - Error type enum: API_FAIL, TURNSTILE_TIMEOUT, JS_ERROR, EDGE_FUNCTION_ERROR
   * @param {string} component - Component name: newsletter, search, detail_modal, etc.
   */
  function logError(errorType, component) {
    const validTypes = new Set(['API_FAIL', 'TURNSTILE_TIMEOUT', 'JS_ERROR', 'EDGE_FUNCTION_ERROR']);
    if (!validTypes.has(errorType)) {
      console.warn(`[Analytics] Invalid error_type: ${errorType}`);
      return;
    }

    trackEvent('error_logged', {
      error_type: errorType,
      component: component || 'unknown'
    });
  }

  /**
   * Track outbound link click with beacon transport
   * @param {Object} params - Click parameters
   * @param {string} params.targetType - Type of link (article, source, external)
   * @param {string} params.sourceDomain - Domain being linked to
   * @param {string} params.contentType - Content type (story, eo, pardon)
   * @param {string} params.contentId - Content ID (optional)
   */
  function trackOutboundClick({ targetType, sourceDomain, contentType, contentId }) {
    trackEvent('outbound_click', {
      target_type: targetType || 'external',
      source_domain: sourceDomain,
      content_type: contentType,
      content_id: contentId
    }, { transport_type: 'beacon' });
  }

  // Detail modal open timestamps (for duration tracking)
  const modalOpenTimes = new Map();

  /**
   * Track detail modal open
   * @param {Object} params - Modal parameters
   * @param {string} params.objectType - Object type (story, eo, pardon)
   * @param {string} params.contentType - Content type
   * @param {string} params.contentId - Content ID
   * @param {string} params.source - How modal was opened (card_click, deep_link)
   */
  function trackDetailOpen({ objectType, contentType, contentId, source }) {
    const key = `${objectType}_${contentId}`;
    modalOpenTimes.set(key, Date.now());

    trackEvent('detail_toggle', {
      object_type: objectType,
      action: 'open',
      content_type: contentType,
      content_id: contentId,
      source: source || 'card_click'
    });
  }

  /**
   * Track detail modal close (includes duration)
   * @param {Object} params - Modal parameters
   * @param {string} params.objectType - Object type (story, eo, pardon)
   * @param {string} params.contentType - Content type
   * @param {string} params.contentId - Content ID
   */
  function trackDetailClose({ objectType, contentType, contentId }) {
    const key = `${objectType}_${contentId}`;
    const openTime = modalOpenTimes.get(key);
    const durationMs = openTime ? Date.now() - openTime : undefined;
    modalOpenTimes.delete(key);

    trackEvent('detail_toggle', {
      object_type: objectType,
      action: 'close',
      content_type: contentType,
      content_id: contentId,
      duration_ms: durationMs
    });
  }

  // ===========================================
  // NEWSLETTER SIGNUP
  // ===========================================

  // Turnstile site key (public)
  const TURNSTILE_SITE_KEY = '0x4AAAAAACMTyFRQ0ebtcHkK';

  /**
   * Submit newsletter signup
   * @param {Object} params - Signup parameters
   * @param {string} params.email - Email address
   * @param {string} params.turnstileToken - Turnstile verification token
   * @param {string} params.signupPage - Page name ('stories', 'eos', 'pardons')
   * @param {string} params.signupSource - Source ('footer', 'inline_50pct')
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async function submitNewsletterSignup({
    email,
    turnstileToken,
    signupPage = 'unknown',
    signupSource = 'footer'
  }) {
    const SUPABASE_URL = window.SUPABASE_CONFIG?.SUPABASE_URL;
    const SUPABASE_ANON_KEY = window.SUPABASE_CONFIG?.SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.error('[Newsletter] Missing Supabase config');
      return { success: false, message: 'Configuration error. Please try again.' };
    }

    // Get UTM params from URL
    const params = new URLSearchParams(window.location.search);
    const utmSource = params.get('utm_source');
    const utmMedium = params.get('utm_medium');
    const utmCampaign = params.get('utm_campaign');

    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/newsletter-signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
          email,
          turnstile_token: turnstileToken,
          honeypot: '', // Empty for real users
          signup_page: signupPage,
          signup_source: signupSource,
          utm_source: utmSource,
          utm_medium: utmMedium,
          utm_campaign: utmCampaign
        })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Set GA4 user property (skip on test environments)
        const hostname = window.location.hostname;
        const isTest = hostname.includes('test--') || hostname === 'localhost' || hostname === '127.0.0.1';
        if (typeof gtag === 'function' && !isTest) {
          gtag('set', 'user_properties', { newsletter_subscriber: true });
        }

        // Track signup event
        trackEvent('newsletter_signup', {
          result: 'success',
          signup_source: signupSource,
          signup_page: signupPage,
          utm_source: utmSource || undefined,
          utm_campaign: utmCampaign || undefined
        });

        // Remember signup in localStorage
        setLocalStorage('tt-newsletter-signed-up', true);

        return { success: true, message: data.message || 'Thanks! Check your email soon.' };
      } else {
        // Track failed signup
        trackEvent('newsletter_signup', {
          result: 'error',
          signup_source: signupSource,
          signup_page: signupPage
        });

        return { success: false, message: data.error || 'Something went wrong. Please try again.' };
      }
    } catch (error) {
      console.error('[Newsletter] Signup error:', error);
      trackEvent('newsletter_signup', {
        result: 'error',
        signup_source: signupSource,
        signup_page: signupPage
      });
      return { success: false, message: 'Network error. Please try again.' };
    }
  }

  /**
   * Check if user has already signed up
   * @returns {boolean}
   */
  function hasNewsletterSignup() {
    return getLocalStorage('tt-newsletter-signed-up', false);
  }

  /**
   * Check if inline CTA has been dismissed this session
   * @returns {boolean}
   */
  function isInlineCTADismissed() {
    return getSessionStorage('tt-newsletter-inline-dismissed', false);
  }

  /**
   * Dismiss inline CTA for this session
   */
  function dismissInlineCTA() {
    setSessionStorage('tt-newsletter-inline-dismissed', true);
  }

  // ===========================================
  // EXPORT TO GLOBAL
  // ===========================================

  global.TTShared = {
    // Caching
    getCachedArticles,
    setCachedArticles,
    clearArticlesCache,

    // URL/History
    getUrlParam,
    setUrlParam,
    pushUrlParam,
    removeUrlParam,

    // Storage
    getLocalStorage,
    setLocalStorage,
    getSessionStorage,
    setSessionStorage,

    // Scroll lock
    lockScroll,
    unlockScroll,

    // Data helpers
    isPrimarySource,
    normalizeSeverity,
    getCategoryLabel,
    getSeverityLabel,
    formatActorName,
    CATEGORY_LABELS,
    SEVERITY_LABELS,

    // Date formatting
    timeAgo,
    formatDate,
    formatDateTime,

    // API
    supabaseRequest,

    // Analytics
    trackEvent,
    trackOncePerSession,
    initScrollDepthTracking,
    logError,
    trackOutboundClick,
    trackDetailOpen,
    trackDetailClose,

    // Newsletter
    TURNSTILE_SITE_KEY,
    submitNewsletterSignup,
    hasNewsletterSignup,
    isInlineCTADismissed,
    dismissInlineCTA
  };

})(window);
