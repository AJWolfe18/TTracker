// TrumpyTracker Dashboard Components Module
// Extracted UI components for better maintainability and organization

// Module initialization with error boundary
(function() {
  'use strict';
  
  // Check dependencies
  if (!window.React) {
    console.error('Dashboard Components: React not loaded');
    return;
  }
  
  if (!window.DashboardUtils) {
    console.error('Dashboard Components: DashboardUtils module required');
    return;
  }
  
  const { useState, useEffect, useCallback, useMemo, useRef } = React;
  const { formatDate } = window.DashboardUtils;
  
  // Create global namespace for components
  window.DashboardComponents = window.DashboardComponents || {};
  
  // ==================== Component: ConstructionBanner ====================
  window.DashboardComponents.ConstructionBanner = () => (
    <div className="bg-gradient-to-r from-yellow-600 to-orange-600 border-l-4 border-yellow-500 p-2 mb-4 shadow-lg">
      <div className="flex items-center justify-center">
        <div className="flex items-center space-x-3">
          <div className="text-xl animate-bounce">🚧</div>
          <div className="text-center">
            <p className="text-yellow-100 font-semibold text-base">
              🔨 Site Under Construction
            </p>
            <p className="text-yellow-200 text-xs">
              We're actively building new features. Have feedback? Contact us at: 
              <a href="mailto:contact.trumpytracker@gmail.com" className="text-white font-semibold underline hover:text-yellow-100 ml-1">
                contact.trumpytracker@gmail.com
              </a>
            </p>
          </div>
          <div className="text-xl animate-bounce" style={{animationDelay: '0.5s'}}>🚧</div>
        </div>
      </div>
    </div>
  );

  // ==================== Component: ContentModal ====================
  window.DashboardComponents.ContentModal = ({ isOpen, onClose, title, date, content, severity, category, sourceUrl, actor, orderNumber }) => {
    // Memoize the escape handler to prevent recreating on every render
    const handleEscape = useCallback((e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    }, [isOpen, onClose]);
    
    // Handle escape key with proper cleanup
    useEffect(() => {
      if (!isOpen) return;
      
      document.addEventListener('keydown', handleEscape);
      // Properly clean up event listener to prevent memory leaks
      return () => document.removeEventListener('keydown', handleEscape);
    }, [isOpen, handleEscape]);
    
    if (!isOpen) return null;
    
    // Get severity badge color - all with white text
    const getSeverityColor = (severity) => {
      switch (severity?.toLowerCase()) {
        case 'critical':
          return 'bg-red-600 text-white';
        case 'high':
          return 'bg-red-500 text-white';
        case 'medium':
          return 'bg-yellow-500 text-white';
        case 'low':
          return 'bg-green-500 text-white';
        default:
          return 'bg-gray-500 text-white';
      }
    };
    
    return (
      <div 
        className="fixed inset-0 bg-black bg-opacity-75 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div 
          className="bg-gray-800 rounded-lg max-w-3xl w-full"
          style={{
            maxHeight: window.innerWidth < 768 && window.innerHeight < window.innerWidth ? '80vh' : '90vh',
            overflowY: 'auto'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div className="sticky top-0 bg-gray-800 border-b border-gray-700 p-6 pb-4">
            <div className="flex justify-between items-start">
              <div className="flex-1 pr-4">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-gray-400 text-sm">{formatDate(date)}</span>
                  {orderNumber && (
                    <span className="bg-blue-600 text-white px-2 py-1 rounded text-xs font-medium">
                      EO {orderNumber}
                    </span>
                  )}
                  {severity && (
                    <span className={`px-2 py-1 rounded text-xs font-medium ${getSeverityColor(severity)}`}>
                      {severity.toUpperCase()}
                    </span>
                  )}
                </div>
                <h2 className="text-xl font-bold text-white">{title}</h2>
                {actor && (
                  <p className="text-blue-400 text-sm mt-1">Actor: {actor}</p>
                )}
              </div>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-white transition-colors text-2xl leading-none p-1"
                aria-label="Close modal"
              >
                ×
              </button>
            </div>
          </div>
          
          {/* Modal Content */}
          <div className="p-6">
            <div className="text-gray-300 whitespace-pre-wrap mb-6">
              {content}
            </div>
            
            {/* Footer with metadata */}
            <div className="flex justify-between items-center pt-4 border-t border-gray-700">
              {category && (
                <span className="text-orange-400 text-xs bg-orange-900/30 px-2 py-1 rounded">
                  {category}
                </span>
              )}
              {sourceUrl && (
                <a 
                  href={sourceUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 text-sm font-medium transition-colors"
                >
                  View Source →
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ==================== Component: PaginationControls ====================
  window.DashboardComponents.PaginationControls = ({ currentPage, totalPages, onPageChange }) => {
    if (totalPages <= 1) return null;
    
    return (
      <div className="flex justify-center items-center gap-2 mt-8">
        <button
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          className={`px-3 py-1 rounded ${
            currentPage === 1 
              ? 'bg-gray-700 text-gray-500 cursor-not-allowed' 
              : 'bg-gray-800 text-white hover:bg-gray-700'
          }`}
        >
          First
        </button>
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className={`px-3 py-1 rounded ${
            currentPage === 1 
              ? 'bg-gray-700 text-gray-500 cursor-not-allowed' 
              : 'bg-gray-800 text-white hover:bg-gray-700'
          }`}
        >
          Previous
        </button>
        <span className="text-gray-400 px-4">
          Page {currentPage} of {totalPages}
        </span>
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className={`px-3 py-1 rounded ${
            currentPage === totalPages 
              ? 'bg-gray-700 text-gray-500 cursor-not-allowed' 
              : 'bg-gray-800 text-white hover:bg-gray-700'
          }`}
        >
          Next
        </button>
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          className={`px-3 py-1 rounded ${
            currentPage === totalPages 
              ? 'bg-gray-700 text-gray-500 cursor-not-allowed' 
              : 'bg-gray-800 text-white hover:bg-gray-700'
          }`}
        >
          Last
        </button>
      </div>
    );
  };

  // ==================== Component: NoResultsMessage ====================
  window.DashboardComponents.NoResultsMessage = ({ searchTerm }) => {
    return (
      <div className="text-center py-12 px-4 transition-opacity duration-300 opacity-100">
        <div className="max-w-md mx-auto">
          <div className="text-6xl mb-4">🔍</div>
          <h3 className="text-xl font-semibold text-gray-300 mb-2">
            No results found
          </h3>
          <p className="text-gray-400">
            {searchTerm ? 
              `No entries match "${searchTerm}" with your current filters` :
              'No entries match your current filter combination'
            }
          </p>
        </div>
      </div>
    );
  };

  // ==================== Component: PoliticalEntryCard ====================
  window.DashboardComponents.PoliticalEntryCard = ({ entry, index = 0, showShareButtons = false }) => {
    const [expanded, setExpanded] = useState(false);
    const hasSpicySummary = !!entry.spicy_summary;
    const displaySummary = entry.spicy_summary || entry.description;
    const hasLongSummary = displaySummary?.length > 200;
    
    // Extract source domain from URL
    const getSourceName = (url) => {
      if (!url) return null;
      try {
        const domain = new URL(url).hostname.replace('www.', '');
        const sourceMap = {
          'cnn.com': 'CNN',
          'reuters.com': 'Reuters',
          'apnews.com': 'AP News',
          'nytimes.com': 'NY Times',
          'washingtonpost.com': 'Washington Post',
          'politico.com': 'Politico',
          'theguardian.com': 'The Guardian',
          'foxnews.com': 'Fox News',
          'nbcnews.com': 'NBC News',
          'cbsnews.com': 'CBS News',
          'axios.com': 'Axios',
          'bloomberg.com': 'Bloomberg',
          'wsj.com': 'WSJ',
          'usatoday.com': 'USA Today',
          'thehill.com': 'The Hill'
        };
        return sourceMap[domain] || domain.split('.')[0].toUpperCase();
      } catch {
        return 'Source';
      }
    };
    
    // Get clean severity label (without emoji since we're using colored pills)
    const getSeverityLabel = () => {
      // Map severity to spicy labels WITHOUT emojis
      const severityMap = {
        'critical': 'Fucking Treason',
        'high': 'Criminal Bullshit',
        'medium': 'Swamp Shit',
        'low': 'Clown Show'
      };
      
      // Always use the mapped label, ignore severity_label_inapp which has emojis
      return severityMap[entry.severity?.toLowerCase()] || '';
    };
    
    // Share functions
    const shareToX = () => {
      const text = entry.shareable_hook || displaySummary?.substring(0, 200) || '';
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
    };
    
    const shareToFacebook = () => {
      const text = entry.shareable_hook || '';
      window.open(`https://www.facebook.com/sharer/sharer.php?quote=${encodeURIComponent(text)}`, '_blank');
    };
    
    return (
      <div className="bg-gray-800/50 backdrop-blur-md rounded-lg p-6 border border-gray-700 hover:border-gray-600 transition-all duration-200 hover:shadow-xl" style={{
        animation: index < 10 ? 'fadeIn 0.4s ease-in-out' : 'none',
        animationDelay: index < 10 ? `${index * 0.05}s` : '0s'
      }}>
        
        {/* Title First */}
        <h3 className="text-lg font-bold text-white mb-3">{entry.title}</h3>
        
        {/* Metadata Line */}
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-3">
          {entry.actor && <span>{entry.actor}</span>}
          {entry.actor && entry.date && <span>•</span>}
          <span>{formatDate(entry.date)}</span>
          {entry.source_url && (
            <>
              <span>•</span>
              <a 
                href={entry.source_url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300"
              >
                {getSourceName(entry.source_url)}
              </a>
            </>
          )}
        </div>
        
        {/* Spicy Summary */}
        {displaySummary && (
          <div className="mb-4">
            <p 
              className="text-gray-100 leading-relaxed transition-all duration-300"
              style={!expanded ? {
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              } : {}}
            >
              {displaySummary}
            </p>
            {hasLongSummary && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-blue-400 hover:text-blue-300 text-sm mt-2 transition-colors"
              >
                {expanded ? 'Show less ↑' : 'Read more →'}
              </button>
            )}
          </div>
        )}
        
        {/* Shareable Hook as Pullquote - HIDDEN for now, will show on share action */}
        {/* entry.shareable_hook && hasSpicySummary && (
          <div className="bg-gray-900/30 border-l-4 border-gray-600 pl-4 py-2 mb-4">
            <p className="text-gray-300 text-sm italic">
              "{entry.shareable_hook}"
            </p>
          </div>
        ) */}
        
        {/* Bottom Actions Bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Severity Badge */}
            {hasSpicySummary && getSeverityLabel() && (
              <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                entry.severity?.toLowerCase() === 'critical' ? 'bg-red-600' :
                entry.severity?.toLowerCase() === 'high' ? 'bg-orange-600' :
                entry.severity?.toLowerCase() === 'medium' ? 'bg-yellow-600 text-white' :
                entry.severity?.toLowerCase() === 'low' ? 'bg-green-600' :
                'bg-gray-700'
              } text-white`}>
                {getSeverityLabel()}
              </span>
            )}
            
            {/* Category */}
            {entry.category && (
              <span className="text-xs text-gray-500">
                {window.CategoryConfig?.formatCategoryDisplay ? 
                  window.CategoryConfig.formatCategoryDisplay(entry.category) : 
                  entry.category}
              </span>
            )}
          </div>
          
          {/* Share Icons - Configurable via prop */}
          {showShareButtons && hasSpicySummary && (
            <div className="flex gap-2">
              <button
                onClick={shareToX}
                aria-label="Share on X"
                className="text-gray-400 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
              </button>
              <button
                onClick={shareToFacebook}
                aria-label="Share on Facebook"
                className="text-gray-400 hover:text-blue-500 transition-colors"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ==================== Component: ExecutiveOrderCard ====================
  window.DashboardComponents.ExecutiveOrderCard = ({ order, index = 0, showShareButtons = false }) => {
    const [expanded, setExpanded] = useState(false);

    // Check if this EO has enriched data (TTRC-219 backfill)
    const hasEnrichedData = !!order.enriched_at;

    // Use "What It Means" section as high-level summary (best overview for dashboard)
    const summary = order.section_what_it_means || '';
    const hasLongSummary = summary?.length > 300;

    // Map category enum to display label
    const getCategoryLabel = () => {
      const categoryMap = {
        'immigration_border': 'Immigration & Border',
        'economy_jobs_taxes': 'Economy, Jobs & Taxes',
        'environment_energy': 'Environment & Energy',
        'justice_civil_rights_voting': 'Justice & Civil Rights',
        'health_care': 'Health Care',
        'education': 'Education',
        'natsec_foreign': 'National Security & Foreign Policy',
        'gov_ops_workforce': 'Government Operations',
        'technology_data_privacy': 'Technology & Data Privacy',
        'infra_housing_transport': 'Infrastructure & Housing'
      };
      return categoryMap[order.category] || order.category;
    };

    // Map action tier to display label with color
    const getActionTierInfo = () => {
      const tierMap = {
        'direct': { label: 'Direct Action', color: 'bg-red-600' },
        'systemic': { label: 'Systemic Change', color: 'bg-orange-600' },
        'tracking': { label: 'Tracking Only', color: 'bg-blue-600' }
      };
      return tierMap[order.action_tier] || { label: order.action_tier, color: 'bg-gray-700' };
    };

    // Navigate to detail page
    const handleCardClick = () => {
      // Store return URL for back button
      sessionStorage.setItem('eoReturnTo', window.location.pathname);
      window.location.href = `/eo-detail.html?id=${order.id}`;
    };

    // Share functions
    const shareToX = () => {
      const text = `Executive Order ${order.order_number}: ${order.title}\n\n${summary.substring(0, 200)}...\n\nLearn more at TrumpyTracker.com`;
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
    };

    const shareToFacebook = () => {
      const text = `Executive Order ${order.order_number}: ${order.title}`;
      window.open(`https://www.facebook.com/sharer/sharer.php?quote=${encodeURIComponent(text)}`, '_blank');
    };

    return (
      <div
        className="bg-gray-800/50 backdrop-blur-md rounded-lg p-6 border border-gray-700 hover:border-blue-500 transition-all duration-200 hover:shadow-xl cursor-pointer"
        style={{
          animation: index < 10 ? 'fadeIn 0.4s ease-in-out' : 'none',
          animationDelay: index < 10 ? `${index * 0.05}s` : '0s'
        }}
        onClick={handleCardClick}
      >

        {/* Title */}
        <h3 className="text-lg font-bold text-white mb-3">{order.title}</h3>

        {/* Metadata Line */}
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-3">
          <span className="font-medium">EO {order.order_number}</span>
          <span>•</span>
          <span>{formatDate(order.date)}</span>
          <span>•</span>
          <a
            href={order.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300"
            onClick={(e) => e.stopPropagation()}
          >
            WhiteHouse.gov
          </a>
        </div>

        {/* High-Level Summary */}
        {hasEnrichedData && summary ? (
          <div className="mb-4">
            <p
              className="text-gray-100 leading-relaxed transition-all duration-300"
              style={!expanded && hasLongSummary ? {
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              } : {}}
            >
              {summary}
            </p>
            {hasLongSummary && !expanded && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCardClick();
                }}
                className="text-blue-400 hover:text-blue-300 text-sm mt-2 transition-colors font-medium"
              >
                View Full Analysis →
              </button>
            )}
            {hasLongSummary && expanded && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded(false);
                }}
                className="text-blue-400 hover:text-blue-300 text-sm mt-2 transition-colors"
              >
                Show less ↑
              </button>
            )}
          </div>
        ) : (
          /* Non-enriched fallback */
          <div className="mb-4">
            <p className="text-gray-300 text-sm italic">
              AI enrichment coming soon for this executive order.
            </p>
          </div>
        )}

        {/* Bottom Metadata & Actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Action Tier Badge */}
            {hasEnrichedData && order.action_tier && (
              <span className={`px-3 py-1 rounded-full text-xs font-bold text-white ${getActionTierInfo().color}`}>
                {getActionTierInfo().label}
              </span>
            )}

            {/* Category */}
            {hasEnrichedData && order.category && (
              <span className="text-xs text-gray-400 bg-gray-700/50 px-2 py-1 rounded">
                {getCategoryLabel()}
              </span>
            )}
          </div>

          {/* Share Icons - Only show for enriched EOs */}
          {showShareButtons && hasEnrichedData && (
            <div className="flex gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  shareToX();
                }}
                aria-label="Share on X"
                className="text-gray-400 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  shareToFacebook();
                }}
                aria-label="Share on Facebook"
                className="text-gray-400 hover:text-blue-500 transition-colors"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ==================== Component: TabNavigation ====================
  window.DashboardComponents.TabNavigation = ({ activeTab, onTabChange, counts }) => {
    const tabs = [
      { id: 'stories', label: 'Stories', color: 'red' },
      // { id: 'political', label: 'Political Entries', color: 'orange' }, // HIDDEN - Old system being migrated
      { id: 'executive', label: 'Executive Orders', color: 'blue' }
    ];

    const handleKeyDown = (e, tabId) => {
      const currentIndex = tabs.findIndex(t => t.id === tabId);
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const nextIndex = (currentIndex + 1) % tabs.length;
        onTabChange(tabs[nextIndex].id);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        onTabChange(tabs[prevIndex].id);
      }
    };

    return (
      <div className="flex justify-center mb-8">
        <div 
          className="bg-gray-800/50 backdrop-blur-md rounded-lg p-1 border border-gray-700"
          role="tablist"
          aria-label="Content sections"
        >
          {tabs.map(tab => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`panel-${tab.id}`}
              id={`tab-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => onTabChange(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, tab.id)}
              className={`px-6 py-2 rounded-md font-medium transition-all duration-200 ${
                activeTab === tab.id
                  ? `bg-${tab.color}-600 text-white shadow-lg`
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              {tab.label}
              {/* Only show count for stories tab */}
              {tab.id === 'stories' && counts?.[tab.id] && (
                <span className="ml-2 text-xs bg-gray-900/50 px-2 py-0.5 rounded">
                  {counts[tab.id]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  };

  // ==================== Component: LoadingOverlay ====================
  window.DashboardComponents.LoadingOverlay = ({ message = 'Applying filters...' }) => {
    return (
      <div 
        className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 flex items-center justify-center pointer-events-none"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="bg-gray-800/90 rounded-lg px-6 py-4 flex items-center space-x-3 shadow-2xl">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" aria-hidden="true"></div>
          <span className="text-white font-medium">{message}</span>
          <span className="sr-only">{message}</span>
        </div>
      </div>
    );
  };

  // ==================== Helper: Filter Pill Button Class ====================
  const getFilterPillClass = (isSelected) => {
    return `px-3 py-1 rounded-full text-xs font-medium transition-all ${
      isSelected
        ? 'bg-blue-600 text-white'
        : 'bg-white text-gray-800 border border-gray-300 hover:border-blue-500'
    }`;
  };

  // ==================== Component: TabSearchFilter ====================
  window.DashboardComponents.TabSearchFilter = ({
    searchTerm,
    onSearchChange,
    selectedFilter,
    onFilterChange,
    filterConfig,
    placeholder = 'Search...'
  }) => {
    return React.createElement(
      'div',
      { className: 'mb-4' },

      // Search Bar
      React.createElement(
        'div',
        { className: 'mb-3' },
        React.createElement('input', {
          type: 'text',
          placeholder: placeholder,
          value: searchTerm,
          onChange: (e) => onSearchChange(e.target.value),
          className: 'w-full md:w-96 px-6 py-2 bg-white text-gray-800 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all'
        })
      ),

      // Filter Pills
      React.createElement(
        'div',
        { className: 'flex items-center gap-3 flex-wrap' },

        // "All" button
        React.createElement(
          'button',
          {
            onClick: () => onFilterChange('all'),
            className: getFilterPillClass(selectedFilter === 'all')
          },
          filterConfig.allLabel
        ),

        // Individual filter buttons
        filterConfig.filters.map(filter =>
          React.createElement(
            'button',
            {
              key: filter.value,
              onClick: () => onFilterChange(filter.value),
              className: getFilterPillClass(selectedFilter === filter.value)
            },
            filter.label
          )
        )
      )
    );
  };

  // ==================== Helper: Get Severity Color ====================
  window.DashboardComponents.getSeverityColor = (severity) => {
    switch (severity?.toLowerCase()) {
      case 'critical':
        return 'bg-red-600 text-white';
      case 'high':
        return 'bg-red-500 text-white';
      case 'medium':
        return 'bg-yellow-500 text-white';
      case 'low':
        return 'bg-green-500 text-white';
      default:
        return 'bg-gray-500 text-white';
    }
  };

  // Log successful module load
  console.log('Dashboard Components Module loaded successfully');
  
})();