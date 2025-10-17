// Executive Order Detail Page Component
// Displays full 4-part editorial analysis for a single EO

(function() {
  'use strict';

  // Check dependencies
  if (!window.React || !window.ReactDOM) {
    console.error('EO Detail: React not loaded');
    return;
  }

  if (!window.DashboardUtils) {
    console.error('EO Detail: DashboardUtils module required');
    return;
  }

  const { useState, useEffect } = React;
  const { formatDate, supabaseRequest } = window.DashboardUtils;

  // ==================== Utility Functions ====================

  /**
   * Parse URL parameters to get EO ID or order number
   * Supports: ?id=3 or ?order=14333
   */
  const parseURLParams = () => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const orderNumber = params.get('order');
    return { id: id ? parseInt(id, 10) : null, orderNumber };
  };

  /**
   * Map severity to color classes
   */
  const getSeverityColors = (severity) => {
    const colorMap = {
      'critical': {
        badge: 'bg-red-600 text-white',
        ring: 'ring-red-500'
      },
      'severe': {
        badge: 'bg-orange-600 text-white',
        ring: 'ring-orange-500'
      },
      'moderate': {
        badge: 'bg-yellow-600 text-white',
        ring: 'ring-yellow-500'
      },
      'minor': {
        badge: 'bg-gray-600 text-white',
        ring: 'ring-gray-500'
      }
    };
    return colorMap[severity?.toLowerCase()] || { badge: 'bg-gray-600 text-white', ring: 'ring-gray-500' };
  };

  /**
   * Map severity to spicy display labels (matches stories)
   */
  const getSeverityLabel = (severity) => {
    const labelMap = {
      'critical': 'Fucking Treason',
      'severe': 'Criminal Bullshit',
      'moderate': 'Swamp Shit',
      'minor': 'Clown Show'
    };
    return labelMap[severity?.toLowerCase()] || severity;
  };

  /**
   * Map category enum to display label
   */
  const getCategoryLabel = (category) => {
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
    return categoryMap[category] || category;
  };

  /**
   * Get action type icon
   */
  const getActionIcon = (type) => {
    const iconMap = {
      'support': '💰',
      'call': '📞',
      'legal': '⚖️',
      'vote': '🗳️',
      'organize': '📢'
    };
    return iconMap[type] || '📌';
  };

  /**
   * Validate action URL (only show actions with valid URLs or phone numbers)
   */
  const isValidActionURL = (url) => {
    if (!url) return false;
    // Check for valid http/https URL or tel: link
    return url.startsWith('http') || url.startsWith('tel:') || url.startsWith('mailto:');
  };

  /**
   * Update Open Graph meta tags dynamically
   */
  const updateMetaTags = (order) => {
    if (!order) return;

    const title = `EO ${order.order_number}: ${order.title}`;
    const description = order.section_what_it_means?.substring(0, 200) || '';
    const url = window.location.href;

    document.title = title;
    document.getElementById('page-title').textContent = title;
    document.getElementById('og-title')?.setAttribute('content', title);
    document.getElementById('og-desc')?.setAttribute('content', description);
    document.getElementById('og-url')?.setAttribute('content', url);
    document.getElementById('canonical')?.setAttribute('href', `/executive-orders/${order.order_number}`);
  };

  // ==================== Main Component ====================

  const EODetailPage = () => {
    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Fetch EO data on mount
    useEffect(() => {
      const fetchEO = async () => {
        try {
          const { id, orderNumber } = parseURLParams();

          if (!id && !orderNumber) {
            setError('No executive order specified. Please provide an ID or order number.');
            setLoading(false);
            return;
          }

          // Build query based on available parameter
          let query = 'executive_orders?select=*&limit=1';
          if (id) {
            query += `&id=eq.${id}`;
          } else if (orderNumber) {
            query += `&order_number=eq.${orderNumber}`;
          }

          const data = await supabaseRequest(query, 'GET', null, false);

          if (!data || data.length === 0) {
            setError('Executive order not found. Please check the ID or order number.');
            setLoading(false);
            return;
          }

          const eoData = data[0];
          setOrder(eoData);
          updateMetaTags(eoData);
          setLoading(false);
        } catch (err) {
          console.error('Failed to fetch EO:', err);
          setError('Failed to load executive order. Please try again later.');
          setLoading(false);
        }
      };

      fetchEO();
    }, []);

    // Add Escape key handler to close detail page
    useEffect(() => {
      const handleEscapeKey = (event) => {
        if (event.key === 'Escape') {
          handleBack();
        }
      };

      document.addEventListener('keydown', handleEscapeKey);

      // Cleanup on unmount
      return () => {
        document.removeEventListener('keydown', handleEscapeKey);
      };
    }, []);

    // Handle share functionality
    const handleShare = async () => {
      if (!order) return;

      const shareData = {
        title: `EO ${order.order_number}: ${order.title}`,
        text: order.section_what_it_means?.substring(0, 200) || '',
        url: window.location.href
      };

      // Try Web Share API first
      if (navigator.share) {
        try {
          await navigator.share(shareData);
          return;
        } catch (err) {
          // User cancelled or error - fall through to clipboard
          if (err.name !== 'AbortError') {
            console.warn('Share failed:', err);
          }
        }
      }

      // Fallback: Copy URL to clipboard
      try {
        await navigator.clipboard.writeText(window.location.href);
        alert('Link copied to clipboard!');
      } catch (err) {
        console.error('Failed to copy:', err);
        alert('Failed to share. Please copy the URL manually.');
      }
    };

    // Handle back button
    const handleBack = () => {
      // Try browser history first
      if (window.history.length > 1) {
        window.history.back();
        return;
      }

      // Fallback: Check sessionStorage for return URL
      const returnTo = sessionStorage.getItem('eoReturnTo');
      if (returnTo) {
        window.location.href = returnTo;
        return;
      }

      // Final fallback: Go to EO list page
      window.location.href = '/executive-orders.html';
    };

    // ==================== Loading State ====================
    if (loading) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
            <p className="text-gray-400">Loading executive order...</p>
          </div>
        </div>
      );
    }

    // ==================== Error State ====================
    if (error || !order) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center max-w-md fade-in">
            <div className="text-6xl mb-4">⚠️</div>
            <h1 className="text-2xl font-bold text-white mb-4">Executive Order Not Found</h1>
            <p className="text-gray-400 mb-6">{error || 'This executive order does not exist.'}</p>
            <button
              onClick={handleBack}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg transition-colors"
            >
              ← Go Back
            </button>
          </div>
        </div>
      );
    }

    const severityColors = getSeverityColors(order.severity);
    const hasEnrichedData = !!order.enriched_at;

    // ==================== Render Detail Page ====================
    return (
      <div className="fade-in">
        {/* Breadcrumb Navigation */}
        <nav aria-label="Breadcrumb" className="mb-6">
          <ol className="flex items-center space-x-2 text-sm text-gray-400">
            <li>
              <a
                href="/executive-orders.html"
                className="hover:text-white transition-colors"
              >
                Executive Orders
              </a>
            </li>
            <li>
              <span className="text-gray-600">→</span>
            </li>
            <li className="text-gray-300">
              EO {order.order_number}
            </li>
          </ol>
        </nav>

        {/* Main Content Card */}
        <article className={`bg-gray-800/50 backdrop-blur-md rounded-lg border-2 ${severityColors.ring} shadow-xl`}>
          {/* Header Section */}
          <header className="relative p-6 border-b border-gray-700">
            {/* EO Badge & Title */}
            <div className="mb-4">
              <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold mb-3 ${severityColors.badge}`}>
                EO {order.order_number}
              </span>
              <h1 className="text-3xl font-bold text-white leading-tight">
                {order.title}
              </h1>
            </div>

            {/* Metadata Pills */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {order.category && (
                <span className="px-3 py-1 bg-blue-600/20 text-blue-400 rounded-full text-xs font-medium">
                  {getCategoryLabel(order.category)}
                </span>
              )}
              {order.severity && (
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${severityColors.badge}`}>
                  {getSeverityLabel(order.severity)}
                </span>
              )}
              {order.date && (
                <span className="px-3 py-1 bg-gray-700 text-gray-300 rounded-full text-xs font-medium">
                  Signed {formatDate(order.date)}
                </span>
              )}
              {order.affected_agencies && order.affected_agencies.length > 0 && (
                <span className="px-3 py-1 bg-gray-700 text-gray-300 rounded-full text-xs font-medium">
                  Agencies: {order.affected_agencies.slice(0, 3).join(', ')}
                </span>
              )}
              {order.source_url && (
                <span className="px-3 py-1 bg-gray-700 text-gray-300 rounded-full text-xs font-medium">
                  Source:{' '}
                  <a
                    href={order.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    WhiteHouse.gov
                  </a>
                </span>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleShare}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Share
              </button>
              {order.source_url && (
                <a
                  href={order.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  View Official Order
                </a>
              )}
            </div>

            {/* Close Button (X in top right) */}
            <button
              onClick={handleBack}
              className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-gray-800/50 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
              aria-label="Close"
            >
              <span className="text-2xl leading-none">×</span>
            </button>
          </header>

          {/* Body - 4-Part Analysis (All Fully Visible) */}
          <div className="p-6 space-y-8">
            {hasEnrichedData ? (
              <>
                {/* Section 1: What They Say */}
                {order.section_what_they_say && (
                  <section>
                    <h2 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
                      <span>📜</span>
                      What They Say
                    </h2>
                    <p className="text-gray-300 leading-relaxed whitespace-pre-wrap">
                      {order.section_what_they_say}
                    </p>
                  </section>
                )}

                {/* Section 2: What It Actually Means */}
                {order.section_what_it_means && (
                  <section>
                    <h2 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
                      <span>🔍</span>
                      What It Actually Means
                    </h2>
                    <p className="text-gray-300 leading-relaxed whitespace-pre-wrap">
                      {order.section_what_it_means}
                    </p>
                  </section>
                )}

                {/* Section 3: Reality Check */}
                {order.section_reality_check && (
                  <section>
                    <h2 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
                      <span>✅</span>
                      Reality Check
                    </h2>
                    <p className="text-gray-300 leading-relaxed whitespace-pre-wrap">
                      {order.section_reality_check}
                    </p>
                  </section>
                )}

                {/* Section 4: Why This Matters */}
                {order.section_why_it_matters && (
                  <section>
                    <h2 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
                      <span>⚠️</span>
                      Why This Matters
                    </h2>
                    <p className="text-gray-300 leading-relaxed whitespace-pre-wrap">
                      {order.section_why_it_matters}
                    </p>
                  </section>
                )}

                {/* Action Section (Tier-Aware) */}
                {order.action_tier !== 'tracking' && order.action_section && order.action_section.actions && order.action_section.actions.length > 0 ? (
                  <section className="bg-gray-900/50 rounded-lg p-6 border border-gray-700">
                    <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                      <span>💪</span>
                      {order.action_section.title || 'What We Can Do'}
                    </h2>
                    <ul className="space-y-4">
                      {order.action_section.actions
                        .filter(action => isValidActionURL(action.url))
                        .map((action, idx) => (
                          <li key={idx} className="flex items-start gap-3">
                            <span className="text-2xl flex-shrink-0">{getActionIcon(action.type)}</span>
                            <div className="flex-1">
                              <p className="text-gray-300 mb-1">{action.description}</p>
                              {action.url && (
                                <a
                                  href={action.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-400 hover:text-blue-300 text-sm font-medium transition-colors"
                                >
                                  Take Action →
                                </a>
                              )}
                              {action.deadline && (
                                <p className="text-gray-500 text-xs mt-1">Deadline: {action.deadline}</p>
                              )}
                            </div>
                          </li>
                        ))}
                    </ul>
                  </section>
                ) : order.action_tier === 'tracking' ? (
                  <section className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
                    <p className="text-gray-400 text-sm text-center">
                      🔍 <strong>Tracking only</strong> — no direct actions right now.
                    </p>
                  </section>
                ) : null}
              </>
            ) : (
              /* Non-enriched fallback */
              <section className="text-center py-12">
                <p className="text-gray-400 text-lg">
                  AI enrichment coming soon for this executive order.
                </p>
                <p className="text-gray-500 text-sm mt-2">
                  Check back later for the full 4-part analysis.
                </p>
              </section>
            )}
          </div>
        </article>
      </div>
    );
  };

  // ==================== Render App ====================
  const root = document.getElementById('eo-root');
  if (root) {
    ReactDOM.render(<EODetailPage />, root);
  } else {
    console.error('EO Detail: Root element not found');
  }

})();
