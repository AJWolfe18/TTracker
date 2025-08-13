// TrumpyTracker Dashboard - Supabase Edition
// Updated to pull data directly from PostgreSQL database

const { useState, useEffect, useCallback, useMemo } = React;

// Supabase Configuration
const SUPABASE_URL = 'https://osjbulmltfpcoldydexg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zamJ1bG1sdGZwY29sZHlkZXhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ3NjQ5NzEsImV4cCI6MjA3MDM0MDk3MX0.COtWEcun0Xkw5hUhaVEJGCrWbumj42L4vwWGgH7RyIE';

// Helper function for Supabase API calls
const supabaseRequest = async (endpoint, method = 'GET', body = null) => {
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
    return await response.json();
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

// Main Dashboard Component with Supabase Integration
const TrumpyTrackerDashboard = () => {
  const [activeTab, setActiveTab] = useState('political');
  const [politicalEntries, setPoliticalEntries] = useState([]);
  const [executiveOrders, setExecutiveOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({});

  // Load political entries from Supabase
  const loadPoliticalEntries = useCallback(async () => {
    try {
      // Default to showing things about Trump (actor filter)
      const query = 'political_entries?archived=neq.true&order=date.desc,added_at.desc&limit=50';
      const data = await supabaseRequest(query);
      
      // Filter for Trump-related entries by default
      const trumpEntries = data.filter(entry => 
        entry.actor && entry.actor.toLowerCase().includes('trump')
      );
      
      setPoliticalEntries(trumpEntries.length > 0 ? trumpEntries : data);
    } catch (error) {
      console.error('Error loading political entries:', error);
      setError(`Failed to load political entries: ${error.message}`);
    }
  }, []);

  // Load executive orders from Supabase
  const loadExecutiveOrders = useCallback(async () => {
    try {
      const query = 'executive_orders?order=date.desc,order_number.desc&limit=25';
      const data = await supabaseRequest(query);
      setExecutiveOrders(data || []);
    } catch (error) {
      console.error('Error loading executive orders:', error);
      setError(`Failed to load executive orders: ${error.message}`);
    }
  }, []);

  // Load dashboard statistics
  const loadStats = useCallback(async () => {
    try {
      const statsData = await supabaseRequest('dashboard_stats');
      if (statsData && statsData.length > 0) {
        setStats(statsData[0]);
      }
    } catch (error) {
      console.error('Error loading stats:', error);
      // Stats are nice-to-have, don't set error state for this
    }
  }, []);

  // Load all data
  const loadAllData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      await Promise.all([
        loadPoliticalEntries(),
        loadExecutiveOrders(),
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
  }, [loadAllData]);

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

  // Stats component
  const StatsSection = ({ stats }) => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
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
      <div className="bg-gray-800/50 backdrop-blur-md rounded-lg p-4 border border-gray-700">
        <div className="text-2xl font-bold text-green-400">{formatDate(stats.latest_entry_date)}</div>
        <div className="text-gray-400 text-sm">Latest Entry</div>
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

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 text-white flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-red-500 text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold mb-4">Connection Error</h2>
          <p className="text-gray-400 mb-6">{error}</p>
          <button 
            onClick={loadAllData}
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

        {/* Statistics Section */}
        <StatsSection stats={stats} />

        {/* Tab Navigation */}
        <div className="flex justify-center mb-8">
          <div className="bg-gray-800/50 backdrop-blur-md rounded-lg p-1 border border-gray-700">
            <button
              onClick={() => setActiveTab('political')}
              className={`px-6 py-2 rounded-md font-medium transition-all duration-200 ${
                activeTab === 'political'
                  ? 'bg-orange-600 text-white shadow-lg'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              Political Entries ({politicalEntries.length})
            </button>
            <button
              onClick={() => setActiveTab('executive')}
              className={`px-6 py-2 rounded-md font-medium transition-all duration-200 ${
                activeTab === 'executive'
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              Executive Orders ({executiveOrders.length})
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="space-y-6">
          {activeTab === 'political' && (
            <div>
              <h2 className="text-2xl font-bold mb-6 text-center">
                Recent Political Accountability Entries
              </h2>
              {politicalEntries.length === 0 ? (
                <div className="text-center text-gray-400 py-12">
                  <p className="text-xl mb-2">No political entries found</p>
                  <p>Check back later for updates</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {politicalEntries.map(entry => (
                    <PoliticalEntryCard key={entry.id} entry={entry} />
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'executive' && (
            <div>
              <h2 className="text-2xl font-bold mb-6 text-center">
                Recent Executive Orders
              </h2>
              {executiveOrders.length === 0 ? (
                <div className="text-center text-gray-400 py-12">
                  <p className="text-xl mb-2">No executive orders found</p>
                  <p>Check back later for updates</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {executiveOrders.map(order => (
                    <ExecutiveOrderCard key={order.id} order={order} />
                  ))}
                </div>
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
            Data updated in real-time from our database
          </p>
        </footer>
      </div>
    </div>
  );
};

// Render the dashboard
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<TrumpyTrackerDashboard />);