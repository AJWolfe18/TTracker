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
    
    // Check if this is initial import or daily update
    const today = new Date().toISOString().split('T')[0];
    
    // Check if we have any existing orders
    let startDate;
    try {
        const existing = await supabaseRequest('executive_orders?select=id&limit=1');
        if (!existing || existing.length === 0) {
            // Initial import - get everything since inauguration
            startDate = '2025-01-20';
            console.log('   🚀 INITIAL IMPORT MODE - fetching all EOs since inauguration');
        } else {
            // Daily update - only last 3 days
            const threeDaysAgo = new Date(Date.now() - 3*24*60*60*1000).toISOString().split('T')[0];
            startDate = threeDaysAgo;
            console.log('   📅 DAILY UPDATE MODE - fetching last 3 days only');
        }
    } catch (error) {
        // If check fails, default to full import
        startDate = '2025-01-20';
        console.log('   ⚠️ Could not check existing records, doing full import');
    }
    
    // Using proper endpoint for Executive Orders only
    // presidential_document_type_id=2 specifically means Executive Orders
    const url = `https://www.federalregister.gov/api/v1/documents.json?conditions[type]=PRESDOCU&conditions[presidential_document_type_id]=2&conditions[publication_date][gte]=${startDate}&conditions[publication_date][lte]=${today}&per_page=200&order=newest`;
    
    console.log(`   Searching from ${startDate} to ${today}`);
    console.log(`   Filter: Executive Orders ONLY (type_id=2)\n`);
    
    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Federal Register API error: ${response.status} - ${errorText}`);
        }
        
        const data = await response.json();
        
        // Validate API response structure
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid API response: not a valid JSON object');
        }
        
        if (!Array.isArray(data.results)) {
            throw new Error(`Invalid API response: results is not an array (got ${typeof data.results})`);
        }
        const orders = [];
        let skippedNonEO = 0;
        
        if (data.results && data.results.length > 0) {
            console.log(`   📋 Found ${data.results.length} Executive Orders from Federal Register`);
            console.log(`   🔍 Processing and extracting order numbers...\n`);
            
            for (const item of data.results) {
                // DEBUG: Log what we actually get from the API
                console.log(`   🔍 DEBUG: executive_order_number = "${item.executive_order_number}" (type: ${typeof item.executive_order_number})`);
                console.log(`   🔍 DEBUG: title = "${item.title?.substring(0, 80)}..."`);
                console.log(`   🔍 DEBUG: document_number = "${item.document_number}"`);
                
                // Extract EO number - MUST be actual Executive Order number (14XXX)
                let orderNumber = null;
                
                // 1. Try the dedicated executive_order_number field (most reliable)
                if (item.executive_order_number && item.executive_order_number !== "") {
                    orderNumber = item.executive_order_number.toString();
                    console.log(`   🎯 Using API executive_order_number: ${orderNumber}`);
                } 
                // 2. Try extracting from title "Executive Order 14334" (5-digit numbers only)
                else if (item.title) {
                    const eoMatch = item.title.match(/Executive Order (1\d{4})/i); // Must start with 1, be 5 digits
                    if (eoMatch) {
                        orderNumber = eoMatch[1];
                        console.log(`   📝 Extracted from title: ${orderNumber}`);
                    } else {
                        console.log(`   ⚠️ Could not extract EO number from title: "${item.title}"`);
                    }
                } else {
                    console.log(`   ⚠️ No title available for extraction`);
                }
                
                console.log(`   🔍 Final orderNumber: "${orderNumber}"\n`);
                
                // Validate the extracted number is in valid EO range (14000-15000)
                if (orderNumber) {
                    const orderNum = parseInt(orderNumber);
                    if (isNaN(orderNum) || orderNum < 14000 || orderNum > 15000) {
                        console.log(`   ⚠️ Invalid EO number ${orderNumber} - not in expected range (14000-15000)`);
                        orderNumber = null; // Reset to null so it gets skipped
                    }
                }
                
                // Skip if we absolutely cannot find a VALID EO number
                if (!orderNumber) {
                    console.log(`   ⚠️ No valid EO number found: ${item.title?.substring(0, 50)}...`);
                    console.log(`      Document: ${item.document_number}, executive_order_number: ${item.executive_order_number}`);
                    skippedNonEO++;
                    continue;
                }
                
                // Validate order number is a valid number
                const orderNum = parseInt(orderNumber);
                if (isNaN(orderNum)) {
                    console.log(`   ⚠️ Invalid order number ${orderNumber} - skipping`);
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
                console.log(`   ✅ Found EO ${orderNumber}: ${order.title.substring(0, 50)}...`);
                console.log(`      Source: ${item.document_number} | ${item.html_url}`);
            }
            
            console.log(`\n   📊 Results:`);
            console.log(`      Federal Register documents: ${data.results.length}`);
            console.log(`      New EOs to add: ${orders.length}`);
            console.log(`      Skipped: ${skippedNonEO} (no order number found)`);
            if (orders.length > 0) {
            const orderNums = orders.map(o => parseInt(o.order_number)).sort((a,b) => a-b);
            console.log(`      Order numbers found: ${orderNums.join(', ')}`);
        }
            
        } else {
            console.log('   ℹ️ No documents found in the specified date range');
        }
        
        return orders;
        
    } catch (error) {
        console.error('❌ FATAL ERROR fetching from Federal Register:', error.message);
        console.error('   URL:', url);
        console.error('   This is a blocking error - manual investigation required');
        throw error; // Re-throw to stop execution
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

// Save to Supabase with error handling
async function saveToSupabase(orders) {
    if (!orders || orders.length === 0) {
        console.log('\n📭 No new executive orders to save');
        return;
    }
    
    console.log(`\n💾 Saving ${orders.length} new executive orders to Supabase...`);
    
    try {
        // Validate all orders have required fields before attempting save
        for (const order of orders) {
            if (!order.order_number || !order.title || !order.date) {
                throw new Error(`Invalid order data: missing required fields in order ${order.order_number || 'unknown'}`);
            }
        }
        
        // Insert all orders at once
        const result = await supabaseRequest('executive_orders', 'POST', orders);
        
        // Validate the insert succeeded
        if (!result) {
            throw new Error('Supabase insert returned null/undefined result');
        }
        
        console.log(`✅ Successfully saved ${orders.length} executive orders`);
        
        // Summary
        const highImpact = orders.filter(o => o.impact_score >= 70).length;
        console.log(`\n📊 Summary:`);
        console.log(`   Total new orders: ${orders.length}`);
        console.log(`   High impact orders: ${highImpact}`);
        if (orders.length > 0) {
            const orderNums = orders.map(o => parseInt(o.order_number)).sort((a,b) => a-b);
            console.log(`   Order number range: ${orderNums[0]} to ${orderNums[orderNums.length-1]}`);
            console.log(`   Order numbers: ${orderNums.join(', ')}`);
        }
        
    } catch (error) {
        console.error('❌ FATAL ERROR saving to Supabase:', error.message);
        console.error('   This is a blocking error - manual investigation required');
        console.error('   Orders attempted:', orders.map(o => o.order_number).join(', '));
        throw error; // Re-throw to stop execution
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
