// TrumpyTracker Dashboard - Supabase Edition with Pagination & Caching
// Optimized for performance and cost reduction

const { useState, useEffect, useCallback, useMemo } = React;

// Configuration - Use values from supabase-browser-config.js
const SUPABASE_URL = window.SUPABASE_URL || window.SUPABASE_CONFIG?.SUPABASE_URL || 'https://osjbulmltfpcoldydexg.supabase.co';
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || window.SUPABASE_CONFIG?.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zamJ1bG1sdGZwY29sZHlkZXhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ3NjQ5NzEsImV4cCI6MjA3MDM0MDk3MX0.COtWEcun0Xkw5hUhaVEJGCrWbumj42L4vwWGgH7RyIE';

// Pagination settings
const ITEMS_PER_PAGE = 20;
const EO_ITEMS_PER_PAGE = 25;

// Cache settings - 24 hour cache since data updates once daily
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_KEY_PREFIX = 'tt_cache_';
const FORCE_REFRESH_HOUR = 12; // Force refresh at noon each day

// Cache helper functions
const getCachedData = (key) => {
  try {
    const cached = localStorage.getItem(CACHE_KEY_PREFIX + key);
    if (!cached) return null;
    
    const { data, timestamp } = JSON.parse(cached);
    const age = Date.now() - timestamp;
    
    // Check if cache is expired
    if (age > CACHE_DURATION) {
      localStorage.removeItem(CACHE_KEY_PREFIX + key);
      return null;
    }
    
    // Also expire if we've passed the daily refresh time
    const lastRefresh = new Date(timestamp);
    const now = new Date();
    if (now.getDate() !== lastRefresh.getDate() && now.getHours() >= FORCE_REFRESH_HOUR) {
      localStorage.removeItem(CACHE_KEY_PREFIX + key);
      return null;
    }
    
    console.log(`Using cached data for ${key} (age: ${Math.round(age/1000/60)} minutes)`);
    return data;
  } catch (error) {
    console.error('Cache read error:', error);
    return null;
  }
};

const setCachedData = (key, data) => {
  try {
    const cacheData = {
      data,
      timestamp: Date.now()
    };
    localStorage.setItem(CACHE_KEY_PREFIX + key, JSON.stringify(cacheData));
    console.log(`Cached data for ${key}`);
  } catch (error) {
    console.error('Cache write error:', error);
    // If localStorage is full, clear old cache entries
    if (error.name === 'QuotaExceededError') {
      clearOldCache();
    }
  }
};

const clearOldCache = () => {
  const keys = Object.keys(localStorage);
  keys.forEach(key => {
    if (key.startsWith(CACHE_KEY_PREFIX)) {
      localStorage.removeItem(key);
    }
  });
};

const clearCache = () => {
  clearOldCache();
  window.location.reload();
};

// Supabase request helper with caching
const supabaseRequest = async (endpoint, method = 'GET', body = null, useCache = true) => {
  // Try cache first for GET requests
  if (method === 'GET' && useCache) {
    const cached = getCachedData(endpoint);
    if (cached) return cached;
  }
  
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const options = {
    method,
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supabase error: ${response.status} - ${error}`);
  }

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    const data = await response.json();
    
    // Cache successful GET requests
    if (method === 'GET' && useCache) {
      setCachedData(endpoint, data);
    }
    
    return data;
  }
  
  return { success: true };
};

// Construction Banner Component
const ConstructionBanner = () => (
  <div className="bg-gradient-to-r from-yellow-600 to-orange-600 border-l-4 border-yellow-500 p-4 mb-6 shadow-lg">
    <div className="flex items-center justify-center">
      <div className="flex items-center space-x-3">
        <div className="text-2xl animate-bounce">🚧</div>
        <div className="text-center">
          <p className="text-yellow-100 font-semibold text-lg">
            🔨 Site Under Construction
          </p>
          <p className="text-yellow-200 text-sm">
            We're actively building new features. Have feedback? Contact us at: 
            <a href="mailto:contact.trumpytracker@gmail.com" className="text-white font-semibold underline hover:text-yellow-100 ml-1">
              contact.trumpytracker@gmail.com
            </a>
          </p>
        </div>
        <div className="text-2xl animate-bounce" style={{animationDelay: '0.5s'}}>🚧</div>
      </div>
    </div>
  </div>
);

// Main Dashboard Component
const TrumpyTrackerDashboard = () => {
  // State management
  const [activeTab, setActiveTab] = useState('political');
  const [allPoliticalEntries, setAllPoliticalEntries] = useState([]);
  const [displayedPoliticalEntries, setDisplayedPoliticalEntries] = useState([]);
  const [executiveOrders, setExecutiveOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({});
  const [activeFilter, setActiveFilter] = useState(null);
  
  // Pagination state
  const [politicalPage, setPoliticalPage] = useState(1);
  const [eoPage, setEoPage] = useState(1);
  const [totalPoliticalPages, setTotalPoliticalPages] = useState(1);
  const [totalEoPages, setTotalEoPages] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);

  // Load political entries with pagination
  const loadPoliticalEntries = useCallback(async (page = 1, append = false) => {
    try {
      setLoadingMore(true);
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
        setAllPoliticalEntries(data || []);
      }
      setDisplayedPoliticalEntries(data || []);
      setPoliticalPage(page);
    } catch (error) {
      console.error('Error loading political entries:', error);
      setError(`Failed to load political entries: ${error.message}`);
    } finally {
      setLoadingMore(false);
    }
  }, []);

  // Load executive orders with pagination
  const loadExecutiveOrders = useCallback(async (page = 1) => {
    try {
      const offset = (page - 1) * EO_ITEMS_PER_PAGE;
      
      // Get total count
      const countQuery = 'executive_orders?select=id';
      const countData = await supabaseRequest(countQuery);
      const totalCount = countData ? countData.length : 0;
      setTotalEoPages(Math.ceil(totalCount / EO_ITEMS_PER_PAGE));
      
      // Get paginated data
      const query = `executive_orders?order=date.desc,order_number.desc&limit=${EO_ITEMS_PER_PAGE}&offset=${offset}`;
      const data = await supabaseRequest(query);
      setExecutiveOrders(data || []);
      setEoPage(page);
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
        loadPoliticalEntries(1),
        loadExecutiveOrders(1),
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

  // Memoized filter counts - prevents recalculation on every render
  const filterCounts = useMemo(() => {
    if (!allPoliticalEntries) return { high: 0, medium: 0, low: 0, ice: 0, trump: 0 };
    
    return {
      high: allPoliticalEntries.filter(e => 
        e.severity?.toLowerCase() === 'high' || e.severity?.toLowerCase() === 'critical'
      ).length,
      medium: allPoliticalEntries.filter(e => 
        e.severity?.toLowerCase() === 'medium'
      ).length,
      low: allPoliticalEntries.filter(e => 
        e.severity?.toLowerCase() === 'low'
      ).length,
      ice: allPoliticalEntries.filter(e => 
        e.title?.toLowerCase().includes('ice') || 
        e.description?.toLowerCase().includes('ice') ||
        e.description?.toLowerCase().includes('immigration')
      ).length,
      trump: allPoliticalEntries.filter(e => 
        e.actor?.toLowerCase().includes('trump')
      ).length
    };
  }, [allPoliticalEntries]);

  // Filter function
  const applyFilter = (filterType) => {
    if (activeFilter === filterType) {
      setActiveFilter(null);
      setDisplayedPoliticalEntries(allPoliticalEntries);
    } else {
      setActiveFilter(filterType);
      let filtered = [...allPoliticalEntries];
      
      switch(filterType) {
        case 'high':
          filtered = allPoliticalEntries.filter(entry => 
            entry.severity?.toLowerCase() === 'high' || entry.severity?.toLowerCase() === 'critical'
          );
          break;
        case 'medium':
          filtered = allPoliticalEntries.filter(entry => 
            entry.severity?.toLowerCase() === 'medium'
          );
          break;
        case 'low':
          filtered = allPoliticalEntries.filter(entry => 
            entry.severity?.toLowerCase() === 'low'
          );
          break;
        case 'ice':
          filtered = allPoliticalEntries.filter(entry => 
            entry.title?.toLowerCase().includes('ice') || 
            entry.description?.toLowerCase().includes('ice') ||
            entry.description?.toLowerCase().includes('immigration') ||
            entry.category?.toLowerCase().includes('immigration')
          );
          break;
        case 'trump':
          filtered = allPoliticalEntries.filter(entry => 
            entry.actor?.toLowerCase().includes('trump') ||
            entry.title?.toLowerCase().includes('trump') ||
            entry.description?.toLowerCase().includes('trump')
          );
          break;
        default:
          filtered = allPoliticalEntries;
      }
      
      setDisplayedPoliticalEntries(filtered);
    }
  };

  // Format date for display
  const formatDate = (dateString) => {
    if (!dateString) return '';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return dateString;
    }
  };

  // Get severity badge color
  const getSeverityColor = (severity) => {
    switch (severity?.toLowerCase()) {
      case 'critical':
        return 'bg-red-600 text-white';
      case 'high':
        return 'bg-red-500 text-white';
      case 'medium':
        return 'bg-yellow-500 text-black';
      case 'low':
        return 'bg-green-500 text-white';
      default:
        return 'bg-gray-500 text-white';
    }
  };

  // Pagination Component
  const PaginationControls = ({ currentPage, totalPages, onPageChange }) => {
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

  // Stats component with clickable filters
  const StatsSection = ({ stats }) => (
    <div className="space-y-4 mb-8">
      {/* Main stats row - responsive grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-gray-800/50 backdrop-blur-md rounded-lg p-4 border border-gray-700">
          <div className="text-2xl font-bold text-white">{stats.total_entries || 0}</div>
          <div className="text-gray-400 text-sm">Total Political Entries</div>
        </div>
        <div className="bg-gray-800/50 backdrop-blur-md rounded-lg p-4 border border-gray-700">
          <div className="text-2xl font-bold text-red-400">{stats.high_severity_count || 0}</div>
          <div className="text-gray-400 text-sm">High Severity</div>
        </div>
        <div className="bg-gray-800/50 backdrop-blur-md rounded-lg p-4 border border-gray-700">
          <div className="text-2xl font-bold text-blue-400">{stats.total_executive_orders || 0}</div>
          <div className="text-gray-400 text-sm">Executive Orders</div>
        </div>
      </div>
      
      {/* Filter buttons - only show on political tab */}
      {activeTab === 'political' && (
        <div className="flex flex-wrap gap-2 justify-center">
          <button
            onClick={() => applyFilter('high')}
            className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
              activeFilter === 'high'
                ? 'bg-red-600 text-white'
                : 'bg-gray-800/50 text-gray-300 hover:bg-gray-700/50 border border-gray-700'
            }`}
            aria-label={`Filter by high severity (${filterCounts.high} items)`}
          >
            High ({filterCounts.high})
          </button>
          <button
            onClick={() => applyFilter('medium')}
            className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
              activeFilter === 'medium'
                ? 'bg-yellow-600 text-white'
                : 'bg-gray-800/50 text-gray-300 hover:bg-gray-700/50 border border-gray-700'
            }`}
            aria-label={`Filter by medium severity (${filterCounts.medium} items)`}
          >
            Medium ({filterCounts.medium})
          </button>
          <button
            onClick={() => applyFilter('low')}
            className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
              activeFilter === 'low'
                ? 'bg-green-600 text-white'
                : 'bg-gray-800/50 text-gray-300 hover:bg-gray-700/50 border border-gray-700'
            }`}
            aria-label={`Filter by low severity (${filterCounts.low} items)`}
          >
            Low ({filterCounts.low})
          </button>
          <div className="border-l border-gray-600 mx-2 hidden sm:block"></div>
          <button
            onClick={() => applyFilter('ice')}
            className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
              activeFilter === 'ice'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800/50 text-gray-300 hover:bg-gray-700/50 border border-gray-700'
            }`}
            aria-label={`Filter by ICE related (${filterCounts.ice} items)`}
          >
            ICE ({filterCounts.ice})
          </button>
          <button
            onClick={() => applyFilter('trump')}
            className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
              activeFilter === 'trump'
                ? 'bg-orange-600 text-white'
                : 'bg-gray-800/50 text-gray-300 hover:bg-gray-700/50 border border-gray-700'
            }`}
            aria-label={`Filter by Trump related (${filterCounts.trump} items)`}
          >
            Trump ({filterCounts.trump})
          </button>
        </div>
      )}
      
      {/* Cache indicator */}
      <div className="text-center">
        <button
          onClick={() => loadAllData(true)}
          className="text-xs text-gray-500 hover:text-gray-400"
        >
          🔄 Refresh Data (Last updated: {new Date().toLocaleDateString()})
        </button>
      </div>
    </div>
  );

  // Political entry card component
  const PoliticalEntryCard = ({ entry }) => (
    <div className="bg-gray-800/50 backdrop-blur-md rounded-lg p-6 border border-gray-700 hover:border-gray-600 transition-all duration-200">
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-gray-400 text-sm">{formatDate(entry.date)}</span>
            {entry.severity && (
              <span className={`px-2 py-1 rounded text-xs font-medium ${getSeverityColor(entry.severity)}`}>
                {entry.severity.toUpperCase()}
              </span>
            )}
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">{entry.title}</h3>
          {entry.actor && (
            <p className="text-blue-400 text-sm mb-2">Actor: {entry.actor}</p>
          )}
        </div>
      </div>
      
      {entry.description && (
        <p className="text-gray-300 text-sm mb-3 line-clamp-3">{entry.description}</p>
      )}
      
      <div className="flex justify-between items-center">
        {entry.category && (
          <span className="text-orange-400 text-xs bg-orange-900/30 px-2 py-1 rounded">
            {entry.category}
          </span>
        )}
        {entry.source_url && (
          <a 
            href={entry.source_url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 text-sm font-medium transition-colors"
          >
            View Source →
          </a>
        )}
      </div>
    </div>
  );

  // Executive order card component
  const ExecutiveOrderCard = ({ order }) => (
    <div className="bg-gray-800/50 backdrop-blur-md rounded-lg p-6 border border-gray-700 hover:border-gray-600 transition-all duration-200">
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-gray-400 text-sm">{formatDate(order.date)}</span>
            {order.order_number && (
              <span className="bg-blue-600 text-white px-2 py-1 rounded text-xs font-medium">
                EO {order.order_number}
              </span>
            )}
            {order.severity_rating && (
              <span className={`px-2 py-1 rounded text-xs font-medium ${getSeverityColor(order.severity_rating)}`}>
                {order.severity_rating.toUpperCase()}
              </span>
            )}
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">{order.title}</h3>
        </div>
      </div>
      
      {order.summary && (
        <p className="text-gray-300 text-sm mb-3 line-clamp-3">{order.summary}</p>
      )}
      
      <div className="flex justify-between items-center">
        {order.category && (
          <span className="text-purple-400 text-xs bg-purple-900/30 px-2 py-1 rounded">
            {order.category}
          </span>
        )}
        {order.source_url && (
          <a 
            href={order.source_url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 text-sm font-medium transition-colors"
          >
            View Source →
          </a>
        )}
      </div>
    </div>
  );

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
          <p className="text-gray-400 mb-6">{error}</p>
          <button 
            onClick={() => loadAllData(true)}
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

        {/* Statistics Section with Filter Buttons */}
        <StatsSection stats={stats} />

        {/* Tab Navigation */}
        <div className="flex justify-center mb-8">
          <div className="bg-gray-800/50 backdrop-blur-md rounded-lg p-1 border border-gray-700">
            <button
              onClick={() => {
                setActiveTab('political');
                setActiveFilter(null);
                setDisplayedPoliticalEntries(allPoliticalEntries);
              }}
              className={`px-6 py-2 rounded-md font-medium transition-all duration-200 ${
                activeTab === 'political'
                  ? 'bg-orange-600 text-white shadow-lg'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              Political Entries
            </button>
            <button
              onClick={() => setActiveTab('executive')}
              className={`px-6 py-2 rounded-md font-medium transition-all duration-200 ${
                activeTab === 'executive'
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              Executive Orders
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="space-y-6">
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
                <div className="text-center text-gray-400 py-12">
                  <p className="text-xl mb-2">
                    {activeFilter ? 'No entries match this filter' : 'No political entries found'}
                  </p>
                  {activeFilter && (
                    <button
                      onClick={() => {
                        setActiveFilter(null);
                        setDisplayedPoliticalEntries(allPoliticalEntries);
                      }}
                      className="mt-4 text-blue-400 hover:text-blue-300"
                    >
                      Clear filter
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {displayedPoliticalEntries.map(entry => (
                      <PoliticalEntryCard key={entry.id} entry={entry} />
                    ))}
                  </div>
                  
                  {!activeFilter && (
                    <PaginationControls
                      currentPage={politicalPage}
                      totalPages={totalPoliticalPages}
                      onPageChange={(page) => loadPoliticalEntries(page)}
                    />
                  )}
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
                <div className="text-center text-gray-400 py-12">
                  <p className="text-xl mb-2">No executive orders found</p>
                  <p>Check back later for updates</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {executiveOrders.map(order => (
                      <ExecutiveOrderCard key={order.id} order={order} />
                    ))}
                  </div>
                  
                  <PaginationControls
                    currentPage={eoPage}
                    totalPages={totalEoPages}
                    onPageChange={(page) => loadExecutiveOrders(page)}
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
    </div>
  );
};

// Render the dashboard
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<TrumpyTrackerDashboard />);