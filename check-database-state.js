// check-database-state.js
// Quick script to check current database state

import { supabaseRequest } from './supabase-config-node.js';

async function checkDatabaseState() {
    console.log('🔍 CHECKING DATABASE STATE');
    console.log('=========================\n');
    
    try {
        // Check political entries count
        const politicalEntries = await supabaseRequest('political_entries?select=id&limit=1000');
        const activePolitical = politicalEntries.filter(e => !e.archived);
        console.log(`📊 Political Entries:`);
        console.log(`   Total: ${politicalEntries.length}`);
        console.log(`   Active: ${activePolitical.length}`);
        console.log(`   Archived: ${politicalEntries.length - activePolitical.length}\n`);
        
        // Check executive orders count and details
        const executiveOrders = await supabaseRequest('executive_orders?select=*&order=date.desc&limit=1000');
        console.log(`📜 Executive Orders:`);
        console.log(`   Total: ${executiveOrders.length}`);
        
        if (executiveOrders.length > 0) {
            // Check for orders without order_number
            const withoutOrderNumber = executiveOrders.filter(eo => !eo.order_number);
            const withOrderNumber = executiveOrders.filter(eo => eo.order_number);
            
            console.log(`   With Order Number: ${withOrderNumber.length}`);
            console.log(`   WITHOUT Order Number: ${withoutOrderNumber.length} ⚠️`);
            
            // Get date range
            const dates = executiveOrders.map(eo => eo.date).filter(d => d);
            dates.sort();
            console.log(`   Date Range: ${dates[0]} to ${dates[dates.length - 1]}`);
            
            // Check for duplicates
            const orderNumbers = withOrderNumber.map(eo => eo.order_number);
            const uniqueOrderNumbers = [...new Set(orderNumbers)];
            if (orderNumbers.length !== uniqueOrderNumbers.length) {
                console.log(`   ⚠️ DUPLICATES FOUND: ${orderNumbers.length - uniqueOrderNumbers.length} duplicate order numbers`);
            }
            
            // Show latest 5 orders
            console.log('\n   Latest 5 Executive Orders:');
            executiveOrders.slice(0, 5).forEach(eo => {
                console.log(`   - ${eo.date}: ${eo.order_number || 'NO NUMBER'} - ${eo.title?.substring(0, 50)}...`);
            });
            
            // Check if we're getting real EOs or something else
            console.log('\n   Sample Order Analysis:');
            const sample = executiveOrders[0];
            console.log(`   - Has order_number: ${!!sample.order_number}`);
            console.log(`   - Has title: ${!!sample.title}`);
            console.log(`   - Has date: ${!!sample.date}`);
            console.log(`   - Has agencies_affected: ${!!sample.agencies_affected}`);
            
            // Count by month to see pattern
            console.log('\n   Orders by Month:');
            const monthCounts = {};
            executiveOrders.forEach(eo => {
                if (eo.date) {
                    const month = eo.date.substring(0, 7);
                    monthCounts[month] = (monthCounts[month] || 0) + 1;
                }
            });
            Object.entries(monthCounts).sort().forEach(([month, count]) => {
                console.log(`   ${month}: ${count} orders`);
            });
        }
        
        // Check dashboard stats view
        console.log('\n📊 Dashboard Stats View:');
        const stats = await supabaseRequest('dashboard_stats?select=*');
        if (stats && stats[0]) {
            console.log(`   Political Entries: ${stats[0].total_entries}`);
            console.log(`   Executive Orders: ${stats[0].total_executive_orders}`);
            console.log(`   High Severity: ${stats[0].high_severity_count}`);
            console.log(`   Latest Entry: ${stats[0].latest_entry_date}`);
        }
        
    } catch (error) {
        console.error('Error checking database:', error.message);
    }
}

checkDatabaseState();
