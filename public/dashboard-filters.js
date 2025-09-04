// Dashboard Filters Module - Phase 3 Refactoring
// Handles all search, filtering, and sorting functionality

// Module Loading Verification
(function() {
  // Check dependencies
  if (!window.React) {
    console.error('Critical: React not loaded. dashboard-filters.js requires React.');
    return;
  }
  
  const { useState, useCallback, useMemo, useRef, useEffect } = React;
  
  // SearchBar Component with Debouncing
  const SearchBar = ({ value, onChange, placeholder }) => {
    return (
      <div className="relative mb-4">
        <input
          type="text"
          placeholder={placeholder || "Search titles, descriptions, actors, categories..."}
          value={value}
          onChange={(e) => onChange(e.target.value)}
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
        {value && (
          <button
            onClick={() => onChange('')}
            className="absolute right-4 top-3.5 text-gray-400 hover:text-white transition-colors"
            aria-label="Clear search"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    );
  };

  // Category Dropdown Component
  const CategoryDropdown = ({ value, onChange, categories }) => {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-4 py-2 bg-gray-900/50 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all duration-200"
        title={categories.length === 0 ? "No categories available" : "Filter by category"}
      >
        <option value="all">{categories.length === 0 ? "No Categories" : "All Categories"}</option>
        {categories.map(cat => (
          <option key={cat} value={cat}>{cat}</option>
        ))}
      </select>
    );
  };

  // Severity Dropdown Component
  const SeverityDropdown = ({ value, onChange }) => {
    return (
      <select
        value={value || 'all'}
        onChange={(e) => onChange(e.target.value === 'all' ? null : e.target.value)}
        className="px-4 py-2 bg-gray-900/50 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all duration-200"
      >
        <option value="all">Severity</option>
        <option value="high">High/Critical</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>
    );
  };

  // Date Range Dropdown Component
  const DateRangeDropdown = ({ value, onChange }) => {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-4 py-2 bg-gray-900/50 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all duration-200"
      >
        <option value="all">All time</option>
        <option value="7days">Last 7 days</option>
        <option value="30days">Last 30 days</option>
        <option value="90days">Last 90 days</option>
      </select>
    );
  };

  // Sort Order Dropdown Component
  const SortOrderDropdown = ({ value, onChange }) => {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-4 py-2 bg-gray-900/50 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all duration-200"
      >
        <option value="newest">Newest</option>
        <option value="oldest">Oldest</option>
      </select>
    );
  };

  // Clear Filters Button Component
  const ClearFiltersButton = ({ onClick, visible }) => {
    if (!visible) return null;
    
    return (
      <button
        onClick={onClick}
        className="col-span-2 sm:col-span-1 px-4 py-2 bg-red-600/20 border border-red-600/50 rounded-lg text-red-400 hover:bg-red-600/30 hover:border-red-600 transition-all duration-200"
      >
        Clear All
      </button>
    );
  };

  // Active Filters Display Component
  const ActiveFiltersDisplay = ({ filters, activeTab, displayCount, totalCount }) => {
    const { searchTerm, selectedCategory, dateRange, activeFilter } = filters;
    
    if (!searchTerm && selectedCategory === 'all' && dateRange === 'all' && !activeFilter) {
      return null;
    }

    return (
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
        {displayCount !== undefined && totalCount !== undefined && (
          <span className="ml-2 text-gray-500 transition-all duration-300">
            • Showing {displayCount} of {totalCount} {activeTab === 'political' ? 'entries' : 'orders'}
          </span>
        )}
      </div>
    );
  };

  // Main Filter Section Component
  const FilterSection = ({ 
    filters, 
    onFilterChange, 
    uniqueCategories, 
    isExpanded, 
    onToggleExpand,
    activeTab,
    displayCount,
    totalCount
  }) => {
    const hasActiveFilters = filters.searchTerm || 
                           filters.selectedCategory !== 'all' || 
                           filters.dateRange !== 'all' || 
                           filters.activeFilter || 
                           filters.sortOrder !== 'newest';

    return (
      <div className="bg-gray-800/50 backdrop-blur-md rounded-lg border border-gray-700 mb-6">
        {/* Toggle Header */}
        <button
          onClick={onToggleExpand}
          className="w-full p-4 flex items-center justify-between hover:bg-gray-700/30 transition-colors"
        >
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            <span className="text-white font-medium">Search & Filters</span>
            {hasActiveFilters && (
              <span className="text-xs bg-blue-600/20 text-blue-400 px-2 py-0.5 rounded">
                Active
              </span>
            )}
          </div>
          <svg 
            className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        
        {/* Collapsible Content */}
        <div className={`overflow-hidden transition-all duration-300 ${isExpanded ? 'max-h-96' : 'max-h-0'}`}>
          <div className="p-4 pt-0 border-t border-gray-700">
            {/* Search Input */}
            <SearchBar 
              value={filters.searchTerm}
              onChange={(value) => onFilterChange('searchTerm', value)}
            />
            
            {/* Filter Dropdowns - Responsive Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-3">
              <CategoryDropdown 
                value={filters.selectedCategory}
                onChange={(value) => onFilterChange('selectedCategory', value)}
                categories={uniqueCategories}
              />
              
              <SeverityDropdown 
                value={filters.activeFilter}
                onChange={(value) => onFilterChange('activeFilter', value)}
              />
              
              <DateRangeDropdown 
                value={filters.dateRange}
                onChange={(value) => onFilterChange('dateRange', value)}
              />
              
              <SortOrderDropdown 
                value={filters.sortOrder}
                onChange={(value) => onFilterChange('sortOrder', value)}
              />
              
              <ClearFiltersButton 
                visible={hasActiveFilters}
                onClick={() => onFilterChange('clearAll')}
              />
            </div>
            
            {/* Active Filters Display */}
            <ActiveFiltersDisplay 
              filters={filters}
              activeTab={activeTab}
              displayCount={displayCount}
              totalCount={totalCount}
            />
          </div>
        </div>
      </div>
    );
  };

  // Filter Utilities
  const filterUtils = {
    // Apply all filters to entries
    applyAllFilters: function(entries, filters) {
      if (!entries || !Array.isArray(entries)) return [];
      
      let filtered = [...entries];
      const { searchTerm, selectedCategory, dateRange, activeFilter, sortOrder } = filters;
      
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
        
        filtered = filtered.filter(entry => {
          if (!entry.date) return false;
          const entryDate = new Date(entry.date);
          if (isNaN(entryDate.getTime())) return false;
          return entryDate >= cutoffDate;
        });
      }
      
      // Apply severity filter
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
        }
      }
      
      // Apply sort order
      if (sortOrder === 'oldest') {
        filtered.sort((a, b) => new Date(a.date) - new Date(b.date));
      } else {
        filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
      }
      
      return filtered;
    },

    // Search-specific filter
    applySearch: function(entries, searchTerm) {
      if (!entries || !searchTerm || searchTerm.trim() === '') return entries;
      
      const searchLower = searchTerm.toLowerCase().trim();
      return entries.filter(entry => {
        return (
          entry.title?.toLowerCase().includes(searchLower) ||
          entry.description?.toLowerCase().includes(searchLower) ||
          entry.summary?.toLowerCase().includes(searchLower) ||
          entry.actor?.toLowerCase().includes(searchLower) ||
          entry.category?.toLowerCase().includes(searchLower)
        );
      });
    },

    // Calculate filter counts for severity badges
    calculateFilterCounts: function(entries, filters) {
      if (!entries || !Array.isArray(entries)) return { high: 0, medium: 0, low: 0 };
      
      // Apply all filters except severity to get base filtered data
      let baseFiltered = [...entries];
      
      // Apply search
      if (filters.searchTerm) {
        baseFiltered = this.applySearch(baseFiltered, filters.searchTerm);
      }
      
      // Apply category
      if (filters.selectedCategory && filters.selectedCategory !== 'all') {
        baseFiltered = baseFiltered.filter(e => e.category === filters.selectedCategory);
      }
      
      // Apply date range
      if (filters.dateRange && filters.dateRange !== 'all') {
        const now = new Date();
        const cutoffDate = new Date();
        
        switch(filters.dateRange) {
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
        ).length
      };
    },

    // Extract unique categories from data
    extractUniqueCategories: function(entries) {
      if (!entries || !Array.isArray(entries)) return [];
      
      const cats = new Set();
      entries.forEach(e => {
        if (e.category && typeof e.category === 'string' && e.category.trim()) {
          cats.add(e.category.trim());
        }
      });
      return Array.from(cats).sort();
    },

    // Get default filter state
    getDefaultFilters: function() {
      return {
        searchTerm: '',
        selectedCategory: 'all',
        dateRange: 'all',
        sortOrder: 'newest',
        activeFilter: null
      };
    },

    // Check if any filters are active
    hasActiveFilters: function(filters) {
      return filters.searchTerm !== '' ||
             filters.selectedCategory !== 'all' ||
             filters.dateRange !== 'all' ||
             filters.sortOrder !== 'newest' ||
             filters.activeFilter !== null;
    },

    // Clear all filters to default
    clearAllFilters: function() {
      return this.getDefaultFilters();
    }
  };

  // Custom Hook for filter state management
  const useFilters = (initialFilters) => {
    const [filters, setFilters] = useState(initialFilters || filterUtils.getDefaultFilters());
    
    const updateFilter = useCallback((key, value) => {
      if (key === 'clearAll') {
        setFilters(filterUtils.getDefaultFilters());
      } else {
        setFilters(prev => ({ ...prev, [key]: value }));
      }
    }, []);
    
    const clearFilters = useCallback(() => {
      setFilters(filterUtils.getDefaultFilters());
    }, []);
    
    const hasActive = useMemo(() => {
      return filterUtils.hasActiveFilters(filters);
    }, [filters]);
    
    return { filters, updateFilter, clearFilters, hasActive };
  };

  // Export to global namespace
  window.DashboardFilters = {
    // Components
    FilterSection,
    SearchBar,
    CategoryDropdown,
    SeverityDropdown,
    DateRangeDropdown,
    SortOrderDropdown,
    ClearFiltersButton,
    ActiveFiltersDisplay,
    
    // Utilities
    filterUtils,
    
    // Hook
    useFilters
  };

  console.log('Dashboard Filters module loaded successfully');
})();