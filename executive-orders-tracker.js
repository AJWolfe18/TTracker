import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Generate unique ID for each entry
function generateId() {
    return 'eo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Categorize executive orders
function categorizeExecutiveOrder(order) {
    const title = (order.title || '').toLowerCase();
    const summary = (order.summary || '').toLowerCase();
    const text = title + ' ' + summary;
    
    // Immigration keywords
    if (text.match(/immigration|border|deportation|asylum|visa|refugee|daca|ice|cbp|homeland/)) {
        return 'immigration';
    }
    // Economy keywords  
    if (text.match(/economy|trade|tariff|tax|business|commerce|jobs|employment|labor/)) {
        return 'economy';
    }
    // Healthcare keywords
    if (text.match(/health|medical|medicare|medicaid|obamacare|affordable care|drug|pharmaceutical/)) {
        return 'healthcare';
    }
    // Environment keywords
    if (text.match(/environment|climate|energy|oil|gas|renewable|epa|pollution|carbon/)) {
        return 'environment';
    }
    // Foreign policy keywords
    if (text.match(/foreign|international|nato|china|russia|military|defense|security|war/)) {
        return 'foreign_policy';
    }
    // Security keywords
    if (text.match(/security|terrorism|intelligence|fbi|cia|surveillance|cyber/)) {
        return 'security';
    }
    
    return 'government_operations';
}

// Assess impact of executive order
function assessImpact(order) {
    const impactFactors = {
        scope: order.agencies_affected?.length > 3 ? 20 : 
               order.agencies_affected?.length > 1 ? 15 : 10,
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
            // Still create the empty files for the dashboard
            await fs.writeFile(masterFilename, JSON.stringify(masterLog, null, 2));
            
            // Ensure public directory exists
            try {
                await fs.access(publicDir);
            } catch {
                await fs.mkdir(publicDir, { recursive: true });
                console.log(`  📁 Created ${publicDir} directory`);
            }
            
            await fs.writeFile(publicMasterFile, JSON.stringify(masterLog, null, 2));
            console.log(`  ✅ Created empty dashboard files`);
            return;
        }

        // Check for duplicates
        const existingUrls = new Set(masterLog.map(order => order.source_url));
        const newOrders = orders.filter(order => !existingUrls.has(order.source_url));
        
        if (newOrders.length === 0) {
            console.log('\n✅ No new executive orders found (all already exist)');
            return;
        }

        console.log(`\n💾 Saving ${newOrders.length} new executive orders...`);

        // Add new orders to master log
        masterLog.push(...newOrders);
        
        // Sort by date (newest first)
        masterLog.sort((a, b) => new Date(b.date) - new Date(a.date));

        // Save daily file
        await fs.writeFile(filename, JSON.stringify(newOrders, null, 2));
        console.log(`  ✅ Saved to ${filename}`);

        // Update master log
        await fs.writeFile(masterFilename, JSON.stringify(masterLog, null, 2));
        console.log(`  ✅ Updated ${masterFilename} (${masterLog.length} total orders)`);

        // Ensure public directory exists
        try {
            await fs.access(publicDir);
        } catch {
            await fs.mkdir(publicDir, { recursive: true });
            console.log(`  📁 Created ${publicDir} directory`);
        }

        // Copy to public directory for dashboard
        await fs.writeFile(publicMasterFile, JSON.stringify(masterLog, null, 2));
        console.log(`  ✅ Copied to ${publicMasterFile} for dashboard access`);

        // Summary
        console.log(`\n📊 Executive Orders Summary:`);
        console.log(`  • New orders added: ${newOrders.length}`);
        console.log(`  • Total orders: ${masterLog.length}`);
        console.log(`  • Date range: ${masterLog[masterLog.length-1]?.date} to ${masterLog[0]?.date}`);

    } catch (error) {
        console.error('❌ Error saving executive orders:', error);
        throw error;
    }
}

// Main execution
async function main() {
    console.log('\n🏛️  Executive Orders Tracker - Historical Backfill');
    console.log('='.repeat(60));

    const today = new Date().toISOString().split('T')[0];
    const startDate = '2025-01-20'; // Trump inauguration date
    
    console.log(`📅 Collecting executive orders from ${startDate} to ${today}`);

    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
        throw new Error('OpenAI API key not found in environment variables');
    }

    try {
        console.log('\n🔍 Searching for executive orders...');
        
        // Use the EXACT same API format as your working political tracker
        const searchPrompt = `Search WhiteHouse.gov for all executive orders issued by President Trump from January 20, 2025 to ${today}. Find all executive orders, presidential memoranda, and policy directives during this entire period.

For each executive order found, extract and format as JSON:
{
  "title": "Full official title of the executive order",
  "order_number": "Executive Order number (e.g., 'EO 14001') if available, or null",
  "date": "YYYY-MM-DD format of signing date",
  "summary": "Brief 2-3 sentence summary of key provisions and expected impact",
  "category": "One of: immigration, economy, healthcare, environment, foreign_policy, security, government_operations",
  "agencies_affected": ["Array of federal agencies/departments that will implement or be affected"],
  "source_url": "Official WhiteHouse.gov URL to the full text or announcement",
  "policy_direction": "One of: expand, eliminate, create, modify",
  "implementation_timeline": "One of: immediate, 30_days, 90_days, ongoing",
  "severity_rating": "One of: low, medium, high (based on scope of impact and number of people affected)"
}

Return a JSON array of all executive orders found from this time period. Ensure all source URLs are accessible WhiteHouse.gov links and all required fields are included.`;

        // Use the EXACT same API call structure as your working political tracker
        const response = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                tools: [
                    {
                        type: 'web_search_preview',
                        search_context_size: 'medium'
                    }
                ],
                input: searchPrompt,
                max_output_tokens: 4000
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        console.log(`  ✅ Received response from OpenAI Responses API`);

        // Extract content using the same pattern as your political tracker
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
                // Enhanced categorization
                category: categorizeExecutiveOrder(order),
                // Impact assessment
                impact_score: assessImpact(order),
                // Add tracking fields
                implementation_status: 'issued',
                legal_challenges: [],
                related_orders: []
            };
        }).filter(order => order !== null && validateOrder(order));

        console.log(`  ✅ Found ${processedOrders.length} valid executive orders`);
        
        if (processedOrders.length > 0) {
            processedOrders.forEach((order, index) => {
                console.log(`    ${index + 1}. ${order.title} (${order.date})`);
            });
        }

        // Save the executive orders
        await saveExecutiveOrders(processedOrders);

        console.log('\n🎉 Executive Orders tracking completed successfully!');
        console.log('\n📋 Next steps:');
        console.log('  1. Check your dashboard Executive Orders tab');
        console.log('  2. Verify data quality and source links');
        console.log('  3. Daily automation will continue from here');

    } catch (error) {
        console.error('\n❌ Error in executive orders tracking:', error);
        
        // Create empty files to prevent workflow failures
        try {
            await fs.writeFile('executive-orders-log.json', JSON.stringify([], null, 2));
            await fs.mkdir('public', { recursive: true });
            await fs.writeFile('public/executive-orders-log.json', JSON.stringify([], null, 2));
            console.log('✅ Created empty files to prevent workflow failure');
        } catch (fileError) {
            console.error('❌ Could not create fallback files:', fileError);
        }
        
        process.exit(1);
    }
}

// Run the tracker
main().catch(console.error);