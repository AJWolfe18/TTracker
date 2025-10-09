// Story Feed Component - With search, filters, and pagination

(function() {
  'use strict';

  const { useState, useEffect, useMemo, useRef } = React;
  const { StoryCard } = window.StoryComponents || {};
  const { fetchStories } = window.StoryAPI || {};

  if (!StoryCard) {
    console.error('StoryFeed: StoryComponents.StoryCard not found. Make sure story-card.js loads first.');
  }

  if (!fetchStories) {
    console.error('StoryFeed: StoryAPI.fetchStories not found. Make sure story-api.js loads first.');
  }

  const ITEMS_PER_PAGE = 20;

  // Category labels matching database enum
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

  function StoryFeed() {
    const [allStories, setAllStories] = useState([]);
    const [displayedStories, setDisplayedStories] = useState([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Filter state
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [selectedSeverity, setSelectedSeverity] = useState('all');
    const [sortBy, setSortBy] = useState('recent');

    const searchDebounceRef = useRef(null);

    // Load all stories on mount
    useEffect(() => {
      loadAllStories();
    }, []);

    async function loadAllStories() {
      try {
        setLoading(true);
        // Load all stories for filtering (using cursor-based approach)
        const batch = await fetchStories({ limit: 1000 });
        setAllStories(batch || []);
        setError(null);
      } catch (err) {
        console.error('StoryFeed.loadAllStories error:', err);
        setError('Failed to load stories. Please try again.');
      } finally {
        setLoading(false);
      }
    }

    // Apply filters and pagination
    useEffect(() => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }

      searchDebounceRef.current = setTimeout(() => {
        applyFiltersAndPagination();
      }, 300);
    }, [searchTerm, selectedCategory, selectedSeverity, sortBy, page, allStories]);

    function applyFiltersAndPagination() {
      let filtered = [...allStories];

      // Apply search filter
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        filtered = filtered.filter(story =>
          story.primary_headline?.toLowerCase().includes(term) ||
          story.summary_spicy?.toLowerCase().includes(term) ||
          story.summary_neutral?.toLowerCase().includes(term) ||
          story.primary_actor?.toLowerCase().includes(term) ||
          story.category?.toLowerCase().includes(term)
        );
      }

      // Apply category filter
      if (selectedCategory !== 'all') {
        filtered = filtered.filter(story => story.category === selectedCategory);
      }

      // Apply severity filter
      if (selectedSeverity !== 'all') {
        filtered = filtered.filter(story => story.severity?.toLowerCase() === selectedSeverity);
      }

      // Apply sorting
      if (sortBy === 'recent') {
        filtered.sort((a, b) => new Date(b.last_updated_at) - new Date(a.last_updated_at));
      } else if (sortBy === 'oldest') {
        filtered.sort((a, b) => new Date(a.last_updated_at) - new Date(b.last_updated_at));
      } else if (sortBy === 'severity') {
        const severityOrder = { critical: 0, severe: 1, moderate: 2, minor: 3 };
        filtered.sort((a, b) => {
          const aVal = severityOrder[a.severity?.toLowerCase()] ?? 4;
          const bVal = severityOrder[b.severity?.toLowerCase()] ?? 4;
          return aVal - bVal;
        });
      }

      // Calculate pagination
      const total = Math.ceil(filtered.length / ITEMS_PER_PAGE);
      setTotalPages(total);

      // Get current page items
      const startIdx = (page - 1) * ITEMS_PER_PAGE;
      const endIdx = startIdx + ITEMS_PER_PAGE;
      setDisplayedStories(filtered.slice(startIdx, endIdx));
    }

    function retry() {
      loadAllStories();
    }

    function clearFilters() {
      setSearchTerm('');
      setSelectedCategory('all');
      setSelectedSeverity('all');
      setSortBy('recent');
      setPage(1);
    }

    function changePage(newPage) {
      if (newPage >= 1 && newPage <= totalPages) {
        setPage(newPage);
        // Scroll to top of feed
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }

    // Get unique categories from stories
    const uniqueCategories = useMemo(() => {
      const cats = new Set(allStories.map(s => s.category).filter(Boolean));
      return Array.from(cats).sort();
    }, [allStories]);

    const storyList = useMemo(() => displayedStories, [displayedStories]);

    if (loading && allStories.length === 0) {
      return React.createElement(
        'div',
        { className: 'tt-feed' },
        React.createElement(
          'div',
          { className: 'tt-skeletons' },
          React.createElement('div', { className: 'tt-skel' }),
          React.createElement('div', { className: 'tt-skel' }),
          React.createElement('div', { className: 'tt-skel' }),
          React.createElement('div', { className: 'tt-skel' }),
          React.createElement('div', { className: 'tt-skel' }),
          React.createElement('div', { className: 'tt-skel' })
        )
      );
    }

    return React.createElement(
      'div',
      { className: 'tt-feed' },

      // Search and Filters Section
      React.createElement(
        'div',
        { className: 'bg-gray-800/50 backdrop-blur-md rounded-lg p-6 mb-6 border border-gray-700' },
        // Search Bar
        React.createElement(
          'div',
          { className: 'mb-4' },
          React.createElement('input', {
            type: 'text',
            placeholder: 'Search stories by headline, summary, actor, or category...',
            value: searchTerm,
            onChange: (e) => setSearchTerm(e.target.value),
            className: 'w-full px-4 py-3 bg-gray-900 text-white border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500 transition-colors'
          })
        ),
        // Filters Row
        React.createElement(
          'div',
          { className: 'grid grid-cols-1 md:grid-cols-4 gap-4' },
          // Category Filter
          React.createElement(
            'select',
            {
              value: selectedCategory,
              onChange: (e) => { setSelectedCategory(e.target.value); setPage(1); },
              className: 'px-4 py-2 bg-gray-900 text-white border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500 transition-colors'
            },
            React.createElement('option', { value: 'all' }, 'All Categories'),
            uniqueCategories.map(cat =>
              React.createElement('option', { key: cat, value: cat }, CATEGORY_LABELS[cat] || cat)
            )
          ),
          // Severity Filter
          React.createElement(
            'select',
            {
              value: selectedSeverity,
              onChange: (e) => { setSelectedSeverity(e.target.value); setPage(1); },
              className: 'px-4 py-2 bg-gray-900 text-white border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500 transition-colors'
            },
            React.createElement('option', { value: 'all' }, 'All Severity'),
            React.createElement('option', { value: 'critical' }, 'Fucking Treason'),
            React.createElement('option', { value: 'severe' }, 'Criminal Bullshit'),
            React.createElement('option', { value: 'moderate' }, 'Swamp Shit'),
            React.createElement('option', { value: 'minor' }, 'Clown Show')
          ),
          // Sort By
          React.createElement(
            'select',
            {
              value: sortBy,
              onChange: (e) => { setSortBy(e.target.value); setPage(1); },
              className: 'px-4 py-2 bg-gray-900 text-white border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500 transition-colors'
            },
            React.createElement('option', { value: 'recent' }, 'Most Recent'),
            React.createElement('option', { value: 'oldest' }, 'Oldest First'),
            React.createElement('option', { value: 'severity' }, 'By Severity')
          ),
          // Clear Filters Button
          React.createElement(
            'button',
            {
              onClick: clearFilters,
              className: 'px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors'
            },
            'Clear Filters'
          )
        ),
        // Results Count
        React.createElement(
          'div',
          { className: 'mt-4 text-sm text-gray-400' },
          `Showing ${storyList.length} of ${allStories.length} stories`
        )
      ),

      // Error State
      error && React.createElement(
        'div',
        { className: 'tt-error' },
        React.createElement('span', null, error),
        React.createElement(
          'button',
          { className: 'tt-btn', onClick: retry },
          'Retry'
        )
      ),

      // Empty State
      storyList.length === 0 && !loading && !error && React.createElement(
        'div',
        { className: 'tt-empty' },
        React.createElement('h3', null, 'No Stories Found'),
        React.createElement('p', null, searchTerm || selectedCategory !== 'all' || selectedSeverity !== 'all' ? 'Try adjusting your filters' : 'Check back soon for updates on political accountability.')
      ),

      // Stories Grid
      storyList.length > 0 && React.createElement(
        'div',
        { className: 'tt-grid' },
        storyList.map((story, index) =>
          React.createElement(StoryCard, {
            key: story.id,
            story: story,
            index: index,
            onShare: (url) => {
              try {
                if (navigator.share) {
                  navigator.share({ url });
                } else if (navigator.clipboard) {
                  navigator.clipboard.writeText(url);
                }
              } catch (err) {
                console.error('Share failed:', err);
              }
            }
          })
        )
      ),

      // True Pagination
      storyList.length > 0 && totalPages > 1 && React.createElement(
        'div',
        { className: 'flex items-center justify-center gap-2 mt-8' },
        // Previous Button
        React.createElement(
          'button',
          {
            onClick: () => changePage(page - 1),
            disabled: page === 1,
            className: `px-4 py-2 rounded-lg border transition-colors ${
              page === 1
                ? 'bg-gray-800 border-gray-700 text-gray-600 cursor-not-allowed'
                : 'bg-gray-800 border-gray-600 text-white hover:bg-gray-700'
            }`
          },
          '← Previous'
        ),
        // Page Numbers
        ...(() => {
          const pages = [];
          const maxPagesToShow = 7;
          let startPage = Math.max(1, page - 3);
          let endPage = Math.min(totalPages, page + 3);

          if (endPage - startPage < maxPagesToShow - 1) {
            if (startPage === 1) {
              endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);
            } else {
              startPage = Math.max(1, endPage - maxPagesToShow + 1);
            }
          }

          if (startPage > 1) {
            pages.push(
              React.createElement(
                'button',
                {
                  key: 1,
                  onClick: () => changePage(1),
                  className: 'px-4 py-2 rounded-lg border bg-gray-800 border-gray-600 text-white hover:bg-gray-700 transition-colors'
                },
                '1'
              )
            );
            if (startPage > 2) {
              pages.push(
                React.createElement('span', { key: 'ellipsis1', className: 'text-gray-500' }, '...')
              );
            }
          }

          for (let i = startPage; i <= endPage; i++) {
            pages.push(
              React.createElement(
                'button',
                {
                  key: i,
                  onClick: () => changePage(i),
                  className: `px-4 py-2 rounded-lg border transition-colors ${
                    i === page
                      ? 'bg-blue-600 border-blue-500 text-white font-bold'
                      : 'bg-gray-800 border-gray-600 text-white hover:bg-gray-700'
                  }`
                },
                i
              )
            );
          }

          if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
              pages.push(
                React.createElement('span', { key: 'ellipsis2', className: 'text-gray-500' }, '...')
              );
            }
            pages.push(
              React.createElement(
                'button',
                {
                  key: totalPages,
                  onClick: () => changePage(totalPages),
                  className: 'px-4 py-2 rounded-lg border bg-gray-800 border-gray-600 text-white hover:bg-gray-700 transition-colors'
                },
                totalPages
              )
            );
          }

          return pages;
        })(),
        // Next Button
        React.createElement(
          'button',
          {
            onClick: () => changePage(page + 1),
            disabled: page === totalPages,
            className: `px-4 py-2 rounded-lg border transition-colors ${
              page === totalPages
                ? 'bg-gray-800 border-gray-700 text-gray-600 cursor-not-allowed'
                : 'bg-gray-800 border-gray-600 text-white hover:bg-gray-700'
            }`
          },
          'Next →'
        )
      )
    );
  }

  window.StoryComponents = Object.assign({}, window.StoryComponents || {}, {
    StoryFeed
  });
})();
