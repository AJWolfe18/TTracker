// Category Configuration Module
// Central location for the 11-category system used across the application

(function() {
    'use strict';
    
    // Database values (what's stored in the database)
    const CATEGORY_VALUES = [
        'corruption_scandals',
        'democracy_elections', 
        'policy_legislation',
        'justice_legal',
        'executive_actions',
        'foreign_policy',
        'corporate_financial',
        'civil_liberties',
        'media_disinformation',
        'epstein_associates',
        'other'
    ];
    
    // Display names (what users see)
    const CATEGORY_DISPLAY_NAMES = {
        'corruption_scandals': 'Corruption & Scandals',
        'democracy_elections': 'Democracy & Elections',
        'policy_legislation': 'Policy & Legislation',
        'justice_legal': 'Justice & Legal',
        'executive_actions': 'Executive Actions',
        'foreign_policy': 'Foreign Policy',
        'corporate_financial': 'Corporate & Financial',
        'civil_liberties': 'Civil Liberties',
        'media_disinformation': 'Media & Disinformation',
        'epstein_associates': 'Epstein & Associates',
        'other': 'Other'
    };
    
    // Function to format category for display
    function formatCategoryDisplay(category) {
        if (!category) return 'Other';
        return CATEGORY_DISPLAY_NAMES[category] || 'Other';
    }
    
    // Function to get all categories for dropdowns
    function getCategoryOptions() {
        return CATEGORY_VALUES.map(value => ({
            value: value,
            label: CATEGORY_DISPLAY_NAMES[value]
        }));
    }
    
    // Export to global namespace
    window.CategoryConfig = {
        CATEGORY_VALUES,
        CATEGORY_DISPLAY_NAMES,
        formatCategoryDisplay,
        getCategoryOptions
    };
    
    console.log('✅ Category configuration loaded (11 categories)');
})();
