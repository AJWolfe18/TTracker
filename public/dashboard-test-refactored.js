// TrumpyTracker Dashboard - Refactored Version with Components Module
// This is the properly refactored version that uses dashboard-components.js

// Module Loading Verification & Error Boundary
(function() {
  // Check if required modules are loaded
  const requiredModules = [
    { name: 'DashboardUtils', path: 'dashboard-utils.js' },
    { name: 'DashboardStats', path: 'dashboard-stats.js' },
    { name: 'DashboardComponents', path: 'dashboard-components.js' }
  ];
  
  let missingModules = [];
  requiredModules.forEach(module => {
    if (!window[module.name]) {
      console.error(`Critical: ${module.name} module not loaded from ${module.path}`);
      missingModules.push(module);
    }
  });
  
  // If modules are missing, show error to user
  if (missingModules.length > 0) {
    const errorHtml = `
      <div style="min-height: 100vh; background: linear-gradient(135deg, #1e3c72, #2a5298); display: flex; align-items: center; justify-content: center; color: white; font-family: system-ui;">
        <div style="text-align: center; padding: 2rem; background: rgba(0,0,0,0.5); border-radius: 1rem; max-width: 500px;">
          <h1 style="font-size: 2rem; margin-bottom: 1rem; color: #ff6b6b;">⚠️ Loading Error</h1>
          <p style="margin-bottom: 1.5rem;">Some required files failed to load. This might be a temporary network issue.</p>
          <p style="margin-bottom: 1rem; font-size: 0.9rem; opacity: 0.8;">Missing: ${missingModules.map(m => m.path).join(', ')}</p>
          <button onclick="window.location.reload()" style="background: #4CAF50; color: white; border: none; padding: 0.75rem 2rem; border-radius: 0.5rem; font-size: 1rem; cursor: pointer;">
            🔄 Reload Page
          </button>
          <div style="margin-top: 1rem; font-size: 0.8rem; opacity: 0.7;">
            If this persists, try clearing your browser cache (Ctrl+Shift+R)
          </div>
        </div>
      </div>
    `;
    document.getElementById('root').innerHTML = errorHtml;
    throw new Error('Required modules not loaded. Dashboard cannot initialize.');
  }
})();

// Import React hooks
const { useState, useEffect, useCallback, useMemo, useRef } = React;

// Configuration
const SUPABASE_URL = window.SUPABASE_URL || window.SUPABASE_CONFIG?.SUPABASE_URL || 'https://osjbulmltfpcoldydexg.supabase.co';
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || window.SUPABASE_CONFIG?.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zamJ1bG1sdGZwY29sZHlkZXhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ3NjQ5NzEsImV4cCI6MjA3MDM0MDk3MX0.COtWEcun0Xkw5hUhaVEJGCrWbumj42L4vwWGgH7RyIE';

// Pagination settings
const ITEMS_PER_PAGE = 20;
const EO_ITEMS_PER_PAGE = 25;

// Import utilities from DashboardUtils module
const { getCachedData, setCachedData, clearOldCache, clearCache, supabaseRequest, formatDate } = window.DashboardUtils;

// Import components from DashboardComponents module
const { 
  ConstructionBanner, 
  ContentModal, 
  PaginationControls,
  NoResultsMessage,
  PoliticalEntryCard,
  ExecutiveOrderCard,
  TabNavigation,
  LoadingOverlay,
  getSeverityColor
} = window.DashboardComponents;

// Import StatsSection from DashboardStats module
const StatsSection = window.DashboardStats.StatsSection;

// THIS IS A TEST FILE - Just rendering the ConstructionBanner to verify it works
const TestDashboard = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 text-white">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <ConstructionBanner />
        
        <div className="bg-green-600 p-4 rounded mt-4">
          <h2 className="text-xl font-bold">✅ Components Module Loaded Successfully!</h2>
          <p>If you can see the construction banner above, the refactoring is working.</p>
        </div>
        
        <div className="bg-blue-600 p-4 rounded mt-4">
          <h2 className="text-xl font-bold">Components Available:</h2>
          <ul className="list-disc ml-5">
            <li>ConstructionBanner: {typeof ConstructionBanner}</li>
            <li>ContentModal: {typeof ContentModal}</li>
            <li>PaginationControls: {typeof PaginationControls}</li>
            <li>NoResultsMessage: {typeof NoResultsMessage}</li>
            <li>PoliticalEntryCard: {typeof PoliticalEntryCard}</li>
            <li>ExecutiveOrderCard: {typeof ExecutiveOrderCard}</li>
            <li>TabNavigation: {typeof TabNavigation}</li>
            <li>LoadingOverlay: {typeof LoadingOverlay}</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

// Render the test dashboard
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<TestDashboard />);