/**
 * Dashboard Statistics Module
 * Handles statistics display and calculations
 * Extracted from dashboard.js for better maintainability
 */

window.DashboardStats = (function() {
  'use strict';

  /**
   * Stats Section Component
   * Displays key metrics in a responsive grid
   */
  const StatsSection = ({ stats }) => {
    return React.createElement('div', { className: 'space-y-4 mb-8' },
      // Main stats row - responsive grid
      React.createElement('div', { className: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4' },
        // Total Political Entries
        React.createElement('div', { className: 'bg-gray-800/50 backdrop-blur-md rounded-lg p-4 border border-gray-700' },
          React.createElement('div', { className: 'text-2xl font-bold text-white' }, stats.total_entries || 0),
          React.createElement('div', { className: 'text-gray-400 text-sm' }, 'Total Political Entries')
        ),
        // High Severity Count
        React.createElement('div', { className: 'bg-gray-800/50 backdrop-blur-md rounded-lg p-4 border border-gray-700' },
          React.createElement('div', { className: 'text-2xl font-bold text-red-400' }, stats.high_severity_count || 0),
          React.createElement('div', { className: 'text-gray-400 text-sm' }, 'High Severity')
        ),
        // Executive Orders Count
        React.createElement('div', { className: 'bg-gray-800/50 backdrop-blur-md rounded-lg p-4 border border-gray-700' },
          React.createElement('div', { className: 'text-2xl font-bold text-blue-400' }, stats.total_executive_orders || 0),
          React.createElement('div', { className: 'text-gray-400 text-sm' }, 'Executive Orders')
        )
      ),
      
      // Cache indicator
      React.createElement('div', { className: 'text-center' },
        React.createElement('button', {
          onClick: () => {
            if (typeof window.loadAllData === 'function') {
              window.loadAllData(true);
            } else {
              console.warn('Data refresh not yet available - page still loading');
              // Fallback: reload the page
              window.location.reload();
            }
          },
          className: 'text-xs text-gray-500 hover:text-gray-400'
        },
          '🔄 Refresh Data (Last updated: ' + new Date().toLocaleDateString() + ')'
        )
      )
    );
  };

  /**
   * Calculate statistics from entries
   */
  const calculateStats = (politicalEntries, executiveOrders) => {
    const stats = {
      total_entries: politicalEntries.length,
      total_executive_orders: executiveOrders.length,
      high_severity_count: 0,
      medium_severity_count: 0,
      low_severity_count: 0,
      critical_severity_count: 0
    };

    // Count severities
    politicalEntries.forEach(entry => {
      const severity = entry.severity?.toLowerCase();
      switch(severity) {
        case 'critical':
          stats.critical_severity_count++;
          stats.high_severity_count++; // Critical counts as high too
          break;
        case 'high':
          stats.high_severity_count++;
          break;
        case 'medium':
          stats.medium_severity_count++;
          break;
        case 'low':
          stats.low_severity_count++;
          break;
      }
    });

    return stats;
  };

  /**
   * Get severity distribution percentages
   */
  const getSeverityDistribution = (stats) => {
    const total = stats.total_entries || 1; // Avoid division by zero
    
    return {
      high: ((stats.high_severity_count / total) * 100).toFixed(1),
      medium: ((stats.medium_severity_count / total) * 100).toFixed(1),
      low: ((stats.low_severity_count / total) * 100).toFixed(1)
    };
  };

  /**
   * Format large numbers for display
   */
  const formatNumber = (num) => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  };

  // Public API
  return {
    StatsSection,
    calculateStats,
    getSeverityDistribution,
    formatNumber
  };
})();