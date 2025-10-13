// TrumpyTracker - Executive Orders Page
// Dedicated page for browsing and filtering executive orders

(function() {
  'use strict';

  // Check dependencies
  if (!window.React) {
    console.error('EO Page: React not loaded');
    return;
  }

  if (!window.DashboardUtils) {
    console.error('EO Page: DashboardUtils module required');
    return;
  }

  if (!window.DashboardComponents) {
    console.error('EO Page: DashboardComponents module required');
    return;
  }

  const { useState, useEffect, useCallback, useMemo, useRef } = React;
  const { supabaseRequest, formatDate } = window.DashboardUtils;
  const {
    ExecutiveOrderCard,
    PaginationControls,
    NoResultsMessage,
    LoadingOverlay
  } = window.DashboardComponents;

  // Configuration
  const ITEMS_PER_PAGE = 20;

  // EO Category mapping (from actual database schema)
  const EO_CATEGORIES = [
    { value: 'immigration_border', label: 'Immigration & Border' },
    { value: 'economy_jobs_taxes', label: 'Economy, Jobs & Taxes' },
    { value: 'environment_energy', label: 'Environment & Energy' },
    { value: 'justice_civil_rights_voting', label: 'Justice & Civil Rights' },
    { value: 'health_care', label: 'Health Care' },
    { value: 'education', label: 'Education' },
    { value: 'natsec_foreign', label: 'National Security & Foreign Policy' },
    { value: 'gov_ops_workforce', label: 'Government Operations' },
    { value: 'technology_data_privacy', label: 'Technology & Data Privacy' },
    { value: 'infra_housing_transport', label: 'Infrastructure & Housing' }
  ];

  // Action tier options
  const ACTION_TIERS = [
    { value: 'direct', label: 'Direct Action' },
    { value: 'systemic', label: 'Systemic Change' },
    { value: 'tracking', label: 'Tracking Only' }
  ];

  // Main Executive Orders Page Component
  const ExecutiveOrdersPage = () => {
    // State management
    const [allExecutiveOrders, setAllExecutiveOrders] = useState([]);
    const [displayedOrders, setDisplayedOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isFiltering, setIsFiltering] = useState(false);

    // Filter state
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [selectedActionTier, setSelectedActionTier] = useState('all');
    const [dateRange, setDateRange] = useState('all'); // all, last_30, last_60, last_90
    const [showEnrichedOnly, setShowEnrichedOnly] = useState(true);

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);

    // Debounce ref for search
    const searchDebounceRef = useRef(null);

    // Load executive orders on mount
    const loadExecutiveOrders = useCallback(async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch all executive orders (ordered by date)
        const query = 'executive_orders?order=date.desc,order_number.desc';
        const data = await supabaseRequest(query);

        if (data) {
          setAllExecutiveOrders(data);
        } else {
          setAllExecutiveOrders([]);
        }
      } catch (err) {
        console.error('Error loading executive orders:', err);
        setError('Failed to load executive orders. Please refresh the page.');
      } finally {
        setLoading(false);
      }
    }, []);

    // Apply all filters to data
    const applyFilters = useCallback((data) => {
      let filtered = [...data];

      // 1. Filter by enrichment status
      if (showEnrichedOnly) {
        filtered = filtered.filter(eo => eo.enriched_at !== null);
      }

      // 2. Search filter (searches across multiple fields)
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        filtered = filtered.filter(eo =>
          eo.title?.toLowerCase().includes(term) ||
          eo.order_number?.toString().includes(term) ||
          eo.section_what_it_means?.toLowerCase().includes(term) ||
          eo.section_what_they_say?.toLowerCase().includes(term) ||
          eo.section_reality_check?.toLowerCase().includes(term) ||
          eo.section_why_it_matters?.toLowerCase().includes(term)
        );
      }

      // 3. Category filter
      if (selectedCategory !== 'all') {
        filtered = filtered.filter(eo => eo.category === selectedCategory);
      }

      // 4. Action tier filter
      if (selectedActionTier !== 'all') {
        filtered = filtered.filter(eo => eo.action_tier === selectedActionTier);
      }

      // 5. Date range filter
      if (dateRange !== 'all') {
        const now = new Date();
        const cutoffDate = new Date();

        switch (dateRange) {
          case 'last_30':
            cutoffDate.setDate(now.getDate() - 30);
            break;
          case 'last_60':
            cutoffDate.setDate(now.getDate() - 60);
            break;
          case 'last_90':
            cutoffDate.setDate(now.getDate() - 90);
            break;
        }

        filtered = filtered.filter(eo => {
          const eoDate = new Date(eo.date);
          return eoDate >= cutoffDate;
        });
      }

      return filtered;
    }, [searchTerm, selectedCategory, selectedActionTier, dateRange, showEnrichedOnly]);

    // Apply filters with debouncing for search
    useEffect(() => {
      if (allExecutiveOrders.length === 0) return;

      // Clear existing timeout
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }

      // Show filtering state
      setIsFiltering(true);

      // Debounce search (300ms), but apply other filters immediately
      const delay = searchTerm ? 300 : 0;

      searchDebounceRef.current = setTimeout(() => {
        const filtered = applyFilters(allExecutiveOrders);

        // Calculate pagination
        const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
        setTotalPages(totalPages);

        // Reset to page 1 when filters change
        setCurrentPage(1);

        // Get first page of results
        const startIndex = 0;
        const endIndex = ITEMS_PER_PAGE;
        const paginatedData = filtered.slice(startIndex, endIndex);

        setDisplayedOrders(paginatedData);
        setIsFiltering(false);
      }, delay);

      return () => {
        if (searchDebounceRef.current) {
          clearTimeout(searchDebounceRef.current);
        }
      };
    }, [searchTerm, selectedCategory, selectedActionTier, dateRange, showEnrichedOnly, allExecutiveOrders, applyFilters]);

    // Handle page change
    const handlePageChange = useCallback((page) => {
      const filtered = applyFilters(allExecutiveOrders);
      const startIndex = (page - 1) * ITEMS_PER_PAGE;
      const endIndex = startIndex + ITEMS_PER_PAGE;
      const paginatedData = filtered.slice(startIndex, endIndex);

      setDisplayedOrders(paginatedData);
      setCurrentPage(page);

      // Scroll to top
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [allExecutiveOrders, applyFilters]);

    // Clear all filters
    const clearAllFilters = useCallback(() => {
      setSearchTerm('');
      setSelectedCategory('all');
      setSelectedActionTier('all');
      setDateRange('all');
      setShowEnrichedOnly(true);
      setCurrentPage(1);
    }, []);

    // Get active filter count
    const activeFilterCount = useMemo(() => {
      let count = 0;
      if (searchTerm) count++;
      if (selectedCategory !== 'all') count++;
      if (selectedActionTier !== 'all') count++;
      if (dateRange !== 'all') count++;
      if (!showEnrichedOnly) count++;
      return count;
    }, [searchTerm, selectedCategory, selectedActionTier, dateRange, showEnrichedOnly]);

    // Get filtered count
    const filteredCount = useMemo(() => {
      return applyFilters(allExecutiveOrders).length;
    }, [allExecutiveOrders, applyFilters]);

    // Load data on mount
    useEffect(() => {
      loadExecutiveOrders();
    }, [loadExecutiveOrders]);

    // Loading state
    if (loading) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 text-white flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
            <p className="text-gray-400">Loading executive orders...</p>
          </div>
        </div>
      );
    }

    // Error state
    if (error) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 text-white flex items-center justify-center">
          <div className="text-center max-w-md">
            <div className="text-red-500 text-6xl mb-4">⚠️</div>
            <h2 className="text-2xl font-bold mb-4">Connection Error</h2>
            <p className="text-gray-400 mb-4">{error}</p>
            <button
              onClick={() => loadExecutiveOrders()}
              className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded font-medium transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 text-white">
        <div className="container mx-auto px-4 py-8 max-w-7xl">
          {/* Header */}
          <header className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <a
                href="/"
                className="text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Back to Dashboard
              </a>
            </div>

            <div className="text-center">
              <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-orange-400 to-red-400 bg-clip-text text-transparent mb-2">
                Executive Orders
              </h1>
              <p className="text-gray-300 text-lg">
                Track and analyze Trump administration executive orders
              </p>
              <p className="text-gray-400 text-sm mt-2">
                {allExecutiveOrders.length} total orders • {filteredCount} matching filters
              </p>
            </div>
          </header>

          {/* Filter Section */}
          <div className="bg-gray-800/50 backdrop-blur-md rounded-lg p-6 border border-gray-700 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Filters</h2>
              {activeFilterCount > 0 && (
                <button
                  onClick={clearAllFilters}
                  className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Clear all ({activeFilterCount})
                </button>
              )}
            </div>

            {/* Search Bar */}
            <div className="mb-4">
              <input
                type="text"
                placeholder="Search by title, order number, or content..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Filter Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
              {/* Category Filter */}
              <div>
                <label className="block text-sm font-medium mb-2">Category</label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Categories</option>
                  {EO_CATEGORIES.map(cat => (
                    <option key={cat.value} value={cat.value}>{cat.label}</option>
                  ))}
                </select>
              </div>

              {/* Action Tier Filter */}
              <div>
                <label className="block text-sm font-medium mb-2">Action Tier</label>
                <select
                  value={selectedActionTier}
                  onChange={(e) => setSelectedActionTier(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Tiers</option>
                  {ACTION_TIERS.map(tier => (
                    <option key={tier.value} value={tier.value}>{tier.label}</option>
                  ))}
                </select>
              </div>

              {/* Date Range Filter */}
              <div>
                <label className="block text-sm font-medium mb-2">Date Range</label>
                <select
                  value={dateRange}
                  onChange={(e) => setDateRange(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Time</option>
                  <option value="last_30">Last 30 Days</option>
                  <option value="last_60">Last 60 Days</option>
                  <option value="last_90">Last 90 Days</option>
                </select>
              </div>
            </div>

            {/* Enrichment Toggle */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="enriched-only"
                checked={showEnrichedOnly}
                onChange={(e) => setShowEnrichedOnly(e.target.checked)}
                className="w-4 h-4 text-blue-600 bg-gray-900 border-gray-600 rounded focus:ring-blue-500"
              />
              <label htmlFor="enriched-only" className="text-sm text-gray-300">
                Show only AI-enriched orders ({allExecutiveOrders.filter(eo => eo.enriched_at).length} available)
              </label>
            </div>
          </div>

          {/* Loading Overlay */}
          {isFiltering && <LoadingOverlay message="Applying filters..." />}

          {/* Results */}
          <div className="space-y-6" style={{
            transition: 'opacity 0.3s ease-in-out',
            opacity: isFiltering ? 0.7 : 1
          }}>
            {displayedOrders.length === 0 ? (
              <NoResultsMessage searchTerm={searchTerm} />
            ) : (
              <>
                <div className="grid grid-cols-1 gap-6">
                  {displayedOrders.map((order, index) => (
                    <ExecutiveOrderCard
                      key={order.id}
                      order={order}
                      index={index}
                      showShareButtons={true}
                    />
                  ))}
                </div>

                <PaginationControls
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={handlePageChange}
                />
              </>
            )}
          </div>

          {/* Footer */}
          <footer className="text-center mt-16 pt-8 border-t border-gray-700">
            <p className="text-gray-400 text-sm">
              TrumpyTracker - Executive Orders Tracker |
              <a href="mailto:contact.trumpytracker@gmail.com" className="text-blue-400 hover:text-blue-300 ml-1">
                Contact Us
              </a>
            </p>
            <p className="text-gray-500 text-xs mt-2">
              Executive orders enriched with AI-powered analysis
            </p>
          </footer>
        </div>
      </div>
    );
  };

  // Render the page
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(<ExecutiveOrdersPage />);

})();
