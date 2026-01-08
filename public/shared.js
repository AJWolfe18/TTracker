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
    const SUPABASE_URL = window.SUPABASE_CONFIG?.SUPABASE_URL || 'https://osjbulmltfpcoldydexg.supabase.co';
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

  /**
   * Track analytics event (Google Analytics)
   * @param {string} eventName - Event name (e.g., 'search', 'view_story')
   * @param {Object} eventParams - Event parameters (optional)
   */
  function trackEvent(eventName, eventParams = {}) {
    if (typeof gtag === 'function') {
      gtag('event', eventName, eventParams);
    }
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
    trackEvent
  };

})(window);
