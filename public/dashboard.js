const { useState, useEffect } = React;

const PoliticalDashboard = () => {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedSeverity, setSelectedSeverity] = useState('all');
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState('desc');

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
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading political tracker data...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="container mx-auto px-4 py-8">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-blue-400 mb-2">Political Accountability Tracker</h1>
          <p className="text-gray-300">Monitoring political developments and accountability issues</p>
        </header>

        {/* Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div 
            className="bg-gray-800 p-6 rounded-lg cursor-pointer hover:bg-gray-700 transition-colors"
            onClick={() => {
              setSelectedSeverity('all');
              setSelectedCategory('all');
              setSearchTerm('');
            }}
          >
            <h3 className="text-lg font-semibold text-blue-400 mb-2">Total Entries</h3>
            <p className="text-3xl font-bold">{totalEntries}</p>
          </div>
          
          <div 
            className="bg-gray-800 p-6 rounded-lg cursor-pointer hover:bg-gray-700 transition-colors"
            onClick={() => setSelectedSeverity('high')}
          >
            <h3 className="text-lg font-semibold text-red-400 mb-2">High Severity</h3>
            <p className="text-3xl font-bold">{highSeverityCount}</p>
          </div>

          <div className="bg-gray-800 p-6 rounded-lg">
            <h3 className="text-lg font-semibold text-green-400 mb-2">Categories</h3>
            <p className="text-3xl font-bold">{categories.length}</p>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="bg-gray-800 p-6 rounded-lg mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <input
              type="text"
              placeholder="Search entries..."
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
              <option value="all">All Severities</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-4 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
            >
              <option value="date">Sort by Date</option>
              <option value="severity">Sort by Severity</option>
              <option value="actor">Sort by Actor</option>
            </select>

            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="px-4 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
            >
              <option value="desc">Newest First</option>
              <option value="asc">Oldest First</option>
            </select>
          </div>
          
          <div className="mt-4 text-sm text-gray-400">
            Showing {sortedEntries.length} of {totalEntries} entries
          </div>
        </div>

        {/* Entries List */}
        <div className="space-y-4">
          {sortedEntries.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-400">No entries found matching your filters.</p>
            </div>
          ) : (
            sortedEntries.map((entry) => (
              <div key={entry.id} className="bg-gray-800 p-6 rounded-lg hover:bg-gray-750 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-400">📅 {new Date(entry.date).toLocaleDateString()}</span>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      entry.severity === 'high' ? 'bg-red-900 text-red-200' :
                      entry.severity === 'medium' ? 'bg-yellow-900 text-yellow-200' :
                      'bg-green-900 text-green-200'
                    }`}>
                      {entry.severity.toUpperCase()}
                    </span>
                    {entry.verified && (
                      <span className="text-green-400 text-sm">✅ Verified</span>
                    )}
                  </div>
                  <span className="text-sm text-blue-400">{entry.actor}</span>
                </div>
                
                <h3 className="text-xl font-semibold mb-2 text-white">{entry.title}</h3>
                <p className="text-gray-300 mb-3 leading-relaxed">{entry.description}</p>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm text-purple-400">{entry.category}</span>
                  {entry.source_url && (
                    <a 
                      href={entry.source_url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 text-sm underline"
                    >
                      View Source
                    </a>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <footer className="mt-12 text-center text-gray-400 text-sm">
          <p>Data updated daily via automated monitoring • Last updated: {new Date().toLocaleDateString()}</p>
        </footer>
      </div>
    </div>
  );
};

ReactDOM.render(<PoliticalDashboard />, document.getElementById('dashboard-root'));
