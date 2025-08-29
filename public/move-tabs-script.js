// Script to move tabs above search/filters in dashboard.js
// Run this to update the dashboard structure

const fs = require('fs');
const path = require('path');

function moveTabsToTop() {
    const dashboardPath = path.join(__dirname, 'dashboard.js');
    let content = fs.readFileSync(dashboardPath, 'utf8');
    
    // Find the main return statement with the JSX
    const returnIndex = content.indexOf('return (');
    if (returnIndex === -1) {
        console.error('Could not find return statement');
        return;
    }
    
    // Find key sections
    const errorBannerStart = content.indexOf('{/* Error banner');
    const searchFilterStart = content.indexOf('{/* Search and Filter Bar');
    const statsStart = content.indexOf('{/* Statistics Section');
    const tabNavStart = content.indexOf('{/* Tab Navigation');
    const loadingOverlayStart = content.indexOf('{/* Loading Overlay');
    
    console.log('Found sections:');
    console.log('- Error banner:', errorBannerStart > -1);
    console.log('- Search/Filter:', searchFilterStart > -1);
    console.log('- Stats:', statsStart > -1);
    console.log('- Tab Nav:', tabNavStart > -1);
    console.log('- Loading Overlay:', loadingOverlayStart > -1);
    
    // Extract the tab navigation section
    if (tabNavStart > -1 && loadingOverlayStart > -1) {
        // Find the end of the tab section (just before loading overlay)
        const tabSection = content.substring(tabNavStart, loadingOverlayStart).trim();
        
        // Remove the old tab section
        content = content.substring(0, tabNavStart) + content.substring(loadingOverlayStart);
        
        // Insert tab section after error banner, before search/filter
        const insertPoint = searchFilterStart;
        content = content.substring(0, insertPoint) + 
                  '\n        ' + tabSection + '\n\n        ' + 
                  content.substring(insertPoint);
        
        // Update the comment
        content = content.replace('{/* Tab Navigation', '{/* Tab Navigation - MOVED TO TOP');
        
        // Write the updated content
        fs.writeFileSync(dashboardPath, content, 'utf8');
        console.log('Successfully moved tabs to top!');
    } else {
        console.error('Could not find tab navigation section');
    }
}

// Run the update
moveTabsToTop();