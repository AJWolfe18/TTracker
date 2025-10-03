// Story Feed Component - Main feed container with pagination and state management

(function() {
  'use strict';
  
  const { useState, useEffect, useMemo } = React;
  const { StoryCard } = window.StoryComponents || {};
  const { fetchStories } = window.StoryAPI || {};

  if (!StoryCard) {
    console.error('StoryFeed: StoryComponents.StoryCard not found. Make sure story-card.js loads first.');
  }
  
  if (!fetchStories) {
    console.error('StoryFeed: StoryAPI.fetchStories not found. Make sure story-api.js loads first.');
  }

  function StoryFeed() {
    const [stories, setStories] = useState([]);
    const [page, setPage] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [hasMore, setHasMore] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);

    useEffect(() => {
      loadPage(0, true);
    }, []);

    async function loadPage(pageNum, reset = false) {
      try {
        if (reset) {
          setLoading(true);
        } else {
          setLoadingMore(true);
        }
        
        const batch = await fetchStories({ 
          offset: pageNum * 30, 
          limit: 30 
        });
        
        setStories(currentStories => reset ? batch : currentStories.concat(batch));
        setHasMore(batch.length === 30);
        setPage(pageNum);
        setError(null);
      } catch (err) {
        console.error('StoryFeed.loadPage error:', err);
        setError('Failed to load stories. Please try again.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    }

    function retry() {
      loadPage(page, page === 0);
    }

    function loadMore() {
      if (!loadingMore && hasMore) {
        loadPage(page + 1);
      }
    }

    const storyList = useMemo(() => stories, [stories]);

    if (loading && storyList.length === 0) {
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

      storyList.length === 0 && !loading && !error && React.createElement(
        'div',
        { className: 'tt-empty' },
        React.createElement('h3', null, 'No Stories Available'),
        React.createElement('p', null, 'Check back soon for updates on political accountability.')
      ),

      storyList.length > 0 && React.createElement(
        'div',
        { className: 'tt-grid' },
        storyList.map(story =>
          React.createElement(StoryCard, {
            key: story.id,
            story: story,
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

      storyList.length > 0 && (
        hasMore
          ? React.createElement(
              'div',
              { className: 'tt-load-more' },
              React.createElement(
                'button',
                {
                  className: 'tt-btn tt-btn-primary',
                  onClick: loadMore,
                  disabled: loadingMore
                },
                loadingMore ? 'Loading…' : 'Load More Stories'
              )
            )
          : React.createElement(
              'div',
              { className: 'tt-end' },
              'End of feed'
            )
      )
    );
  }

  window.StoryComponents = Object.assign({}, window.StoryComponents || {}, {
    StoryFeed
  });
})();
