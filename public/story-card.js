// Story Card Component - Story-first card with severity, receipts, and actions
// Includes inline SourcesModal for viewing all article sources

(function() {
  'use strict';
  
  const { useState, useMemo, useEffect, useRef } = React;
  const { fetchStoryArticles } = window.StoryAPI || {};

  // Time ago helper - NULL SAFE
  // TIMEZONE NOTE: Assumes published_at is ISO UTC from API (standard)
  // Relative time computed against Date.now() (browser local time)
  // If timestamps aren't normalized, convert server-side with 'Z' suffix
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

  // Severity configuration matching TTRC-145 requirements
  const SEVERITY_CONFIG = {
    critical: { 
      label: 'FUCKING TREASON',  
      ribbon: '#fecaca', 
      badge: '#dc2626' 
    },
    severe: { 
      label: 'CRIMINAL BULLSHIT', 
      ribbon: '#fed7aa', 
      badge: '#ea580c' 
    },
    moderate: { 
      label: 'SWAMP SHIT',        
      ribbon: '#fde68a', 
      badge: '#ca8a04' 
    },
    minor: { 
      label: 'CLOWN SHOW',        
      ribbon: '#bbf7d0', 
      badge: '#16a34a' 
    }
  };

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
   * SourcesModal - Accessible modal showing all sources for a story
   */
  function SourcesModal({ story, grouped, onClose, error, onRetry }) {
    const trapRef = useRef(null);
    
    useEffect(() => {
      const previouslyFocused = document.activeElement;
      setTimeout(() => trapRef.current?.focus(), 0);
      
      function handleKeyDown(e) {
        if (e.key === 'Escape') onClose();
      }
      
      document.addEventListener('keydown', handleKeyDown);
      
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        previouslyFocused && previouslyFocused.focus?.();
      };
    }, [onClose]);

    return React.createElement(
      'div',
      {
        className: 'tt-modal-overlay',
        role: 'dialog',
        'aria-modal': 'true',
        onClick: (e) => {
          if (e.target === e.currentTarget) onClose();
        }
      },
      React.createElement(
        'div',
        { className: 'tt-modal', tabIndex: -1, ref: trapRef, 'aria-labelledby': 'sources-modal-title' },
        React.createElement(
          'div',
          { className: 'tt-modal-header' },
          React.createElement('h3', { className: 'tt-modal-title', id: 'sources-modal-title' }, 'Sources'),
          React.createElement(
            'button',
            {
              className: 'tt-modal-close',
              onClick: onClose,
              'aria-label': 'Close'
            },
            '×'
          )
        ),
        React.createElement(
          'div',
          { className: 'tt-modal-body' },
          React.createElement(
            'div',
            { className: 'tt-modal-headline' },
            story.primary_headline
          ),
          error && React.createElement(
            'div',
            {
              className: 'tt-error',
              style: { marginTop: 0 }
            },
            React.createElement('span', null, error),
            React.createElement(
              'button',
              {
                className: 'tt-btn',
                onClick: onRetry
              },
              'Retry'
            )
          ),
          grouped.length === 0 && !error && React.createElement(
            'div',
            {
              className: 'tt-modal-note',
              style: {
                color: '#64748b',
                textAlign: 'center',
                padding: '24px 16px'
              }
            },
            React.createElement('p', { style: { margin: 0 } }, 'No sources available for this story.'),
            React.createElement(
              'p',
              {
                style: {
                  margin: '4px 0 0 0',
                  fontSize: '12px',
                  color: '#94a3b8'
                }
              },
              'This may be a manually created entry.'
            )
          ),
          grouped.map(([source, articles]) => {
            const latest = articles[0] || {};
            return React.createElement(
              'div',
              { key: source, className: 'tt-source-row' },
              React.createElement(
                'div',
                null,
                React.createElement('div', { className: 'tt-source-name' }, source),
                React.createElement(
                  'div',
                  { className: 'tt-source-meta' },
                  `${timeAgo(latest.published_at)} • ${articles.length} article${articles.length > 1 ? 's' : ''}`
                ),
                React.createElement(
                  'div',
                  { className: 'tt-source-title' },
                  latest.title || ''
                )
              ),
              latest.url ? React.createElement(
                'a',
                {
                  className: 'tt-source-link',
                  href: latest.url,
                  target: '_blank',
                  rel: 'noopener noreferrer',
                  'data-test': 'source-article'
                },
                'Read ↗'
              ) : React.createElement(
                'span',
                { className: 'tt-source-meta' },
                'No link'
              )
            );
          }),
          grouped.length > 0 && React.createElement(
            'div',
            { className: 'tt-modal-note' },
            'Showing latest link per source. Open to view full coverage.'
          )
        )
      )
    );
  }

  /**
   * StoryCard - Main card component for displaying a story
   */
  function StoryCard({ story, onShare }) {
    // GUARD: Ensure valid story object with ID
    if (!story || !story.id) {
      console.error('StoryCard: Invalid story object', story);
      return null;
    }

    const [expanded, setExpanded] = useState(false);
    const [showSources, setShowSources] = useState(false);
    const [articles, setArticles] = useState([]);
    const [loadingArticles, setLoadingArticles] = useState(false);
    const [articleError, setArticleError] = useState(null);

    const severity = SEVERITY_CONFIG[story.severity] || SEVERITY_CONFIG.moderate;
    const categoryLabel = CATEGORY_LABELS[story.category] || 'Other';

    // Use fetched articles (will be empty array until lazy-loaded)
    const safeArticles = articles;

    // Sort articles by published date (newest first) - NULL SAFE
    const sortedArticles = useMemo(() => {
      return [...safeArticles].sort((a, b) => 
        new Date(b?.published_at || 0) - new Date(a?.published_at || 0)
      );
    }, [safeArticles]);

    // Group articles by source name - NULL SAFE
    const groupedSources = useMemo(() => {
      const sourceMap = new Map();
      sortedArticles.forEach(article => {
        const sourceName = article?.source_name || 'Other';
        if (!sourceMap.has(sourceName)) {
          sourceMap.set(sourceName, []);
        }
        sourceMap.get(sourceName).push(article);
      });
      return Array.from(sourceMap.entries()).sort((a, b) => 
        a[0].localeCompare(b[0])
      );
    }, [sortedArticles]);

    const shareUrl = `${location.href.split('#')[0]}#${story.id}`;

    // Lazy-load articles when "View Sources" is clicked
    async function handleViewSources() {
      setShowSources(true);
      
      // Skip fetch if articles already loaded or currently loading
      if (articles.length > 0 || loadingArticles || !fetchStoryArticles) {
        return;
      }
      
      setLoadingArticles(true);
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
    }

    // HARDENED: Share with fallbacks for older browsers
    async function handleShare() {
      const url = shareUrl;
      const payload = { title: 'TrumpyTracker Story', text: story.primary_headline, url };
      
      // Try native share first
      if (navigator.share) {
        try {
          await navigator.share(payload);
          return;
        } catch (err) {
          // User cancelled or error - fall through to clipboard
        }
      }
      
      // Clipboard fallback
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
        } else {
          // Legacy copy method
          const textarea = document.createElement('textarea');
          textarea.value = url;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
        }
      } catch (err) {
        console.error('Share/copy failed:', err);
      }
    }

    return React.createElement(
      'section',
      {
        className: 'tt-card',
        style: { borderTop: `3px solid ${severity.ribbon}` },
        'aria-labelledby': `story-${story.id}-title`,
        'data-test': 'story-card'
      },
      React.createElement(
        'div',
        {
          className: 'tt-card-head',
          onClick: () => setExpanded(v => !v),
          role: 'button',
          'aria-expanded': expanded,
          tabIndex: 0,
          onKeyPress: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setExpanded(v => !v);
            }
          }
        },
        React.createElement(
          'div',
          { className: 'tt-card-headline' },
          React.createElement(
            'h2',
            { id: `story-${story.id}-title` },
            story.primary_headline
          ),
          React.createElement(
            'div',
            { className: 'tt-meta' },
            React.createElement(
              'span',
              { className: 'tt-badge', style: { background: severity.badge } },
              severity.label
            ),
            React.createElement('span', null, ` • ${categoryLabel}`),
            React.createElement('span', null, ` • ${story.source_count ?? 0} sources`),
            React.createElement(
              'span',
              { title: story.last_updated_at ? new Date(story.last_updated_at).toLocaleString() : '' },
              ` • Updated ${timeAgo(story.last_updated_at)}`
            ),
            story.status && React.createElement(
              'span',
              { className: 'tt-status' },
              story.status === 'active' ? 'Active' : 'Closed'
            )
          )
        ),
        React.createElement(
          'div',
          {
            className: `tt-chevron ${expanded ? 'rot' : ''}`,
            'aria-hidden': 'true'
          },
          '⌄'
        )
      ),

      React.createElement(
        'div',
        {
          className: `tt-card-body ${expanded ? 'open' : ''}`,
          id: `story-${story.id}-panel`
        },
        React.createElement(
          'p',
          { className: 'tt-summary' },
          story.summary_spicy || story.summary_neutral || story.primary_headline || 'No summary available.'
        ),

        React.createElement(
          'div',
          { className: 'tt-actions' },
          // CONDITIONAL: Disable "Read Original" when no articles
          sortedArticles.length === 0 ? (
            React.createElement(
              'button',
              {
                className: 'tt-btn tt-btn-primary',
                disabled: true
              },
              'No Article Available'
            )
          ) : (
            React.createElement(
              'a',
              {
                className: 'tt-btn tt-btn-primary',
                href: sortedArticles[0].url,
                target: '_blank',
                rel: 'noopener noreferrer'
              },
              'Read Original'
            )
          ),
          React.createElement(
            'button',
            {
              className: 'tt-btn',
              onClick: handleViewSources,
              'data-test': 'view-sources-btn',
              disabled: loadingArticles
            },
            loadingArticles ? 'Loading...' : `View Sources (${story.source_count ?? 0})`
          ),
          React.createElement(
            'button',
            {
              className: 'tt-btn',
              onClick: handleShare
            },
            'Share'
          )
        ),

        React.createElement(
          'div',
          { className: 'tt-receipts' },
          React.createElement('strong', null, 'Receipts:'),
          groupedSources.slice(0, 4).map(([name, articles]) =>
            React.createElement(
              'span',
              { key: name, className: 'tt-chip' },
              `${name} (${articles.length})`
            )
          ),
          groupedSources.length > 4 &&
            React.createElement(
              'span',
              { className: 'tt-more' },
              `+${groupedSources.length - 4} more`
            )
        )
      ),

      showSources &&
        React.createElement(SourcesModal, {
          story,
          grouped: groupedSources,
          onClose: () => setShowSources(false),
          error: articleError,
          onRetry: () => {
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
          }
        })
    );
  }

  // Export to window
  window.StoryComponents = Object.assign({}, window.StoryComponents || {}, {
    StoryCard
  });
})();
