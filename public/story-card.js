// Story Card Component - Production-style single-column card with all RSS enrichment fields
// TTRC-193: Revert to production styling + display all enrichment data

(function() {
  'use strict';

  const { useState, useMemo } = React;
  const { fetchStoryArticles } = window.StoryAPI || {};

  // Time ago helper
  function timeAgo(iso) {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms) || ms < 0) return '—';
    const s = Math.max(1, Math.floor(ms / 1000));
    const intervals = [
      [31536000, 'y'],
      [2592000, 'mo'],
      [604800, 'w'],
      [86400, 'd'],
      [3600, 'h'],
      [60, 'm']
    ];

    for (const [sec, unit] of intervals) {
      if (s >= sec) {
        return `${Math.floor(s / sec)}${unit} ago`;
      }
    }
    return `${s}s ago`;
  }

  // Format date helper (matches production)
  function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Category labels matching 11-category system
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

  /**
   * SourcesModal - Modal for viewing all sources with error handling
   */
  function SourcesModal({ story, grouped, onClose, error, onRetry }) {
    return React.createElement(
      'div',
      {
        className: 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4',
        onClick: (e) => e.target === e.currentTarget && onClose()
      },
      React.createElement(
        'div',
        {
          className: 'bg-gray-800 rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6 border border-gray-700'
        },
        // Header
        React.createElement(
          'div',
          { className: 'flex justify-between items-start mb-4' },
          React.createElement(
            'h3',
            { className: 'text-xl font-bold text-white' },
            'Sources'
          ),
          React.createElement(
            'button',
            {
              onClick: onClose,
              className: 'text-gray-400 hover:text-white text-2xl leading-none'
            },
            '×'
          )
        ),

        // Error State
        error && React.createElement(
          'div',
          {
            className: 'bg-red-500/10 border border-red-500 rounded p-4 mb-4'
          },
          React.createElement(
            'p',
            { className: 'text-red-400 mb-2' },
            error
          ),
          React.createElement(
            'button',
            {
              onClick: onRetry,
              className: 'px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors'
            },
            'Retry'
          )
        ),

        // Empty State
        !error && grouped.length === 0 && React.createElement(
          'div',
          { className: 'text-center py-8' },
          React.createElement(
            'p',
            { className: 'text-gray-400 mb-2' },
            'No sources available for this story.'
          ),
          React.createElement(
            'p',
            { className: 'text-gray-500 text-sm' },
            'This may be a manually created entry.'
          )
        ),

        // Sources List
        !error && grouped.length > 0 && React.createElement(
          'div',
          { className: 'space-y-4' },
          grouped.map(([sourceName, articles]) =>
            React.createElement(
              'div',
              { key: sourceName, className: 'border-l-2 border-gray-600 pl-4' },
              React.createElement(
                'h4',
                { className: 'font-bold text-white mb-2' },
                `${sourceName} (${articles.length})`
              ),
              React.createElement(
                'div',
                { className: 'space-y-2' },
                articles.map((article, idx) =>
                  React.createElement(
                    'a',
                    {
                      key: idx,
                      href: article.url,
                      target: '_blank',
                      rel: 'noopener noreferrer',
                      className: 'block text-blue-400 hover:text-blue-300 text-sm'
                    },
                    article.title || 'Untitled'
                  )
                )
              )
            )
          )
        )
      )
    );
  }

  /**
   * StoryCard - Production-style single-column card with all enrichment fields
   */
  function StoryCard({ story, index = 0 }) {
    const [expanded, setExpanded] = useState(false);
    const [showSources, setShowSources] = useState(false);
    const [articles, setArticles] = useState([]);
    const [loadingArticles, setLoadingArticles] = useState(false);
    const [articleError, setArticleError] = useState(null);

    // Summary fallback chain: spicy → neutral → headline
    const displaySummary = story.summary_spicy || story.summary_neutral || story.primary_headline || 'No summary available.';
    const hasLongSummary = displaySummary?.length > 200;

    // Get category label
    const categoryLabel = CATEGORY_LABELS[story.category] || 'Uncategorized';

    // Get severity label
    const getSeverityLabel = () => {
      const severityMap = {
        'critical': 'Fucking Treason',
        'severe': 'Criminal Bullshit',
        'moderate': 'Swamp Shit',
        'minor': 'Clown Show'
      };
      return severityMap[story.severity?.toLowerCase()] || '';
    };

    const sortedArticles = useMemo(
      () =>
        (articles || []).sort((a, b) => {
          if (a.is_primary_source !== b.is_primary_source) {
            return b.is_primary_source - a.is_primary_source;
          }
          return (b.similarity_score || 0) - (a.similarity_score || 0);
        }),
      [articles]
    );

    const groupedSources = useMemo(() => {
      const groups = {};
      sortedArticles.forEach((a) => {
        const name = a.source_name || 'Unknown';
        (groups[name] = groups[name] || []).push(a);
      });
      return Object.entries(groups);
    }, [sortedArticles]);

    const handleViewSources = async () => {
      if (!fetchStoryArticles) return;
      // Guard: Don't fetch if already loading or loaded
      if (articles.length > 0 || loadingArticles) return;

      setLoadingArticles(true);
      setShowSources(true);
      try {
        const fetchedArticles = await fetchStoryArticles(story.id);
        setArticles(fetchedArticles || []);
        setArticleError(null);
      } catch (error) {
        console.error('Failed to load story articles:', error);
        setArticleError('Failed to load sources. Please try again.');
      } finally {
        setLoadingArticles(false);
      }
    };

    const handleRetry = () => {
      setArticleError(null);
      setArticles([]);
      setLoadingArticles(true);
      fetchStoryArticles(story.id)
        .then(fetchedArticles => {
          setArticles(fetchedArticles || []);
          setArticleError(null);
        })
        .catch(error => {
          console.error('Failed to load story articles:', error);
          setArticleError('Failed to load sources. Please try again.');
        })
        .finally(() => setLoadingArticles(false));
    };

    // Production-style card with dark theme and all enrichment fields
    return React.createElement(
      'div',
      {
        className: 'bg-gray-800/50 backdrop-blur-md rounded-lg p-6 border border-gray-700 hover:border-gray-600 transition-all duration-200 hover:shadow-xl',
        style: {
          animation: index < 10 ? 'fadeIn 0.4s ease-in-out' : 'none',
          animationDelay: index < 10 ? `${index * 0.05}s` : '0s'
        }
      },

      // Title First
      React.createElement(
        'h3',
        { className: 'text-lg font-bold text-white mb-3' },
        story.primary_headline
      ),

      // Metadata Line: Actor • Date • Source Count
      React.createElement(
        'div',
        { className: 'flex items-center gap-2 text-sm text-gray-400 mb-3' },
        story.primary_actor && React.createElement('span', null, story.primary_actor),
        story.primary_actor && story.last_updated_at && React.createElement('span', null, '•'),
        React.createElement(
          'span',
          { title: story.last_updated_at ? new Date(story.last_updated_at).toLocaleString() : '' },
          `Updated ${timeAgo(story.last_updated_at)}`
        ),
        React.createElement('span', null, '•'),
        React.createElement(
          'button',
          {
            onClick: handleViewSources,
            className: 'text-blue-400 hover:text-blue-300 cursor-pointer transition-colors',
            disabled: loadingArticles
          },
          loadingArticles ? 'Loading...' : `${story.source_count ?? 0} sources`
        )
      ),

      // Summary with expand/collapse
      displaySummary && React.createElement(
        'div',
        { className: 'mb-4' },
        React.createElement(
          'p',
          {
            className: 'text-gray-100 leading-relaxed transition-all duration-300',
            style: !expanded ? {
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            } : {}
          },
          displaySummary
        ),
        hasLongSummary && React.createElement(
          'button',
          {
            onClick: () => setExpanded(!expanded),
            className: 'text-blue-400 hover:text-blue-300 text-sm mt-2 transition-colors'
          },
          expanded ? 'Show less ↑' : 'Read more →'
        )
      ),

      // Bottom Actions Bar: Severity Badge + Category
      React.createElement(
        'div',
        { className: 'flex items-center justify-between' },
        React.createElement(
          'div',
          { className: 'flex items-center gap-3' },
          // Severity Badge
          getSeverityLabel() && React.createElement(
            'span',
            {
              className: `px-3 py-1 rounded-full text-xs font-bold text-white ${
                story.severity?.toLowerCase() === 'critical' ? 'bg-red-600' :
                story.severity?.toLowerCase() === 'severe' ? 'bg-orange-600' :
                story.severity?.toLowerCase() === 'moderate' ? 'bg-yellow-600' :
                story.severity?.toLowerCase() === 'minor' ? 'bg-green-600' :
                'bg-gray-700'
              }`
            },
            getSeverityLabel()
          ),
          // Category
          categoryLabel && React.createElement(
            'span',
            { className: 'text-xs text-gray-500' },
            categoryLabel
          )
        )
      ),

      // Sources Modal
      showSources &&
        React.createElement(SourcesModal, {
          story,
          grouped: groupedSources,
          onClose: () => setShowSources(false),
          error: articleError,
          onRetry: handleRetry
        })
    );
  }

  // Export to window
  window.StoryComponents = Object.assign({}, window.StoryComponents || {}, {
    StoryCard
  });
})();
