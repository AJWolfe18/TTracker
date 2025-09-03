// TrumpyTracker Dashboard - Fully Modularized Version
// All components loaded from modules - zero duplication

// Module Loading Verification & Error Boundary
(function() {
  // Check if required modules are loaded
  const requiredModules = [
    { name: 'DashboardUtils', path: 'dashboard-utils.js' },
    { name: 'DashboardStats', path: 'dashboard-stats.js' },
    { name: 'DashboardComponents', path: 'dashboard-components.js' }
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
      <div style="min-height: 100vh; background: linear-gradient(135deg, #1e3c72, #2a5298); display: flex; align-items: center; justify-content: center; color: white; font-family: system-ui;">
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

// Import ALL components from DashboardComponents module
const {
  ConstructionBanner,
  ContentModal,
  NoResultsMessage,
  PaginationControls,
  PoliticalEntryCard,  // Now using module version!
  ExecutiveOrderCard,  // Now using module version!
  TabNavigation,       // Now using module version!
  LoadingOverlay,      // Now using module version!
  getSeverityColor
} = window.DashboardComponents || {};

// Configuration
const SUPABASE_URL = window.SUPABASE_URL || window.SUPABASE_CONFIG?.SUPABASE_URL || 'https://osjbulmltfpcoldydexg.supabase.co';
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || window.SUPABASE_CONFIG?.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zamJ1bG1sdGZwY29sZHlkZXhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ3NjQ5NzEsImV4cCI6MjA3MDM0MDk3MX0.COtWEcun0Xkw5hUhaVEJGCrWbumj42L4vwWGgH7RyIE';

// Pagination settings
const ITEMS_PER_PAGE = 20;
const EO_ITEMS_PER_PAGE = 25;

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
  const [activeTab, setActiveTab] = useState('political');
  const [allPoliticalEntries, setAllPoliticalEntries] = useState([]);
  const [displayedPoliticalEntries, setDisplayedPoliticalEntries] = useState([]);
  const [allExecutiveOrders, setAllExecutiveOrders] = useState([]);
  const [executiveOrders, setExecutiveOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({});
  const [activeFilter, setActiveFilter] = useState(null);
  const [isFiltering, setIsFiltering] = useState(false);
  const [isFilterExpanded, setIsFilterExpanded] = useState(true);
  
  // Search and filter state
  const [searchTerm, setSearchTerm] = useState('');
  const searchDebounceRef = useRef(null);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [dateRange, setDateRange] = useState('all');
  const [sortOrder, setSortOrder] = useState('newest');
  
  // Pagination state
  const [politicalPage, setPoliticalPage] = useState(1);
  const [eoPage, setEoPage] = useState(1);
  const [totalPoliticalPages, setTotalPoliticalPages] = useState(1);
  const [totalEoPages, setTotalEoPages] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);

  // Load political entries with pagination
  const loadPoliticalEntries = useCallback(async (page = 1, append = false, loadAll = false) => {
    try {
      setLoadingMore(true);
      
      if (loadAll) {
        // Load ALL entries for search functionality
        const query = 'political_entries?archived=neq.true&order=date.desc,added_at.desc';
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
        const countQuery = 'political_entries?select=id&archived=neq.true';
        const countData = await supabaseRequest(countQuery);
        const totalCount = countData ? countData.length : 0;
        setTotalPoliticalPages(Math.ceil(totalCount / ITEMS_PER_PAGE));
        
        // Then get paginated data
        const query = `political_entries?archived=neq.true&order=date.desc,added_at.desc&limit=${ITEMS_PER_PAGE}&offset=${offset}`;
        const data = await supabaseRequest(query);
        
        if (append) {
          setAllPoliticalEntries(prev => [...prev, ...(data || [])]);
        } else {
          // If we don't have all data yet, load it for search
          if (allPoliticalEntries.length === 0 || allPoliticalEntries.length < totalCount) {
            const allQuery = 'political_entries?archived=neq.true&order=date.desc,added_at.desc';
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
    const cats = new Set();
    if (activeTab === 'political') {
      allPoliticalEntries.forEach(e => {
        // Only add valid string categories
        if (e.category && typeof e.category === 'string' && e.category.trim()) {
          cats.add(e.category.trim());
        }
      });
    } else {
      allExecutiveOrders.forEach(e => {
        // Only add valid string categories
        if (e.category && typeof e.category === 'string' && e.category.trim()) {
          cats.add(e.category.trim());
        }
      });
    }
    return Array.from(cats).sort();
  }, [allPoliticalEntries, allExecutiveOrders, activeTab]);

  // Apply all filters (search, category, date, severity)
  const applyAllFilters = useCallback((entries) => {
    let filtered = [...entries];
    
    // Apply search filter
    if (searchTerm && searchTerm.trim() !== '') {
      const searchLower = searchTerm.toLowerCase().trim();
      filtered = filtered.filter(entry => {
        return (
          entry.title?.toLowerCase().includes(searchLower) ||
          entry.description?.toLowerCase().includes(searchLower) ||
          entry.summary?.toLowerCase().includes(searchLower) ||
          entry.actor?.toLowerCase().includes(searchLower) ||
          entry.category?.toLowerCase().includes(searchLower)
        );
      });
    }
    
    // Apply category filter
    if (selectedCategory && selectedCategory !== 'all') {
      filtered = filtered.filter(entry => entry.category === selectedCategory);
    }
    
    // Apply date range filter
    if (dateRange && dateRange !== 'all') {
      const now = new Date();
      const cutoffDate = new Date();
      
      switch(dateRange) {
        case '7days':
          cutoffDate.setDate(now.getDate() - 7);
          break;
        case '30days':
          cutoffDate.setDate(now.getDate() - 30);
          break;
        case '90days':
          cutoffDate.setDate(now.getDate() - 90);
          break;
      }
      
      if (dateRange !== 'all') {
        filtered = filtered.filter(entry => {
          // Handle null, undefined, or invalid dates
          if (!entry.date) return false;
          const entryDate = new Date(entry.date);
          // Check for invalid date
          if (isNaN(entryDate.getTime())) return false;
          return entryDate >= cutoffDate;
        });
      }
    }
    
    // Apply severity filter if active
    if (activeFilter) {
      switch(activeFilter) {
        case 'high':
          filtered = filtered.filter(entry => 
            entry.severity?.toLowerCase() === 'high' || entry.severity?.toLowerCase() === 'critical'
          );
          break;
        case 'medium':
          filtered = filtered.filter(entry => 
            entry.severity?.toLowerCase() === 'medium'
          );
          break;
        case 'low':
          filtered = filtered.filter(entry => 
            entry.severity?.toLowerCase() === 'low'
          );
          break;
      }
    }
    
    // Apply sort order
    if (sortOrder === 'oldest') {
      filtered.sort((a, b) => new Date(a.date) - new Date(b.date));
    } else {
      // Default to newest first
      filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
    }
    
    return filtered;
  }, [searchTerm, selectedCategory, dateRange, activeFilter, sortOrder]);

  // Apply search filter (kept for backward compatibility)
  const applySearch = useCallback((entries, search) => {
    if (!search || search.trim() === '') return entries;
    
    const searchLower = search.toLowerCase().trim();
    return entries.filter(entry => {
      return (
        entry.title?.toLowerCase().includes(searchLower) ||
        entry.description?.toLowerCase().includes(searchLower) ||
        entry.summary?.toLowerCase().includes(searchLower) ||
        entry.actor?.toLowerCase().includes(searchLower) ||
        entry.category?.toLowerCase().includes(searchLower)
      );
    });
  }, []);

  // Handle search and filters with debouncing
  const handleFiltersChange = useCallback(() => {
    // Clear existing debounce
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    
    // Show loading state immediately for better UX
    setIsFiltering(true);
    
    // Set new debounce
    searchDebounceRef.current = setTimeout(() => {
      if (activeTab === 'political') {
        const filtered = applyAllFilters(allPoliticalEntries);
        
        // Paginate filtered results
        const paginatedFiltered = filtered.slice(0, ITEMS_PER_PAGE);
        setDisplayedPoliticalEntries(paginatedFiltered);
        setTotalPoliticalPages(Math.ceil(filtered.length / ITEMS_PER_PAGE));
        setPoliticalPage(1); // Reset to page 1 when filtering
      } else {
        const filtered = applyAllFilters(allExecutiveOrders);
        
        // Paginate filtered results
        const paginatedFiltered = filtered.slice(0, EO_ITEMS_PER_PAGE);
        setExecutiveOrders(paginatedFiltered);
        setTotalEoPages(Math.ceil(filtered.length / EO_ITEMS_PER_PAGE));
        setEoPage(1); // Reset to page 1 when filtering
      }
      // Hide loading state after filtering is complete
      setIsFiltering(false);
    }, 300); // 300ms debounce
  }, [activeTab, allPoliticalEntries, allExecutiveOrders, applyAllFilters]);

  // Trigger filter changes when any filter changes
  useEffect(() => {
    if (allPoliticalEntries.length > 0 || allExecutiveOrders.length > 0) {
      handleFiltersChange();
    }
  }, [searchTerm, selectedCategory, dateRange, sortOrder, activeFilter]);

  // Handle search input
  const handleSearch = useCallback((value) => {
    setSearchTerm(value);
  }, []);

  // Memoized filter counts - prevents recalculation on every render
  const filterCounts = useMemo(() => {
    if (!allPoliticalEntries) return { high: 0, medium: 0, low: 0 };
    
    // Apply all filters except severity to get base filtered data
    let baseFiltered = [...allPoliticalEntries];
    
    // Apply search
    if (searchTerm) {
      baseFiltered = applySearch(baseFiltered, searchTerm);
    }
    
    // Apply category
    if (selectedCategory && selectedCategory !== 'all') {
      baseFiltered = baseFiltered.filter(e => e.category === selectedCategory);
    }
    
    // Apply date range
    if (dateRange && dateRange !== 'all') {
      const now = new Date();
      const cutoffDate = new Date();
      
      switch(dateRange) {
        case '7days':
          cutoffDate.setDate(now.getDate() - 7);
          break;
        case '30days':
          cutoffDate.setDate(now.getDate() - 30);
          break;
        case '90days':
          cutoffDate.setDate(now.getDate() - 90);
          break;
      }
      
      baseFiltered = baseFiltered.filter(e => {
        // Handle null, undefined, or invalid dates
        if (!e.date) return false;
        const entryDate = new Date(e.date);
        if (isNaN(entryDate.getTime())) return false;
        return entryDate >= cutoffDate;
      });
    }
    
    return {
      high: baseFiltered.filter(e => 
        e.severity?.toLowerCase() === 'high' || e.severity?.toLowerCase() === 'critical'
      ).length,
      medium: baseFiltered.filter(e => 
        e.severity?.toLowerCase() === 'medium'
      ).length,
      low: baseFiltered.filter(e => 
        e.severity?.toLowerCase() === 'low'
      ).length
    };
  }, [allPoliticalEntries, searchTerm, selectedCategory, dateRange, applySearch]);

  // Tab counts for TabNavigation component
  const tabCounts = useMemo(() => ({
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
        {/* Construction Banner */}
        <ConstructionBanner />
        
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
                <p className="text-gray-300 text-lg">Real-time Political Accountability Dashboard</p>
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
            if (tab === 'political') {
              // Apply all current filters to political entries
              const filtered = applyAllFilters(allPoliticalEntries);
              const paginatedFiltered = filtered.slice(0, ITEMS_PER_PAGE);
              setDisplayedPoliticalEntries(paginatedFiltered);
              setTotalPoliticalPages(Math.ceil(filtered.length / ITEMS_PER_PAGE));
              setPoliticalPage(1);
            } else {
              // Apply all current filters to executive orders
              const filtered = applyAllFilters(allExecutiveOrders);
              const paginatedFiltered = filtered.slice(0, EO_ITEMS_PER_PAGE);
              setExecutiveOrders(paginatedFiltered);
              setTotalEoPages(Math.ceil(filtered.length / EO_ITEMS_PER_PAGE));
              setEoPage(1);
            }
          }}
          counts={tabCounts}
        />

        {/* Search and Filter Bar - Collapsible */}
        <div className="bg-gray-800/50 backdrop-blur-md rounded-lg border border-gray-700 mb-6">
          {/* Toggle Header */}
          <button
            onClick={() => setIsFilterExpanded(!isFilterExpanded)}
            className="w-full p-4 flex items-center justify-between hover:bg-gray-700/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              <span className="text-white font-medium">Search & Filters</span>
              {(searchTerm || selectedCategory !== 'all' || dateRange !== 'all' || activeFilter) && (
                <span className="text-xs bg-blue-600/20 text-blue-400 px-2 py-0.5 rounded">
                  Active
                </span>
              )}
            </div>
            <svg 
              className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isFilterExpanded ? 'rotate-180' : ''}`}
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          
          {/* Collapsible Content */}
          <div className={`overflow-hidden transition-all duration-300 ${isFilterExpanded ? 'max-h-96' : 'max-h-0'}`}>
            <div className="p-4 pt-0 border-t border-gray-700">
              {/* Search Input */}
              <div className="relative mb-4">
                <input
                  type="text"
                  placeholder="Search titles, descriptions, actors, categories..."
                  value={searchTerm}
                  onChange={(e) => handleSearch(e.target.value)}
                  className="w-full px-4 py-3 pl-12 bg-gray-900/50 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all duration-200"
                />
                <svg 
                  className="absolute left-4 top-3.5 w-5 h-5 text-gray-400" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    strokeWidth={2} 
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" 
                  />
                </svg>
                {searchTerm && (
                  <button
                    onClick={() => handleSearch('')}
                    className="absolute right-4 top-3.5 text-gray-400 hover:text-white transition-colors"
                    aria-label="Clear search"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              
              {/* Filter Dropdowns - Responsive Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-3">
                {/* Category Filter */}
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="px-4 py-2 bg-gray-900/50 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all duration-200"
                  title={uniqueCategories.length === 0 ? "No categories available" : "Filter by category"}
                >
                  <option value="all">{uniqueCategories.length === 0 ? "No Categories" : "All Categories"}</option>
                  {uniqueCategories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                
                {/* Severity Filter - Dropdown version */}
                <select
                  value={activeFilter || 'all'}
                  onChange={(e) => setActiveFilter(e.target.value === 'all' ? null : e.target.value)}
                  className="px-4 py-2 bg-gray-900/50 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all duration-200"
                >
                  <option value="all">Severity</option>
                  <option value="high">High/Critical</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                
                {/* Date Range Filter */}
                <select
                  value={dateRange}
                  onChange={(e) => setDateRange(e.target.value)}
                  className="px-4 py-2 bg-gray-900/50 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all duration-200"
                >
                  <option value="all">All time</option>
                  <option value="7days">Last 7 days</option>
                  <option value="30days">Last 30 days</option>
                  <option value="90days">Last 90 days</option>
                </select>
                
                {/* Sort Order */}
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                  className="px-4 py-2 bg-gray-900/50 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all duration-200"
                >
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                </select>
                
                {/* Clear All Filters Button - Full width on mobile */}
                {(searchTerm || selectedCategory !== 'all' || dateRange !== 'all' || activeFilter || sortOrder !== 'newest') && (
                  <button
                    onClick={() => {
                      setSearchTerm('');
                      setSelectedCategory('all');
                      setDateRange('all');
                      setActiveFilter(null);
                      setSortOrder('newest');
                    }}
                    className="col-span-2 sm:col-span-1 px-4 py-2 bg-red-600/20 border border-red-600/50 rounded-lg text-red-400 hover:bg-red-600/30 hover:border-red-600 transition-all duration-200"
                  >
                    Clear All
                  </button>
                )}
              </div>
              
              {/* Active Filters Display */}
              {(searchTerm || selectedCategory !== 'all' || dateRange !== 'all' || activeFilter) && (
                <div className="mt-3 text-sm text-gray-400">
                  <span className="mr-2">Active filters:</span>
                  {searchTerm && (
                    <span className="inline-block bg-blue-600/20 text-blue-400 px-2 py-1 rounded mr-2">
                      Search: "{searchTerm}"
                    </span>
                  )}
                  {selectedCategory !== 'all' && (
                    <span className="inline-block bg-orange-600/20 text-orange-400 px-2 py-1 rounded mr-2">
                      Category: {selectedCategory}
                    </span>
                  )}
                  {dateRange !== 'all' && (
                    <span className="inline-block bg-green-600/20 text-green-400 px-2 py-1 rounded mr-2">
                      Date: {dateRange === '7days' ? 'Last 7 days' : dateRange === '30days' ? 'Last 30 days' : 'Last 90 days'}
                    </span>
                  )}
                  {activeFilter && (
                    <span className="inline-block bg-yellow-600/20 text-yellow-400 px-2 py-1 rounded mr-2">
                      Severity: {activeFilter.charAt(0).toUpperCase() + activeFilter.slice(1)}
                    </span>
                  )}
                  {activeTab === 'political' && (
                    <span className="ml-2 text-gray-500 transition-all duration-300">
                      • Showing {displayedPoliticalEntries.length} of {allPoliticalEntries.length} entries
                    </span>
                  )}
                  {activeTab === 'executive' && (
                    <span className="ml-2 text-gray-500 transition-all duration-300">
                      • Showing {executiveOrders.length} of {allExecutiveOrders.length} orders
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Statistics Section with Filter Buttons */}
        <StatsSection stats={stats} />

        {/* Loading Overlay for Filtering - Using module component */}
        {isFiltering && <LoadingOverlay message="Applying filters..." />}

        {/* Content Area with transition animations */}
        <div className="space-y-6" style={{
          transition: 'opacity 0.3s ease-in-out, transform 0.3s ease-in-out',
          opacity: isFiltering ? 0.7 : 1,
          transform: isFiltering ? 'scale(0.98)' : 'scale(1)'
        }}>
          {activeTab === 'political' && (
            <div>
              <h2 className="text-2xl font-bold mb-6 text-center">
                Recent Political Accountability Entries
                {activeFilter && (
                  <span className="text-lg font-normal text-gray-400 ml-2">
                    (Filtered: {activeFilter.charAt(0).toUpperCase() + activeFilter.slice(1)})
                  </span>
                )}
              </h2>
              
              {loadingMore && (
                <div className="text-center py-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto"></div>
                </div>
              )}
              
              {displayedPoliticalEntries.length === 0 ? (
                <NoResultsMessage searchTerm={searchTerm} />
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
                      if (searchTerm || selectedCategory !== 'all' || dateRange !== 'all' || activeFilter || sortOrder !== 'newest') {
                        const filtered = applyAllFilters(allPoliticalEntries);
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
            <div>
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
                      // If any filters are active, handle pagination with filters
                      if (searchTerm || selectedCategory !== 'all' || dateRange !== 'all' || activeFilter || sortOrder !== 'newest') {
                        const filtered = applyAllFilters(allExecutiveOrders);
                        const paginatedFiltered = filtered.slice((page - 1) * EO_ITEMS_PER_PAGE, page * EO_ITEMS_PER_PAGE);
                        setExecutiveOrders(paginatedFiltered);
                        setEoPage(page);
                      } else {
                        loadExecutiveOrders(page);
                      }
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