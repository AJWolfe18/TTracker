const { useState, useEffect } = React;

const PoliticalDashboard = () => {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedSeverity, setSelectedSeverity] = useState('all');
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState('desc');
  const [showEmailSignup, setShowEmailSignup] = useState(false);

  useEffect(() => {
    loadEntries();
  }, []);

  const loadEntries = async () => {
    try {
      const response = await fetch('/master-tracker-log.json');
      const data = await response.json();
      setEntries(data || []);
    } catch (error) {
      console.error('Error loading entries:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredEntries = entries.filter(entry => {
    // Filter out archived items from public view
    if (entry.archived) return false;
    
    // Apply all filters
    const matchesSearch = !searchTerm || 
        entry.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.actor?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCategory = selectedCategory === 'all' || entry.category === selectedCategory;
    const matchesSeverity = selectedSeverity === 'all' || entry.severity === selectedSeverity;
    
    return matchesSearch && matchesCategory && matchesSeverity;
  });

  // Calculate statistics from active (non-archived) entries only
  const activeEntries = entries.filter(entry => !entry.archived);
  const totalEntries = activeEntries.length;
  const highSeverityCount = activeEntries.filter(entry => entry.severity === 'high').length;
  const trumpEntries = activeEntries.filter(entry => 
    entry.actor?.toLowerCase().includes('trump') || 
    entry.title?.toLowerCase().includes('trump')
  ).length;
  const muskEntries = activeEntries.filter(entry => 
    entry.actor?.toLowerCase().includes('musk') || 
    entry.title?.toLowerCase().includes('musk') ||
    entry.title?.toLowerCase().includes('doge')
  ).length;

  const sortedEntries = [...filteredEntries].sort((a, b) => {
    let aValue, bValue;
    
    if (sortBy === 'date') {
      aValue = new Date(a.date);
      bValue = new Date(b.date);
    } else if (sortBy === 'severity') {
      const severityOrder = { high: 3, medium: 2, low: 1 };
      aValue = severityOrder[a.severity] || 0;
      bValue = severityOrder[b.severity] || 0;
    } else {
      aValue = a[sortBy]?.toLowerCase() || '';
      bValue = b[sortBy]?.toLowerCase() || '';
    }
    
    if (sortOrder === 'desc') {
      return bValue > aValue ? 1 : -1;
    } else {
      return aValue > bValue ? 1 : -1;
    }
  });

  const categories = [...new Set(activeEntries.map(entry => entry.category))].sort();

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <div className="text-white text-xl">Loading AI Political Intelligence...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 text-white">
      <div className="container mx-auto px-4 py-8">
        {/* Hero Header */}
        <header className="text-center mb-12">
          <div className="flex items-center justify-center mb-6">
            <div className="w-16 h-16 bg-gradient-to-r from-red-500 to-blue-500 rounded-lg flex items-center justify-center mr-4">
              <span className="text-2xl font-bold">T2</span>
            </div>
            <div>
              <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-400 to-red-400 bg-clip-text text-transparent mb-2">
                TrumpyTracker
              </h1>
              <div className="text-sm text-blue-300 font-semibold">TRUMP 2.0 ERA</div>
            </div>
          </div>
          
          <p className="text-xl text-gray-300 mb-4">
            AI-Powered Real-Time Political Intelligence
          </p>
          <p className="text-gray-400 max-w-2xl mx-auto">
            Automated daily monitoring of Trump Administration 2.0, federal agencies, and key political actors. 
            Real news discovery with AI verification from credible sources.
          </p>
          
          {/* Email Signup CTA */}
          <div className="mt-6">
            {!showEmailSignup ? (
              <button 
                onClick={() => setShowEmailSignup(true)}
                className="bg-gradient-to-r from-blue-600 to-red-600 hover:from-blue-700 hover:to-red-700 px-8 py-3 rounded-lg font-semibold transition-all duration-300 transform hover:scale-105"
              >
                📧 Get High-Severity Alerts
              </button>
            ) : (
              <div className="bg-gray-800/50 p-6 rounded-lg max-w-md mx-auto backdrop-blur">
                <div className="flex gap-2">
                  <input 
                    type="email" 
                    placeholder="Enter your email for alerts"
                    className="flex-1 px-4 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
                  />
                  <button className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded font-medium">
                    Subscribe
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-2">Get notified of high-severity political developments</p>
              </div>
            )}
          </div>
        </header>

        {/* Intelligence Dashboard Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div 
            className="bg-gray-800/60 backdrop-blur p-6 rounded-lg border border-gray-700 cursor-pointer hover:bg-gray-700/60 transition-all duration-300"
            onClick={() => {
              setSelectedSeverity('all');
              setSelectedCategory('all');
              setSearchTerm('');
            }}
          >
            <h3 className="text-lg font-semibold text-blue-400 mb-2">📊 Total Intelligence</h3>
            <p className="text-3xl font-bold">{totalEntries}</p>
            <p className="text-sm text-gray-400">Political developments tracked</p>
          </div>
          
          <div 
            className="bg-gray-800/60 backdrop-blur p-6 rounded-lg border border-gray-700 cursor-pointer hover:bg-gray-700/60 transition-all duration-300"
            onClick={() => setSelectedSeverity('high')}
          >
            <h3 className="text-lg font-semibold text-red-400 mb-2">🚨 High Priority</h3>
            <p className="text-3xl font-bold text-red-400">{highSeverityCount}</p>
            <p className="text-sm text-gray-400">Critical developments</p>
          </div>

          <div 
            className="bg-gray-800/60 backdrop-blur p-6 rounded-lg border border-gray-700 cursor-pointer hover:bg-gray-700/60 transition-all duration-300"
            onClick={() => setSearchTerm('trump')}
          >
            <h3 className="text-lg font-semibold text-orange-400 mb-2">🏛️ Trump & Family</h3>
            <p className="text-3xl font-bold text-orange-400">{trumpEntries}</p>
            <p className="text-sm text-gray-400">Trump-related entries</p>
          </div>

          <div 
            className="bg-gray-800/60 backdrop-blur p-6 rounded-lg border border-gray-700 cursor-pointer hover:bg-gray-700/60 transition-all duration-300"
            onClick={() => setSearchTerm('musk')}
          >
            <h3 className="text-lg font-semibold text-purple-400 mb-2">🚀 Musk & DOGE</h3>
            <p className="text-3xl font-bold text-purple-400">{muskEntries}</p>
            <p className="text-sm text-gray-400">DOGE & tech influence</p>
          </div>
        </div>

        {/* Trump 2.0 vs 1.0 Comparison Teaser */}
        <div className="bg-gradient-to-r from-gray-800/60 to-blue-800/60 backdrop-blur p-6 rounded-lg border border-gray-700 mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-semibold text-blue-400 mb-2">🔄 Trump 2.0 vs 1.0 Analysis</h3>
              <p className="text-gray-300">Compare current developments with Trump's first presidency patterns</p>
              <p className="text-sm text-gray-400 mt-1">Coming soon: Historical comparison dashboard</p>
            </div>
            <button className="bg-blue-600/30 border border-blue-500 px-6 py-2 rounded font-medium hover:bg-blue-600/50 transition-colors">
              Preview Feature
            </button>
          </div>
        </div>

        {/* Advanced Search and Filters */}
        <div className="bg-gray-800/60 backdrop-blur p-6 rounded-lg border border-gray-700 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <input
              type="text"
              placeholder="Search intelligence..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="px-4 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
            />
            
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-4 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Categories</option>
              {categories.map(category => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>

            <select
              value={selectedSeverity}
              onChange={(e) => setSelectedSeverity(e.target.value)}
              className="px-4 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Threat Levels</option>
              <option value="high">🚨 High Priority</option>
              <option value="medium">⚠️ Medium Priority</option>
              <option value="low">ℹ️ Low Priority</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-4 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
            >
              <option value="date">Sort by Date</option>
              <option value="severity">Sort by Priority</option>
              <option value="actor">Sort by Actor</option>
            </select>

            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="px-4 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
            >
              <option value="desc">Latest First</option>
              <option value="asc">Oldest First</option>
            </select>
          </div>
          
          <div className="mt-4 flex items-center justify-between text-sm text-gray-400">
            <span>Showing {sortedEntries.length} of {totalEntries} intelligence reports</span>
            <span>🤖 Updated daily via AI monitoring</span>
          </div>
        </div>

        {/* Intelligence Feed */}
        <div className="space-y-4">
          {sortedEntries.length === 0 ? (
            <div className="text-center py-12 bg-gray-800/60 backdrop-blur rounded-lg border border-gray-700">
              <div className="text-6xl mb-4">🔍</div>
              <p className="text-gray-400 text-lg">No intelligence found matching your criteria.</p>
              <p className="text-gray-500 text-sm mt-2">Try adjusting your search filters</p>
            </div>
          ) : (
            sortedEntries.map((entry) => (
              <div key={entry.id} className="bg-gray-800/60 backdrop-blur p-6 rounded-lg border border-gray-700 hover:bg-gray-700/60 transition-all duration-300">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-400">📅 {new Date(entry.date).toLocaleDateString()}</span>
                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                      entry.severity === 'high' ? 'bg-red-900/50 text-red-200 border border-red-500' :
                      entry.severity === 'medium' ? 'bg-yellow-900/50 text-yellow-200 border border-yellow-500' :
                      'bg-green-900/50 text-green-200 border border-green-500'
                    }`}>
                      {entry.severity === 'high' ? '🚨 HIGH PRIORITY' :
                       entry.severity === 'medium' ? '⚠️ MEDIUM' : 'ℹ️ LOW'}
                    </span>
                    {entry.verified && (
                      <span className="text-green-400 text-sm">✅ AI-Verified</span>
                    )}
                  </div>
                  <span className="text-sm text-blue-400 font-medium">{entry.actor}</span>
                </div>
                
                <h3 className="text-xl font-semibold mb-3 text-white">{entry.title}</h3>
                <p className="text-gray-300 mb-4 leading-relaxed">{entry.description}</p>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm text-purple-400 font-medium">{entry.category}</span>
                  {entry.source_url && (
                    <a 
                      href={entry.source_url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="bg-blue-600/20 border border-blue-500 text-blue-400 hover:bg-blue-600/30 px-4 py-2 rounded text-sm font-medium transition-colors"
                    >
                      📖 View Source
                    </a>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <footer className="mt-16 text-center">
          <div className="bg-gray-800/60 backdrop-blur p-8 rounded-lg border border-gray-700">
            <h3 className="text-xl font-semibold text-blue-400 mb-4">AI-Powered Political Intelligence</h3>
            <p className="text-gray-300 mb-4">
              Automated daily monitoring using OpenAI's web search capabilities to discover and verify 
              political developments from credible news sources.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm text-gray-400">
              <div>
                <strong className="text-blue-400">🤖 AI Technology</strong><br/>
                GPT-4o-mini with web search
              </div>
              <div>
                <strong className="text-green-400">✅ Source Verification</strong><br/>
                15+ credible news outlets
              </div>
              <div>
                <strong className="text-purple-400">📊 Real-Time Updates</strong><br/>
                Daily at 9:00 AM EST
              </div>
            </div>
            <p className="text-gray-500 text-xs mt-6">
              Last updated: {new Date().toLocaleDateString()} • Trump 2.0 Era Intelligence Platform
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
};

ReactDOM.render(<PoliticalDashboard />, document.getElementById('root'));
