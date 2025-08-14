// executive-orders-tracker-supabase.js
// Fetches and stores executive orders in Supabase
// FIXED VERSION - Only collects actual Executive Orders, not all presidential documents

import fetch from 'node-fetch';
import { supabaseRequest } from './supabase-config-node.js';

console.log('📜 EXECUTIVE ORDERS TRACKER - SUPABASE VERSION');
console.log('================================================\n');

// Generate unique ID for executive orders
function generateOrderId() {
    return `eo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Check if order already exists in database
async function orderExists(orderNumber) {
    try {
        const query = `order_number=eq.${orderNumber}`;
        const existing = await supabaseRequest(`executive_orders?${query}&limit=1`);
        return existing && existing.length > 0;
    } catch (error) {
        console.error('Error checking for existing order:', error.message);
        return false;
    }
}

// Fetch from Federal Register API - FIXED to only get Executive Orders
async function fetchFromFederalRegister() {
    console.log('📊 Fetching from Federal Register API (Executive Orders ONLY)...');
    
    const startDate = '2025-01-20'; // Inauguration date
    const today = new Date().toISOString().split('T')[0];
    
    // Using proper endpoint for Executive Orders only
    // presidential_document_type_id=2 specifically means Executive Orders
    const url = `https://www.federalregister.gov/api/v1/documents.json?conditions[type]=PRESDOCU&conditions[presidential_document_type_id]=2&conditions[publication_date][gte]=${startDate}&conditions[publication_date][lte]=${today}&per_page=200&order=newest`;
    
    console.log(`   Searching from ${startDate} to ${today}`);
    console.log(`   Filter: Executive Orders ONLY (type_id=2)\n`);
    
    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Federal Register API error: ${response.status}`);
        }
        
        const data = await response.json();
        const orders = [];
        let skippedNonEO = 0;
        
        if (data.results && data.results.length > 0) {
            console.log(`   📋 Found ${data.results.length} presidential documents`);
            console.log(`   🔍 Filtering for Executive Orders only...\n`);
            
            for (const item of data.results) {
                // CRITICAL FIX: Only process items that are actually Executive Orders
                // Must have "Executive Order" in the title AND have an order number
                const isExecutiveOrder = item.title && 
                    (item.title.includes('Executive Order') || 
                     item.subtype === 'Executive Order' ||
                     item.presidential_document_type === 'Executive Order');
                
                if (!isExecutiveOrder) {
                    skippedNonEO++;
                    console.log(`   ⏭️ Skipping non-EO: ${item.title?.substring(0, 50)}...`);
                    continue;
                }
                
                // Extract EO number from title - must have a valid number
                const eoMatch = item.title?.match(/Executive Order (\d+)/i) || 
                               item.executive_order_number ||
                               item.title?.match(/(\d{5})/);
                
                const orderNumber = eoMatch ? (eoMatch[1] || eoMatch[0]) : null;
                
                // CRITICAL: Skip if no order number found
                if (!orderNumber) {
                    skippedNonEO++;
                    console.log(`   ⚠️ Skipping - no order number: ${item.title?.substring(0, 50)}...`);
                    continue;
                }
                
                // Validate order number is in expected range (14900-15200 for 2025)
                const orderNum = parseInt(orderNumber);
                if (isNaN(orderNum) || orderNum < 14900 || orderNum > 15200) {
                    console.log(`   ⚠️ Suspicious order number ${orderNumber} - skipping`);
                    skippedNonEO++;
                    continue;
                }
                
                // Skip if we already have this order
                if (await orderExists(orderNumber)) {
                    console.log(`   ✓ Already have EO ${orderNumber}`);
                    continue;
                }
                
                const order = {
                    id: generateOrderId(),
                    title: item.title || 'Untitled Executive Order',
                    order_number: orderNumber,
                    date: item.publication_date || today,
                    summary: item.abstract || item.description || 'No summary available',
                    category: determineCategory(item.title, item.abstract),
                    agencies_affected: extractAgencies(item),
                    source_url: item.html_url || `https://www.federalregister.gov/documents/${item.document_number}`,
                    pdf_url: item.pdf_url || null,
                    citation: item.citation || null,
                    publication_date: item.publication_date,
                    document_number: item.document_number || null,
                    source: 'Federal Register API',
                    verified: true,
                    added_at: new Date().toISOString(),
                    impact_score: calculateImpactScore(item),
                    implementation_status: 'issued'
                };
                
                orders.push(order);
                console.log(`   ✅ Valid EO ${orderNumber}: ${order.title.substring(0, 50)}...`);
            }
            
            console.log(`\n   📊 Results:`);
            console.log(`      Processed: ${data.results.length} documents`);
            console.log(`      Valid EOs: ${orders.length}`);
            console.log(`      Skipped: ${skippedNonEO} (not Executive Orders)`);
            
        } else {
            console.log('   ℹ️ No documents found in the specified date range');
        }
        
        return orders;
        
    } catch (error) {
        console.error('❌ Error fetching from Federal Register:', error.message);
        return [];
    }
}

// Extract agencies from the item
function extractAgencies(item) {
    if (item.agencies && Array.isArray(item.agencies)) {
        return item.agencies.map(a => typeof a === 'string' ? a : a.name || a.raw_name).filter(Boolean);
    }
    return [];
}

// Determine category based on content
function determineCategory(title, abstract) {
    const text = `${title} ${abstract}`.toLowerCase();
    
    if (text.includes('immigration') || text.includes('border')) return 'immigration';
    if (text.includes('climate') || text.includes('energy') || text.includes('environment')) return 'environment';
    if (text.includes('health') || text.includes('medicare') || text.includes('medicaid')) return 'healthcare';
    if (text.includes('defense') || text.includes('military')) return 'defense';
    if (text.includes('trade') || text.includes('tariff')) return 'trade';
    if (text.includes('education')) return 'education';
    if (text.includes('court') || text.includes('judicial')) return 'judicial';
    if (text.includes('tax') || text.includes('economy')) return 'economic';
    if (text.includes('regulation') || text.includes('deregulation')) return 'regulatory';
    
    return 'government_operations';
}

// Calculate impact score
function calculateImpactScore(item) {
    let score = 50; // Base score
    
    // Check for high-impact keywords
    const text = `${item.title} ${item.abstract}`.toLowerCase();
    
    if (text.includes('emergency')) score += 20;
    if (text.includes('national security')) score += 15;
    if (text.includes('immediately')) score += 10;
    if (text.includes('suspend')) score += 15;
    if (text.includes('terminate')) score += 15;
    if (text.includes('billion') || text.includes('million')) score += 10;
    
    // Check agency count
    if (item.agencies && item.agencies.length > 3) score += 10;
    
    return Math.min(score, 100); // Cap at 100
}

// Save to Supabase
async function saveToSupabase(orders) {
    if (!orders || orders.length === 0) {
        console.log('\n📭 No new executive orders to save');
        return;
    }
    
    console.log(`\n💾 Saving ${orders.length} new executive orders to Supabase...`);
    
    try {
        // Insert all orders at once
        await supabaseRequest('executive_orders', 'POST', orders);
        console.log(`✅ Successfully saved ${orders.length} executive orders`);
        
        // Summary
        const highImpact = orders.filter(o => o.impact_score >= 70).length;
        console.log(`\n📊 Summary:`);
        console.log(`   Total new orders: ${orders.length}`);
        console.log(`   High impact orders: ${highImpact}`);
        if (orders.length > 0) {
            console.log(`   Date range: ${orders[orders.length-1]?.date} to ${orders[0]?.date}`);
            console.log(`   Order numbers: ${orders.map(o => o.order_number).join(', ')}`);
        }
        
    } catch (error) {
        console.error('❌ Error saving to Supabase:', error.message);
        throw error;
    }
}

// Get current database stats
async function getDatabaseStats() {
    try {
        const allOrders = await supabaseRequest('executive_orders?select=order_number,date&order=order_number.asc');
        const withNumber = allOrders.filter(o => o.order_number);
        const withoutNumber = allOrders.filter(o => !o.order_number);
        
        console.log('\n📊 Current Database Status:');
        console.log(`   Total records: ${allOrders.length}`);
        console.log(`   With order number: ${withNumber.length}`);
        console.log(`   WITHOUT order number: ${withoutNumber.length} ${withoutNumber.length > 0 ? '⚠️' : '✅'}`);
        
        if (withNumber.length > 0) {
            const orderNums = withNumber.map(o => parseInt(o.order_number)).filter(n => !isNaN(n)).sort((a,b) => a-b);
            console.log(`   Order number range: ${orderNums[0]} to ${orderNums[orderNums.length-1]}`);
        }
        
        if (withoutNumber.length > 0) {
            console.log('\n   ⚠️ WARNING: Database contains records without order numbers!');
            console.log('   These are likely NOT Executive Orders and should be cleaned.');
            console.log('   Run safe-eo-cleanup.bat to remove them.');
        }
        
    } catch (error) {
        console.error('Error getting database stats:', error.message);
    }
}

// Main function
async function main() {
    try {
        console.log('🔍 Starting executive orders collection...\n');
        
        // Show current database state
        await getDatabaseStats();
        
        // Fetch from Federal Register (with proper filtering)
        console.log('\n' + '='.repeat(60));
        const federalOrders = await fetchFromFederalRegister();
        
        // Save to Supabase
        console.log('='.repeat(60));
        if (federalOrders.length > 0) {
            await saveToSupabase(federalOrders);
            console.log('\n✨ Executive orders tracking complete!');
        } else {
            console.log('\n📭 No new executive orders to add');
        }
        
        // Show updated stats
        console.log('\n' + '='.repeat(60));
        await getDatabaseStats();
        
    } catch (error) {
        console.error('\n❌ Fatal error:', error);
        process.exit(1);
    }
}

// Run the tracker
main();
