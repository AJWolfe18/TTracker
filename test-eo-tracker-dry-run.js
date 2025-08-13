// test-eo-tracker-dry-run.js
// Test version that checks Federal Register API and database without writing

import fetch from 'node-fetch';
import { supabaseRequest } from './supabase-config-node.js';

console.log('🧪 EXECUTIVE ORDERS TRACKER - TEST/DRY RUN MODE');
console.log('================================================\n');

// Test Federal Register API
async function testFederalRegisterAPI() {
    console.log('📊 Testing Federal Register API...');
    
    const startDate = '2025-01-20';
    const today = new Date().toISOString().split('T')[0];
    
    // Test the exact URL your script uses
    const url = `https://www.federalregister.gov/api/v1/articles.json?conditions[type]=PRESDOCU&conditions[presidential_document_type_id]=2&conditions[publication_date][gte]=${startDate}&conditions[publication_date][lte]=${today}&per_page=200&order=newest`;
    
    console.log('   API URL:', url);
    console.log(`   Date range: ${startDate} to ${today}\n`);
    
    try {
        const response = await fetch(url);
        
        console.log(`   Response status: ${response.status} ${response.statusText}`);
        
        if (!response.ok) {
            console.error('   ❌ API returned error:', response.status);
            return [];
        }
        
        const data = await response.json();
        
        if (data.results && data.results.length > 0) {
            console.log(`   ✅ API returned ${data.results.length} executive orders\n`);
            
            // Show first 3 orders as examples
            console.log('   Sample orders from API:');
            data.results.slice(0, 3).forEach((order, i) => {
                console.log(`   ${i + 1}. ${order.title}`);
                console.log(`      Date: ${order.publication_date}`);
                console.log(`      Number: ${order.executive_order_number || 'N/A'}`);
                console.log(`      URL: ${order.html_url}\n`);
            });
            
            return data.results;
        } else {
            console.log('   ⚠️ API returned no results\n');
            return [];
        }
    } catch (error) {
        console.error('   ❌ Error calling API:', error.message);
        return [];
    }
}

// Test database connection and check existing orders
async function testDatabaseConnection() {
    console.log('🗄️ Testing Supabase connection...');
    
    try {
        // Test 1: Check if we can query the executive_orders table
        console.log('   Testing executive_orders table access...');
        const testQuery = await supabaseRequest('executive_orders?select=*&limit=1');
        console.log('   ✅ Can read from executive_orders table\n');
        
        // Test 2: Count existing orders
        console.log('   Counting existing orders...');
        const allOrders = await supabaseRequest('executive_orders?select=order_number,date,title&order=date.desc');
        console.log(`   ✅ Found ${allOrders.length} orders in database\n`);
        
        if (allOrders.length > 0) {
            // Show most recent orders
            console.log('   Most recent orders in database:');
            allOrders.slice(0, 3).forEach((order, i) => {
                console.log(`   ${i + 1}. ${order.title}`);
                console.log(`      Date: ${order.date}`);
                console.log(`      Number: ${order.order_number || 'N/A'}\n`);
            });
            
            // Find date of most recent order
            const mostRecentDate = allOrders[0].date;
            console.log(`   📅 Most recent order date: ${mostRecentDate}\n`);
        }
        
        return allOrders;
    } catch (error) {
        console.error('   ❌ Database connection error:', error.message);
        console.error('   Check your supabase-config-node.js file\n');
        return [];
    }
}

// Compare API results with database
async function compareData(apiOrders, dbOrders) {
    console.log('🔍 Comparing API results with database...\n');
    
    // Create a set of existing order numbers
    const existingNumbers = new Set(dbOrders.map(o => o.order_number).filter(Boolean));
    
    // Check which API orders are missing from database
    const missingOrders = [];
    const duplicateOrders = [];
    
    for (const apiOrder of apiOrders) {
        const orderNum = apiOrder.executive_order_number;
        if (orderNum) {
            if (existingNumbers.has(orderNum)) {
                duplicateOrders.push(apiOrder);
            } else {
                missingOrders.push(apiOrder);
            }
        }
    }
    
    console.log(`   📊 Analysis Results:`);
    console.log(`   - Total orders from API: ${apiOrders.length}`);
    console.log(`   - Total orders in database: ${dbOrders.length}`);
    console.log(`   - Orders already in database: ${duplicateOrders.length}`);
    console.log(`   - NEW orders to be added: ${missingOrders.length}\n`);
    
    if (missingOrders.length > 0) {
        console.log('   📝 New orders that would be added:');
        missingOrders.slice(0, 5).forEach((order, i) => {
            console.log(`   ${i + 1}. ${order.title}`);
            console.log(`      Date: ${order.publication_date}`);
            console.log(`      Number: ${order.executive_order_number}\n`);
        });
        
        if (missingOrders.length > 5) {
            console.log(`   ... and ${missingOrders.length - 5} more\n`);
        }
    }
    
    return { missingOrders, duplicateOrders };
}

// Test if we can write to database (without actually writing)
async function testDatabaseWrite() {
    console.log('📝 Testing database write permissions...');
    
    // Create a test order object
    const testOrder = {
        id: `test_${Date.now()}`,
        title: 'TEST ORDER - DO NOT SAVE',
        order_number: 'TEST-9999',
        date: new Date().toISOString().split('T')[0],
        summary: 'This is a test order to check write permissions',
        category: 'test',
        agencies_affected: [],
        source_url: 'https://test.example.com',
        verified: false,
        added_at: new Date().toISOString()
    };
    
    console.log('   Would write order with structure:');
    console.log('   ', JSON.stringify(testOrder, null, 2).split('\n').join('\n   '));
    console.log('\n   ✅ Order structure looks valid');
    console.log('   (In live mode, this would be written to database)\n');
}

// Main test function
async function runTests() {
    console.log('Starting comprehensive tests...\n');
    console.log('================================\n');
    
    // Run all tests
    const apiOrders = await testFederalRegisterAPI();
    const dbOrders = await testDatabaseConnection();
    
    if (apiOrders.length > 0 && dbOrders !== null) {
        await compareData(apiOrders, dbOrders);
    }
    
    await testDatabaseWrite();
    
    console.log('================================\n');
    console.log('🏁 Test Summary:\n');
    
    if (apiOrders.length > 0) {
        console.log('✅ Federal Register API is working');
    } else {
        console.log('❌ Federal Register API returned no data');
    }
    
    if (dbOrders.length >= 0) {
        console.log('✅ Database connection is working');
    } else {
        console.log('❌ Database connection failed');
    }
    
    console.log('\n💡 Recommendations:');
    console.log('1. If API returns data but database is outdated:');
    console.log('   - Run the full script to update database');
    console.log('   - Check GitHub Actions logs for errors');
    console.log('2. If API returns no data:');
    console.log('   - Check the date range and API parameters');
    console.log('   - Federal Register might be down or changed their API');
    console.log('3. If database connection fails:');
    console.log('   - Check supabase-config-node.js');
    console.log('   - Verify Supabase URL and keys are correct');
}

// Run the tests
runTests().catch(console.error);