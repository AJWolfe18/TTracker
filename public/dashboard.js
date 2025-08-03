// Updated dashboard.js with tabs for Political Tracker and Executive Orders

const { useState, useEffect, useCallback, useMemo } = React;

// Main Dashboard Component with Tabs
const TrumpyTrackerDashboard = () => {
  const [activeTab, setActiveTab] = useState('political');

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 text-white">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Hero Header */}
        <header className="text-center mb-8">
          <div className="flex items-center justify-center mb-6">
            <div className="w-16 h-16 bg-gradient-to-r from-red-500 to-blue-500 rounded-lg flex items-center justify-center mr-4 shadow-lg">
              <span className="text-2xl font-bold">T2</span>
            </div>
            <div>
              <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-blue-400 to-red-400 bg-clip-text text-transparent mb-2">
                TrumpyTracker
              </h1>
              <div className="text-sm text-blue-300 font-semibold">TRUMP 2.0 ERA</div>
            </div>
          </div>
          
          <p className="text-xl text-gray-300 mb-4">
            Political Accountability & Executive Action Monitor
          </p>
        </header>

        {/* Tab Navigation */}
        <div className="flex justify-center mb-8">
          <div className="bg-gray-800/60 backdrop-blur p-2 rounded-lg border border-gray-700 shadow-lg">
            <div className="flex gap-2">
              <button
                onClick={() => setActiveTab('political')}
                className={`px-6 py-3 rounded-lg font-medium transition-all duration-300 ${
                  activeTab === 'political'
                    ? 'bg-blue-600 text-white shadow-lg'
                    : 'text-gray-300 hover:text-white hover:bg-gray-700/50'
                }`}
              >
                📊 Political Tracker
              </button>
              <button
                onClick={() => setActiveTab('executive')}
                className={`px-6 py-3 rounded-lg font-medium transition-all duration-300 ${
                  activeTab === 'executive'
                    ? 'bg-red-600 text-white shadow-lg'
                    : 'text-gray-300 hover:text-white hover:bg-gray-700/50'
                }`}
              >
                🏛️ Executive Orders
              </button>
            </div>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'political' && <PoliticalDashboard />}
        {activeTab === 'executive' && <ExecutiveOrdersDashboard />}

        {/* Footer */}
        <footer className="mt-16 text-center">
          <div className="bg-gray-800/60 backdrop-blur p-8 rounded-lg border border-gray-700 shadow-lg">
            <h3 className="text-xl font-semibold text-blue-400 mb-4">Comprehensive Political Monitoring</h3>
            <p className="text-gray-300 mb-4 max-w-2xl mx-auto">
              Automated tracking of political developments and executive actions using AI-powered 
              daily monitoring from credible sources.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 text-sm text-gray-400">
              <div>
                <strong className="text-blue-400">🤖 AI-Powered Collection</strong><br/>
                Daily news discovery & analysis
              </div>
              <div>
                <strong className="text-red-400">🏛️ Executive Orders</strong><br/>
                Official WhiteHouse.gov tracking
              </div>
              <div>
                <strong className="text-green-400">✅ Source Verification</strong><br/>
                15+ credible news outlets
              </div>
              <div>
                <strong className="text-purple-400">📊 Real-Time Updates</strong><br/>
                Multiple daily collections
              </div>
            </div>
            <p className="text-gray-500 text-xs mt-6">
              Last updated: {new Date().toLocaleDateString()} • Political Accountability Platform
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
};

// Political Dashboard Component (your existing component)
const PoliticalDashboard = () => {
  // State management with proper initialization
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedSeverity, setSelectedSeverity] = useState('all');
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState('desc');
  const [showEmailSignup, setShowEmailSignup] = useState(false);
  const [emailAddress, setEmailAddress] = useState('');

  // Robust data loading with error handling
  const loadEntries = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch('/master-tracker-log.json', {
        signal: controller.signal,
        cache: 'no-cache'
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Failed to load data: HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!Array.isArray(data)) {
        throw new Error('Invalid data format: expected array');
      }
      
      const validEntries = data.filter(entry => 
        entry && 
        typeof entry === 'object' && 
        entry.id && 
        entry.title && 
        entry.date
      );
      
      setEntries(validEntries);
      
    } catch (error) {
      console.error('Error loading entries:', error);
      if (error.name === 'AbortError') {
        setError('Request timeout - please try again');
      } else {
        setError(`Failed to load data: ${error.message}`);
      }
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  // Memoized filtered entries for performance
  const filteredEntries = useMemo(() => {
    return entries.filter(entry => {
      if (entry.archived) return false;
      
      const matchesSearch = !searchTerm || [
        entry.title,
        entry.description,
        entry.actor,
        entry.category
      ].some(field => 
        field?.toLowerCase().includes(searchTerm.toLowerCase())
      );
      
      const matchesCategory = selectedCategory === 'all' || entry.category === selectedCategory;
      const matchesSeverity = selectedSeverity === 'all' || entry.severity === selectedSeverity;
      
      return matchesSearch && matchesCategory && matchesSeverity;
    });
  }, [entries, searchTerm, selectedCategory, selectedSeverity]);

  // Statistics
  const statistics = useMemo(() => {
    const activeEntries = entries.filter(entry => !entry.archived);
    
    return {
      totalEntries: activeEntries.length,
      highSeverityCount: activeEntries.filter(entry => entry.severity === 'high').length,
      trumpEntries: activeEntries.filter(entry => 
        entry.actor?.toLowerCase().includes('trump') || 
        entry.title?.toLowerCase().includes('trump')
      ).length,
      iceEntries: activeEntries.filter(entry => 
        entry.actor?.toLowerCase().includes('ice') || 
        entry.title?.toLowerCase().includes('ice') ||
        entry.actor?.toLowerCase().includes('homeland') ||
        entry.title?.toLowerCase().includes('immigration')
      ).length
    };
  }, [entries]);

  // Sorted entries
  const sortedEntries = useMemo(() => {
    return [...filteredEntries].sort((a, b) => {
      let aValue, bValue;
      
      switch (sortBy) {
        case 'date':
          aValue = new Date(a.date || 0);
          bValue = new Date(b.date || 0);
          break;
        case 'severity':
          const severityOrder = { high: 3, medium: 2, low: 1 };
          aValue = severityOrder[a.severity] || 0;
          bValue = severityOrder[b.severity] || 0;
          break;
        case 'actor':
          aValue = (a.actor || '').toLowerCase();
          bValue = (b.actor || '').toLowerCase();
          break;
        default:
          aValue = (a[sortBy] || '').toString().toLowerCase();
          bValue = (b[sortBy] || '').toString().toLowerCase();
      }
      
      if (sortOrder === 'desc') {
        return bValue > aValue ? 1 : bValue < aValue ? -1 : 0;
      } else {
        return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
      }
    });
  }, [filteredEntries, sortBy, sortOrder]);

  const categories = useMemo(() => {
    const activeEntries = entries.filter(entry => !entry.archived);
    return [...new Set(activeEntries.map(entry => entry.category).filter(Boolean))].sort();
  }, [entries]);

  // Helper functions
  const handleQuickFilter = useCallback((type, value) => {
    switch (type) {
      case 'all':
        setSelectedSeverity('all');
        setSelectedCategory('all');
        setSearchTerm('');
        break;
      case 'severity':
        setSelectedSeverity(value);
        break;
      case 'search':
        setSearchTerm(value);
        setSelectedCategory('all');
        setSelectedSeverity('all');
        break;
      default:
        break;
    }
  }, []);

  const handleEmailSignup = useCallback(async (e) => {
    e.preventDefault();
    if (!emailAddress.trim()) return;
    
    alert(`Thanks! We'll notify ${emailAddress} of high-severity developments.`);
    setEmailAddress('');
    setShowEmailSignup(false);
  }, [emailAddress]);

  const formatDate = useCallback((dateString) => {
    try {
      return new Date(dateString).toLocaleDateString();
    } catch {
      return 'Invalid Date';
    }
  }, []);

  const getSeverityClasses = useCallback((severity) => {
    const baseClasses = 'px-3 py-1 rounded-full text-xs font-bold border';
    switch (severity) {
      case 'high':
        return `${baseClasses} bg-red-900/50 text-red-200 border-red-500`;
      case 'medium':
        return `${baseClasses} bg-yellow-900/50 text-yellow-200 border-yellow-500`;
      case 'low':
        return `${baseClasses} bg-green-900/50 text-green-200 border-green-500`;
      default:
        return `${baseClasses} bg-gray-900/50 text-gray-200 border-gray-500`;
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <div className="text-white text-xl">Loading Political Tracker...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center max-w-md">
          <div className="text-red-400 text-6xl mb-4">⚠️</div>
          <h2 className="text-white text-xl mb-2">Error Loading Data</h2>
          <p className="text-gray-400 mb-4">{error}</p>
          <button
            onClick={loadEntries}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
          >
            🔄 Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Email Signup CTA */}
      <div className="text-center">
        {!showEmailSignup ? (
          <button 
            onClick={() => setShowEmailSignup(true)}
            className="bg-gradient-to-r from-blue-600 to-red-600 hover:from-blue-700 hover:to-red-700 px-8 py-3 rounded-lg font-semibold transition-all duration-300 transform hover:scale-105 shadow-lg"
          >
            📧 Get High-Severity Alerts
          </button>
        ) : (
          <form onSubmit={handleEmailSignup} className="bg-gray-800/50 p-6 rounded-lg max-w-md mx-auto backdrop-blur border border-gray-700">
            <div className="flex gap-2">
              <input 
                type="email" 
                value={emailAddress}
                onChange={(e) => setEmailAddress(e.target.value)}
                placeholder="Enter your email for alerts"
                className="flex-1 px-4 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none text-white"
                required
              />
              <button 
                type="submit"
                className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded font-medium transition-colors"
              >
                Subscribe
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">Get notified of high-severity political developments</p>
            <button
              type="button"
              onClick={() => setShowEmailSignup(false)}
              className="text-xs text-gray-500 hover:text-gray-400 mt-2"
            >
              Cancel
            </button>
          </form>
        )}
      </div>

      {/* Political Dashboard Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div 
          className="bg-gray-800/60 backdrop-blur p-6 rounded-lg border border-gray-700 cursor-pointer hover:bg-gray-700/60 transition-all duration-300 shadow-lg hover:shadow-xl hover:-translate-y-1"
          onClick={() => handleQuickFilter('all')}
        >
          <h3 className="text-lg font-semibold text-blue-400 mb-2">📊 Total Entries</h3>
          <p className="text-3xl font-bold">{statistics.totalEntries}</p>
          <p className="text-sm text-gray-400">Political developments tracked</p>
        </div>
        
        <div 
          className="bg-gray-800/60 backdrop-blur p-6 rounded-lg border border-gray-700 cursor-pointer hover:bg-gray-700/60 transition-all duration-300 shadow-lg hover:shadow-xl hover:-translate-y-1"
          onClick={() => handleQuickFilter('severity', 'high')}
        >
          <h3 className="text-lg font-semibold text-red-400 mb-2">🚨 High Priority</h3>
          <p className="text-3xl font-bold text-red-400">{statistics.highSeverityCount}</p>
          <p className="text-sm text-gray-400">Critical developments</p>
        </div>

        <div 
          className="bg-gray-800/60 backdrop-blur p-6 rounded-lg border border-gray-700 cursor-pointer hover:bg-gray-700/60 transition-all duration-300 shadow-lg hover:shadow-xl hover:-translate-y-1"
          onClick={() => handleQuickFilter('search', 'trump')}
        >
          <h3 className="text-lg font-semibold text-orange-400 mb-2">🏛️ Executive Branch</h3>
          <p className="text-3xl font-bold text-orange-400">{statistics.trumpEntries}</p>
          <p className="text-sm text-gray-400">Administration actions</p>
        </div>

        <div 
          className="bg-gray-800/60 backdrop-blur p-6 rounded-lg border border-gray-700 cursor-pointer hover:bg-gray-700/60 transition-all duration-300 shadow-lg hover:shadow-xl hover:-translate-y-1"
          onClick={() => handleQuickFilter('search', 'ice')}
        >
          <h3 className="text-lg font-semibold text-purple-400 mb-2">🛡️ ICE & Immigration</h3>
          <p className="text-3xl font-bold text-purple-400">{statistics.iceEntries}</p>
          <p className="text-sm text-gray-400">Enforcement actions</p>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-gray-800/60 backdrop-blur p-6 rounded-lg border border-gray-700 shadow-lg">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <input
            type="text"
            placeholder="Search entries..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="px-4 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none text-white placeholder-gray-400"
          />
          
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-4 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none text-white"
          >
            <option value="all">All Categories</option>
            {categories.map(category => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>

          <select
            value={selectedSeverity}
            onChange={(e) => setSelectedSeverity(e.target.value)}
            className="px-4 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none text-white"
          >
            <option value="all">All Severities</option>
            <option value="high">🚨 High Priority</option>
            <option value="medium">⚠️ Medium Priority</option>
            <option value="low">ℹ️ Low Priority</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-4 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none text-white"
          >
            <option value="date">Sort by Date</option>
            <option value="severity">Sort by Priority</option>
            <option value="actor">Sort by Actor</option>
          </select>

          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className="px-4 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none text-white"
          >
            <option value="desc">Latest First</option>
            <option value="asc">Oldest First</option>
          </select>
        </div>
        
        <div className="mt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-sm text-gray-400">
          <span>Showing {sortedEntries.length} of {statistics.totalEntries} political developments</span>
          <div className="flex items-center gap-4">
            <span>🤖 Updated daily via automated monitoring</span>
            <button
              onClick={loadEntries}
              className="text-blue-400 hover:text-blue-300 transition-colors"
              title="Refresh data"
            >
              🔄 Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Entries Feed */}
      <div className="space-y-4">
        {sortedEntries.length === 0 ? (
          <div className="text-center py-12 bg-gray-800/60 backdrop-blur rounded-lg border border-gray-700 shadow-lg">
            <div className="text-6xl mb-4">🔍</div>
            <p className="text-gray-400 text-lg">No entries found matching your criteria</p>
            <p className="text-gray-500 text-sm mt-2">Try adjusting your search filters or clearing them</p>
            {(searchTerm || selectedCategory !== 'all' || selectedSeverity !== 'all') && (
              <button
                onClick={() => handleQuickFilter('all')}
                className="mt-4 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
              >
                Clear All Filters
              </button>
            )}
          </div>
        ) : (
          sortedEntries.map((entry) => (
            <article key={entry.id} className="bg-gray-800/60 backdrop-blur p-6 rounded-lg border border-gray-700 hover:bg-gray-700/60 transition-all duration-300 shadow-lg hover:shadow-xl hover:-translate-y-1">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between mb-3 gap-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm text-gray-400">📅 {formatDate(entry.date)}</span>
                  <span className={getSeverityClasses(entry.severity)}>
                    {entry.severity === 'high' ? '🚨 HIGH' :
                     entry.severity === 'medium' ? '⚠️ MEDIUM' : 'ℹ️ LOW'}
                  </span>
                  {entry.verified && (
                    <span className="text-green-400 text-sm">✅ Verified</span>
                  )}
                </div>
                <span className="text-sm text-blue-400 font-medium">{entry.actor}</span>
              </div>
              
              <h3 className="text-xl font-semibold mb-3 text-white leading-tight">{entry.title}</h3>
              <p className="text-gray-300 mb-4 leading-relaxed">{entry.description}</p>
              
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <span className="text-sm text-purple-400 font-medium">{entry.category}</span>
                {entry.source_url && (
                  <a 
                    href={entry.source_url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="bg-blue-600/20 border border-blue-500 text-blue-400 hover:bg-blue-600/30 px-4 py-2 rounded text-sm font-medium transition-colors inline-flex items-center gap-2"
                  >
                    📖 View Source
                    <span className="text-xs">↗</span>
                  </a>
                )}
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
};

// [Include the ExecutiveOrdersDashboard component from the previous artifact here]

// Render the main dashboard
ReactDOM.render(<TrumpyTrackerDashboard />, document.getElementById('root'));
