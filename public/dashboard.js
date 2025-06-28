const { useState, useEffect } = React;

const PoliticalDashboard = () => {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const response = await fetch('/master-tracker-log.json');
      if (response.ok) {
        const data = await response.json();
        setEntries(data);
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
  const totalEntries = filteredEntries.length;

  if (loading) {
    return React.createElement('div', { 
      className: 'min-h-screen bg-gray-50 flex items-center justify-center' 
    },
      React.createElement('div', { className: 'text-center' },
        React.createElement('div', { 
          className: 'animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4' 
        }),
        React.createElement('p', { className: 'text-gray-600' }, 'Loading Political Tracker...')
      )
    );
  }

  return React.createElement('div', { className: 'min-h-screen bg-gray-50' },
    // Header
    React.createElement('div', { className: 'bg-white shadow' },
      React.createElement('div', { className: 'max-w-7xl mx-auto px-4 py-6' },
        React.createElement('h1', { className: 'text-3xl font-bold text-gray-900' }, 'Political Accountability Tracker'),
        React.createElement('p', { className: 'mt-2 text-gray-600' }, 'Monitoring government actions and political developments')
      )
    ),

    React.createElement('div', { className: 'max-w-7xl mx-auto px-4 py-6' },
      // Stats
      React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-3 gap-6 mb-8' },
        React.createElement('div', { className: 'bg-white rounded-lg shadow p-6' },
          React.createElement('h3', { className: 'text-lg font-medium text-gray-900' }, 'Total Entries'),
          React.createElement('p', { className: 'text-3xl font-bold text-blue-600' }, totalEntries)
        ),
        React.createElement('div', { className: 'bg-white rounded-lg shadow p-6' },
          React.createElement('h3', { className: 'text-lg font-medium text-gray-900' }, 'High Severity'),
          React.createElement('p', { className: 'text-3xl font-bold text-red-600' }, highSeverityCount)
        ),
        React.createElement('div', { className: 'bg-white rounded-lg shadow p-6' },
          React.createElement('h3', { className: 'text-lg font-medium text-gray-900' }, 'Categories'),
          React.createElement('p', { className: 'text-3xl font-bold text-green-600' }, categories.length)
        )
      ),

      // Filters
      React.createElement('div', { className: 'bg-white rounded-lg shadow p-6 mb-8' },
        React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
          React.createElement('div', {},
            React.createElement('label', { className: 'block text-sm font-medium text-gray-700 mb-2' }, 'Search'),
            React.createElement('input', {
              type: 'text',
              placeholder: 'Search entries...',
              value: searchTerm,
              onChange: (e) => setSearchTerm(e.target.value),
              className: 'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500'
            })
          ),
          React.createElement('div', {},
            React.createElement('label', { className: 'block text-sm font-medium text-gray-700 mb-2' }, 'Category'),
            React.createElement('select', {
              value: selectedCategory,
              onChange: (e) => setSelectedCategory(e.target.value),
              className: 'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500'
            },
              React.createElement('option', { value: 'all' }, 'All Categories'),
              categories.map(cat => 
                React.createElement('option', { key: cat, value: cat }, cat)
              )
            )
          )
        )
      ),

      // Entries List
      React.createElement('div', { className: 'space-y-4' },
        filteredEntries.length === 0 ?
          React.createElement('div', { className: 'bg-white rounded-lg shadow p-8 text-center' },
            React.createElement('p', { className: 'text-gray-500' }, 'No entries found matching your criteria.')
          ) :
          filteredEntries.map(entry =>
            React.createElement('div', { 
              key: entry.id, 
              className: 'bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow' 
            },
              React.createElement('div', { className: 'flex justify-between items-start mb-4' },
                React.createElement('h3', { className: 'text-xl font-semibold text-gray-900' }, entry.title),
                React.createElement('span', { 
                  className: `px-3 py-1 rounded-full text-sm font-medium ${getSeverityColor(entry.severity)}` 
                }, entry.severity?.toUpperCase())
              ),
              React.createElement('p', { className: 'text-gray-600 mb-4' }, entry.description),
              React.createElement('div', { className: 'flex justify-between items-center text-sm text-gray-500' },
                React.createElement('span', {}, `${entry.actor} • ${entry.category}`),
                React.createElement('span', {}, entry.date)
              )
            )
          )
      )
    )
  );
};

ReactDOM.render(React.createElement(PoliticalDashboard), document.getElementById('root'));
