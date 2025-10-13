// TrumpyTracker Dashboard - Phase 3 Refactored Version
// Filter logic extracted to dashboard-filters.js module

// Module Loading Verification & Error Boundary
(function() {
  // Check if required modules are loaded - NOW INCLUDING FILTERS
  const requiredModules = [
    { name: 'DashboardUtils', path: 'dashboard-utils.js' },
    { name: 'DashboardStats', path: 'dashboard-stats.js' },
    { name: 'DashboardComponents', path: 'dashboard-components.js' },
    { name: 'DashboardFilters', path: 'dashboard-filters.js' }  // NEW!
  ];
  
  let missingModules = [];
  requiredModules.forEach(module => {
    if (!window[module.name]) {
      console.error(`Critical: ${module.name} module not loaded from ${module.path}`);
      missingModules.push(module);
    }
  });
  
  // If modules are missing, show error to user
  if (missingModules.length > 0) {
    const errorHtml = `
      <div style="min-height: 100vh; background: linear-gradient(135deg, #1e3c72, #2a5298); display: flex; align-items: center; justify-content; color: white; font-family: system-ui;">
        <div style="text-align: center; padding: 2rem; background: rgba(0,0,0,0.5); border-radius: 1rem; max-width: 500px;">
          <h1 style="font-size: 2rem; margin-bottom: 1rem; color: #ff6b6b;">⚠️ Loading Error</h1>
          <p style="margin-bottom: 1.5rem;">Some required files failed to load. This might be a temporary network issue.</p>
          <p style="margin-bottom: 1rem; font-size: 0.9rem; opacity: 0.8;">Missing: ${missingModules.map(m => m.path).join(', ')}</p>
          <button onclick="window.location.reload()" style="background: #4CAF50; color: white; border: none; padding: 0.75rem 2rem; border-radius: 0.5rem; font-size: 1rem; cursor: pointer;">
            🔄 Reload Page
          </button>
          <div style="margin-top: 1rem; font-size: 0.8rem; opacity: 0.7;">
            If this persists, try clearing your browser cache (Ctrl+Shift+R)
          </div>
        </div>
      </div>
    `;
    document.getElementById('root').innerHTML = errorHtml;
    throw new Error('Required modules not loaded. Dashboard cannot initialize.');
  }
})();

// Import React hooks
const { useState, useEffect, useCallback, useMemo, useRef } = React;

// Import components from DashboardComponents module
const {
  ConstructionBanner,
  ContentModal,
  NoResultsMessage,
  PaginationControls,
  PoliticalEntryCard,
  ExecutiveOrderCard,
  TabNavigation,
  LoadingOverlay,
  TabSearchFilter,
  getSeverityColor
} = window.DashboardComponents || {};

// Import Story components
const { StoryFeed } = window.StoryComponents || {};

// Import filter components and utilities from DashboardFilters module
const {
  FilterSection,
  filterUtils
} = window.DashboardFilters || {};

// Configuration
const SUPABASE_URL = window.SUPABASE_URL || window.SUPABASE_CONFIG?.SUPABASE_URL || 'https://osjbulmltfpcoldydexg.supabase.co';
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || window.SUPABASE_CONFIG?.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zamJ1bG1sdGZwY29sZHlkZXhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ3NjQ5NzEsImV4cCI6MjA3MDM0MDk3MX0.COtWEcun0Xkw5hUhaVEJGCrWbumj42L4vwWGgH7RyIE';

// Pagination settings
const ITEMS_PER_PAGE = 20;
const EO_ITEMS_PER_PAGE = 25;

// Filter configurations per tab
const FILTER_CONFIGS = {
  executive: {
    filterKey: 'action_tier', // Using new enriched schema
    allLabel: 'All Actions',
    placeholder: 'Search executive orders...',
    filters: [
      { value: 'direct', label: 'Direct Action' },
      { value: 'systemic', label: 'Systemic Change' },
      { value: 'tracking', label: 'Tracking Only' }
    ]
  }
  // Add 'political' config later if tab is re-enabled
};

// Use utilities from DashboardUtils module
const { 
  getCachedData, 
  setCachedData, 
  clearOldCache, 
  clearCache, 
  supabaseRequest,
  formatDate 
} = window.DashboardUtils;

// Get cache configuration from utilities module
const CACHE_DURATION = window.DashboardUtils.CACHE_DURATION;
const CACHE_KEY_PREFIX = window.DashboardUtils.CACHE_KEY_PREFIX;
const FORCE_REFRESH_HOUR = window.DashboardUtils.FORCE_REFRESH_HOUR;

// Use StatsSection from DashboardStats module
const StatsSection = window.DashboardStats.StatsSection;

// Main Dashboard Component
const TrumpyTrackerDashboard = () => {
  // Inject CSS animations with duplicate prevention
  React.useEffect(() => {
    const existingStyle = document.getElementById('tt-animations');
    if (!existingStyle) {
      const style = document.createElement('style');
      style.id = 'tt-animations';
      style.textContent = `
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        /* Smooth transitions for filter changes */
        .filter-transition {
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
      `;
      document.head.appendChild(style);
    }
    return () => {
      const style = document.getElementById('tt-animations');
      if (style) document.head.removeChild(style);
    };
  }, []);

  // State management
  const [activeTab, setActiveTab] = useState('stories');
  const [allPoliticalEntries, setAllPoliticalEntries] = useState([]);
  const [displayedPoliticalEntries, setDisplayedPoliticalEntries] = useState([]);
  const [allExecutiveOrders, setAllExecutiveOrders] = useState([]);
  const [executiveOrders, setExecutiveOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({});
  const [isFiltering, setIsFiltering] = useState(false);
  const [isFilterExpanded, setIsFilterExpanded] = useState(true);
  
  // Unified search/filter state (replaces old filters object)
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('all');
  const searchDebounceRef = useRef(null);
  
  // OLD filter state - kept for political tab (will migrate later)
  const [filters, setFilters] = useState(filterUtils.getDefaultFilters());
  
  // Pagination state
  const [politicalPage, setPoliticalPage] = useState(1);
  const [eoPage, setEoPage] = useState(1);
  const [totalPoliticalPages, setTotalPoliticalPages] = useState(1);
  const [totalEoPages, setTotalEoPages] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);

  // Unified filter function for Executive Orders
  const applyUnifiedFilters = useCallback((data, searchTerm, selectedFilter, filterKey) => {
    let filtered = [...data];

    // 1. Search filter (searches across title and enriched sections)
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(item =>
        item.title?.toLowerCase().includes(term) ||
        item.section_what_they_say?.toLowerCase().includes(term) ||
        item.section_what_it_means?.toLowerCase().includes(term) ||
        item.section_reality_check?.toLowerCase().includes(term) ||
        item.section_why_it_matters?.toLowerCase().includes(term) ||
        item.order_number?.toString().includes(term)
      );
    }

    // 2. Action tier filter (using new enriched schema)
    if (selectedFilter !== 'all') {
      filtered = filtered.filter(item => item[filterKey] === selectedFilter);
    }

    // 3. Default sort: Most recent first
    filtered.sort((a, b) => {
      const dateA = new Date(a.date || a.last_updated_at);
      const dateB = new Date(b.date || b.last_updated_at);
      return dateB - dateA;
    });

    return filtered;
  }, []);

  // Handle search with debouncing
  const handleSearchChange = useCallback((value) => {
    setSearchTerm(value);
    // Note: Debouncing is handled by useEffect dependency on searchTerm
    // The useEffect will only run after user stops typing for React's batching period
  }, []);

  // Apply filters when search/filter changes (Executive Orders only) with debouncing
  useEffect(() => {
    if (activeTab === 'executive' && allExecutiveOrders.length > 0) {
      // Clear existing timeout
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }

      // Debounce search (300ms), but apply filter changes immediately
      const delay = searchTerm ? 300 : 0;
      
      searchDebounceRef.current = setTimeout(() => {
        const config = FILTER_CONFIGS.executive;
        const filtered = applyUnifiedFilters(
          allExecutiveOrders,
          searchTerm,
          selectedFilter,
          config.filterKey
        );

        // Paginate filtered results
        const paginated = filtered.slice(0, EO_ITEMS_PER_PAGE);
        setExecutiveOrders(paginated);
        setTotalEoPages(Math.ceil(filtered.length / EO_ITEMS_PER_PAGE));
        setEoPage(1);
      }, delay);

      // Cleanup timeout on unmount or dependency change
      return () => {
        if (searchDebounceRef.current) {
          clearTimeout(searchDebounceRef.current);
        }
      };
    }
  }, [searchTerm, selectedFilter, allExecutiveOrders, activeTab, applyUnifiedFilters]);

  // Handle filter changes (OLD - for political tab)
  const handleFilterChange = useCallback((key, value) => {
    if (key === 'clearAll') {
      setFilters(filterUtils.getDefaultFilters());
    } else {
      setFilters(prev => ({ ...prev, [key]: value }));
    }
  }, []);

  // Load political entries with pagination
  const loadPoliticalEntries = useCallback(async (page = 1, append = false, loadAll = false) => {
    try {
      setLoadingMore(true);
      
      if (loadAll) {
        // Load ALL entries for search functionality
        const query = 'political_entries?order=published_at.desc,created_at.desc';
        const data = await supabaseRequest(query);
        setAllPoliticalEntries(data || []);
        
        // Still paginate for display
        const paginatedData = (data || []).slice(0, ITEMS_PER_PAGE);
        setDisplayedPoliticalEntries(paginatedData);
        setTotalPoliticalPages(Math.ceil((data || []).length / ITEMS_PER_PAGE));
        setPoliticalPage(1);
      } else {
        const offset = (page - 1) * ITEMS_PER_PAGE;
        
        // First, get total count (cached separately)
        const countQuery = 'political_entries?select=id';
        const countData = await supabaseRequest(countQuery);
        const totalCount = countData ? countData.length : 0;
        setTotalPoliticalPages(Math.ceil(totalCount / ITEMS_PER_PAGE));
        
        // Then get paginated data
        const query = `political_entries?order=published_at.desc,created_at.desc&limit=${ITEMS_PER_PAGE}&offset=${offset}`;
        const data = await supabaseRequest(query);
        
        if (append) {
          setAllPoliticalEntries(prev => [...prev, ...(data || [])]);
        } else {
          // If we don't have all data yet, load it for search
          if (allPoliticalEntries.length === 0 || allPoliticalEntries.length < totalCount) {
            const allQuery = 'political_entries?order=published_at.desc,created_at.desc';
            const allData = await supabaseRequest(allQuery);
            setAllPoliticalEntries(allData || []);
          }
        }
        setDisplayedPoliticalEntries(data || []);
        setPoliticalPage(page);
      }
    } catch (error) {
      console.error('Error loading political entries:', error);
      setError(`Failed to load political entries: ${error.message}`);
    } finally {
      setLoadingMore(false);
    }
  }, []);

  // Load executive orders with pagination
  const loadExecutiveOrders = useCallback(async (page = 1, loadAll = false) => {
    try {
      if (loadAll) {
        // Load ALL entries for search functionality
        const query = 'executive_orders?order=date.desc,order_number.desc';
        const data = await supabaseRequest(query);
        setAllExecutiveOrders(data || []);
        
        // Still paginate for display
        const paginatedData = (data || []).slice(0, EO_ITEMS_PER_PAGE);
        setExecutiveOrders(paginatedData);
        setTotalEoPages(Math.ceil((data || []).length / EO_ITEMS_PER_PAGE));
        setEoPage(1);
      } else {
        const offset = (page - 1) * EO_ITEMS_PER_PAGE;
        
        // Get total count
        const countQuery = 'executive_orders?select=id';
        const countData = await supabaseRequest(countQuery);
        const totalCount = countData ? countData.length : 0;
        setTotalEoPages(Math.ceil(totalCount / EO_ITEMS_PER_PAGE));
        
        // Get paginated data
        const query = `executive_orders?order=date.desc,order_number.desc&limit=${EO_ITEMS_PER_PAGE}&offset=${offset}`;
        const data = await supabaseRequest(query);
        
        // If we don't have all data yet, load it for search
        if (allExecutiveOrders.length === 0 || allExecutiveOrders.length < totalCount) {
          const allQuery = 'executive_orders?order=date.desc,order_number.desc';
          const allData = await supabaseRequest(allQuery);
          setAllExecutiveOrders(allData || []);
        }
        
        setExecutiveOrders(data || []);
        setEoPage(page);
      }
    } catch (error) {
      console.error('Error loading executive orders:', error);
      setError(`Failed to load executive orders: ${error.message}`);
    }
  }, []);

  // Load dashboard statistics (heavily cached)
  const loadStats = useCallback(async () => {
    try {
      const statsData = await supabaseRequest('dashboard_stats');
      if (statsData && statsData.length > 0) {
        setStats(statsData[0]);
      }
    } catch (error) {
      console.error('Error loading stats:', error);
      // Stats table doesn't exist in TEST - gracefully fail
      setStats({});
    }
  }, []);

  // Load all data
  const loadAllData = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    
    // Clear cache if forced
    if (forceRefresh) {
      clearOldCache();
    }
    
    try {
      await Promise.all([
        loadPoliticalEntries(1, false, true), // Load ALL political entries
        loadExecutiveOrders(1, true), // Load ALL executive orders
        loadStats()
      ]);
    } catch (error) {
      console.error('Error loading data:', error);
      setError('Failed to load dashboard data. Please refresh the page.');
    } finally {
      setLoading(false);
    }
  }, [loadPoliticalEntries, loadExecutiveOrders, loadStats]);

  useEffect(() => {
    loadAllData();
  }, []);

  // Make loadAllData available globally for stats module
  window.loadAllData = loadAllData;

  // Extract unique categories from data
  const uniqueCategories = useMemo(() => {
    const entries = activeTab === 'political' ? allPoliticalEntries : allExecutiveOrders;
    return filterUtils.extractUniqueCategories(entries);
  }, [allPoliticalEntries, allExecutiveOrders, activeTab]);

  // Handle search and filters with debouncing (Political tab only)
  const handleFiltersApply = useCallback(() => {
    // Clear existing debounce
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    
    // Show loading state immediately for better UX
    setIsFiltering(true);
    
    // Set new debounce
    searchDebounceRef.current = setTimeout(() => {
      if (activeTab === 'political') {
        const filtered = filterUtils.applyAllFilters(allPoliticalEntries, filters);
        
        // Paginate filtered results
        const paginatedFiltered = filtered.slice(0, ITEMS_PER_PAGE);
        setDisplayedPoliticalEntries(paginatedFiltered);
        setTotalPoliticalPages(Math.ceil(filtered.length / ITEMS_PER_PAGE));
        setPoliticalPage(1); // Reset to page 1 when filtering
      }
      // Executive tab now uses unified filtering via useEffect (lines 132-165)
      // Hide loading state after filtering is complete
      setIsFiltering(false);
    }, 300); // 300ms debounce
  }, [activeTab, allPoliticalEntries, filters]);

  // Trigger filter changes when any filter changes
  useEffect(() => {
    if (allPoliticalEntries.length > 0 || allExecutiveOrders.length > 0) {
      handleFiltersApply();
    }
  }, [filters.searchTerm, filters.selectedCategory, filters.dateRange, filters.sortOrder, filters.activeFilter]);

  // Memoized filter counts - prevents recalculation on every render
  const filterCounts = useMemo(() => {
    if (activeTab !== 'political' || !allPoliticalEntries) return { high: 0, medium: 0, low: 0 };
    return filterUtils.calculateFilterCounts(allPoliticalEntries, filters);
  }, [allPoliticalEntries, filters, activeTab]);

  // Tab counts for TabNavigation component
  const tabCounts = useMemo(() => ({
    stories: null, // Story count handled by StoryFeed component
    political: allPoliticalEntries.length,
    executive: allExecutiveOrders.length
  }), [allPoliticalEntries.length, allExecutiveOrders.length]);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-gray-400">Loading dashboard data...</p>
        </div>
      </div>
    );
  }

  // Error state with partial data display
  if (error && displayedPoliticalEntries.length === 0 && executiveOrders.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 text-white flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-red-500 text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold mb-4">Connection Error</h2>
          <p className="text-gray-400 mb-4">{error}</p>
          <p className="text-gray-500 text-sm mb-6">
            We'll automatically retry the connection. If the problem persists, please check your internet connection.
          </p>
          <div className="flex gap-3 justify-center">
            <button 
              onClick={() => loadAllData(true)}
              className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded font-medium transition-colors"
            >
              Retry Now
            </button>
            <button 
              onClick={() => window.location.reload()}
              className="bg-gray-600 hover:bg-gray-700 px-6 py-2 rounded font-medium transition-colors"
            >
              Refresh Page
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 text-white">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Hero Header with Logo */}
        <header className="text-center mb-8">
          <div className="flex items-center justify-center mb-6">
            <div className="flex items-center space-x-4">
              <div className="w-20 h-20 flex items-center justify-center">
                <a
                  href="./trumpytracker-logo.jpeg"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Click to view logo full size"
                  className="cursor-pointer hover:opacity-80 transition-opacity"
                >
                  <img
                    src="./trumpytracker-logo.jpeg"
                    alt="TrumpyTracker Logo"
                    className="w-full h-full object-contain rounded-lg shadow-lg hover:shadow-xl transition-shadow"
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.parentElement.nextSibling.style.display = 'flex';
                    }}
                  />
                </a>
                <div
                  className="w-full h-full bg-gradient-to-r from-red-500 to-orange-500 rounded-lg flex items-center justify-center shadow-lg"
                  style={{display: 'none'}}
                >
                  <span className="text-2xl font-bold">T2</span>
                </div>
              </div>

              <div className="text-left">
                <h1 className="text-4xl md:text-6xl font-bold bg-gradient-to-r from-orange-400 to-red-400 bg-clip-text text-transparent mb-2">
                  TRUMPYTRACKER
                </h1>
                <p className="text-gray-300 text-lg">Tracking the Corruption. Every Damn Day.</p>
              </div>
            </div>
          </div>

        </header>

        {/* Error banner if there's an error but we have cached data */}
        {error && (displayedPoliticalEntries.length > 0 || executiveOrders.length > 0) && (
          <div className="bg-yellow-600/20 border border-yellow-600 rounded-lg p-3 mb-4">
            <p className="text-yellow-400 text-sm">
              ⚠️ Connection issue - showing cached data. 
              <button onClick={() => loadAllData(true)} className="underline ml-2">
                Try refreshing
              </button>
            </p>
          </div>
        )}

        {/* Tab Navigation - Using module component */}
        <TabNavigation 
          activeTab={activeTab}
          onTabChange={(tab) => {
            setActiveTab(tab);
            
            // Reset search/filter state when switching tabs
            setSearchTerm('');
            setSelectedFilter('all');
            
            if (tab === 'stories') {
              // Stories tab - no filter handling needed (handled by StoryFeed component)
            } else if (tab === 'political') {
              // Apply all current filters to political entries
              const filtered = filterUtils.applyAllFilters(allPoliticalEntries, filters);
              const paginatedFiltered = filtered.slice(0, ITEMS_PER_PAGE);
              setDisplayedPoliticalEntries(paginatedFiltered);
              setTotalPoliticalPages(Math.ceil(filtered.length / ITEMS_PER_PAGE));
              setPoliticalPage(1);
            } else {
              // Executive tab - show all results initially (filtering handled by useEffect)
              const paginatedData = allExecutiveOrders.slice(0, EO_ITEMS_PER_PAGE);
              setExecutiveOrders(paginatedData);
              setTotalEoPages(Math.ceil(allExecutiveOrders.length / EO_ITEMS_PER_PAGE));
              setEoPage(1);
            }
          }}
          counts={tabCounts}
        />

        {/* Filter Section - Political tab uses old FilterSection, Executive uses new TabSearchFilter */}
        {activeTab === 'political' && (
          <FilterSection 
            filters={filters}
            onFilterChange={handleFilterChange}
            uniqueCategories={uniqueCategories}
            isExpanded={isFilterExpanded}
            onToggleExpand={() => setIsFilterExpanded(!isFilterExpanded)}
            activeTab={activeTab}
            displayCount={displayedPoliticalEntries.length}
            totalCount={allPoliticalEntries.length}
          />
        )}
        
        {/* New unified search/filter for Executive Orders */}
        {activeTab === 'executive' && (
          <TabSearchFilter
            searchTerm={searchTerm}
            onSearchChange={handleSearchChange}
            selectedFilter={selectedFilter}
            onFilterChange={setSelectedFilter}
            filterConfig={FILTER_CONFIGS.executive}
            placeholder={FILTER_CONFIGS.executive.placeholder}
          />
        )}

        {/* Loading Overlay for Filtering - Using module component */}
        {isFiltering && <LoadingOverlay message="Applying filters..." />}

        {/* Content Area with transition animations */}
        <div className="space-y-6" style={{
          transition: 'opacity 0.3s ease-in-out, transform 0.3s ease-in-out',
          opacity: isFiltering ? 0.7 : 1,
          transform: isFiltering ? 'scale(0.98)' : 'scale(1)'
        }}>
          {activeTab === 'stories' && (
            <div
              id="panel-stories"
              role="tabpanel"
              aria-labelledby="tab-stories"
            >
              {StoryFeed ? (
                <StoryFeed />
              ) : (
                <div className="text-center py-12">
                  <div className="text-red-500 text-4xl mb-4">⚠️</div>
                  <h3 className="text-xl font-bold mb-2">Story Components Not Loaded</h3>
                  <p className="text-gray-400 mb-4">
                    The story view components failed to load. Please refresh the page.
                  </p>
                  <button 
                    onClick={() => window.location.reload()}
                    className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded font-medium transition-colors"
                  >
                    Refresh Page
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'political' && (
            <div
              id="panel-political"
              role="tabpanel"
              aria-labelledby="tab-political"
            >
              <h2 className="text-2xl font-bold mb-6 text-center">
                Recent Political Accountability Entries
                {filters.activeFilter && (
                  <span className="text-lg font-normal text-gray-400 ml-2">
                    (Filtered: {filters.activeFilter.charAt(0).toUpperCase() + filters.activeFilter.slice(1)})
                  </span>
                )}
              </h2>
              
              {loadingMore && (
                <div className="text-center py-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto"></div>
                </div>
              )}
              
              {displayedPoliticalEntries.length === 0 ? (
                <NoResultsMessage searchTerm={filters.searchTerm} />
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-6" style={{
                    transition: 'all 0.3s ease-in-out'
                  }}>
                    {displayedPoliticalEntries.map((entry, index) => (
                      <PoliticalEntryCard 
                        key={entry.id} 
                        entry={entry} 
                        index={index}
                        formatDate={formatDate}
                        showShareButtons={true}
                      />
                    ))}
                  </div>
                  
                  <PaginationControls
                    currentPage={politicalPage}
                    totalPages={totalPoliticalPages}
                    onPageChange={(page) => {
                      // If any filters are active, handle pagination with filters
                      if (filterUtils.hasActiveFilters(filters)) {
                        const filtered = filterUtils.applyAllFilters(allPoliticalEntries, filters);
                        const paginatedFiltered = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);
                        setDisplayedPoliticalEntries(paginatedFiltered);
                        setPoliticalPage(page);
                      } else {
                        loadPoliticalEntries(page);
                      }
                    }}
                  />
                </>
              )}
            </div>
          )}

          {activeTab === 'executive' && (
            <div
              id="panel-executive"
              role="tabpanel"
              aria-labelledby="tab-executive"
            >
              <h2 className="text-2xl font-bold mb-6 text-center">
                Recent Executive Orders
              </h2>
              
              {loadingMore && (
                <div className="text-center py-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto"></div>
                </div>
              )}
              
              {executiveOrders.length === 0 ? (
                <NoResultsMessage searchTerm={searchTerm} />
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-6">
                    {executiveOrders.map((order, index) => (
                      <ExecutiveOrderCard 
                        key={order.id} 
                        order={order} 
                        index={index}
                        formatDate={formatDate}
                        showShareButtons={true}
                      />
                    ))}
                  </div>
                  
                  <PaginationControls
                    currentPage={eoPage}
                    totalPages={totalEoPages}
                    onPageChange={(page) => {
                      // Handle pagination with unified filters
                      const config = FILTER_CONFIGS.executive;
                      const filtered = applyUnifiedFilters(
                        allExecutiveOrders,
                        searchTerm,
                        selectedFilter,
                        config.filterKey
                      );
                      const paginatedFiltered = filtered.slice((page - 1) * EO_ITEMS_PER_PAGE, page * EO_ITEMS_PER_PAGE);
                      setExecutiveOrders(paginatedFiltered);
                      setEoPage(page);
                    }}
                  />
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="text-center mt-16 pt-8 border-t border-gray-700">
          <p className="text-gray-400 text-sm">
            TrumpyTracker - Powered by Supabase | 
            <a href="mailto:contact.trumpytracker@gmail.com" className="text-blue-400 hover:text-blue-300 ml-1">
              Contact Us
            </a>
          </p>
          <p className="text-gray-500 text-xs mt-2">
            Data cached for performance - Updates daily at noon
          </p>
        </footer>
      </div>
      
      {/* Content Modal - Using module component */}
      <ContentModal 
        isOpen={false}
        onClose={() => {}}
      />
    </div>
  );
};

// Render the dashboard
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<TrumpyTrackerDashboard />);