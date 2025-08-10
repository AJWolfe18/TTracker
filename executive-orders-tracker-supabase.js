// executive-orders-tracker-supabase.js
// Fetches and stores executive orders in Supabase

import fetch from 'node-fetch';
import { supabaseRequest } from './supabase-config.js';

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

// Fetch from Federal Register API
async function fetchFromFederalRegister() {
    console.log('📊 Fetching from Federal Register API...');
    
    const startDate = '2025-01-20'; // Inauguration date
    const today = new Date().toISOString().split('T')[0];
    
    const url = `https://www.federalregister.gov/api/v1/articles.json?conditions[type]=PRESDOCU&conditions[presidential_document_type_id]=2&conditions[publication_date][gte]=${startDate}&conditions[publication_date][lte]=${today}&per_page=200&order=newest`;
    
    console.log(`   Searching from ${startDate} to ${today}`);
    
    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Federal Register API error: ${response.status}`);
        }
        
        const data = await response.json();
        const orders = [];
        
        if (data.results && data.results.length > 0) {
            console.log(`   ✅ Found ${data.results.length} executive orders\n`);
            
            for (const item of data.results) {
                // Extract EO number from title
                const eoMatch = item.title?.match(/Executive Order (\d+)/i) || 
                               item.executive_order_number ||
                               item.title?.match(/(\d{5})/);
                
                const orderNumber = eoMatch ? (eoMatch[1] || eoMatch[0]) : null;
                
                // Skip if we already have this order
                if (orderNumber && await orderExists(orderNumber)) {
                    console.log(`   ⏭️ Skipping existing order: EO ${orderNumber}`);
                    continue;
                }
                
                const order = {
                    id: generateOrderId(),
                    title: item.title || 'Untitled Executive Order',
                    order_number: orderNumber,
                    date: item.publication_date || today,
                    summary: item.abstract || item.description || 'No summary available',
                    category: determineCategory(item.title, item.abstract),
                    agencies_affected: item.agencies || [],
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
                console.log(`   📝 Processed: ${order.title.substring(0, 60)}...`);
            }
        } else {
            console.log('   ℹ️ No executive orders found in the specified date range');
        }
        
        return orders;
        
    } catch (error) {
        console.error('❌ Error fetching from Federal Register:', error.message);
        return [];
    }
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
        console.log('\n⚠️ No new executive orders to save');
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
        console.log(`   Date range: ${orders[orders.length-1]?.date} to ${orders[0]?.date}`);
        
    } catch (error) {
        console.error('❌ Error saving to Supabase:', error.message);
        throw error;
    }
}

// Main function
async function main() {
    try {
        console.log('🔍 Starting executive orders collection...\n');
        
        // Fetch from Federal Register
        const federalOrders = await fetchFromFederalRegister();
        
        // Save to Supabase
        if (federalOrders.length > 0) {
            await saveToSupabase(federalOrders);
            console.log('\n✨ Executive orders tracking complete!');
        } else {
            console.log('\n📭 No new executive orders found today');
        }
        
    } catch (error) {
        console.error('\n❌ Fatal error:', error);
        process.exit(1);
    }
}

// Run the tracker
main();