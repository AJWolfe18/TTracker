// executive-orders-tracker.js
import fetch from 'node-fetch';
import fs from 'fs/promises';

console.log('🏩️ EXECUTIVE ORDERS TRACKER');
console.log('============================\n');

// Generate simple ID
function generateId() {
    return Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

// Prompt definition (FIXED)
const EO_PROMPT = `Search for all U.S. Executive Orders issued between January 20, 2025 and today.

For each executive order, extract and return the following structured data in valid JSON format:
{
  "date": "YYYY-MM-DD",
  "title": "Full official title of the executive order",
  "order_number": "Executive Order number (e.g. EO 14001)",
  "summary": "2–3 sentence nonpartisan summary of what the order does and its intended impact",
  "impact_areas": ["e.g. immigration", "energy policy", "trade", "education"],
  "affected_agencies": ["List of federal departments or agencies involved"],
  "policy_direction": "expand | restrict | modify | create | eliminate",
  "severity_rating": "low | medium | high",
  "source_url": "Direct URL to official WhiteHouse.gov page",
  "full_text_available": true | false
}

Focus on categorizing each order by policy area. Prioritize orders related to:
- Immigration and border security (e.g. wall, deportations, asylum)
- Energy and environment (e.g. drilling, pipelines, climate rollback)
- Trade and tariffs (especially China, Mexico, WTO, USMCA)
- Defense and national security (DoD, NSA, cyber, border ops)
- Federal agency restructuring, appointments, or spending cuts
- Education, healthcare, and social policy (e.g. Title IX, ACA)
- Regulatory rollback or new enforcement measures

### Instructions:
- Include all orders, both major and minor — no filtering
- Include EOs issued on weekends, holidays, or same-day edits
- Only include EOs published or confirmed on whitehouse.gov
- Group amended or rescinded orders with the original, noting changes
- Return as a complete JSON array (even if over 20 results)`;

// Fetch executive orders from WhiteHouse.gov
async function fetchExecutiveOrders() {
    try {
        console.log('📋 Searching for recent Executive Orders...');

        const response = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                tools: [
                    {
                        type: 'web_search_preview',
                        search_context_size: 'large'
                    }
                ],
                input: EO_PROMPT,
                max_output_tokens: 3000
            }),
        });

        if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.status}`);
        }

        const data = await response.json();
        const content = data.output?.find(item => item.type === 'message')?.content?.[0]?.text || '';

        console.log(`  Response length: ${content.length}`);
        console.log(`  Tokens used: ${data.usage?.total_tokens || 'unknown'}`);

        // Extract JSON from response
        let orders = [];
        try {
            const jsonMatch = content.match(/\[[\s\S]*?\]/);
            if (jsonMatch) {
                orders = JSON.parse(jsonMatch[0]);
            }
        } catch (parseError) {
            console.log(`  ❌ Could not parse JSON response`);
            orders = [];
        }

        if (!Array.isArray(orders)) {
            orders = orders ? [orders] : [];
        }

        // Process and enhance orders
        const processedOrders = orders.map(order => {
            if (!order || typeof order !== 'object') return null;

            return {
                ...order,
                id: generateId(),
                type: 'executive_order',
                added_at: new Date().toISOString(),
                verified: order.source_url?.includes('whitehouse.gov') || false,
                date: order.date || new Date().toISOString().split('T')[0],
                category: categorizeExecutiveOrder(order),
                impact_score: assessImpact(order),
                implementation_status: 'issued',
                legal_challenges: [],
                related_orders: []
            };
        }).filter(order => order !== null && validateOrder(order));

        console.log(`  ✅ Found ${processedOrders.length} valid executive orders`);

        if (processedOrders.length > 0) {
            processedOrders.forEach((order, index) => {
                console.log(`    ${index + 1}. [${order.severity_rating.toUpperCase()}] ${order.title}`);
            });
        }

        return processedOrders;

    } catch (error) {
        console.error('❌ Error fetching executive orders:', error.message);
        return [];
    }
}

// Categorize executive orders by policy area
function categorizeExecutiveOrder(order) {
    const title = (order.title || '').toLowerCase();
    const summary = (order.summary || '').toLowerCase();
    const content = `${title} ${summary}`;
    
    if (content.includes('immigration') || content.includes('border') || content.includes('ice')) {
        return 'Immigration & Border Security';
    } else if (content.includes('regulation') || content.includes('deregulation') || content.includes('agency')) {
        return 'Federal Regulation';
    } else if (content.includes('energy') || content.includes('environment') || content.includes('climate')) {
        return 'Energy & Environment';
    } else if (content.includes('trade') || content.includes('tariff') || content.includes('economic')) {
        return 'Economic Policy';
    } else if (content.includes('security') || content.includes('defense') || content.includes('military')) {
        return 'National Security';
    } else if (content.includes('healthcare') || content.includes('medicare') || content.includes('medicaid')) {
        return 'Healthcare Policy';
    } else if (content.includes('education') || content.includes('school')) {
        return 'Education Policy';
    } else {
        return 'General Administration';
    }
}

// Assess the impact of an executive order
function assessImpact(order) {
    const impactFactors = {
        agencies: (order.affected_agencies?.length || 0) * 10,
        areas: (order.impact_areas?.length || 0) * 5,
        severity: order.severity_rating === 'high' ? 30 : 
                 order.severity_rating === 'medium' ? 15 : 5,
        direction: order.policy_direction === 'eliminate' ? 25 :
                  order.policy_direction === 'create' ? 20 :
                  order.policy_direction === 'expand' ? 15 : 10
    };
    
    return Object.values(impactFactors).reduce((sum, val) => sum + val, 0);
}

// Validate order data
function validateOrder(order) {
    const required = ['title', 'date', 'summary'];
    const missing = required.filter(field => !order[field]);
    
    if (missing.length > 0) {
        console.log(`  ⚠️  Order missing required fields: ${missing.join(', ')}`);
        return false;
    }
    
    return true;
}

// Save executive orders to separate file
async function saveExecutiveOrders(orders) {
    const today = new Date().toISOString().split('T')[0];
    const filename = `executive-orders-${today}.json`;
    const masterFilename = 'executive-orders-log.json';
    const publicDir = 'public';
    const publicMasterFile = `${publicDir}/${masterFilename}`;

    try {
        // Load existing executive orders log
        console.log('\n📁 Loading existing executive orders log...');
        let masterLog = [];
        try {
            const masterData = await fs.readFile(masterFilename, 'utf8');
            masterLog = JSON.parse(masterData);
            console.log(`  Found ${masterLog.length} existing orders`);
        } catch (error) {
            console.log('  No existing orders log found, creating new one');
        }

        if (orders.length === 0) {
            console.log('\n⚠️  No new executive orders to save');
            return;
        }

        // Check for duplicates
        const existingUrls = new Set(masterLog.map(order => order.source_url));
        const newOrders = orders.filter(order => !existingUrls.has(order.source_url));
        
        if (newOrders.length === 0) {
            console.log('\n⚠️  All orders already exist in database');
            return;
        }

        // Save daily file
        await fs.writeFile(filename, JSON.stringify(newOrders, null, 2));
        console.log(`\n✅ Saved ${newOrders.length} new orders to ${filename}`);

        // Update master log
        masterLog.push(...newOrders);
        
        // Sort by date (newest first)
        masterLog.sort((a, b) => b.date.localeCompare(a.date));

        // Save updated master log
        await fs.writeFile(masterFilename, JSON.stringify(masterLog, null, 2));
        console.log(`✅ Updated master orders log with ${masterLog.length} total orders`);

        // Ensure public directory exists and copy master log
        try {
            await fs.mkdir(publicDir, { recursive: true });
            await fs.writeFile(publicMasterFile, JSON.stringify(masterLog, null, 2));
            console.log('✅ Updated public executive orders log for website');
        } catch (publicError) {
            console.error('❌ Error updating public orders log:', publicError.message);
        }

        console.log(`\n📊 Executive Orders Summary:`);
        console.log(`  - New orders added: ${newOrders.length}`);
        console.log(`  - Total orders in database: ${masterLog.length}`);
        
        // Category breakdown
        const categoryCount = {};
        newOrders.forEach(order => {
            categoryCount[order.category] = (categoryCount[order.category] || 0) + 1;
        });
        
        console.log('\n📊 New Orders by Category:');
        Object.entries(categoryCount).forEach(([cat, count]) => {
            console.log(`  - ${cat}: ${count}`);
        });

    } catch (error) {
        console.error('❌ Error saving executive orders:', error.message);
        throw error;
    }
}

// Main execution
async function main() {
    try {
        console.log('🚀 Starting Executive Orders Tracker...');
        console.log('🔍 Using OpenAI Responses API with web search capabilities\n');
        
        const orders = await fetchExecutiveOrders();
        await saveExecutiveOrders(orders);

        console.log('\n=== EXECUTIVE ORDERS TRACKING SUMMARY ===');
        console.log('📅 Date:', new Date().toDateString());
        console.log('🕐 Time:', new Date().toLocaleTimeString());
        console.log('📋 New orders found:', orders.length);

        if (orders.length > 0) {
            // Severity breakdown
            const highSeverity = orders.filter(o => o.severity_rating === 'high').length;
            const mediumSeverity = orders.filter(o => o.severity_rating === 'medium').length;
            const lowSeverity = orders.filter(o => o.severity_rating === 'low').length;
            
            console.log(`\n⚠️  Severity: ${highSeverity} high, ${mediumSeverity} medium, ${lowSeverity} low`);
            
            // Most impactful orders
            const topOrders = orders
                .sort((a, b) => b.impact_score - a.impact_score)
                .slice(0, 3);
                
            console.log('\n🎯 Most Impactful Orders:');
            topOrders.forEach((order, index) => {
                console.log(`  ${index + 1}. ${order.title} (Impact: ${order.impact_score})`);
            });
        }
        
        console.log('==========================================\n');

    } catch (error) {
        console.error('❌ Error in main execution:', error.message);
        console.error('Stack trace:', error.stack);
        console.log('Script completed with errors but continuing...');
    }
}

// Check if this is being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export { fetchExecutiveOrders, saveExecutiveOrders, main };
