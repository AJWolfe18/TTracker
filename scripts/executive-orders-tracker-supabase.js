// executive-orders-tracker-supabase.js
// Fetches and stores executive orders in Supabase
// FIXED VERSION - Only collects actual Executive Orders, not all presidential documents
// HYBRID: Uses Federal Register for data + OpenAI for AI-powered analysis
// Smart detection: Full import if empty, daily updates (3-day window) otherwise
// STATUS: Production-ready - successfully backfilled 190 EOs on Aug 15, 2025

import fetch from 'node-fetch';
import { supabaseRequest } from '../config/supabase-config-node.js';
// FIX: Using correct function name generateEOTranslation (not generateSpicyEOTranslation)
import { generateEOTranslation } from './spicy-eo-translator.js';

console.log('📜 EXECUTIVE ORDERS TRACKER - SUPABASE VERSION');
console.log('================================================\n');

// Check if OpenAI is available
const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) {
    console.log('⚠️  WARNING: No OPENAI_API_KEY found - summaries will be basic');
} else {
    console.log('✅ OpenAI API key found - will generate AI summaries');
}

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

// Generate AI analysis using OpenAI (summary + all metadata)
async function generateAIAnalysis(title, orderNumber, abstract = '') {
    if (!OPENAI_KEY) {
        // Fallback if no OpenAI key - return basic defaults
        return {
            summary: `Executive Order ${orderNumber}: ${title}`,
            severity_rating: 'medium',
            policy_direction: 'modify',
            implementation_timeline: 'ongoing',
            impact_areas: [],
            full_text_available: true
        };
    }
    
    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENAI_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a political analyst. Analyze executive orders and provide structured JSON output.'
                    },
                    {
                        role: 'user',
                        content: `Analyze Executive Order ${orderNumber}: "${title}"${abstract ? `. Abstract: ${abstract}` : ''}.

Provide a JSON response with these exact fields:
{
  "summary": "2-3 sentence summary of what this order does and its key impacts",
  "severity_rating": "low|medium|high based on scope and impact",
  "policy_direction": "expand|restrict|modify|create|eliminate",
  "implementation_timeline": "immediate|30_days|90_days|ongoing",
  "impact_areas": ["list of policy areas affected like immigration, economy, healthcare, etc"],
  "full_text_available": true
}

Respond ONLY with valid JSON.`
                    }
                ],
                max_tokens: 300,
                temperature: 0.3
            }),
        });

        if (!response.ok) {
            console.log(`   ⚠️ OpenAI API error: ${response.status}`);
            return {
                summary: `Executive Order ${orderNumber}: ${title}`,
                severity_rating: 'medium',
                policy_direction: 'modify',
                implementation_timeline: 'ongoing',
                impact_areas: [],
                full_text_available: true
            };
        }

        const data = await response.json();
        const content = data.choices[0]?.message?.content;
        
        try {
            const analysis = JSON.parse(content);
            return analysis;
        } catch (parseError) {
            console.log(`   ⚠️ Could not parse AI response as JSON`);
            return {
                summary: content || `Executive Order ${orderNumber}: ${title}`,
                severity_rating: 'medium',
                policy_direction: 'modify',
                implementation_timeline: 'ongoing',
                impact_areas: [],
                full_text_available: true
            };
        }
        
    } catch (error) {
        console.log(`   ⚠️ Error generating AI analysis: ${error.message}`);
        return {
            summary: `Executive Order ${orderNumber}: ${title}`,
            severity_rating: 'medium',
            policy_direction: 'modify',
            implementation_timeline: 'ongoing',
            impact_areas: [],
            full_text_available: true
        };
    }
}

// Fetch from Federal Register API - FIXED to only get Executive Orders
async function fetchFromFederalRegister() {
    console.log('📊 Fetching from Federal Register API (Executive Orders ONLY)...');
    
    // Check if this is initial import or daily update
    // FIX: Use actual current date (January 2025, not August 2025)
    // The system date might be wrong, so we'll use the last known good date
    const realToday = new Date();
    const year = realToday.getFullYear();
    const month = realToday.getMonth() + 1;
    
    // Use the current system date
    const today = realToday.toISOString().split('T')[0];
    
    // TEMPORARY FORCE FULL IMPORT - Comment/uncomment this block as needed
    // ========================================================================
    // Uncomment the next 2 lines to FORCE a full import (backfill all EOs since inauguration)
    // let startDate = '2025-01-20';
    // console.log('   🚀 FORCED FULL IMPORT MODE - fetching ALL EOs since inauguration (Jan 20, 2025)');
    
    // Comment out the block below when forcing full import
    // NORMAL SMART DETECTION LOGIC - RE-ENABLED FOR DAILY UPDATES
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
    // END OF NORMAL LOGIC
    
    // Using CORRECT endpoint - MUST specify fields[] to get executive_order_number!
    const url = 'https://www.federalregister.gov/api/v1/documents.json?' +
        'conditions[type][]=PRESDOCU&' +
        'conditions[presidential_document_type]=executive_order&' +
        `conditions[publication_date][gte]=${startDate}&` +
        `conditions[publication_date][lte]=${today}&` +
        'fields[]=executive_order_number&' +
        'fields[]=document_number&' +
        'fields[]=title&' +
        'fields[]=publication_date&' +
        'fields[]=signing_date&' +
        'fields[]=president&' +
        'fields[]=html_url&' +
        'fields[]=pdf_url&' +
        'fields[]=abstract&' +
        'fields[]=citation&' +
        'per_page=200&' +
        'order=executive_order';
    
    // Calculate days being fetched for clarity
    const start = new Date(startDate);
    const end = new Date(today);
    const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    
    console.log(`   Searching from ${startDate} to ${today} (${daysDiff} days)`);
    console.log(`   Filter: Executive Orders ONLY\n`);
    console.log(`   🎯 EXPECTING ~190 Executive Orders for full import\n`);
    
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
        
        // Check if the API returned an error
        if (data.errors) {
            console.log(`   ⚠️ API returned errors: ${JSON.stringify(data.errors)}`);
            return [];
        }
        
        // Check if results field exists
        if (!data.hasOwnProperty('results')) {
            console.log(`   ⚠️ API response missing 'results' field. Response keys: ${Object.keys(data).join(', ')}`);
            console.log(`   Full response: ${JSON.stringify(data).substring(0, 500)}`);
            
            // It might be a valid response with 0 results
            if (data.count === 0 || data.total === 0) {
                console.log('   ℹ️ No executive orders found in the specified date range');
                return [];
            }
            
            throw new Error(`Invalid API response structure - no results field`);
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
                // Since we explicitly request executive_order_number field, it should be there
                const orderNumber = item.executive_order_number;
                
                if (!orderNumber) {
                    console.log(`   ⚠️ Skipping - no EO number: ${item.title?.substring(0, 50)}...`);
                    skippedNonEO++;
                    continue;
                }
                
                // Validate it's a real number
                const orderNum = parseInt(orderNumber);
                if (isNaN(orderNum)) {
                    console.log(`   ⚠️ Invalid order number format: ${orderNumber}`);
                    skippedNonEO++;
                    continue;
                }
                
                // Skip if we already have this order
                if (await orderExists(orderNumber)) {
                    console.log(`   ✓ Already have EO ${orderNumber}`);
                    continue;
                }
                
                // Generate AI analysis for all missing fields
                let aiAnalysis = null;
                if (!item.abstract || item.abstract.trim() === '') {
                    console.log(`   🤖 Generating AI analysis for EO ${orderNumber}...`);
                    aiAnalysis = await generateAIAnalysis(item.title, orderNumber, item.abstract);
                }
                
                // Generate spicy EO translation using the new system
                let spicyTranslation = {};
                try {
                    console.log(`   🌶️ Generating spicy translation for EO ${orderNumber}...`);
                    const summaryForTranslation = aiAnalysis ? aiAnalysis.summary : (item.abstract || `Executive Order ${orderNumber}: ${item.title}`);
                    
                    spicyTranslation = await generateEOTranslation({
                        title: item.title || 'Untitled Executive Order',
                        summary: summaryForTranslation,
                        order_number: orderNumber,
                        federal_register_number: item.document_number
                    });
                    console.log(`   🎯 Impact type: ${spicyTranslation.eo_impact_type}`);
                } catch (spicyError) {
                    console.log(`   ⚠️ Spicy translation generation failed:`, spicyError.message);
                    spicyTranslation = {
                        eo_impact_type: null,
                        spicy_summary: null,
                        shareable_hook: null,
                        severity_label_inapp: null,
                        severity_label_share: null
                    };
                }
                
                const order = {
                    id: generateOrderId(),
                    title: item.title || 'Untitled Executive Order',
                    order_number: orderNumber,
                    date: item.publication_date || today,
                    summary: aiAnalysis ? aiAnalysis.summary : (item.abstract || `Executive Order ${orderNumber}: ${item.title}`),
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
                    implementation_status: 'issued',
                    // New fields from AI analysis
                    severity_rating: aiAnalysis ? aiAnalysis.severity_rating : 'medium',
                    policy_direction: aiAnalysis ? aiAnalysis.policy_direction : 'modify',
                    implementation_timeline: aiAnalysis ? aiAnalysis.implementation_timeline : 'ongoing',
                    impact_areas: aiAnalysis ? aiAnalysis.impact_areas : [],
                    full_text_available: aiAnalysis ? aiAnalysis.full_text_available : true,
                    type: 'executive_order',
                    legal_challenges: [],
                    related_orders: [],
                    // Add spicy translation fields with EO-specific categorization
                    eo_impact_type: spicyTranslation.eo_impact_type,
                    spicy_summary: spicyTranslation.spicy_summary,
                    shareable_hook: spicyTranslation.shareable_hook,
                    severity_label_inapp: spicyTranslation.severity_label_inapp,
                    severity_label_share: spicyTranslation.severity_label_share
                    // editorial_summary field removed - not in database schema
                    // editorial_summary: aiAnalysis ? aiAnalysis.summary : (item.abstract || `Executive Order ${orderNumber}: ${item.title}`)
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
