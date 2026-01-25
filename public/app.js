// TrumpyTracker Theme Preview - Standalone React Components
// Dual theme system with Light (Newspaper) and Dark (Professional) modes

(function() {
  'use strict';

  const { useState, useEffect, useMemo, useRef, useCallback } = React;

  // ===========================================
  // CONFIGURATION
  // ===========================================

  const SUPABASE_URL = window.SUPABASE_CONFIG?.SUPABASE_URL || 'https://wnrjrywpcadwutfykflu.supabase.co';
  const SUPABASE_ANON_KEY = window.SUPABASE_CONFIG?.SUPABASE_ANON_KEY;

  const ITEMS_PER_PAGE = 12; // 4 rows x 3 columns on desktop

  // Category configuration
  const CATEGORIES = {
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

  // ADO-270: Alarm level labels - populated from tone-system.json
  // Fallback values in case fetch fails
  let ALARM_LABELS = {
    5: { spicy: 'Constitutional Dumpster Fire', neutral: 'Constitutional Crisis' },
    4: { spicy: 'Criminal Bullshit', neutral: 'Criminal Activity' },
    3: { spicy: 'The Deep Swamp', neutral: 'Institutional Corruption' },
    2: { spicy: 'The Great Gaslight', neutral: 'Misleading/Spin' },
    1: { spicy: 'Accidental Sanity', neutral: 'Mixed Outcome' },
    0: { spicy: 'A Broken Clock Moment', neutral: 'Positive Outcome' }
  };

  let ALARM_COLORS = {
    5: { bg: '#fee2e2', text: '#7f1d1d', border: '#dc2626' },
    4: { bg: '#fed7aa', text: '#7c2d12', border: '#ea580c' },
    3: { bg: '#fef3c7', text: '#713f12', border: '#f59e0b' },
    2: { bg: '#dbeafe', text: '#1e3a8a', border: '#3b82f6' },
    1: { bg: '#cffafe', text: '#155e75', border: '#06b6d4' },
    0: { bg: '#d1fae5', text: '#064e3b', border: '#10b981' }
  };

  // Legacy severity → alarm_level mapping (for backward compatibility)
  const LEGACY_SEVERITY_MAP = { critical: 5, severe: 4, moderate: 3, minor: 2 };

  // Load tone system from shared JSON (single source of truth)
  fetch('/shared/tone-system.json')
    .then(res => res.json())
    .then(toneSystem => {
      const storiesLabels = toneSystem.labels?.stories || {};
      const colors = toneSystem.colors || {};

      // Update ALARM_LABELS from JSON
      for (let level = 0; level <= 5; level++) {
        const levelStr = String(level);
        if (storiesLabels[levelStr]) {
          ALARM_LABELS[level] = {
            spicy: storiesLabels[levelStr].spicy || ALARM_LABELS[level].spicy,
            neutral: storiesLabels[levelStr].neutral || ALARM_LABELS[level].neutral
          };
        }
        if (colors[levelStr]) {
          ALARM_COLORS[level] = {
            bg: colors[levelStr].bg || ALARM_COLORS[level].bg,
            text: colors[levelStr].text || ALARM_COLORS[level].text,
            border: colors[levelStr].border || ALARM_COLORS[level].border
          };
        }
      }
      console.log('[Stories] Loaded labels from tone-system.json');
    })
    .catch(err => {
      console.warn('[Stories] Failed to load tone-system.json, using fallback labels:', err.message);
    });

  // Helper: Get alarm level from story (alarm_level field or mapped from legacy severity)
  function getAlarmLevel(story) {
    if (story?.alarm_level != null) return story.alarm_level;
    if (story?.severity) return LEGACY_SEVERITY_MAP[story.severity.toLowerCase()] ?? 3;
    return null;
  }

  // Helper: Get display label for alarm level (spicy mode)
  function getAlarmLabel(level) {
    if (level == null) return '';
    return ALARM_LABELS[level]?.spicy || '';
  }

  // Helper: Map alarm level to CSS data attribute (for styling)
  // Uses legacy severity names for CSS compatibility
  function getAlarmLevelCssClass(level) {
    if (level === 5) return 'critical';
    if (level === 4) return 'severe';
    if (level === 3) return 'moderate';
    if (level === 2) return 'minor';
    if (level === 1) return 'low';
    if (level === 0) return 'positive';
    return 'moderate';
  }

  // ===========================================
  // UTILITIES
  // ===========================================

  // Relative time formatter
  function timeAgo(isoDate) {
    if (!isoDate) return '—';
    const ms = Date.now() - new Date(isoDate).getTime();
    if (!Number.isFinite(ms) || ms < 0) return '—';
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

  // Format date nicely
  function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  // Supabase request helper
  async function supabaseRequest(query) {
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

  // Analytics tracking helper (from shared.js)
  const trackEvent = window.TTShared?.trackEvent || (() => {});

  // ===========================================
  // THEME CONTEXT
  // ===========================================

  function useTheme() {
    const [theme, setThemeState] = useState(() => {
      const saved = localStorage.getItem('tt-theme');
      return saved || 'light';
    });

    const setTheme = useCallback((newTheme) => {
      setThemeState(newTheme);
      localStorage.setItem('tt-theme', newTheme);
      document.documentElement.setAttribute('data-theme', newTheme);
    }, []);

    const toggleTheme = useCallback(() => {
      const newTheme = theme === 'dark' ? 'light' : 'dark';
      setTheme(newTheme);
      trackEvent('theme_toggle', { theme: newTheme });
    }, [theme, setTheme]);

    // Sync with document on mount
    useEffect(() => {
      document.documentElement.setAttribute('data-theme', theme);
    }, []);

    return { theme, setTheme, toggleTheme };
  }

  // ===========================================
  // HEADER COMPONENT
  // ===========================================

  function Header({ theme, toggleTheme }) {
    const merchButtonRef = useRef(null);

    // IntersectionObserver for merch impression tracking
    useEffect(() => {
      const button = merchButtonRef.current;
      if (!button || !window.TTShared?.trackMerchImpression) return;

      // Feature detection for older browsers
      if (!('IntersectionObserver' in window)) {
        // Fallback: just track impression immediately
        try { window.TTShared.trackMerchImpression('nav'); } catch (e) {}
        return;
      }

      const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          window.TTShared.trackMerchImpression('nav');
          observer.disconnect(); // Only fire once
        }
      }, { threshold: 0.5 });

      observer.observe(button);
      return () => observer.disconnect();
    }, []);

    return React.createElement('header', { className: 'tt-header' },
      React.createElement('div', { className: 'tt-header-inner' },
        // Logo
        React.createElement('a', { href: '#', className: 'tt-logo' },
          React.createElement('img', {
            src: './trumpytracker-logo.jpeg',
            alt: 'TrumpyTracker',
            className: 'tt-logo-icon',
            onError: (e) => { e.target.style.display = 'none'; }
          }),
          React.createElement('div', null,
            React.createElement('div', { className: 'tt-logo-text' }, 'TrumpyTracker'),
            React.createElement('div', { className: 'tt-tagline' }, 'Tracking the Corruption. Every Damn Day.')
          )
        ),

        // Header actions (merch + theme toggle)
        React.createElement('div', { className: 'tt-header-actions' },
          // Merch Coming Soon button
          React.createElement('button', {
            ref: merchButtonRef,
            className: 'tt-merch-btn',
            onClick: () => {
              if (window.TTShared?.trackMerchInterest) {
                window.TTShared.trackMerchInterest('nav');
              }
              // Ghost button - no action yet, just tracking
              alert('Merch coming soon! Sign up for our newsletter to be notified.');
            },
            'aria-label': 'Merch coming soon'
          }, 'Merch Coming Soon'),

          // Theme toggle
          React.createElement('button', {
            className: 'tt-theme-toggle',
            onClick: toggleTheme,
            'aria-label': `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`
          },
            theme === 'dark' ? '☀️ Light' : '🌙 Dark'
          )
        )
      )
    );
  }

  // ===========================================
  // SEARCH & FILTERS COMPONENT
  // ===========================================

  // Sort options
  const SORT_OPTIONS = {
    recent_update: 'Most recent update',
    newest: 'Newest created'
  };

  // Alarm level filter options (0-5 scale + all)
  // Using numeric keys for filtering, labels come from ALARM_LABELS
  const ALARM_FILTERS = ['all', 5, 4, 3, 2, 1, 0];

  function FiltersSection({
    searchTerm,
    onSearchChange,
    selectedCategory,
    onCategoryChange,
    selectedSeverity,
    onSeverityChange,
    selectedSort,
    onSortChange,
    categories,
    filteredCount,
    totalCount,
    onClearAll
  }) {
    // Check if any filter is active
    const hasActiveFilters = selectedCategory !== 'all' || selectedSeverity !== 'all' || searchTerm.trim() !== '';

    return React.createElement('div', { className: 'tt-filters' },
      // Top row: Search + Category dropdown + Sort dropdown
      React.createElement('div', { className: 'tt-filters-row' },
        // Search
        React.createElement('div', { className: 'tt-search-wrapper' },
          React.createElement('span', { className: 'tt-search-icon' }, '🔍'),
          React.createElement('input', {
            type: 'text',
            className: 'tt-search',
            placeholder: 'Search stories...',
            value: searchTerm,
            onChange: (e) => onSearchChange(e.target.value)
          })
        ),

        // Category dropdown (native select)
        React.createElement('select', {
          className: 'tt-dropdown',
          value: selectedCategory,
          onChange: (e) => onCategoryChange(e.target.value),
          'aria-label': 'Filter by category'
        },
          React.createElement('option', { value: 'all' }, 'All Categories'),
          ...categories.map(cat =>
            React.createElement('option', { key: cat, value: cat }, CATEGORIES[cat] || cat)
          )
        ),

        // Sort dropdown (native select)
        React.createElement('select', {
          className: 'tt-dropdown tt-dropdown-sort',
          value: selectedSort,
          onChange: (e) => onSortChange(e.target.value),
          'aria-label': 'Sort by'
        },
          Object.entries(SORT_OPTIONS).map(([value, label]) =>
            React.createElement('option', { key: value, value }, label)
          )
        )
      ),

      // Alarm level pills row (ADO-270)
      React.createElement('div', { className: 'tt-severity-filters' },
        React.createElement('span', { className: 'tt-filter-label' }, 'Alarm:'),
        ALARM_FILTERS.map(level =>
          React.createElement('button', {
            key: level,
            className: `tt-severity-pill ${selectedSeverity === level ? 'active' : ''}`,
            onClick: () => onSeverityChange(level)
          }, level === 'all' ? 'All' : getAlarmLabel(level) || `Level ${level}`)
        )
      ),

      // Results count + Active filters row
      React.createElement('div', { className: 'tt-filters-status' },
        // Results count
        React.createElement('span', { className: 'tt-results-count' },
          `${filteredCount} ${filteredCount === 1 ? 'story' : 'stories'}`,
          filteredCount !== totalCount && ` (of ${totalCount})`
        ),

        // Active filter chips
        hasActiveFilters && React.createElement('div', { className: 'tt-active-filters' },
          // Category chip
          selectedCategory !== 'all' && React.createElement('span', { className: 'tt-filter-chip' },
            `Category: ${CATEGORIES[selectedCategory] || selectedCategory}`,
            React.createElement('button', {
              className: 'tt-chip-remove',
              onClick: () => onCategoryChange('all'),
              'aria-label': 'Remove category filter'
            }, '×')
          ),

          // Alarm level chip (ADO-270)
          selectedSeverity !== 'all' && React.createElement('span', { className: 'tt-filter-chip' },
            `Alarm: ${getAlarmLabel(selectedSeverity) || `Level ${selectedSeverity}`}`,
            React.createElement('button', {
              className: 'tt-chip-remove',
              onClick: () => onSeverityChange('all'),
              'aria-label': 'Remove alarm filter'
            }, '×')
          ),

          // Search chip
          searchTerm.trim() && React.createElement('span', { className: 'tt-filter-chip' },
            `Search: "${searchTerm.trim().substring(0, 20)}${searchTerm.trim().length > 20 ? '...' : ''}"`,
            React.createElement('button', {
              className: 'tt-chip-remove',
              onClick: () => onSearchChange(''),
              'aria-label': 'Clear search'
            }, '×')
          ),

          // Clear all button
          React.createElement('button', {
            className: 'tt-clear-all',
            onClick: onClearAll
          }, 'Clear all')
        )
      )
    );
  }

  // ===========================================
  // STORY CARD COMPONENT
  // ===========================================

  function StoryCard({ story, onViewSources, onViewDetails }) {
    const [expanded, setExpanded] = useState(false);

    // Get display values (ADO-270: use alarm_level with legacy fallback)
    const categoryLabel = CATEGORIES[story.category] || 'Uncategorized';
    const alarmLevel = getAlarmLevel(story);
    const alarmLabel = getAlarmLabel(alarmLevel);
    const alarmCssClass = getAlarmLevelCssClass(alarmLevel);
    const summary = story.summary_spicy || story.summary_neutral || story.primary_headline || '';
    const hasLongSummary = summary.length > 200;

    return React.createElement('article', { className: 'tt-card' },
      // Header: Category + Timestamp
      React.createElement('div', { className: 'tt-card-header' },
        React.createElement('span', {
          className: 'tt-category',
          'data-cat': story.category
        }, categoryLabel),
        React.createElement('span', { className: 'tt-timestamp' },
          timeAgo(story.last_updated_at)
        )
      ),

      // Headline
      React.createElement('h2', { className: 'tt-headline' }, story.primary_headline),

      // Actor + Alarm Level (ADO-270)
      React.createElement('div', { className: 'tt-actor-row' },
        story.primary_actor && React.createElement('span', { className: 'tt-actor' },
          React.createElement('span', { className: 'tt-actor-icon' }, '👤'),
          'Main actor: ',
          window.TTShared?.formatActorName(story.primary_actor) || story.primary_actor
        ),
        alarmLabel && React.createElement('span', {
          className: 'tt-severity',
          'data-severity': alarmCssClass
        }, alarmLabel)
      ),

      // Summary
      React.createElement('div', { className: 'tt-summary' },
        React.createElement('p', {
          className: `tt-summary-text ${!expanded && hasLongSummary ? 'clamped' : ''}`
        }, summary),
        hasLongSummary && React.createElement('button', {
          className: 'tt-expand-btn',
          onClick: () => setExpanded(!expanded),
          'aria-expanded': expanded
        }, expanded ? 'Show less ' : 'Expand summary ',
          React.createElement('span', { className: 'tt-chevron' }, expanded ? '▲' : '▼'))
      ),

      // Footer
      React.createElement('div', { className: 'tt-card-footer' },
        React.createElement('button', {
          className: 'tt-sources-btn',
          onClick: () => onViewSources(story)
        },
          React.createElement('span', null, '📰'),
          `${story.source_count || 0} sources`
        ),
        React.createElement('button', {
          className: 'tt-read-more',
          onClick: () => onViewDetails(story)
        },
          'View details ',
          React.createElement('span', { className: 'tt-arrow-icon' }, '↗')
        )
      )
    );
  }

  // ===========================================
  // SOURCES MODAL COMPONENT
  // ===========================================

  function SourcesModal({ story, articles, onClose, loading, error }) {
    // Group articles by source
    const groupedSources = useMemo(() => {
      if (!articles || articles.length === 0) return [];
      const groups = {};
      articles.forEach(article => {
        const name = article.source_name || 'Unknown';
        if (!groups[name]) groups[name] = [];
        groups[name].push(article);
      });
      return Object.entries(groups);
    }, [articles]);

    // Close on escape key
    useEffect(() => {
      const handleEsc = (e) => {
        if (e.key === 'Escape') onClose();
      };
      document.addEventListener('keydown', handleEsc);
      return () => document.removeEventListener('keydown', handleEsc);
    }, [onClose]);

    return React.createElement('div', {
      className: 'tt-modal-overlay',
      onClick: (e) => e.target === e.currentTarget && onClose()
    },
      React.createElement('div', { className: 'tt-modal', role: 'dialog', 'aria-modal': 'true' },
        // Header
        React.createElement('div', { className: 'tt-modal-header' },
          React.createElement('h3', { className: 'tt-modal-title' }, 'Sources'),
          React.createElement('button', {
            className: 'tt-modal-close',
            onClick: onClose,
            'aria-label': 'Close modal'
          }, '×')
        ),

        // Body
        React.createElement('div', { className: 'tt-modal-body' },
          // Loading
          loading && React.createElement('div', { className: 'tt-loading' },
            React.createElement('div', { className: 'tt-spinner' }),
            React.createElement('p', null, 'Loading sources...')
          ),

          // Error
          error && React.createElement('div', { style: { color: 'var(--severity-critical-bg)', padding: '16px' } },
            React.createElement('p', null, error),
            React.createElement('button', {
              onClick: () => window.location.reload(),
              style: { marginTop: '12px', padding: '8px 16px', cursor: 'pointer' }
            }, 'Retry')
          ),

          // Empty state
          !loading && !error && groupedSources.length === 0 && React.createElement('div', { className: 'tt-empty' },
            React.createElement('p', null, 'No sources available for this story.')
          ),

          // Sources list
          !loading && !error && groupedSources.length > 0 && groupedSources.map(([sourceName, sourceArticles]) =>
            React.createElement('div', { key: sourceName, className: 'tt-source-group' },
              React.createElement('div', { className: 'tt-source-name' },
                `${sourceName} (${sourceArticles.length})`
              ),
              sourceArticles.map((article, idx) =>
                React.createElement('a', {
                  key: idx,
                  href: article.url,
                  target: '_blank',
                  rel: 'noopener noreferrer',
                  className: 'tt-source-link',
                  onClick: () => {
                    if (window.TTShared?.trackOutboundClick) {
                      try {
                        const domain = new URL(article.url).hostname;
                        window.TTShared.trackOutboundClick({
                          targetType: 'article',
                          sourceDomain: domain,
                          contentType: 'story',
                          contentId: String(story?.id)
                        });
                      } catch (e) { /* ignore URL parse errors */ }
                    }
                  }
                }, article.title || 'Untitled')
              )
            )
          )
        )
      )
    );
  }

  // ===========================================
  // STORY DETAIL MODAL COMPONENT
  // ===========================================

  function StoryDetailModal({ story, articles, junctionData, onClose, loading, error, onRetry }) {
    const modalHeadlineId = `story-detail-headline-${story?.id || 'unknown'}`;

    // Close on escape key
    useEffect(() => {
      const handleEsc = (e) => {
        if (e.key === 'Escape') onClose();
      };
      document.addEventListener('keydown', handleEsc);
      return () => document.removeEventListener('keydown', handleEsc);
    }, [onClose]);

    // Get display values (ADO-270: use alarm_level with legacy fallback)
    const categoryLabel = CATEGORIES[story?.category] || 'Uncategorized';
    const alarmLevel = getAlarmLevel(story);
    const alarmLabel = getAlarmLabel(alarmLevel);
    const alarmCssClass = getAlarmLevelCssClass(alarmLevel);
    const summary = story?.summary_spicy || story?.summary_neutral || '';

    // Check if article is primary source
    const isPrimarySource = (article) => {
      if (!junctionData || junctionData.length === 0) return false;
      const junction = junctionData.find(j =>
        j.article_id === article.id || j.articles?.id === article.id
      );
      if (junction?.is_primary_source === true) return true;

      // Fallback: earliest published
      if (!articles || articles.length === 0) return false;
      const validArticles = articles.filter(a => a.published_at);
      if (validArticles.length === 0) return false;
      const earliest = validArticles.reduce((a, b) =>
        new Date(a.published_at) < new Date(b.published_at) ? a : b
      );
      return article.id === earliest.id;
    };

    return React.createElement('div', {
      className: 'tt-modal-overlay tt-detail-modal-overlay',
      onClick: (e) => e.target === e.currentTarget && onClose()
    },
      React.createElement('div', {
        className: 'tt-modal tt-detail-modal',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': modalHeadlineId
      },
        // Header
        React.createElement('div', { className: 'tt-detail-modal-header' },
          React.createElement('button', {
            className: 'tt-modal-close',
            onClick: onClose,
            'aria-label': 'Close modal'
          }, '×')
        ),

        // Body
        React.createElement('div', { className: 'tt-detail-modal-body' },
          // Loading state
          loading && React.createElement('div', { className: 'tt-loading' },
            React.createElement('div', { className: 'tt-spinner' }),
            React.createElement('p', null, 'Loading story details...')
          ),

          // Error state
          error && !loading && React.createElement('div', { className: 'tt-detail-error' },
            React.createElement('p', null, error),
            React.createElement('button', {
              className: 'tt-retry-btn',
              onClick: onRetry
            }, 'Retry')
          ),

          // Content (show even while loading for immediate feedback)
          !error && story && React.createElement(React.Fragment, null,
            // Category + Timestamp row
            React.createElement('div', { className: 'tt-detail-meta' },
              React.createElement('span', {
                className: 'tt-category',
                'data-cat': story.category
              }, categoryLabel),
              React.createElement('span', { className: 'tt-detail-timestamp' },
                'Updated ',
                timeAgo(story.last_updated_at)
              )
            ),

            // Headline
            React.createElement('h2', {
              id: modalHeadlineId,
              className: 'tt-detail-headline'
            }, story.primary_headline),

            // Actor + Alarm Level row (ADO-270)
            React.createElement('div', { className: 'tt-detail-actor-row' },
              story.primary_actor && React.createElement('span', { className: 'tt-actor' },
                React.createElement('span', { className: 'tt-actor-icon' }, '👤'),
                'Main actor: ',
                window.TTShared?.formatActorName(story.primary_actor) || story.primary_actor
              ),
              alarmLabel && React.createElement('span', {
                className: 'tt-severity',
                'data-severity': alarmCssClass
              }, alarmLabel)
            ),

            // Full summary
            summary && React.createElement('div', { className: 'tt-detail-summary' },
              React.createElement('p', null, summary)
            ),

            // Sources section
            React.createElement('div', { className: 'tt-detail-sources' },
              React.createElement('h3', { className: 'tt-detail-sources-title' },
                `Sources (${articles?.length || 0})`
              ),

              // Loading skeleton for sources
              loading && React.createElement('div', { className: 'tt-sources-skeleton' },
                [1, 2, 3].map(i =>
                  React.createElement('div', { key: i, className: 'tt-skeleton-row' })
                )
              ),

              // Empty state
              !loading && (!articles || articles.length === 0) && React.createElement('p', { className: 'tt-empty-sources' },
                'No source links available for this story yet.'
              ),

              // Source list
              !loading && articles && articles.length > 0 && React.createElement('ul', { className: 'tt-source-list' },
                articles.map((article, idx) =>
                  React.createElement('li', { key: article.id || idx, className: 'tt-source-item' },
                    // Primary badge
                    isPrimarySource(article) && React.createElement('span', { className: 'tt-primary-badge' }, 'Primary'),

                    // Source name + time
                    React.createElement('span', { className: 'tt-source-meta' },
                      React.createElement('span', { className: 'tt-source-outlet' }, article.source_name || 'Unknown'),
                      article.published_at && React.createElement('span', { className: 'tt-source-time' },
                        ' · ',
                        timeAgo(article.published_at)
                      )
                    ),

                    // Title link
                    React.createElement('a', {
                      href: article.url,
                      target: '_blank',
                      rel: 'noopener noreferrer',
                      className: 'tt-source-title',
                      onClick: () => {
                        if (window.TTShared?.trackOutboundClick) {
                          try {
                            const domain = new URL(article.url).hostname;
                            window.TTShared.trackOutboundClick({
                              targetType: 'article',
                              sourceDomain: domain,
                              contentType: 'story',
                              contentId: String(story?.id)
                            });
                          } catch (e) { /* ignore URL parse errors */ }
                        }
                      }
                    },
                      article.title || 'Untitled',
                      React.createElement('span', { className: 'tt-external-icon' }, ' ↗')
                    )
                  )
                )
              )
            )
          )
        )
      )
    );
  }

  // ===========================================
  // SCOTUS CONFIGURATION (ADO-83)
  // ===========================================

  // Ruling impact scale labels (0-5)
  const SCOTUS_IMPACT_LABELS = {
    5: 'Constitutional Crisis',
    4: 'Rubber-stamping Tyranny',
    3: 'Institutional Sabotage',
    2: 'Judicial Sidestepping',
    1: 'Crumbs from the Bench',
    0: 'Democracy Wins'
  };

  // Reverse lookup: label → level (ensures consistent colors regardless of DB data)
  const SCOTUS_LABEL_TO_LEVEL = {
    'Constitutional Crisis': 5,
    'Rubber-stamping Tyranny': 4,
    'Institutional Sabotage': 3,
    'Judicial Sidestepping': 2,
    'Crumbs from the Bench': 1,
    'Democracy Wins': 0
  };

  // Title case helper for DB fields like "affirmed" → "Affirmed"
  function titleCase(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  // ===========================================
  // SCOTUS CARD COMPONENT
  // ===========================================

  function ScotusCard({ scotusCase, onViewDetails }) {
    // Get display values - use full case_name, not short version
    const displayName = scotusCase.case_name || scotusCase.case_name_short || 'Unknown Case';
    // Get label first, then derive level from label for consistent coloring
    const impactLabel = scotusCase.ruling_label || SCOTUS_IMPACT_LABELS[scotusCase.ruling_impact_level] || '';
    // Use label→level lookup to ensure same label = same color (fixes DB inconsistency)
    const impactLevel = SCOTUS_LABEL_TO_LEVEL[impactLabel] ?? scotusCase.ruling_impact_level ?? 3;
    // Show summary_spicy on card (like Stories), with who_wins as fallback
    const summary = scotusCase.summary_spicy || scotusCase.who_wins || '';
    const hasLongSummary = summary.length > 180;
    // Disposition for prominent header badge
    const disposition = scotusCase.disposition || '';
    const dispositionDisplay = titleCase(disposition) || '';

    return React.createElement('article', { className: 'tt-card' },
      // Header: Date on right (disposition removed from card, stays in modal)
      React.createElement('div', { className: 'tt-card-header' },
        React.createElement('span', { className: 'tt-timestamp tt-timestamp-right' },
          formatDate(scotusCase.decided_at)
        )
      ),

      // Case name (headline)
      React.createElement('h2', { className: 'tt-headline' }, displayName),

      // Meta row: Author + Impact Badge (like Stories' Actor + Alarm)
      React.createElement('div', { className: 'tt-scotus-meta-row' },
        scotusCase.majority_author && React.createElement('span', { className: 'tt-scotus-author' },
          scotusCase.majority_author
        ),
        impactLabel && React.createElement('span', {
          className: 'tt-scotus-impact',
          'data-impact': impactLevel
        }, impactLabel)
      ),

      // Summary preview (like Stories tab)
      summary && React.createElement('div', { className: 'tt-summary' },
        React.createElement('p', { className: 'tt-summary-text' },
          hasLongSummary ? summary.substring(0, 180) + '...' : summary
        )
      ),

      // Footer: Term (muted) + View Details
      React.createElement('div', { className: 'tt-card-footer' },
        scotusCase.term && React.createElement('span', { className: 'tt-scotus-term-muted' },
          `Term ${scotusCase.term}`
        ),
        React.createElement('button', {
          className: 'tt-read-more',
          onClick: () => onViewDetails(scotusCase)
        }, 'View details')
      )
    );
  }

  // ===========================================
  // SCOTUS DETAIL MODAL COMPONENT
  // ===========================================

  function ScotusDetailModal({ scotusCase, onClose }) {
    const modalHeadlineId = `scotus-detail-headline-${scotusCase?.id || 'unknown'}`;

    // Close on escape key
    useEffect(() => {
      const handleEsc = (e) => {
        if (e.key === 'Escape') onClose();
      };
      document.addEventListener('keydown', handleEsc);
      return () => document.removeEventListener('keydown', handleEsc);
    }, [onClose]);

    // Lock scroll when modal opens
    useEffect(() => {
      if (window.TTShared) window.TTShared.lockScroll();
      return () => {
        if (window.TTShared) window.TTShared.unlockScroll();
      };
    }, []);

    // Get display values - derive level from label for consistent coloring
    const impactLabel = scotusCase?.ruling_label || SCOTUS_IMPACT_LABELS[scotusCase?.ruling_impact_level] || '';
    const impactLevel = SCOTUS_LABEL_TO_LEVEL[impactLabel] ?? scotusCase?.ruling_impact_level ?? 3;

    // Parse dissent authors
    const dissentAuthors = Array.isArray(scotusCase?.dissent_authors)
      ? scotusCase.dissent_authors.join(', ')
      : scotusCase?.dissent_authors || '';

    // Check for "null" string in dissent highlights
    const dissentHighlights = scotusCase?.dissent_highlights && scotusCase.dissent_highlights !== 'null'
      ? scotusCase.dissent_highlights
      : null;

    return React.createElement('div', {
      className: 'tt-modal-overlay tt-detail-modal-overlay',
      onClick: (e) => e.target === e.currentTarget && onClose()
    },
      React.createElement('div', {
        className: 'tt-modal tt-detail-modal tt-scotus-modal',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': modalHeadlineId
      },
        // Header
        React.createElement('div', { className: 'tt-detail-modal-header' },
          React.createElement('button', {
            className: 'tt-modal-close',
            onClick: onClose,
            'aria-label': 'Close modal'
          }, '×')
        ),

        // Body
        React.createElement('div', { className: 'tt-detail-modal-body' },
          // Impact badge + Term
          React.createElement('div', { className: 'tt-scotus-detail-header' },
            impactLabel && React.createElement('span', {
              className: 'tt-scotus-impact tt-scotus-impact-large',
              'data-impact': impactLevel
            }, impactLabel),
            scotusCase.term && React.createElement('span', { className: 'tt-scotus-term' },
              `Term ${scotusCase.term}`
            )
          ),

          // Case name
          React.createElement('h2', {
            id: modalHeadlineId,
            className: 'tt-detail-headline'
          }, scotusCase.case_name),

          // Meta grid
          React.createElement('div', { className: 'tt-scotus-meta-grid' },
            // Citation
            scotusCase.citation && React.createElement('div', { className: 'tt-scotus-meta-item' },
              React.createElement('span', { className: 'tt-scotus-meta-label' }, 'Citation'),
              React.createElement('span', { className: 'tt-scotus-meta-value' }, scotusCase.citation)
            ),
            // Docket
            scotusCase.docket_number && React.createElement('div', { className: 'tt-scotus-meta-item' },
              React.createElement('span', { className: 'tt-scotus-meta-label' }, 'Docket'),
              React.createElement('span', { className: 'tt-scotus-meta-value' }, scotusCase.docket_number)
            ),
            // Decided
            scotusCase.decided_at && React.createElement('div', { className: 'tt-scotus-meta-item' },
              React.createElement('span', { className: 'tt-scotus-meta-label' }, 'Decided'),
              React.createElement('span', { className: 'tt-scotus-meta-value' }, formatDate(scotusCase.decided_at))
            ),
            // Argued
            scotusCase.argued_at && React.createElement('div', { className: 'tt-scotus-meta-item' },
              React.createElement('span', { className: 'tt-scotus-meta-label' }, 'Argued'),
              React.createElement('span', { className: 'tt-scotus-meta-value' }, formatDate(scotusCase.argued_at))
            ),
            // Disposition
            scotusCase.disposition && React.createElement('div', { className: 'tt-scotus-meta-item' },
              React.createElement('span', { className: 'tt-scotus-meta-label' }, 'Disposition'),
              React.createElement('span', { className: 'tt-scotus-meta-value' }, titleCase(scotusCase.disposition))
            ),
            // Case Type
            scotusCase.case_type && React.createElement('div', { className: 'tt-scotus-meta-item' },
              React.createElement('span', { className: 'tt-scotus-meta-label' }, 'Case Type'),
              React.createElement('span', { className: 'tt-scotus-meta-value' }, titleCase(scotusCase.case_type))
            )
          ),

          // Majority Author
          React.createElement('div', { className: 'tt-scotus-meta-grid' },
            scotusCase.majority_author && React.createElement('div', { className: 'tt-scotus-meta-item' },
              React.createElement('span', { className: 'tt-scotus-meta-label' }, 'Majority Opinion'),
              React.createElement('span', { className: 'tt-scotus-meta-value' }, scotusCase.majority_author)
            ),
            dissentAuthors && React.createElement('div', { className: 'tt-scotus-meta-item' },
              React.createElement('span', { className: 'tt-scotus-meta-label' }, 'Dissenting'),
              React.createElement('span', { className: 'tt-scotus-meta-value' }, dissentAuthors)
            ),
            scotusCase.vote_split && React.createElement('div', { className: 'tt-scotus-meta-item' },
              React.createElement('span', { className: 'tt-scotus-meta-label' }, 'Vote'),
              React.createElement('span', { className: 'tt-scotus-meta-value' }, scotusCase.vote_split)
            )
          ),

          // Who Wins
          scotusCase.who_wins && React.createElement('div', { className: 'tt-scotus-section' },
            React.createElement('h3', { className: 'tt-scotus-section-title' }, '👍 Who Wins'),
            React.createElement('p', { className: 'tt-scotus-section-content' }, scotusCase.who_wins)
          ),

          // Who Loses
          scotusCase.who_loses && React.createElement('div', { className: 'tt-scotus-section' },
            React.createElement('h3', { className: 'tt-scotus-section-title' }, '👎 Who Loses'),
            React.createElement('p', { className: 'tt-scotus-section-content' }, scotusCase.who_loses)
          ),

          // Summary (spicy)
          scotusCase.summary_spicy && React.createElement('div', { className: 'tt-scotus-section' },
            React.createElement('h3', { className: 'tt-scotus-section-title' }, '📜 Summary'),
            React.createElement('p', { className: 'tt-scotus-section-content' }, scotusCase.summary_spicy)
          ),

          // Why It Matters
          scotusCase.why_it_matters && React.createElement('div', { className: 'tt-scotus-section' },
            React.createElement('h3', { className: 'tt-scotus-section-title' }, '⚡ Why It Matters'),
            React.createElement('p', { className: 'tt-scotus-section-content' }, scotusCase.why_it_matters)
          ),

          // Dissent Highlights
          dissentHighlights && React.createElement('div', { className: 'tt-scotus-section tt-scotus-dissent' },
            React.createElement('h3', { className: 'tt-scotus-section-title' }, '🔥 Dissent Highlights'),
            React.createElement('p', { className: 'tt-scotus-section-content' }, dissentHighlights)
          ),

          // Sources (CourtListener + PDF)
          (scotusCase.source_url || scotusCase.pdf_url) && React.createElement('div', { className: 'tt-scotus-section' },
            React.createElement('h3', { className: 'tt-scotus-section-title' }, 'Sources'),
            React.createElement('div', { className: 'tt-scotus-links' },
            scotusCase.source_url && React.createElement('a', {
              href: scotusCase.source_url,
              target: '_blank',
              rel: 'noopener noreferrer',
              className: 'tt-scotus-link',
              onClick: () => {
                if (window.TTShared?.trackOutboundClick) {
                  window.TTShared.trackOutboundClick({
                    targetType: 'scotus_source',
                    sourceDomain: 'courtlistener.com',
                    contentType: 'scotus',
                    contentId: String(scotusCase.id)
                  });
                }
              }
            },
              'View on CourtListener'
            ),
            scotusCase.pdf_url && React.createElement('a', {
              href: scotusCase.pdf_url,
              target: '_blank',
              rel: 'noopener noreferrer',
              className: 'tt-scotus-link',
              onClick: () => {
                if (window.TTShared?.trackOutboundClick) {
                  window.TTShared.trackOutboundClick({
                    targetType: 'scotus_pdf',
                    sourceDomain: 'supremecourt.gov',
                    contentType: 'scotus',
                    contentId: String(scotusCase.id)
                  });
                }
              }
            },
              'Download PDF'
            )
          )
          )
        )
      )
    );
  }

  // ===========================================
  // SCOTUS FEED COMPONENT
  // ===========================================

  function ScotusFeed() {
    const [cases, setCases] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedCase, setSelectedCase] = useState(null);

    // Filters
    const [selectedImpact, setSelectedImpact] = useState('all');
    const [selectedTerm, setSelectedTerm] = useState('all');

    // Load cases
    useEffect(() => {
      loadCases();
    }, []);

    async function loadCases() {
      try {
        setLoading(true);
        // Fetch public SCOTUS cases, ordered by decided_at desc
        const data = await supabaseRequest(
          'scotus_cases?is_public=eq.true&select=id,case_name,case_name_short,docket_number,citation,term,decided_at,argued_at,vote_split,majority_author,dissent_authors,disposition,case_type,ruling_impact_level,ruling_label,who_wins,who_loses,summary_spicy,why_it_matters,dissent_highlights,evidence_anchors,source_url,pdf_url&order=decided_at.desc&limit=100'
        );
        setCases(data || []);
        setError(null);
      } catch (err) {
        console.error('Failed to load SCOTUS cases:', err);
        setError('Failed to load Supreme Court cases. Please try again.');
      } finally {
        setLoading(false);
      }
    }

    // Filter cases
    const filteredCases = useMemo(() => {
      let result = [...cases];

      // Impact filter (use Number() to handle string/number type mismatch from DB)
      if (selectedImpact !== 'all') {
        result = result.filter(c => Number(c.ruling_impact_level) === Number(selectedImpact));
      }

      // Term filter
      if (selectedTerm !== 'all') {
        result = result.filter(c => c.term === selectedTerm);
      }

      return result;
    }, [cases, selectedImpact, selectedTerm]);

    // Get unique terms for filter
    const terms = useMemo(() => {
      const termSet = new Set(cases.map(c => c.term).filter(Boolean));
      return Array.from(termSet).sort().reverse(); // Most recent first
    }, [cases]);

    // Handle view details
    const handleViewDetails = useCallback((scotusCase) => {
      setSelectedCase(scotusCase);

      // Track analytics
      if (window.TTShared?.trackDetailOpen) {
        window.TTShared.trackDetailOpen({
          objectType: 'scotus',
          contentType: 'scotus',
          contentId: String(scotusCase.id),
          source: 'card_click'
        });
      }
    }, []);

    // Close modal
    const closeModal = useCallback(() => {
      if (window.TTShared?.trackDetailClose && selectedCase) {
        window.TTShared.trackDetailClose({
          objectType: 'scotus',
          contentType: 'scotus',
          contentId: String(selectedCase.id)
        });
      }
      setSelectedCase(null);
    }, [selectedCase]);

    // Handle filter changes
    const handleImpactChange = useCallback((level) => {
      setSelectedImpact(level);
      trackEvent('filter_scotus_impact', { impact_level: level });
    }, []);

    const handleTermChange = useCallback((term) => {
      setSelectedTerm(term);
      trackEvent('filter_scotus_term', { term });
    }, []);

    // Loading state
    if (loading) {
      return React.createElement('div', { className: 'tt-loading' },
        React.createElement('div', { className: 'tt-spinner' }),
        React.createElement('p', null, 'Loading Supreme Court cases...')
      );
    }

    // Error state
    if (error) {
      return React.createElement('div', { className: 'tt-empty' },
        React.createElement('h3', null, 'Error Loading Cases'),
        React.createElement('p', null, error),
        React.createElement('button', {
          onClick: loadCases,
          className: 'tt-retry-btn',
          style: { marginTop: '16px' }
        }, 'Retry')
      );
    }

    return React.createElement(React.Fragment, null,
      // Filters section
      React.createElement('div', { className: 'tt-filters' },
        // Impact filter pills
        React.createElement('div', { className: 'tt-severity-filters' },
          React.createElement('span', { className: 'tt-filter-label' }, 'Impact:'),
          React.createElement('button', {
            className: `tt-severity-pill ${selectedImpact === 'all' ? 'active' : ''}`,
            onClick: () => handleImpactChange('all')
          }, 'All'),
          [5, 4, 3, 2, 1, 0].map(level =>
            React.createElement('button', {
              key: level,
              className: `tt-severity-pill ${selectedImpact === level ? 'active' : ''}`,
              onClick: () => handleImpactChange(level)
            }, SCOTUS_IMPACT_LABELS[level])
          )
        ),

        // Term dropdown + results count
        React.createElement('div', { className: 'tt-filters-status' },
          terms.length > 0 && React.createElement('select', {
            className: 'tt-dropdown',
            value: selectedTerm,
            onChange: (e) => handleTermChange(e.target.value),
            'aria-label': 'Filter by term'
          },
            React.createElement('option', { value: 'all' }, 'All Terms'),
            terms.map(term =>
              React.createElement('option', { key: term, value: term }, `Term ${term}`)
            )
          ),
          React.createElement('span', { className: 'tt-results-count' },
            `${filteredCases.length} ${filteredCases.length === 1 ? 'case' : 'cases'}`,
            filteredCases.length !== cases.length && ` (of ${cases.length})`
          )
        )
      ),

      // Feed
      React.createElement('div', { className: 'tt-feed' },
        // Empty state
        filteredCases.length === 0 && React.createElement('div', { className: 'tt-empty' },
          React.createElement('h3', null, 'No Cases Found'),
          React.createElement('p', null,
            cases.length === 0
              ? 'No Supreme Court cases are available yet. Check back soon!'
              : `0 cases match your filters (of ${cases.length} total).`
          ),
          (selectedImpact !== 'all' || selectedTerm !== 'all') &&
            React.createElement('button', {
              className: 'tt-retry-btn',
              onClick: () => { setSelectedImpact('all'); setSelectedTerm('all'); },
              style: { marginTop: '16px' }
            }, 'Clear filters')
        ),

        // Cases grid
        filteredCases.length > 0 && React.createElement('div', { className: 'tt-grid' },
          filteredCases.map(scotusCase =>
            React.createElement(ScotusCard, {
              key: scotusCase.id,
              scotusCase,
              onViewDetails: handleViewDetails
            })
          )
        )
      ),

      // Detail modal
      selectedCase && React.createElement(ScotusDetailModal, {
        scotusCase: selectedCase,
        onClose: closeModal
      })
    );
  }

  // ===========================================
  // PAGINATION COMPONENT
  // ===========================================

  function Pagination({ currentPage, totalPages, onPageChange }) {
    if (totalPages <= 1) return null;

    const pages = [];
    const maxVisible = 5;
    let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let end = Math.min(totalPages, start + maxVisible - 1);

    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1);
    }

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    return React.createElement('div', { className: 'tt-pagination' },
      // Previous
      React.createElement('button', {
        className: 'tt-page-btn',
        onClick: () => onPageChange(currentPage - 1),
        disabled: currentPage === 1
      }, '←'),

      // First page
      start > 1 && React.createElement('button', {
        className: 'tt-page-btn',
        onClick: () => onPageChange(1)
      }, '1'),

      start > 2 && React.createElement('span', { style: { color: 'var(--text-muted)' } }, '...'),

      // Page numbers
      ...pages.map(page =>
        React.createElement('button', {
          key: page,
          className: `tt-page-btn ${page === currentPage ? 'active' : ''}`,
          onClick: () => onPageChange(page)
        }, page)
      ),

      end < totalPages - 1 && React.createElement('span', { style: { color: 'var(--text-muted)' } }, '...'),

      // Last page
      end < totalPages && React.createElement('button', {
        className: 'tt-page-btn',
        onClick: () => onPageChange(totalPages)
      }, totalPages),

      // Next
      React.createElement('button', {
        className: 'tt-page-btn',
        onClick: () => onPageChange(currentPage + 1),
        disabled: currentPage === totalPages
      }, '→')
    );
  }

  // ===========================================
  // STORY FEED COMPONENT
  // ===========================================

  function StoryFeed() {
    const [allStories, setAllStories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Filters
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [selectedSeverity, setSelectedSeverity] = useState('all');
    const [selectedSort, setSelectedSort] = useState('recent_update');
    const [page, setPage] = useState(1);

    // Sources Modal (existing)
    const [selectedStory, setSelectedStory] = useState(null);
    const [modalArticles, setModalArticles] = useState([]);
    const [modalLoading, setModalLoading] = useState(false);
    const [modalError, setModalError] = useState(null);

    // Detail Modal (new - full story view)
    const [detailStory, setDetailStory] = useState(null);
    const [detailArticles, setDetailArticles] = useState([]);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState(null);
    const [detailJunctionData, setDetailJunctionData] = useState([]);
    const detailOpenedViaPush = useRef(false);
    const detailClosingRef = useRef(false); // Guard against deep-link re-open race

    const searchDebounceRef = useRef(null);

    // Load stories
    useEffect(() => {
      loadStories();
    }, []);

    async function loadStories() {
      try {
        setLoading(true);
        // Match production filters: active status + enriched stories only (TTRC-119)
        const data = await supabaseRequest(
          'stories?status=eq.active&summary_neutral=not.is.null&select=id,primary_headline,summary_spicy,summary_neutral,alarm_level,severity,category,source_count,primary_actor,status,last_updated_at,first_seen_at&order=last_updated_at.desc,id.desc&limit=500'
        );
        setAllStories(data || []);
        setError(null);
      } catch (err) {
        console.error('Failed to load stories:', err);
        setError('Failed to load stories. Please try again.');
      } finally {
        setLoading(false);
      }
    }

    // Filter and sort stories
    const filteredStories = useMemo(() => {
      let result = [...allStories];

      // Search filter
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        result = result.filter(story =>
          story.primary_headline?.toLowerCase().includes(term) ||
          story.summary_spicy?.toLowerCase().includes(term) ||
          story.summary_neutral?.toLowerCase().includes(term) ||
          story.primary_actor?.toLowerCase().includes(term) ||
          story.category?.toLowerCase().includes(term)
        );
      }

      // Category filter
      if (selectedCategory !== 'all') {
        result = result.filter(story => story.category === selectedCategory);
      }

      // Alarm level filter (ADO-270: uses numeric levels with legacy fallback)
      if (selectedSeverity !== 'all') {
        result = result.filter(story =>
          getAlarmLevel(story) === selectedSeverity
        );
      }

      // Sort (use story-level fields only - never fetch articles for sort)
      result.sort((a, b) => {
        if (selectedSort === 'newest') {
          // Sort by created_at (newest first)
          const aDate = new Date(a.first_seen_at || a.created_at || 0);
          const bDate = new Date(b.first_seen_at || b.created_at || 0);
          const diff = bDate - aDate;
          return diff !== 0 ? diff : b.id - a.id; // Tie-breaker: id
        } else {
          // Default: most recent update
          const aDate = new Date(a.last_updated_at || a.updated_at || a.created_at || 0);
          const bDate = new Date(b.last_updated_at || b.updated_at || b.created_at || 0);
          const diff = bDate - aDate;
          return diff !== 0 ? diff : b.id - a.id; // Tie-breaker: id
        }
      });

      return result;
    }, [allStories, searchTerm, selectedCategory, selectedSeverity, selectedSort]);

    // Paginated stories
    const totalPages = Math.ceil(filteredStories.length / ITEMS_PER_PAGE);
    const paginatedStories = useMemo(() => {
      const start = (page - 1) * ITEMS_PER_PAGE;
      return filteredStories.slice(start, start + ITEMS_PER_PAGE);
    }, [filteredStories, page]);

    // Get unique categories
    const categories = useMemo(() => {
      const cats = new Set(allStories.map(s => s.category).filter(Boolean));
      return Array.from(cats).sort();
    }, [allStories]);

    // Handle search with debounce
    const handleSearchChange = useCallback((value) => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
      searchDebounceRef.current = setTimeout(() => {
        setSearchTerm(value);
        setPage(1);
      }, 300);
    }, []);

    // Track search after results are computed (debounced)
    const searchTrackRef = useRef(null);
    useEffect(() => {
      if (!searchTerm.trim()) return;

      // Debounce search tracking to avoid rapid fire
      if (searchTrackRef.current) {
        clearTimeout(searchTrackRef.current);
      }
      searchTrackRef.current = setTimeout(() => {
        const resultCount = filteredStories.length;
        if (window.TTShared?.trackSearchAction) {
          window.TTShared.trackSearchAction(searchTerm, resultCount);
        }
        // Log zero-result searches to database for content gaps
        if (resultCount === 0 && window.TTShared?.logSearchGap) {
          window.TTShared.logSearchGap(searchTerm);
        }
      }, 500);

      return () => {
        if (searchTrackRef.current) {
          clearTimeout(searchTrackRef.current);
        }
      };
    }, [searchTerm, filteredStories.length]);

    // Handle category change
    const handleCategoryChange = useCallback((cat) => {
      setSelectedCategory(cat);
      setPage(1);
      trackEvent('filter_category', { category: cat });
    }, []);

    // Handle severity change
    const handleSeverityChange = useCallback((sev) => {
      setSelectedSeverity(sev);
      setPage(1);
      trackEvent('filter_alarm_level', { alarm_level: sev });
    }, []);

    // Handle sort change
    const handleSortChange = useCallback((sort) => {
      setSelectedSort(sort);
      setPage(1);
      trackEvent('sort_change', { sort_by: sort });
    }, []);

    // Handle clear all filters
    const handleClearAll = useCallback(() => {
      setSearchTerm('');
      setSelectedCategory('all');
      setSelectedSeverity('all');
      setSelectedSort('recent_update');
      setPage(1);
    }, []);

    // Handle page change
    const handlePageChange = useCallback((newPage) => {
      setPage(newPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      trackEvent('pagination', { page: newPage });
    }, []);

    // Handle view sources
    const handleViewSources = useCallback(async (story) => {
      setSelectedStory(story);
      setModalLoading(true);
      setModalError(null);

      try {
        // Get articles for this story via article_story junction
        const data = await supabaseRequest(
          `article_story?story_id=eq.${story.id}&select=article_id,is_primary_source,similarity_score,articles(id,title,url,source_name,published_at)`
        );

        const articles = (data || [])
          .map(item => item.articles)
          .filter(Boolean)
          .sort((a, b) => {
            // Sort by primary source first, then similarity
            const aItem = data.find(d => d.articles?.id === a.id);
            const bItem = data.find(d => d.articles?.id === b.id);
            if (aItem?.is_primary_source !== bItem?.is_primary_source) {
              return bItem?.is_primary_source ? 1 : -1;
            }
            return (bItem?.similarity_score || 0) - (aItem?.similarity_score || 0);
          });

        setModalArticles(articles);
      } catch (err) {
        console.error('Failed to load sources:', err);
        setModalError('Failed to load sources. Please try again.');
      } finally {
        setModalLoading(false);
      }
    }, []);

    // Handle view details (full story modal)
    const handleViewDetails = useCallback(async (story, fromDeepLink = false) => {
      // Guard: if already showing this story, don't double-push
      if (detailStory?.id === story.id) return;

      setDetailStory(story);
      setDetailLoading(true);
      setDetailError(null);

      // Track detail modal open
      if (window.TTShared) {
        window.TTShared.trackDetailOpen({
          objectType: 'story',
          contentType: 'story',
          contentId: String(story.id),
          source: fromDeepLink ? 'deep_link' : 'card_click'
        });
      }

      // Lock scroll when modal opens
      if (window.TTShared) window.TTShared.lockScroll();

      // Push to history (only if opened via click, not deep link)
      if (!fromDeepLink && window.TTShared) {
        window.TTShared.pushUrlParam('story', story.id, { modal: 'story', id: story.id });
        detailOpenedViaPush.current = true;
      } else {
        detailOpenedViaPush.current = false;
      }

      // Check cache first
      if (window.TTShared) {
        const cached = window.TTShared.getCachedArticles(story.id);
        if (cached) {
          setDetailArticles(cached.articles || []);
          setDetailJunctionData(cached.junctionData || []);
          setDetailLoading(false);
          setDetailError(cached.error || null);
          return;
        }
      }

      try {
        // Get articles for this story via article_story junction
        const data = await supabaseRequest(
          `article_story?story_id=eq.${story.id}&select=article_id,is_primary_source,similarity_score,articles(id,title,url,source_name,published_at)`
        );

        const articles = (data || [])
          .map(item => item.articles)
          .filter(Boolean)
          .sort((a, b) => {
            // Sort by published time (newest first)
            return new Date(b.published_at || 0) - new Date(a.published_at || 0);
          });

        setDetailArticles(articles);
        setDetailJunctionData(data || []);

        // Cache the result
        if (window.TTShared) {
          window.TTShared.setCachedArticles(story.id, { articles, junctionData: data, error: null });
        }
      } catch (err) {
        console.error('Failed to load story details:', err);
        setDetailError('Failed to load sources. Please try again.');

        // Cache error state too
        if (window.TTShared) {
          window.TTShared.setCachedArticles(story.id, { articles: [], junctionData: [], error: 'Failed to load sources.' });
        }
      } finally {
        setDetailLoading(false);
      }
    }, [detailStory?.id]);

    // Close detail modal
    const closeDetailModal = useCallback(() => {
      // Set closing guard to prevent deep-link useEffect race condition
      detailClosingRef.current = true;

      // Track detail modal close (with duration)
      if (window.TTShared && detailStory) {
        window.TTShared.trackDetailClose({
          objectType: 'story',
          contentType: 'story',
          contentId: String(detailStory.id)
        });
      }

      // Unlock scroll
      if (window.TTShared) window.TTShared.unlockScroll();

      // Handle history
      if (detailOpenedViaPush.current) {
        window.history.back();
      } else if (window.TTShared) {
        window.TTShared.removeUrlParam('story');
      }
      detailOpenedViaPush.current = false;

      setDetailStory(null);

      // Clear closing guard after a tick (allow URL to update)
      setTimeout(() => { detailClosingRef.current = false; }, 50);
    }, [detailStory]);

    // Handle popstate (back button)
    useEffect(() => {
      const handlePopState = () => {
        // If modal is open and user pressed back, close it
        if (detailStory) {
          if (window.TTShared) window.TTShared.unlockScroll();
          setDetailStory(null);
          detailOpenedViaPush.current = false;
        }
      };

      window.addEventListener('popstate', handlePopState);
      return () => window.removeEventListener('popstate', handlePopState);
    }, [detailStory]);

    // Check for deep link on mount
    useEffect(() => {
      // Skip if we're in the middle of closing (prevents race condition re-open)
      if (detailClosingRef.current) return;

      if (window.TTShared) {
        const storyId = window.TTShared.getUrlParam('story');
        if (storyId && allStories.length > 0) {
          const story = allStories.find(s => String(s.id) === storyId);
          if (story) {
            handleViewDetails(story, true);
          } else {
            // Story not found in current list - try to fetch it
            (async () => {
              try {
                const data = await supabaseRequest(
                  `stories?id=eq.${storyId}&select=id,primary_headline,summary_spicy,summary_neutral,alarm_level,severity,category,source_count,primary_actor,status,last_updated_at,first_seen_at`
                );
                if (data && data.length > 0) {
                  handleViewDetails(data[0], true);
                } else {
                  // Story not found - remove param
                  window.TTShared.removeUrlParam('story');
                }
              } catch {
                window.TTShared.removeUrlParam('story');
              }
            })();
          }
        }
      }
    }, [allStories, handleViewDetails]);

    // Loading state
    if (loading) {
      return React.createElement('div', { className: 'tt-loading' },
        React.createElement('div', { className: 'tt-spinner' }),
        React.createElement('p', null, 'Loading stories...')
      );
    }

    // Error state
    if (error) {
      return React.createElement('div', { className: 'tt-empty' },
        React.createElement('h3', null, 'Error Loading Stories'),
        React.createElement('p', null, error),
        React.createElement('button', {
          onClick: loadStories,
          style: { marginTop: '16px', padding: '12px 24px', cursor: 'pointer' }
        }, 'Retry')
      );
    }

    return React.createElement(React.Fragment, null,
      // Filters
      React.createElement(FiltersSection, {
        searchTerm,
        onSearchChange: handleSearchChange,
        selectedCategory,
        onCategoryChange: handleCategoryChange,
        selectedSeverity,
        onSeverityChange: handleSeverityChange,
        selectedSort,
        onSortChange: handleSortChange,
        categories,
        filteredCount: filteredStories.length,
        totalCount: allStories.length,
        onClearAll: handleClearAll
      }),

      // Feed
      React.createElement('div', { className: 'tt-feed' },
        // Empty state
        paginatedStories.length === 0 && React.createElement('div', { className: 'tt-empty' },
          React.createElement('h3', null, 'No Stories Found'),
          React.createElement('p', null,
            filteredStories.length === 0 && allStories.length > 0
              ? `0 stories match your filters (of ${allStories.length} total).`
              : 'No stories available.'
          ),
          (selectedCategory !== 'all' || selectedSeverity !== 'all' || searchTerm.trim()) &&
            React.createElement('button', {
              className: 'tt-retry-btn',
              onClick: handleClearAll,
              style: { marginTop: '16px' }
            }, 'Clear all filters')
        ),

        // Story grid
        paginatedStories.length > 0 && React.createElement('div', { className: 'tt-grid' },
          paginatedStories.map(story =>
            React.createElement(StoryCard, {
              key: story.id,
              story,
              onViewSources: handleViewSources,
              onViewDetails: handleViewDetails
            })
          )
        ),

        // Pagination
        React.createElement(Pagination, {
          currentPage: page,
          totalPages,
          onPageChange: handlePageChange
        })
      ),

      // Sources modal
      selectedStory && React.createElement(SourcesModal, {
        story: selectedStory,
        articles: modalArticles,
        loading: modalLoading,
        error: modalError,
        onClose: () => setSelectedStory(null)
      }),

      // Story detail modal
      detailStory && React.createElement(StoryDetailModal, {
        story: detailStory,
        articles: detailArticles,
        junctionData: detailJunctionData,
        loading: detailLoading,
        error: detailError,
        onClose: closeDetailModal,
        onRetry: () => {
          // Clear cache and retry
          if (window.TTShared) {
            window.TTShared.setCachedArticles(detailStory.id, null);
          }
          handleViewDetails(detailStory, !detailOpenedViaPush.current);
        }
      })
    );
  }

  // ===========================================
  // TAB NAVIGATION COMPONENT
  // ===========================================

  const TABS = [
    { id: 'stories', label: 'Stories', href: './' },
    { id: 'eo', label: 'Executive Orders', href: './executive-orders.html' },
    { id: 'pardons', label: 'Pardons', href: './pardons.html' },
    { id: 'scotus', label: 'Supreme Court', href: './?tab=scotus' },
    { id: 'merch', label: 'Merchandise', href: './?tab=merch' }
  ];

  function TabNavigation({ activeTab }) {
    return React.createElement('nav', {
      role: 'navigation',
      className: 'tt-tabs',
      'aria-label': 'Main navigation'
    },
      React.createElement('div', { className: 'tt-tabs-inner' },
        TABS.map(tab =>
          React.createElement('a', {
            key: tab.id,
            href: tab.href,
            className: `tt-tab ${activeTab === tab.id ? 'active' : ''}`
          }, tab.label)
        )
      )
    );
  }

  // ===========================================
  // COMING SOON COMPONENT
  // ===========================================

  const COMING_SOON_CONTENT = {
    scotus: {
      title: 'Supreme Court Tracker',
      description: 'Track Supreme Court decisions and their impact on democracy. Coming soon.'
    },
    merch: {
      title: 'TrumpyTracker Merch',
      description: 'Show your support for accountability. Official merchandise coming soon.'
    }
  };

  function ComingSoon({ tabId, onBack }) {
    const content = COMING_SOON_CONTENT[tabId] || {
      title: 'Coming Soon',
      description: 'This feature is under development.'
    };

    return React.createElement('div', { className: 'tt-coming-soon' },
      React.createElement('div', { className: 'tt-coming-soon-content' },
        React.createElement('span', { className: 'tt-coming-soon-icon' }, '🚧'),
        React.createElement('h2', { className: 'tt-coming-soon-title' }, content.title),
        React.createElement('p', { className: 'tt-coming-soon-desc' }, content.description),
        React.createElement('button', {
          className: 'tt-back-btn',
          onClick: onBack
        }, '← Back to Stories')
      )
    );
  }

  // ===========================================
  // NEWSLETTER COMPONENTS
  // ===========================================

  // Newsletter Form (reusable for footer and inline)
  function NewsletterForm({ signupPage, signupSource, isInline = false }) {
    const [email, setEmail] = useState('');
    const [status, setStatus] = useState('idle'); // idle, loading, success, error
    const [message, setMessage] = useState('');
    const [showTurnstile, setShowTurnstile] = useState(false); // Only show on focus
    const turnstileRef = useRef(null);
    const turnstileWidgetId = useRef(null);

    // Initialize Turnstile widget only when showTurnstile is true
    useEffect(() => {
      if (!showTurnstile) return;

      if (window.turnstile && turnstileRef.current && !turnstileWidgetId.current) {
        turnstileWidgetId.current = window.turnstile.render(turnstileRef.current, {
          sitekey: window.TTShared?.TURNSTILE_SITE_KEY || '0x4AAAAAACMTyFRQ0ebtcHkK',
          callback: () => {},
          'error-callback': () => {
            console.warn('[Turnstile] Widget error');
          }
        });
      }

      return () => {
        if (turnstileWidgetId.current && window.turnstile) {
          window.turnstile.remove(turnstileWidgetId.current);
          turnstileWidgetId.current = null;
        }
      };
    }, [showTurnstile]);

    const handleSubmit = async (e) => {
      e.preventDefault();

      if (!email.trim()) {
        setStatus('error');
        setMessage('Please enter your email address.');
        return;
      }

      // Get Turnstile token
      let turnstileToken = '';
      if (window.turnstile && turnstileWidgetId.current) {
        turnstileToken = window.turnstile.getResponse(turnstileWidgetId.current);
        if (!turnstileToken) {
          setStatus('error');
          setMessage('Please complete the verification.');
          return;
        }
      }

      // Ensure signup handler is available
      if (!window.TTShared?.submitNewsletterSignup) {
        setStatus('error');
        setMessage('Signup is temporarily unavailable. Please try again later.');
        return;
      }

      setStatus('loading');
      setMessage('');

      try {
        const result = await window.TTShared.submitNewsletterSignup({
          email: email.trim(),
          turnstileToken,
          signupPage,
          signupSource
        });

        if (result.success) {
          setStatus('success');
          setMessage(result.message);
          setEmail('');
          // Reset Turnstile
          if (window.turnstile && turnstileWidgetId.current) {
            window.turnstile.reset(turnstileWidgetId.current);
          }
        } else {
          setStatus('error');
          setMessage(result.message);
        }
      } catch (err) {
        setStatus('error');
        setMessage(err?.message || 'Something went wrong. Please try again.');
        // Reset Turnstile on error too
        if (window.turnstile && turnstileWidgetId.current) {
          window.turnstile.reset(turnstileWidgetId.current);
        }
      }
    };

    // Don't show if already signed up
    if (window.TTShared?.hasNewsletterSignup()) {
      return null;
    }

    return React.createElement('form', {
      className: 'tt-newsletter-form',
      onSubmit: handleSubmit
    },
      // Honeypot field (hidden from real users)
      React.createElement('input', {
        type: 'text',
        name: 'website',
        className: 'tt-newsletter-hp',
        tabIndex: -1,
        autoComplete: 'off'
      }),
      // Email input
      React.createElement('input', {
        type: 'email',
        className: 'tt-newsletter-input',
        placeholder: 'Enter your email',
        value: email,
        onChange: (e) => setEmail(e.target.value),
        onFocus: () => setShowTurnstile(true),
        disabled: status === 'loading',
        'aria-label': 'Email address'
      }),
      // Submit button
      React.createElement('button', {
        type: 'submit',
        className: 'tt-newsletter-submit',
        disabled: status === 'loading'
      }, status === 'loading' ? 'Subscribing...' : 'Subscribe'),
      // Turnstile widget (only renders after email input focus)
      showTurnstile && React.createElement('div', {
        className: 'tt-newsletter-turnstile',
        ref: turnstileRef
      }),
      // Status message
      message && React.createElement('div', {
        className: `tt-newsletter-message ${status}`
      }, message),
      // Privacy note
      React.createElement('p', { className: 'tt-newsletter-privacy' },
        'No spam, ever. Unsubscribe anytime.'
      )
    );
  }

  // Newsletter Footer
  function NewsletterFooter() {
    // Don't show if already signed up
    if (window.TTShared?.hasNewsletterSignup()) {
      return null;
    }

    return React.createElement('footer', { className: 'tt-newsletter-footer' },
      React.createElement('div', { className: 'tt-newsletter-inner' },
        React.createElement('h3', { className: 'tt-newsletter-title' },
          'Stay in the Loop'
        ),
        React.createElement('p', { className: 'tt-newsletter-subtitle' },
          'Get weekly updates on the latest political bullshit.'
        ),
        React.createElement(NewsletterForm, {
          signupPage: 'stories',
          signupSource: 'footer'
        })
      )
    );
  }

  // Inline Newsletter CTA (appears at 50% scroll)
  function InlineNewsletterCTA({ signupPage }) {
    const [show, setShow] = useState(false);

    useEffect(() => {
      // Don't show if already signed up or dismissed
      if (window.TTShared?.hasNewsletterSignup() || window.TTShared?.isInlineCTADismissed()) {
        return;
      }

      let hasTriggered = false;

      const checkScroll = () => {
        if (hasTriggered) return;

        const scrollTop = window.scrollY;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const scrollPercent = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;

        if (scrollPercent >= 50) {
          hasTriggered = true;
          setShow(true);
          window.removeEventListener('scroll', checkScroll);
        }
      };

      window.addEventListener('scroll', checkScroll, { passive: true });
      return () => window.removeEventListener('scroll', checkScroll);
    }, []);

    const handleDismiss = () => {
      setShow(false);
      window.TTShared?.dismissInlineCTA();
    };

    if (!show) return null;

    return React.createElement('div', { className: 'tt-newsletter-inline-wrapper' },
      React.createElement('div', { className: 'tt-newsletter-inline' },
        React.createElement('button', {
          className: 'tt-newsletter-close',
          onClick: handleDismiss,
          'aria-label': 'Dismiss'
        }, '×'),
        React.createElement('h3', { className: 'tt-newsletter-title' },
          'Like what you\'re reading?'
        ),
        React.createElement('p', { className: 'tt-newsletter-subtitle' },
          'Get the weekly roundup of political corruption delivered to your inbox.'
        ),
        React.createElement(NewsletterForm, {
          signupPage,
          signupSource: 'inline_50pct',
          isInline: true
        })
      )
    );
  }

  // ===========================================
  // MAIN APP COMPONENT
  // ===========================================

  function ThemePreviewApp() {
    const { theme, toggleTheme } = useTheme();
    const [activeTab, setActiveTab] = useState('stories');

    // Check for ?tab= param on mount
    useEffect(() => {
      if (window.TTShared) {
        const tabParam = window.TTShared.getUrlParam('tab');
        if (tabParam && (tabParam === 'scotus' || tabParam === 'merch')) {
          setActiveTab(tabParam);
        }
      }
    }, []);

    // Initialize scroll depth tracking
    useEffect(() => {
      if (window.TTShared?.initScrollDepthTracking) {
        window.TTShared.initScrollDepthTracking('stories');
      }
    }, []);

    // Handle back to stories
    const handleBack = useCallback(() => {
      setActiveTab('stories');
      if (window.TTShared) {
        window.TTShared.removeUrlParam('tab');
      }
    }, []);

    // Determine what content to show based on active tab
    const renderContent = () => {
      if (activeTab === 'scotus') {
        return React.createElement(React.Fragment, null,
          React.createElement(ScotusFeed),
          React.createElement(InlineNewsletterCTA, { signupPage: 'scotus' })
        );
      }
      if (activeTab === 'merch') {
        return React.createElement(ComingSoon, { tabId: 'merch', onBack: handleBack });
      }
      // Default: stories
      return React.createElement(React.Fragment, null,
        React.createElement(StoryFeed),
        React.createElement(InlineNewsletterCTA, { signupPage: 'stories' })
      );
    };

    return React.createElement('div', { className: 'tt-preview-root', style: { display: 'flex', flexDirection: 'column', minHeight: '100vh' } },
      React.createElement(Header, { theme, toggleTheme }),
      React.createElement(TabNavigation, { activeTab }),
      React.createElement('div', { style: { flex: 1 } }, renderContent()),
      React.createElement(NewsletterFooter)
    );
  }

  // ===========================================
  // MOUNT APPLICATION
  // ===========================================

  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(React.createElement(ThemePreviewApp));

})();
