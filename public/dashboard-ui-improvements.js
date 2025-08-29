// Dashboard UI Improvements Patch
// This file contains the updates needed for TTRC-97

// Instructions:
// 1. Remove the old ContentModal component (lines 85-183)
// 2. Remove modalContent state
// 3. Update component imports to use DashboardComponents
// 4. Add collapsible filter section

// Step 1: After line 58, add these imports
const {
  ConstructionBanner: DashboardConstructionBanner,
  PoliticalEntryCard,
  ExecutiveOrderCard,
  NoResultsMessage,
  PaginationControls,
  TabNavigation,
  LoadingOverlay
} = window.DashboardComponents;

// Step 2: In TrumpyTrackerDashboard component, update state (around line 264)
// Remove: const [modalContent, setModalContent] = useState(null);
// Add: const [isFilterCollapsed, setIsFilterCollapsed] = useState(false);

// Step 3: Add Collapsible Filter Section component
const CollapsibleFilterSection = ({ 
  isCollapsed, 
  setIsCollapsed, 
  hasActiveFilters,
  children 
}) => {
  // Load collapsed state from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('filterSectionCollapsed');
    if (saved !== null) {
      setIsCollapsed(saved === 'true');
    }
  }, []);
  
  // Save collapsed state to localStorage
  const toggleCollapsed = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem('filterSectionCollapsed', newState.toString());
  };
  
  return (
    <div className="mb-6">
      <button
        onClick={toggleCollapsed}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700 hover:border-gray-600 transition-all duration-200"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg font-medium text-white">
            Search & Filters
          </span>
          {hasActiveFilters && !isCollapsed && (
            <span className="px-2 py-0.5 bg-orange-600 text-white text-xs rounded-full">
              Active
            </span>
          )}
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${
            isCollapsed ? '' : 'rotate-180'
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      
      <div className={`transition-all duration-300 overflow-hidden ${
        isCollapsed ? 'max-h-0' : 'max-h-[500px]'
      }`}>
        <div className="pt-4">
          {children}
        </div>
      </div>
    </div>
  );
};

// Step 4: Replace PoliticalEntryCard usage (search for "PoliticalEntryCard")
// Change from:
//   <PoliticalEntryCard key={entry.id} entry={entry} index={index} onReadMore={(content) => setModalContent(content)} />
// To:
//   <PoliticalEntryCard key={entry.id} entry={entry} index={index} />

// Step 5: Replace ExecutiveOrderCard usage
// Change from:
//   <ExecutiveOrderCard key={order.id} order={order} index={index} onReadMore={(content) => setModalContent(content)} />
// To:
//   <ExecutiveOrderCard key={order.id} order={order} index={index} />

// Step 6: Update NoResultsMessage usage
// Change from:
//   <NoResultsMessage suggestions={...} onSuggestionClick={...} onClearAll={...} />
// To:
//   <NoResultsMessage suggestions={...} onSuggestionClick={...} />

// Step 7: Remove ContentModal from the render (near the end)
// Remove these lines:
//   {/* Content Modal */}
//   <ContentModal 
//     isOpen={!!modalContent}
//     onClose={() => setModalContent(null)}
//     {...modalContent}
//   />

// Step 8: Check if filters are active
const hasActiveFilters = () => {
  return searchTerm || 
         selectedCategory !== 'all' || 
         dateRange !== 'all' || 
         activeFilter || 
         sortOrder !== 'newest';
};

console.log('Dashboard UI Improvements patch file created. Follow the instructions above to update dashboard.js');
