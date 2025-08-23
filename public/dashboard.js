// TrumpyTracker Dashboard - Supabase Edition with Pagination & Caching
// Optimized for performance and cost reduction

// Import useRef at the top
const { useState, useEffect, useCallback, useMemo, useRef } = React;

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

// Supabase request helper with caching and retry logic
const supabaseRequest = async (endpoint, method = 'GET', body = null, useCache = true, retries = 3) => {
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

  // Retry logic with exponential backoff
  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
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
    } catch (error) {
      lastError = error;
      console.warn(`Attempt ${attempt + 1} failed for ${endpoint}:`, error.message);
      
      // Don't retry on 4xx errors (client errors)
      if (error.message.includes('Supabase error: 4')) {
        throw error;
      }
      
      // Wait before retrying (exponential backoff)
      if (attempt < retries - 1) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
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

// Content Modal Component
const ContentModal = ({ isOpen, onClose, title, date, content, severity, category, sourceUrl, actor, orderNumber }) => {
  // Handle escape key with proper cleanup
  useEffect(() => {
    if (!isOpen) return;
    
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    
    document.addEventListener('keydown', handleEscape);
    // Properly clean up event listener to prevent memory leaks
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);
  
  if (!isOpen) return null;
  
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
  
  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-75 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div 
        className="bg-gray-800 rounded-lg max-w-3xl w-full"
        style={{
          maxHeight: '90vh',
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

// Main Dashboard Component
const TrumpyTrackerDashboard = () => {
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
  
  // Search and filter state
  const [searchTerm, setSearchTerm] = useState('');
  const searchDebounceRef = useRef(null);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [dateRange, setDateRange] = useState('all');
  const [sortOrder, setSortOrder] = useState('newest');
  
  // Modal state
  const [modalContent, setModalContent] = useState(null);
  
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
        case 'ice':
          filtered = filtered.filter(entry => 
            entry.title?.toLowerCase().includes('ice') || 
            entry.description?.toLowerCase().includes('ice') ||
            entry.description?.toLowerCase().includes('immigration') ||
            entry.category?.toLowerCase().includes('immigration')
          );
          break;
        case 'trump':
          filtered = filtered.filter(entry => 
            entry.actor?.toLowerCase().includes('trump') ||
            entry.title?.toLowerCase().includes('trump') ||
            entry.description?.toLowerCase().includes('trump')
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

  // Apply severity filter helper
  const applySeverityFilter = useCallback((entries, filterType) => {
    switch(filterType) {
      case 'high':
        return entries.filter(entry => 
          entry.severity?.toLowerCase() === 'high' || entry.severity?.toLowerCase() === 'critical'
        );
      case 'medium':
        return entries.filter(entry => 
          entry.severity?.toLowerCase() === 'medium'
        );
      case 'low':
        return entries.filter(entry => 
          entry.severity?.toLowerCase() === 'low'
        );
      case 'ice':
        return entries.filter(entry => 
          entry.title?.toLowerCase().includes('ice') || 
          entry.description?.toLowerCase().includes('ice') ||
          entry.description?.toLowerCase().includes('immigration') ||
          entry.category?.toLowerCase().includes('immigration')
        );
      case 'trump':
        return entries.filter(entry => 
          entry.actor?.toLowerCase().includes('trump') ||
          entry.title?.toLowerCase().includes('trump') ||
          entry.description?.toLowerCase().includes('trump')
        );
      default:
        return entries;
    }
  }, []);

  // Memoized filter counts - prevents recalculation on every render
  const filterCounts = useMemo(() => {
    if (!allPoliticalEntries) return { high: 0, medium: 0, low: 0, ice: 0, trump: 0 };
    
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
      ).length,
      ice: baseFiltered.filter(e => 
        e.title?.toLowerCase().includes('ice') || 
        e.description?.toLowerCase().includes('ice') ||
        e.description?.toLowerCase().includes('immigration')
      ).length,
      trump: baseFiltered.filter(e => 
        e.actor?.toLowerCase().includes('trump')
      ).length
    };
  }, [allPoliticalEntries, searchTerm, selectedCategory, dateRange, applySearch]);

  // Filter function
  const applyFilter = (filterType) => {
    if (activeFilter === filterType) {
      setActiveFilter(null);
      // Apply search if there's a search term
      const filtered = searchTerm ? applySearch(allPoliticalEntries, searchTerm) : allPoliticalEntries;
      
      // Paginate the filtered results
      const paginatedFiltered = filtered.slice((politicalPage - 1) * ITEMS_PER_PAGE, politicalPage * ITEMS_PER_PAGE);
      setDisplayedPoliticalEntries(paginatedFiltered);
      setTotalPoliticalPages(Math.ceil(filtered.length / ITEMS_PER_PAGE));
    } else {
      setActiveFilter(filterType);
      
      // Apply search first if there's a search term
      let filtered = searchTerm ? applySearch(allPoliticalEntries, searchTerm) : [...allPoliticalEntries];
      
      // Then apply severity filter
      filtered = applySeverityFilter(filtered, filterType);
      
      // Paginate the filtered results
      const paginatedFiltered = filtered.slice(0, ITEMS_PER_PAGE);
      setDisplayedPoliticalEntries(paginatedFiltered);
      setTotalPoliticalPages(Math.ceil(filtered.length / ITEMS_PER_PAGE));
      setPoliticalPage(1); // Reset to page 1 when filtering
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

  // Political entry card component with line-clamp
  const PoliticalEntryCard = ({ entry }) => {
    // Use optional chaining for better null safety
    const hasLongDescription = entry.description?.length > 200;
    
    return (
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
          <div>
            <p className="text-gray-300 text-sm mb-3" style={{
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              lineHeight: '1.5'
            }}>
              {entry.description}
            </p>
            {hasLongDescription && (
              <button
                onClick={() => setModalContent({
                  title: entry.title,
                  date: entry.date,
                  content: entry.description,
                  severity: entry.severity,
                  category: entry.category,
                  sourceUrl: entry.source_url,
                  actor: entry.actor
                })}
                className="text-blue-400 hover:text-blue-300 text-sm font-medium transition-colors"
              >
                Read more →
              </button>
            )}
          </div>
        )}
      
        <div className="flex justify-between items-center mt-3">
          <div>
            {entry.category && (
              <span className="text-orange-400 text-xs bg-orange-900/30 px-2 py-1 rounded">
                {entry.category}
              </span>
            )}
          </div>
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
  };

  // Executive order card component with line-clamp
  const ExecutiveOrderCard = ({ order }) => {
    // Use optional chaining for better null safety
    const hasLongSummary = order.summary?.length > 200;
    
    return (
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
          <div>
            <p className="text-gray-300 text-sm mb-3" style={{
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              lineHeight: '1.5'
            }}>
              {order.summary}
            </p>
            {hasLongSummary && (
              <button
                onClick={() => setModalContent({
                  title: order.title,
                  date: order.date,
                  content: order.summary,
                  severity: order.severity_rating,
                  category: order.category,
                  sourceUrl: order.source_url,
                  orderNumber: order.order_number
                })}
                className="text-blue-400 hover:text-blue-300 text-sm font-medium transition-colors"
              >
                Read more →
              </button>
            )}
          </div>
        )}
      
        <div className="flex justify-between items-center mt-3">
          <div>
            {order.category && (
              <span className="text-purple-400 text-xs bg-purple-900/30 px-2 py-1 rounded">
                {order.category}
              </span>
            )}
          </div>
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
  };

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

        {/* Search and Filter Bar */}
        <div className="bg-gray-800/50 backdrop-blur-md rounded-lg p-4 border border-gray-700 mb-6">
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
                <span className="ml-2 text-gray-500">
                  • Showing {displayedPoliticalEntries.length} of {allPoliticalEntries.length} entries
                </span>
              )}
              {activeTab === 'executive' && (
                <span className="ml-2 text-gray-500">
                  • Showing {executiveOrders.length} of {allExecutiveOrders.length} orders
                </span>
              )}
            </div>
          )}
        </div>

        {/* Statistics Section with Filter Buttons */}
        <StatsSection stats={stats} />

        {/* Tab Navigation */}
        <div className="flex justify-center mb-8">
          <div className="bg-gray-800/50 backdrop-blur-md rounded-lg p-1 border border-gray-700">
            <button
              onClick={() => {
                setActiveTab('political');
                // Apply all current filters to political entries
                const filtered = applyAllFilters(allPoliticalEntries);
                const paginatedFiltered = filtered.slice(0, ITEMS_PER_PAGE);
                setDisplayedPoliticalEntries(paginatedFiltered);
                setTotalPoliticalPages(Math.ceil(filtered.length / ITEMS_PER_PAGE));
                setPoliticalPage(1);
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
              onClick={() => {
                setActiveTab('executive');
                // Apply all current filters to executive orders
                const filtered = applyAllFilters(allExecutiveOrders);
                const paginatedFiltered = filtered.slice(0, EO_ITEMS_PER_PAGE);
                setExecutiveOrders(paginatedFiltered);
                setTotalEoPages(Math.ceil(filtered.length / EO_ITEMS_PER_PAGE));
                setEoPage(1);
              }}
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
      
      {/* Content Modal */}
      <ContentModal 
        isOpen={!!modalContent}
        onClose={() => setModalContent(null)}
        {...modalContent}
      />
    </div>
  );
};

// Render the dashboard
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<TrumpyTrackerDashboard />);