// TrumpyTracker Theme Preview - Standalone React Components
// Dual theme system with Light (Newspaper) and Dark (Professional) modes

(function() {
  'use strict';

  const { useState, useEffect, useMemo, useRef, useCallback } = React;

  // ===========================================
  // CONFIGURATION
  // ===========================================

  const SUPABASE_URL = window.SUPABASE_CONFIG?.SUPABASE_URL || 'https://osjbulmltfpcoldydexg.supabase.co';
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

  // Severity labels (the spicy ones!)
  const SEVERITY_LABELS = {
    critical: 'Fucking Treason',
    severe: 'Criminal Bullshit',
    moderate: 'Swamp Shit',
    minor: 'Clown Show'
  };

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

        // Theme toggle
        React.createElement('button', {
          className: 'tt-theme-toggle',
          onClick: toggleTheme,
          'aria-label': `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`
        },
          theme === 'dark' ? '☀️ Light' : '🌙 Dark'
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

  // Severity filter options
  const SEVERITY_FILTERS = ['all', 'critical', 'severe', 'moderate', 'minor'];

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

      // Severity pills row
      React.createElement('div', { className: 'tt-severity-filters' },
        React.createElement('span', { className: 'tt-filter-label' }, 'Severity:'),
        SEVERITY_FILTERS.map(sev =>
          React.createElement('button', {
            key: sev,
            className: `tt-severity-pill ${selectedSeverity === sev ? 'active' : ''}`,
            onClick: () => onSeverityChange(sev)
          }, sev === 'all' ? 'All' : SEVERITY_LABELS[sev] || sev)
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

          // Severity chip
          selectedSeverity !== 'all' && React.createElement('span', { className: 'tt-filter-chip' },
            `Severity: ${SEVERITY_LABELS[selectedSeverity] || selectedSeverity}`,
            React.createElement('button', {
              className: 'tt-chip-remove',
              onClick: () => onSeverityChange('all'),
              'aria-label': 'Remove severity filter'
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

    // Get display values
    const categoryLabel = CATEGORIES[story.category] || 'Uncategorized';
    const severityLabel = SEVERITY_LABELS[story.severity?.toLowerCase()] || '';
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

      // Actor + Severity
      React.createElement('div', { className: 'tt-actor-row' },
        story.primary_actor && React.createElement('span', { className: 'tt-actor' },
          React.createElement('span', { className: 'tt-actor-icon' }, '👤'),
          'Main actor: ',
          window.TTShared?.formatActorName(story.primary_actor) || story.primary_actor
        ),
        severityLabel && React.createElement('span', {
          className: 'tt-severity',
          'data-severity': story.severity?.toLowerCase()
        }, severityLabel)
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
                  className: 'tt-source-link'
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

    // Get display values
    const categoryLabel = CATEGORIES[story?.category] || 'Uncategorized';
    const severityLabel = SEVERITY_LABELS[story?.severity?.toLowerCase()] || '';
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

            // Actor + Severity row
            React.createElement('div', { className: 'tt-detail-actor-row' },
              story.primary_actor && React.createElement('span', { className: 'tt-actor' },
                React.createElement('span', { className: 'tt-actor-icon' }, '👤'),
                'Main actor: ',
                window.TTShared?.formatActorName(story.primary_actor) || story.primary_actor
              ),
              severityLabel && React.createElement('span', {
                className: 'tt-severity',
                'data-severity': story.severity?.toLowerCase()
              }, severityLabel)
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
                      className: 'tt-source-title'
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
          'stories?status=eq.active&summary_neutral=not.is.null&select=id,primary_headline,summary_spicy,summary_neutral,severity,category,source_count,primary_actor,status,last_updated_at,first_seen_at&order=last_updated_at.desc,id.desc&limit=500'
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

      // Severity filter
      if (selectedSeverity !== 'all') {
        result = result.filter(story =>
          story.severity?.toLowerCase() === selectedSeverity
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
        if (value.trim()) {
          trackEvent('search', { search_term: value.trim() });
        }
      }, 300);
    }, []);

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
      trackEvent('filter_severity', { severity: sev });
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

      // Track story view (only from user clicks, not deep links)
      if (!fromDeepLink) {
        trackEvent('view_story', {
          story_id: story.id,
          category: story.category,
          severity: story.severity
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
    }, []);

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
                  `stories?id=eq.${storyId}&select=id,primary_headline,summary_spicy,summary_neutral,severity,category,source_count,primary_actor,status,last_updated_at,first_seen_at`
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

    // Handle back to stories
    const handleBack = useCallback(() => {
      setActiveTab('stories');
      if (window.TTShared) {
        window.TTShared.removeUrlParam('tab');
      }
    }, []);

    // Determine what content to show
    const showComingSoon = activeTab === 'scotus' || activeTab === 'merch';

    return React.createElement('div', { className: 'tt-preview-root' },
      React.createElement(Header, { theme, toggleTheme }),
      React.createElement(TabNavigation, { activeTab }),
      showComingSoon
        ? React.createElement(ComingSoon, { tabId: activeTab, onBack: handleBack })
        : React.createElement(StoryFeed)
    );
  }

  // ===========================================
  // MOUNT APPLICATION
  // ===========================================

  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(React.createElement(ThemePreviewApp));

})();
