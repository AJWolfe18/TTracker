// Updated card components with inline expansion and UI improvements

// Political entry card component with inline expansion
const PoliticalEntryCard = ({ entry, index = 0 }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasSpicySummary = !!entry.spicy_summary;
  const displaySummary = entry.spicy_summary || entry.description;
  
  // Extract source domain from URL
  const getSourceName = (url) => {
    if (!url) return null;
    try {
      const domain = new URL(url).hostname.replace('www.', '');
      const sourceMap = {
        'cnn.com': 'CNN',
        'reuters.com': 'Reuters',
        'apnews.com': 'AP News',
        'nytimes.com': 'NY Times',
        'washingtonpost.com': 'Washington Post',
        'politico.com': 'Politico',
        'theguardian.com': 'The Guardian',
        'foxnews.com': 'Fox News',
        'nbcnews.com': 'NBC News',
        'cbsnews.com': 'CBS News',
        'axios.com': 'Axios',
        'bloomberg.com': 'Bloomberg',
        'wsj.com': 'WSJ',
        'usatoday.com': 'USA Today',
        'thehill.com': 'The Hill'
      };
      return sourceMap[domain] || domain.split('.')[0].toUpperCase();
    } catch {
      return 'Source';
    }
  };
  
  // Get clean severity label
  const getSeverityLabel = () => {
    if (entry.severity_label_inapp) return entry.severity_label_inapp;
    
    const severityMap = {
      'critical': 'Fucking Treason 🔴',
      'high': 'Criminal Bullshit 🟠',
      'medium': 'Swamp Shit 🟡',
      'low': 'Clown Show 🟢'
    };
    
    return severityMap[entry.severity?.toLowerCase()] || '';
  };
  
  return (
    <div className="bg-gray-800/50 backdrop-blur-md rounded-lg p-6 border border-gray-700 hover:border-gray-600 transition-all duration-200 hover:shadow-xl" style={{
      animation: index < 10 ? 'fadeIn 0.4s ease-in-out' : 'none',
      animationDelay: index < 10 ? `${index * 0.05}s` : '0s'
    }}>
      
      {/* Title First */}
      <h3 className="text-lg font-bold text-white mb-3">{entry.title}</h3>
      
      {/* Metadata Line */}
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-3">
        {entry.actor && <span>{entry.actor}</span>}
        {entry.actor && entry.date && <span>•</span>}
        <span>{formatDate(entry.date)}</span>
        {entry.source_url && (
          <>
            <span>•</span>
            <a 
              href={entry.source_url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300"
            >
              {getSourceName(entry.source_url)}
            </a>
          </>
        )}
      </div>
      
      {/* Spicy Summary with inline expansion */}
      {displaySummary && (
        <div className="mb-4">
          <p className={`text-gray-100 leading-relaxed ${!isExpanded ? 'line-clamp-3' : ''}`}>
            {displaySummary}
          </p>
          {displaySummary.length > 200 && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-blue-400 hover:text-blue-300 text-sm mt-2 flex items-center gap-1"
            >
              {isExpanded ? (
                <>Show less <span className="text-xs">↑</span></>
              ) : (
                <>Show more <span className="text-xs">↓</span></>
              )}
            </button>
          )}
        </div>
      )}
      
      {/* Bottom Actions Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Severity Badge */}
          {hasSpicySummary && getSeverityLabel() && (
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${
              entry.severity?.toLowerCase() === 'critical' ? 'bg-red-600' :
              entry.severity?.toLowerCase() === 'high' ? 'bg-orange-600' :
              entry.severity?.toLowerCase() === 'medium' ? 'bg-yellow-600' :
              entry.severity?.toLowerCase() === 'low' ? 'bg-green-600' :
              'bg-gray-700'
            } text-white`}>
              {getSeverityLabel()}
            </span>
          )}
          
          {/* Category */}
          {entry.category && (
            <span className="text-xs text-gray-500">
              {entry.category}
            </span>
          )}
        </div>
        
        {/* Original Source Link */}
        {entry.source_url && (
          <a 
            href={entry.source_url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 text-xs"
          >
            Original Source ↗
          </a>
        )}
      </div>
    </div>
  );
};

// Executive order card component with inline expansion
const ExecutiveOrderCard = ({ order, index = 0 }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasSpicySummary = !!order.spicy_summary;
  const displaySummary = order.spicy_summary || order.summary;
  
  // Get impact label for EOs
  const getImpactLabel = () => {
    if (order.severity_label_inapp) return order.severity_label_inapp;
    
    const impactMap = {
      'fascist_power_grab': 'Fascist Power Grab 🔴',
      'authoritarian_overreach': 'Authoritarian Overreach 🟠',
      'corrupt_grift': 'Corrupt Grift 🟡',
      'performative_bullshit': 'Performative Bullshit 🟢'
    };
    
    return impactMap[order.eo_impact_type] || '';
  };
  
  return (
    <div className="bg-gray-800/50 backdrop-blur-md rounded-lg p-6 border border-gray-700 hover:border-gray-600 transition-all duration-200 hover:shadow-xl" style={{
      animation: index < 10 ? 'fadeIn 0.4s ease-in-out' : 'none',
      animationDelay: index < 10 ? `${index * 0.05}s` : '0s'
    }}>
      
      {/* Title First */}
      <h3 className="text-lg font-bold text-white mb-3">{order.title}</h3>
      
      {/* Metadata Line */}
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-3">
        <span className="font-medium">EO {order.order_number}</span>
        <span>•</span>
        <span>{formatDate(order.date)}</span>
        <span>•</span>
        <a 
          href={order.source_url} 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300"
        >
          WhiteHouse.gov
        </a>
      </div>
      
      {/* Spicy Translation with inline expansion */}
      {displaySummary && (
        <div className="mb-4">
          <p className={`text-gray-100 leading-relaxed ${!isExpanded ? 'line-clamp-3' : ''}`}>
            {displaySummary}
          </p>
          {displaySummary.length > 200 && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-blue-400 hover:text-blue-300 text-sm mt-2 flex items-center gap-1"
            >
              {isExpanded ? (
                <>Show less <span className="text-xs">↑</span></>
              ) : (
                <>Show more <span className="text-xs">↓</span></>
              )}
            </button>
          )}
        </div>
      )}
      
      {/* Bottom Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Impact Badge */}
          {hasSpicySummary && getImpactLabel() && (
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${
              order.eo_impact_type === 'fascist_power_grab' ? 'bg-red-600' :
              order.eo_impact_type === 'authoritarian_overreach' ? 'bg-orange-600' :
              order.eo_impact_type === 'corrupt_grift' ? 'bg-yellow-600' :
              order.eo_impact_type === 'performative_bullshit' ? 'bg-green-600' :
              'bg-gray-700'
            } text-white`}>
              {getImpactLabel()}
            </span>
          )}
          
          {/* Category */}
          {order.category && (
            <span className="text-xs text-gray-500">
              {order.category}
            </span>
          )}
        </div>
        
        {/* Original Source Link */}
        {order.source_url && (
          <a 
            href={order.source_url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 text-xs"
          >
            Original Source ↗
          </a>
        )}
      </div>
    </div>
  );
};

// Collapsible Search/Filter Section
const SearchFilterSection = ({ 
  searchTerm, 
  handleSearch, 
  selectedCategory, 
  setSelectedCategory,
  activeFilter,
  setActiveFilter,
  dateRange,
  setDateRange,
  sortOrder,
  setSortOrder,
  uniqueCategories,
  activeTab,
  displayedPoliticalEntries,
  allPoliticalEntries,
  executiveOrders,
  allExecutiveOrders
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  
  return (
    <div className="bg-gray-800/50 backdrop-blur-md rounded-lg border border-gray-700 mb-6">
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full p-4 flex items-center justify-between hover:bg-gray-700/30 transition-colors"
      >
        <span className="text-white font-medium">Search & Filters</span>
        <span className="text-gray-400">{isCollapsed ? '▼' : '▲'}</span>
      </button>
      
      {!isCollapsed && (
        <div className="p-4 pt-0">
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
                  handleSearch('');
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
      )}
    </div>
  );
};
