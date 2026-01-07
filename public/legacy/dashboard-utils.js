/**
 * Dashboard Utilities Module
 * Provides utility functions for caching, data fetching, formatting, and error handling
 * Extracted from dashboard.js for better maintainability
 */

window.DashboardUtils = (function() {
  'use strict';

  // Configuration constants from original dashboard.js
  const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
  const CACHE_KEY_PREFIX = 'tt_cache_';
  const FORCE_REFRESH_HOUR = 12; // Force refresh at noon each day
  
  // Supabase configuration - Use values from supabase-browser-config.js
  const SUPABASE_URL = window.SUPABASE_URL || window.SUPABASE_CONFIG?.SUPABASE_URL || 'https://osjbulmltfpcoldydexg.supabase.co';
  const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || window.SUPABASE_CONFIG?.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zamJ1bG1sdGZwY29sZHlkZXhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ3NjQ5NzEsImV4cCI6MjA3MDM0MDk3MX0.COtWEcun0Xkw5hUhaVEJGCrWbumj42L4vwWGgH7RyIE';

  /**
   * Cache Management Functions
   */
  const getCachedData = (key) => {
    try {
      const cached = localStorage.getItem(CACHE_KEY_PREFIX + key);
      if (!cached) return null;
      
      const { data, timestamp } = JSON.parse(cached);
      const age = Date.now() - timestamp;
      
      // Check if cache is expired
      if (age > CACHE_DURATION) {
        localStorage.removeItem(CACHE_KEY_PREFIX + key);
        return null;
      }
      
      // Also expire if we've passed the daily refresh time
      const lastRefresh = new Date(timestamp);
      const now = new Date();
      if (now.getDate() !== lastRefresh.getDate() && now.getHours() >= FORCE_REFRESH_HOUR) {
        localStorage.removeItem(CACHE_KEY_PREFIX + key);
        return null;
      }
      
      console.log(`Using cached data for ${key} (age: ${Math.round(age/1000/60)} minutes)`);
      return data;
    } catch (error) {
      console.error('Cache read error:', error);
      return null;
    }
  };

  const setCachedData = (key, data) => {
    try {
      const cacheData = {
        data,
        timestamp: Date.now()
      };
      localStorage.setItem(CACHE_KEY_PREFIX + key, JSON.stringify(cacheData));
      console.log(`Cached data for ${key}`);
    } catch (error) {
      console.error('Cache write error:', error);
      // If localStorage is full, clear old cache entries
      if (error.name === 'QuotaExceededError') {
        clearOldCache();
      }
    }
  };

  const clearOldCache = () => {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith(CACHE_KEY_PREFIX)) {
        localStorage.removeItem(key);
      }
    });
  };

  const clearCache = () => {
    clearOldCache();
    window.location.reload();
  };

  /**
   * Supabase Request Helper with Caching and Retry Logic
   */
  const supabaseRequest = async (endpoint, method = 'GET', body = null, useCache = true, retries = 3) => {
    // Try cache first for GET requests
    if (method === 'GET' && useCache) {
      const cached = getCachedData(endpoint);
      if (cached) return cached;
    }
    
    const base = (SUPABASE_URL || '').replace(/\/+$/,'');
    const ep   = (endpoint || '').trim().replace(/^\/+/, '');
    const url  = `${base}/rest/v1/${ep}`;
    if (!ep) throw new Error('Supabase error: empty endpoint');
    const options = {
      method,
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      }
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    // Debug logging
    console.debug('[Supabase]', method, url);
    
    // Retry logic with exponential backoff
    let lastError;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await fetch(url, options);
        
        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Supabase error: ${response.status} - ${error}`);
        }

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const data = await response.json();
          
          // Cache successful GET requests
          if (method === 'GET' && useCache) {
            setCachedData(endpoint, data);
          }
          
          return data;
        }
        
        return { success: true };
      } catch (error) {
        lastError = error;
        console.warn(`Attempt ${attempt + 1} failed for ${endpoint}:`, error.message);
        
        // Don't retry on 4xx errors (client errors)
        if (error.message.includes('Supabase error: 4')) {
          throw error;
        }
        
        // Wait before retrying (exponential backoff)
        if (attempt < retries - 1) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  };

  /**
   * Category Formatting Functions - 11-Category System
   */
  const formatCategoryForDisplay = (category) => {
    if (!category) return 'Other';
    
    const displayMap = {
      'corruption_scandals': 'Corruption & Scandals',
      'democracy_elections': 'Democracy & Elections',
      'policy_legislation': 'Policy & Legislation',
      'justice_legal': 'Justice & Legal',
      'executive_actions': 'Executive Actions',
      'foreign_policy': 'Foreign Policy',
      'corporate_financial': 'Corporate & Financial',
      'civil_liberties': 'Civil Liberties',
      'media_disinformation': 'Media & Disinformation',
      'epstein_associates': 'Epstein & Associates',
      'other': 'Other'
    };
    
    return displayMap[category] || 'Other';
  };

  const getValidCategories = () => {
    return [
      'corruption_scandals',
      'democracy_elections',
      'policy_legislation',
      'justice_legal',
      'executive_actions',
      'foreign_policy',
      'corporate_financial',
      'civil_liberties',
      'media_disinformation',
      'epstein_associates',
      'other'
    ];
  };

  /**
   * Date Formatting Functions
   */
  const formatDate = (dateString) => {
    if (!dateString) return '';
    try {
      // Handle date-only strings (YYYY-MM-DD) to avoid timezone issues
      // When parsing "2025-10-15", JS treats it as UTC midnight,
      // which becomes previous day in CT (UTC-6)
      const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateString);
      
      let date;
      if (dateOnly) {
        // Parse as local date to avoid timezone conversion
        const [year, month, day] = dateString.split('-').map(Number);
        date = new Date(year, month - 1, day);
      } else {
        date = new Date(dateString);
      }
      
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return dateString;
    }
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return '';
    try {
      return new Date(dateString).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateString;
    }
  };

  // Public API
  return {
    // Cache functions
    getCachedData,
    setCachedData,
    clearOldCache,
    clearCache,
    
    // Supabase functions
    supabaseRequest,
    
    // Category functions
    formatCategoryForDisplay,
    getValidCategories,
    
    // Date functions
    formatDate,
    formatDateTime,
    
    // Configuration
    CACHE_DURATION,
    CACHE_KEY_PREFIX,
    FORCE_REFRESH_HOUR,
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  };
})();
