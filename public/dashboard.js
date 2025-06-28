const { useState, useEffect } = React;

const PoliticalDashboard = () => {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [sortBy, setSortBy] = useState('date'); // New state for sorting
  const [sortOrder, setSortOrder] = useState('desc'); // New state for sort direction

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const response = await fetch('/master-tracker-log.json');
      if (response.ok) {
        const data = await response.json();
        
        // Auto-verify entries with reputable sources
        const processedData = data.map(entry => {
          if (!entry.hasOwnProperty('verified') || entry.verified === undefined) {
            entry.verified = isReputableSource(entry.source_url);
          }
          return entry;
        });
        
        setEntries(processedData);
      } else {
        console.log('No data file found, using sample data');
        loadSampleData();
      }
    } catch (error) {
      console.log('Error loading data:', error);
      loadSampleData();
    } finally {
      setLoading(false);
    }
  };

  const isReputableSource = (url) => {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      return false;
    }
    
    const reputableDomains = [
      'washingtonpost.com', 'nytimes.com', 'reuters.com', 'apnews.com',
      'npr.org', 'bbc.com', 'cnn.com', 'politico.com', 'theguardian.com',
      'wsj.com', 'usatoday.com', 'abcnews.go.com', 'cbsnews.com',
      'nbcnews.com', 'pbs.org', 'time.com', 'newsweek.com', 'axios.com',
      'bloomberg.com', 'economist.com', 'businessinsider.com', 'wired.com',
      'newyorker.com', 'theatlantic.com', 'vanityfair.com', 'aclu.org',
      'sfgate.com', 'meidasnews.com', 'thedailybeast.com', 'newrepublic.com'
    ];
    
    try {
      const domain = new URL(url).hostname.toLowerCase().replace('www.', '');
      return reputableDomains.some(reputable => domain.includes(reputable));
    } catch (e) {
      return false;
    }
  };

  const loadSampleData = () => {
    const sampleEntries = [
      {
        id: 1,
        date: '2025-06-28',
        actor: 'Donald Trump',
        category: 'Financial',
        title: 'Investigation into Truth Social revenue reporting',
        description: 'SEC reviewing quarterly reports following whistleblower allegations.',
        severity: 'high',
        verified: true
      },
      {
        id: 2,
        date: '2025-06-28',
        actor: 'Department of Justice',
        category: 'Civil Liberties',
        title: 'Expanded surveillance program under FISA',
        description: 'DOJ announces broader data collection capabilities.',
        severity: 'high',
        verified: true
      }
    ];
    setEntries(sampleEntries);
  };

  const filteredEntries = entries.filter(entry => {
    const matchesSearch = entry.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         entry.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         entry.actor?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || entry.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Sort the filtered entries
  const sortedEntries = [...filteredEntries].sort((a, b) => {
    if (sortBy === 'severity') {
      const severityOrder = { 'high': 3, 'medium': 2, 'low': 1 };
      const aValue = severityOrder[a.severity] || 0;
      const bValue = severityOrder[b.severity] || 0;
      return sortOrder === 'desc' ? bValue - aValue : aValue - bValue;
    } else {
      // Always use event date for date sorting
      const aDate = new Date(a.date);
      const bDate = new Date(b.date);
      
      // Check for invalid dates
      if (isNaN(aDate.getTime()) || isNaN(bDate.getTime())) {
        console.warn('Invalid date found:', a.date, b.date);
        return 0;
      }
      
      return sortOrder === 'desc' ? bDate - aDate : aDate - bDate;
    }
  });

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'high': return 'bg-red-100 text-red-800 border-red-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low': return 'bg-green-100 text-green-800 border-green-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const categories = [...new Set(entries.map(e => e.category))].filter(Boolean);
  const highSeverityCount = filteredEntries.filter(e => e.severity === 'high').length;
  const mediumSeverityCount = filteredEntries.filter(e => e.severity === 'medium').length;
  const lowSeverityCount = filteredEntries.filter(e => e.severity === 'low').length;
  const totalEntries = filteredEntries.length;

  if (loading) {
    return React.createElement('div', { 
      className: 'min-h-screen bg-gray-900 flex items-center justify-center' 
    },
      React.createElement('div', { className: 'text-center' },
        React.createElement('div', { 
          className: 'animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400 mx-auto mb-4' 
        }),
        React.createElement('p', { className: 'text-gray-300' }, 'Loading Political Tracker...')
      )
    );
  }

  return React.createElement('div', { className: 'min-h-screen bg-gray-900' },
    // Header
    React.createElement('div', { className: 'bg-gray-800 shadow-lg border-b border-gray-700' },
      React.createElement('div', { className: 'max-w-7xl mx-auto px-4 py-6' },
        React.createElement('h1', { className: 'text-3xl font-bold text-white' }, 'Political Accountability Tracker'),
        React.createElement('p', { className: 'mt-2 text-gray-300' }, 'Monitoring government actions and political developments')
      )
    ),

    React.createElement('div', { className: 'max-w-7xl mx-auto px-4 py-6' },
      // Stats
      React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-4 gap-6 mb-8' },
        React.createElement('div', { className: 'bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-6' },
          React.createElement('h3', { className: 'text-lg font-medium text-gray-300' }, 'Total Entries'),
          React.createElement('p', { className: 'text-3xl font-bold text-blue-400' }, totalEntries)
        ),
        React.createElement('div', { className: 'bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-6' },
          React.createElement('h3', { className: 'text-lg font-medium text-gray-300' }, 'High Severity'),
          React.createElement('p', { className: 'text-3xl font-bold text-red-400' }, highSeverityCount)
        ),
        React.createElement('div', { className: 'bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-6' },
          React.createElement('h3', { className: 'text-lg font-medium text-gray-300' }, 'Medium Severity'),
          React.createElement('p', { className: 'text-3xl font-bold text-yellow-400' }, mediumSeverityCount)
        ),
        React.createElement('div', { className: 'bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-6' },
          React.createElement('h3', { className: 'text-lg font-medium text-gray-300' }, 'Low Severity'),
          React.createElement('p', { className: 'text-3xl font-bold text-green-400' }, lowSeverityCount)
        )
      ),

      // Filters
      React.createElement('div', { className: 'bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-6 mb-8' },
        React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-4 gap-4' },
          React.createElement('div', {},
            React.createElement('label', { className: 'block text-sm font-medium text-gray-300 mb-2' }, 'Search'),
            React.createElement('input', {
              type: 'text',
              placeholder: 'Search entries...',
              value: searchTerm,
              onChange: (e) => setSearchTerm(e.target.value),
              className: 'w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-400'
            })
          ),
          React.createElement('div', {},
            React.createElement('label', { className: 'block text-sm font-medium text-gray-300 mb-2' }, 'Category'),
            React.createElement('select', {
              value: selectedCategory,
              onChange: (e) => setSelectedCategory(e.target.value),
              className: 'w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500'
            },
              React.createElement('option', { value: 'all' }, 'All Categories'),
              categories.map(cat => 
                React.createElement('option', { key: cat, value: cat }, cat)
              )
            )
          ),
          React.createElement('div', {},
            React.createElement('label', { className: 'block text-sm font-medium text-gray-300 mb-2' }, 'Sort By'),
            React.createElement('select', {
              value: sortBy,
              onChange: (e) => setSortBy(e.target.value),
              className: 'w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500'
            },
              React.createElement('option', { value: 'date' }, 'Event Date'),
              React.createElement('option', { value: 'severity' }, 'Severity')
            )
          ),
          React.createElement('div', {},
            React.createElement('label', { className: 'block text-sm font-medium text-gray-300 mb-2' }, 'Order'),
            React.createElement('select', {
              value: sortOrder,
              onChange: (e) => setSortOrder(e.target.value),
              className: 'w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500'
            },
              React.createElement('option', { value: 'desc' }, 'Newest First'),
              React.createElement('option', { value: 'asc' }, 'Oldest First')
            )
          )
        )
      ),

      // Entries List
      React.createElement('div', { className: 'space-y-4' },
        filteredEntries.length === 0 ?
          React.createElement('div', { className: 'bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-8 text-center' },
            React.createElement('p', { className: 'text-gray-400' }, 'No entries found matching your criteria.')
          ) :
          sortedEntries.map(entry =>
            React.createElement('div', { 
              key: entry.id, 
              className: 'bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-6 hover:bg-gray-750 transition-colors' 
            },
              React.createElement('div', { className: 'flex justify-between items-start mb-4' },
                React.createElement('h3', { className: 'text-xl font-semibold text-white flex-1 mr-4' }, entry.title),
                React.createElement('span', { 
                  className: `px-3 py-1 rounded-full text-sm font-medium ${getSeverityColor(entry.severity)}` 
                }, entry.severity?.toUpperCase())
              ),
              React.createElement('p', { className: 'text-gray-300 mb-4' }, entry.description),
              React.createElement('div', { className: 'flex justify-between items-end' },
                React.createElement('div', { className: 'text-sm text-gray-400' },
                  React.createElement('div', {}, `${entry.actor} • ${entry.category}`),
                  React.createElement('div', {}, entry.date)
                ),
                React.createElement('div', { className: 'flex flex-col items-end gap-2' },
                  // Verification status with source link combined
                  React.createElement('div', { className: 'flex items-center gap-2' },
                    React.createElement('span', { 
                      className: `px-2 py-1 rounded text-xs font-medium flex items-center gap-1 ${
                        entry.verified ? 'text-green-400 bg-green-900/30' : 'text-red-400 bg-red-900/30'
                      }`
                    },
                      entry.verified ? '✅' : '❌',
                      entry.verified ? 'Verified' : 'Unverified'
                    ),
                    // Source link
                    entry.source_url && entry.source_url !== 'Multiple sources' && entry.source_url.startsWith('http') ?
                      React.createElement('a', {
                        href: entry.source_url,
                        target: '_blank',
                        rel: 'noopener noreferrer',
                        className: 'text-blue-400 hover:text-blue-300 text-xs underline flex items-center gap-1 px-2 py-1 bg-blue-900/20 rounded'
                      }, 'Source', React.createElement('span', {}, '↗')) :
                      entry.source_url ? React.createElement('span', { className: 'text-gray-500 text-xs px-2 py-1' }, entry.source_url) : null
                  )
                )
              )
            )
          )
      )
    )
  );
};

ReactDOM.render(React.createElement(PoliticalDashboard), document.getElementById('root'));
