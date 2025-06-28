const { useState, useEffect } = React;
const { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } = Recharts;
const { Calendar, TrendingUp, AlertTriangle, User, Building, Scale, Search, Filter, Download, ExternalLink, Eye, Bell, Settings } = LucideReact;

const PoliticalDashboard = () => {
  const [entries, setEntries] = useState([]);
  const [filteredEntries, setFilteredEntries] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedActor, setSelectedActor] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedSeverity, setSelectedSeverity] = useState('all');
  const [timeRange, setTimeRange] = useState('30');
  const [viewMode, setViewMode] = useState('dashboard');
  const [loading, setLoading] = useState(true);

  // Load real data from GitHub repository
  useEffect(() => {
    loadDataFromGitHub();
  }, []);

  const loadDataFromGitHub = async () => {
    try {
      // Try to load the master tracker log from your GitHub repository
      const response = await fetch('/master-tracker-log.json');
      if (response.ok) {
        const data = await response.json();
        setEntries(data);
        setFilteredEntries(data);
      } else {
        // Fallback to sample data if GitHub file not found
        loadSampleData();
      }
    } catch (error) {
      console.log('Loading sample data (GitHub data not available)');
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
        title: 'Investigation into Truth Social revenue reporting discrepancies',
        description: 'SEC reviewing quarterly reports following whistleblower allegations of inflated user engagement metrics affecting advertiser rates.',
        source_url: 'https://reuters.com/example',
        verified: true,
        severity: 'high'
      },
      {
        id: 2,
        date: '2025-06-28',
        actor: 'Department of Justice',
        category: 'Civil Liberties',
        title: 'Expanded surveillance program under FISA Section 702',
        description: 'DOJ announces broader data collection capabilities targeting domestic communications with foreign intelligence value.',
        source_url: 'https://washingtonpost.com/example',
        verified: true,
        severity: 'high'
      },
      {
        id: 3,
        date: '2025-06-27',
        actor: 'Elon Musk',
        category: 'Platform Manipulation',
        title: 'X algorithm changes favor verified accounts',
        description: 'Internal documents reveal algorithm modifications that suppress reach of non-paying users by up to 70%.',
        source_url: 'https://techcrunch.com/example',
        verified: false,
        severity: 'medium'
      },
      {
        id: 4,
        date: '2025-06-27',
        actor: 'Department of Education',
        category: 'Government Oversight',
        title: 'Student loan forgiveness program restrictions',
        description: 'New guidelines limit eligibility criteria, potentially affecting 2.3 million previously qualified borrowers.',
        source_url: 'https://npr.org/example',
        verified: true,
        severity: 'medium'
      },
      {
        id: 5,
        date: '2025-06-26',
        actor: 'FBI',
        category: 'Civil Liberties',
        title: 'Warrantless digital device searches increase 340%',
        description: 'Civil liberties groups raise concerns over border search statistics released in quarterly transparency report.',
        source_url: 'https://aclu.org/example',
        verified: true,
        severity: 'high'
      },
      {
        id: 6,
        date: '2025-06-26',
        actor: 'Donald Trump',
        category: 'Election Integrity',
        title: 'Campaign finance violations under review',
        description: 'FEC investigating unreported contributions totaling $2.8 million from cryptocurrency donations.',
        source_url: 'https://politico.com/example',
        verified: true,
        severity: 'medium'
      }
    ];
    
    setEntries(sampleEntries);
    setFilteredEntries(sampleEntries);
  };

  useEffect(() => {
    let filtered = entries.filter(entry => {
      const matchesSearch = entry.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          entry.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          entry.actor.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesActor = selectedActor === 'all' || entry.actor === selectedActor;
      const matchesCategory = selectedCategory === 'all' || entry.category === selectedCategory;
      const matchesSeverity = selectedSeverity === 'all' || entry.severity === selectedSeverity;
      
      const entryDate = new Date(entry.date);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - parseInt(timeRange));
      const matchesTimeRange = entryDate >= cutoffDate;
      
      return matchesSearch && matchesActor && matchesCategory && matchesSeverity && matchesTimeRange;
    });
    
    setFilteredEntries(filtered);
  }, [entries, searchTerm, selectedActor, selectedCategory, selectedSeverity, timeRange]);

  // Analytics data
  const severityData = [
    { name: 'High', value: filteredEntries.filter(e => e.severity === 'high').length, color: '#ef4444' },
    { name: 'Medium', value: filteredEntries.filter(e => e.severity === 'medium').length, color: '#f59e0b' },
    { name: 'Low', value: filteredEntries.filter(e => e.severity === 'low').length, color: '#10b981' }
  ];

  const categoryData = [
    'Financial', 'Civil Liberties', 'Platform Manipulation', 'Government Oversight', 'Election Integrity', 'Corporate Ethics', 'Legal Proceedings'
  ].map(category => ({
    name: category,
    count: filteredEntries.filter(e => e.category === category).length
  })).filter(item => item.count > 0);

  const actorData = [...new Set(filteredEntries.map(e => e.actor))]
    .map(actor => ({
      name: actor,
      count: filteredEntries.filter(e => e.actor === actor).length
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const timelineData = [...new Set(filteredEntries.map(e => e.date))]
    .sort()
    .map(date => ({
      date: date,
      count: filteredEntries.filter(e => e.date === date).length,
      high: filteredEntries.filter(e => e.date === date && e.severity === 'high').length
    }));

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'high': return 'text-red-600 bg-red-50 border-red-200';
      case 'medium': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'low': return 'text-green-600 bg-green-50 border-green-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getCategoryIcon = (category) => {
    const iconProps = { className: "w-4 h-4" };
    switch (category) {
      case 'Financial': return React.createElement(Building, iconProps);
      case 'Civil Liberties': return React.createElement(Scale, iconProps);
      case 'Platform Manipulation': return React.createElement(Search, iconProps);
      case 'Government Oversight': return React.createElement(User, iconProps);
      default: return React.createElement(AlertTriangle, iconProps);
    }
  };

  const uniqueActors = [...new Set(entries.map(entry => entry.actor))];
  const uniqueCategories = [...new Set(entries.map(entry => entry.category))];

  if (loading) {
    return React.createElement('div', { className: 'min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center' },
      React.createElement('div', { className: 'text-center' },
        React.createElement('div', { className: 'animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto mb-4' }),
        React.createElement('p', { className: 'text-gray-600' }, 'Loading Political Tracker...')
      )
    );
  }

  return React.createElement('div', { className: 'min-h-screen bg-gradient-to-br from-slate-50 to-blue-50' },
    // Header
    React.createElement('div', { className: 'bg-white border-b border-gray-200 shadow-sm' },
      React.createElement('div', { className: 'max-w-full mx-auto px-6 py-4' },
        React.createElement('div', { className: 'flex items-center justify-between' },
          React.createElement('div', {},
            React.createElement('h1', { className: 'text-2xl font-bold text-gray-900' }, 'Political Accountability Tracker'),
            React.createElement('p', { className: 'text-gray-600' }, 'Real-time monitoring of government actions and accountability')
          ),
          React.createElement('div', { className: 'flex items-center gap-4' },
            React.createElement('div', { className: 'flex bg-gray-100 rounded-lg p-1' },
              React.createElement('button', {
                onClick: () => setViewMode('dashboard'),
                className: `px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  viewMode === 'dashboard' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`
              }, 'Dashboard'),
              React.createElement('button', {
                onClick: () => setViewMode('entries'),
                className: `px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  viewMode === 'entries' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`
              }, 'All Entries')
            )
          )
        )
      )
    ),

    React.createElement('div', { className: 'max-w-full mx-auto px-6 py-6' },
      // Filters
      React.createElement('div', { className: 'bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6' },
        React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-6 gap-4' },
          // Search input and other filters would go here
          React.createElement('div', { className: 'md:col-span-2' },
            React.createElement('label', { className: 'block text-sm font-medium text-gray-700 mb-2' }, 'Search'),
            React.createElement('div', { className: 'relative' },
              React.createElement(Search, { className: 'w-4 h-4 absolute left-3 top-3 text-gray-400' }),
              React.createElement('input', {
                type: 'text',
                placeholder: 'Search entries...',
                value: searchTerm,
                onChange: (e) => setSearchTerm(e.target.value),
                className: 'w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent'
              })
            )
          )
        )
      ),

      // Dashboard content
      viewMode === 'dashboard' ? 
        React.createElement('div', { className: 'grid grid-cols-12 gap-6' },
          // Left Column
          React.createElement('div', { className: 'col-span-8 space-y-6' },
            // Key Metrics
            React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-4 gap-4' },
              React.createElement('div', { className: 'bg-white rounded-xl shadow-sm border border-gray-200 p-4' },
                React.createElement('div', { className: 'flex items-center justify-between' },
                  React.createElement('div', {},
                    React.createElement('p', { className: 'text-sm font-medium text-gray-600' }, 'Total Entries'),
                    React.createElement('p', { className: 'text-2xl font-bold text-gray-900' }, filteredEntries.length)
                  ),
                  React.createElement('div', { className: 'p-2 bg-blue-100 rounded-lg' },
                    React.createElement(TrendingUp, { className: 'w-5 h-5 text-blue-600' })
                  )
                )
              )
            ),
            
            // Timeline Chart
            React.createElement('div', { className: 'bg-white rounded-xl shadow-sm border border-gray-200 p-6' },
              React.createElement('h3', { className: 'text-lg font-semibold text-gray-900 mb-4' }, 'Activity Timeline'),
              React.createElement(ResponsiveContainer, { width: '100%', height: 400 },
                React.createElement(LineChart, { data: timelineData },
                  React.createElement(CartesianGrid, { strokeDasharray: '3 3' }),
                  React.createElement(XAxis, { dataKey: 'date' }),
                  React.createElement(YAxis),
                  React.createElement(Tooltip),
                  React.createElement(Line, { type: 'monotone', dataKey: 'count', stroke: '#3b82f6', strokeWidth: 3 })
                )
              )
            )
          ),
          
          // Right Column
          React.createElement('div', { className: 'col-span-4 space-y-6' },
            React.createElement('div', { className: 'bg-white rounded-xl shadow-sm border border-gray-200 p-6' },
              React.createElement('h3', { className: 'text-lg font-semibold text-gray-900 mb-4' }, 'Quick Stats'),
              React.createElement('div', { className: 'space-y-3' },
                React.createElement('div', { className: 'flex justify-between items-center' },
                  React.createElement('span', { className: 'text-sm text-gray-600' }, 'High Severity'),
                  React.createElement('span', { className: 'font-bold text-red-600' }, 
                    filteredEntries.filter(e => e.severity === 'high').length
                  )
                )
              )
            )
          )
        ) :
        // Entries List View
        React.createElement('div', { className: 'space-y-4' },
          filteredEntries.length === 0 ?
            React.createElement('div', { className: 'bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center' },
              React.createElement('p', { className: 'text-gray-500' }, 'No entries found matching your criteria.')
            ) :
            filteredEntries.map(entry =>
              React.createElement('div', { key: entry.id, className: 'bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow' },
                React.createElement('h3', { className: 'text-lg font-semibold text-gray-900 mb-2' }, entry.title),
                React.createElement('p', { className: 'text-gray-600 mb-4' }, entry.description),
                React.createElement('div', { className: 'flex items-center justify-between' },
                  React.createElement('span', { className: 'text-sm font-medium text-gray-700' }, entry.actor),
                  React.createElement('span', { className: 'text-sm text-gray-500' }, entry.date)
                )
              )
            )
        )
    )
  );
};

ReactDOM.render(React.createElement(PoliticalDashboard), document.getElementById('root'));
