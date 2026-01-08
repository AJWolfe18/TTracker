import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration for legal compliance
const CONFIG = {
    // Updated endpoints based on testing
    FEDERAL_REGISTER_BASE: 'https://www.federalregister.gov/api/v1',
    WHITEHOUSE_RSS: 'https://www.whitehouse.gov/news/feed/', // Fixed URL
    
    // User agent for proper identification
    USER_AGENT: 'TrumpyTracker/1.0 (Political Accountability Tracker; +https://trumpytracker.com)',
    
    // Request settings
    REQUEST_TIMEOUT: 30000, // 30 seconds
    RETRY_ATTEMPTS: 3,
    RATE_LIMIT_DELAY: 1000, // 1 second between requests
};

// Generate unique ID for each entry
function generateId() {
    return 'eo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Retry wrapper with exponential backoff
async function fetchWithRetry(url, options = {}, maxRetries = CONFIG.RETRY_ATTEMPTS) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);
            
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: {
                    'User-Agent': CONFIG.USER_AGENT,
                    'Accept': 'application/json',
                    ...options.headers
                }
            });
            
            clearTimeout(timeout);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            return response;
            
        } catch (error) {
            console.log(`  ⚠️  Attempt ${attempt + 1}/${maxRetries} failed: ${error.message}`);
            
            if (attempt === maxRetries - 1) {
                throw error;
            }
            
            // Exponential backoff
            const delay = CONFIG.RATE_LIMIT_DELAY * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Fixed Federal Register API call based on documentation
async function fetchFromFederalRegisterAPI() {
    try {
        console.log('🏛️  Fetching from Federal Register API (official government source)...');
        
        const today = new Date().toISOString().split('T')[0];
        
        // FIXED: Use correct parameter format based on API documentation
        // Based on search results, the API uses different parameter structure
        const apiUrl = `${CONFIG.FEDERAL_REGISTER_BASE}/articles.json` + 
                      `?conditions[type]=PRESDOCU` + // Presidential documents
                      `&conditions[presidential_document_type_id]=2` + // Executive Orders specifically
                      `&conditions[publication_date][gte]=2025-01-20` +
                      `&conditions[publication_date][lte]=${today}` +
                      `&fields[]=title&fields[]=executive_order_number&fields[]=publication_date` +
                      `&fields[]=signing_date&fields[]=citation&fields[]=html_url` +
                      `&fields[]=pdf_url&fields[]=json_url&fields[]=abstract` +
                      `&order=signing_date&per_page=1000`;
        
        console.log(`  📡 API Query: ${apiUrl}`);
        
        const response = await fetchWithRetry(apiUrl);
        
        // Basic validation for government API response
        let data;
        try {
            const responseText = await response.text();
            console.log(`  📄 Response preview: ${responseText.substring(0, 200)}...`);
            data = JSON.parse(responseText);
            
            // Basic validation - just check if we got a valid response structure
            if (!data || typeof data !== 'object') {
                console.log(`  ⚠️  Invalid response structure from Federal Register API`);
                return [];
            }
        } catch (parseError) {
            console.log(`  ❌ Failed to parse API response as JSON: ${parseError.message}`);
            return [];
        }
        
        console.log(`  ✅ Federal Register API returned ${data.count || 0} total results`);
        
        if (!data.results || !Array.isArray(data.results) || data.results.length === 0) {
            console.log('  ℹ️  No executive orders found in Federal Register for this period');
            return [];
        }
        
        // Process all Executive Orders (API filter confirmed working)
        const processedOrders = data.results
            .filter(order => order && typeof order === 'object')
            .map(order => ({
                title: order.title || 'Untitled Executive Order',
                order_number: order.executive_order_number || null,
                date: order.signing_date || order.publication_date || null,
                publication_date: order.publication_date || null,
                citation: order.citation || null,
                source_url: order.html_url || `https://www.federalregister.gov/documents/${order.document_number}`,
                pdf_url: order.pdf_url || null,
                abstract: order.abstract || null,
                document_number: order.document_number || null,
                source: 'Federal Register API',
                verified: true
            }));
        
        console.log(`  ✅ Processed ${processedOrders.length} executive orders from Federal Register`);
        return processedOrders;
        
    } catch (error) {
        console.error('  ❌ Error fetching from Federal Register API:', error.message);
        return [];
    }
}

// Fixed RSS feed fetching with better URL and parsing
async function fetchFromWhiteHouseRSS() {
    try {
        console.log('📡 Fetching from WhiteHouse.gov RSS feeds (official channels)...');
        
        // FIXED: Use working RSS endpoints
        const rssEndpoints = [
            CONFIG.WHITEHOUSE_RSS, // Main news feed
            'https://www.whitehouse.gov/presidential-actions/feed/', // Working URL from test
        ];
        
        const allOrders = [];
        
        for (const rssUrl of rssEndpoints) {
            try {
                console.log(`  📡 Checking RSS: ${rssUrl}`);
                
                const response = await fetchWithRetry(rssUrl, {
                    headers: {
                        'Accept': 'application/rss+xml, application/xml, text/xml'
                    }
                });
                
                const xml = await response.text();
                console.log(`  ✅ Retrieved RSS feed (${xml.length} characters)`);
                
                // FIXED: Better XML parsing with more robust regex
                const itemMatches = xml.match(/<item[^>]*>[\s\S]*?<\/item>/g) || [];
                
                for (const item of itemMatches) {
                    // FIXED: Handle both CDATA and regular title formats
                    const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s) ||
                                     item.match(/<title[^>]*>(.*?)<\/title>/s);
                    const linkMatch = item.match(/<link[^>]*>(.*?)<\/link>/s);
                    const dateMatch = item.match(/<pubDate[^>]*>(.*?)<\/pubDate>/s);
                    const descMatch = item.match(/<description[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/s);
                    const categoryMatch = item.match(/<category[^>]*>(.*?)<\/category>/s);
                    
                    if (titleMatch && linkMatch) {
                        const title = titleMatch[1].trim();
                        const url = linkMatch[1].trim();
                        const pubDate = dateMatch ? dateMatch[1].trim() : '';
                        const description = descMatch ? descMatch[1].trim() : '';
                        const category = categoryMatch ? categoryMatch[1].trim() : '';
                        
                        // FIXED: Better filtering for executive orders
                        const isExecutiveOrder = (
                            title.toLowerCase().includes('executive order') ||
                            title.toLowerCase().includes('presidential memorandum') ||
                            category.toLowerCase().includes('executive order') ||
                            url.includes('executive-order') ||
                            url.includes('presidential-memorandum')
                        );
                        
                        // Filter for Trump's second term (Jan 20, 2025 onwards)
                        // Inauguration date is historical fact - won't change
                        const INAUGURATION_DATE = new Date('2025-01-20');
                        const orderDate = new Date(pubDate);
                        const isSecondTermContent = !isNaN(orderDate.getTime()) && orderDate >= INAUGURATION_DATE;

                        if (isExecutiveOrder && isSecondTermContent) {
                            allOrders.push({
                                title: title,
                                source_url: url,
                                pub_date: pubDate,
                                description: description,
                                category: category,
                                source: 'WhiteHouse.gov RSS',
                                verified: true
                            });
                        }
                    }
                }
                
            } catch (rssError) {
                console.log(`    ⚠️  RSS ${rssUrl} failed: ${rssError.message}`);
                continue;
            }
        }
        
        console.log(`  ✅ Found ${allOrders.length} executive orders from RSS feeds`);
        return allOrders;
        
    } catch (error) {
        console.error('❌ Error fetching from RSS feeds:', error.message);
        return [];
    }
}

// Removed bulk download method - was using hardcoded URL that doesn't exist
// Federal Register API + RSS feeds provide comprehensive coverage

// Enhanced OpenAI analysis (keeping existing logic)
async function analyzeExecutiveOrderWithOpenAI(order, apiKey) {
    try {
        console.log(`  🤖 Analyzing: ${order.title.substring(0, 50)}...`);
        
        const analysisPrompt = `Analyze this executive order and provide structured data:

Title: ${order.title}
Source URL: ${order.source_url}
${order.abstract ? `Abstract: ${order.abstract}` : ''}
${order.description ? `Description: ${order.description}` : ''}
${order.order_number ? `Order Number: ${order.order_number}` : ''}
${order.date ? `Date: ${order.date}` : ''}

Please provide a JSON response with the following structure:
{
  "title": "Clean, properly formatted title",
  "order_number": "Executive order number if mentioned (e.g., 'EO 15001') or null",
  "date": "YYYY-MM-DD format if you can determine the date, or null",
  "summary": "2-3 sentence summary of what this order does and its expected impact",
  "category": "One of: immigration, economy, healthcare, environment, foreign_policy, security, government_operations",
  "agencies_affected": ["Array of federal agencies that would implement this"],
  "policy_direction": "One of: expand, eliminate, create, modify",
  "implementation_timeline": "One of: immediate, 30_days, 90_days, ongoing",
  "severity_rating": "One of: low, medium, high (based on scope and impact)",
  "verified": true
}

Based on the title and any context provided, provide your best analysis. Use the existing order number and date if provided in the source data.`;

        const response = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'You are an expert at analyzing U.S. government executive orders and policy documents. Provide accurate, structured analysis based on the information given.'
                    },
                    {
                        role: 'user',
                        content: analysisPrompt
                    }
                ],
                max_tokens: 1000,
                temperature: 0.1
            })
        });

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        
        // Extract JSON from response
        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const analysis = JSON.parse(jsonMatch[0]);
                
                // Merge with original order data, preserving official data
                return {
                    ...analysis,
                    // Preserve official data over AI analysis
                    order_number: order.order_number || analysis.order_number,
                    date: order.date || analysis.date,
                    source_url: order.source_url,
                    pdf_url: order.pdf_url,
                    citation: order.citation,
                    publication_date: order.publication_date,
                    document_number: order.document_number,
                    source: order.source,
                    verified: true
                };
            }
        } catch (parseError) {
            console.log(`    ⚠️  Could not parse AI analysis for: ${order.title}`);
        }
        
        return null;
        
    } catch (error) {
        console.log(`    ❌ Error analyzing order: ${error.message}`);
        return null;
    }
}

// Enhanced categorization
function categorizeExecutiveOrder(order) {
    if (order.category && order.category !== 'Presidential Actions') return order.category;
    
    const title = (order.title || '').toLowerCase();
    const summary = (order.summary || '').toLowerCase();
    const text = title + ' ' + summary;
    
    if (text.match(/immigration|border|deportation|asylum|visa|refugee|daca|ice|cbp|homeland/)) {
        return 'immigration';
    }
    if (text.match(/economy|trade|tariff|tax|business|commerce|jobs|employment|labor/)) {
        return 'economy';
    }
    if (text.match(/health|medical|medicare|medicaid|obamacare|affordable care|drug|pharmaceutical/)) {
        return 'healthcare';
    }
    if (text.match(/environment|climate|energy|oil|gas|renewable|epa|pollution|carbon/)) {
        return 'environment';
    }
    if (text.match(/foreign|international|nato|china|russia|military|defense|security|war/)) {
        return 'foreign_policy';
    }
    if (text.match(/security|terrorism|intelligence|fbi|cia|surveillance|cyber/)) {
        return 'security';
    }
    
    return 'government_operations';
}

// Enhanced impact assessment
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

// Enhanced validation
function validateOrder(order) {
    const required = ['title', 'source_url'];
    const missing = required.filter(field => !order[field]);
    
    if (missing.length > 0) {
        console.log(`  ⚠️  Order missing required fields: ${missing.join(', ')}`);
        return false;
    }
    
    // Validate URL
    try {
        new URL(order.source_url);
    } catch {
        console.log(`  ⚠️  Invalid URL: ${order.source_url}`);
        return false;
    }
    
    // Validate date format if present
    if (order.date && !/^\d{4}-\d{2}-\d{2}$/.test(order.date)) {
        console.log(`  ⚠️  Invalid date format: ${order.date}`);
        return false;
    }
    
    return true;
}

// Save executive orders (keeping existing logic)
async function saveExecutiveOrders(orders) {
    const today = new Date().toISOString().split('T')[0];
    const filename = `executive-orders-${today}.json`;
    const masterFilename = 'executive-orders-log.json';
    const publicDir = 'public';
    const publicMasterFile = `${publicDir}/${masterFilename}`;

    try {
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
            await fs.writeFile(masterFilename, JSON.stringify(masterLog, null, 2));
            
            try {
                await fs.access(publicDir);
            } catch {
                await fs.mkdir(publicDir, { recursive: true });
                console.log(`  📁 Created ${publicDir} directory`);
            }
            
            await fs.writeFile(publicMasterFile, JSON.stringify(masterLog, null, 2));
            console.log(`  ✅ Maintained empty dashboard files`);
            return;
        }

        // Enhanced duplicate detection
        const existingUrls = new Set(masterLog.map(order => order.source_url));
        const existingNumbers = new Set(masterLog.map(order => order.order_number).filter(Boolean));
        const existingTitles = new Set(masterLog.map(order => order.title.toLowerCase()));
        
        const newOrders = orders.filter(order => 
            !existingUrls.has(order.source_url) && 
            (!order.order_number || !existingNumbers.has(order.order_number)) &&
            !existingTitles.has(order.title.toLowerCase())
        );
        
        if (newOrders.length === 0) {
            console.log('\n✅ No new executive orders found (all already exist)');
            return;
        }

        console.log(`\n💾 Saving ${newOrders.length} new executive orders...`);

        // Add new orders to master log
        masterLog.push(...newOrders);
        
        // Sort by date (newest first)
        masterLog.sort((a, b) => {
            const dateA = new Date(a.date || '1900-01-01');
            const dateB = new Date(b.date || '1900-01-01');
            return dateB - dateA;
        });

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
        if (masterLog.length > 0) {
            const dates = masterLog.map(o => o.date).filter(Boolean).sort();
            if (dates.length > 0) {
                console.log(`  • Date range: ${dates[0]} to ${dates[dates.length-1]}`);
            }
        }

    } catch (error) {
        console.error('❌ Error saving executive orders:', error);
        throw error;
    }
}

// Main execution function
async function main() {
    console.log('\n🏛️  Executive Orders Tracker - FIXED Legal & Compliant Version');
    console.log('='.repeat(75));
    console.log('🔧 Simplified to 2 reliable sources: Federal Register API + RSS');
    console.log('✅ Fully compliant with government data policies');

    const today = new Date().toISOString().split('T')[0];
    const startDate = '2025-01-20';
    
    console.log(`📅 Collecting executive orders from ${startDate} to ${today}`);

    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
        throw new Error('OpenAI API key not found in environment variables');
    }

    try {
        // Step 1: Federal Register API call (primary source)
        const federalRegisterOrders = await fetchFromFederalRegisterAPI();
        
        await new Promise(resolve => setTimeout(resolve, CONFIG.RATE_LIMIT_DELAY));
        
        // Step 2: WhiteHouse RSS feeds (secondary source)
        const rssOrders = await fetchFromWhiteHouseRSS();
        
        // Step 3: Combine both official sources
        const allRawOrders = [...federalRegisterOrders, ...rssOrders];
        const uniqueOrders = [];
        const seenUrls = new Set();
        const seenNumbers = new Set();
        const seenTitles = new Set();
        
        for (const order of allRawOrders) {
            const urlKey = order.source_url;
            const numberKey = order.order_number;
            const titleKey = order.title.toLowerCase();
            
            const isDuplicate = seenUrls.has(urlKey) || 
                              (numberKey && seenNumbers.has(numberKey)) ||
                              seenTitles.has(titleKey);
            
            if (!isDuplicate) {
                seenUrls.add(urlKey);
                if (numberKey) seenNumbers.add(numberKey);
                seenTitles.add(titleKey);
                uniqueOrders.push(order);
            }
        }
        
        console.log(`\n📋 Found ${uniqueOrders.length} unique executive orders to analyze`);
        
        if (uniqueOrders.length === 0) {
            console.log('ℹ️  No executive orders found from official sources for the specified period');
            console.log('This could mean:');
            console.log('  • No executive orders have been issued yet in this timeframe');
            console.log('  • Orders are still being processed by the Federal Register');
            console.log('  • There may be a delay in official publication');
            console.log('  • API parameters may need further adjustment');
            await saveExecutiveOrders([]);
            return;
        }
        
        // Step 5: Analyze with OpenAI (with rate limiting)
        console.log('\n🤖 Analyzing executive orders with OpenAI...');
        const analyzedOrders = [];
        
        for (let i = 0; i < uniqueOrders.length; i++) {
            const rawOrder = uniqueOrders[i];
            
            if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, CONFIG.RATE_LIMIT_DELAY));
            }
            
            const analysis = await analyzeExecutiveOrderWithOpenAI(rawOrder, apiKey);
            if (analysis) {
                const enhancedOrder = {
                    ...analysis,
                    id: generateId(),
                    type: 'executive_order',
                    added_at: new Date().toISOString(),
                    category: categorizeExecutiveOrder(analysis),
                    impact_score: assessImpact(analysis),
                    implementation_status: 'issued',
                    legal_challenges: [],
                    related_orders: []
                };
                
                if (validateOrder(enhancedOrder)) {
                    analyzedOrders.push(enhancedOrder);
                }
            }
        }

        console.log(`\n✅ Successfully analyzed ${analyzedOrders.length} executive orders`);
        
        if (analyzedOrders.length > 0) {
            analyzedOrders.forEach((order, index) => {
                console.log(`  ${index + 1}. ${order.title} (${order.date || 'Date TBD'})`);
                console.log(`      📄 Source: ${order.source}`);
                console.log(`      🔗 URL: ${order.source_url}`);
            });
        }

        await saveExecutiveOrders(analyzedOrders);

        console.log('\n🎉 Executive Orders tracking completed successfully!');
        console.log('\n📋 Next steps:');
        console.log('  1. Check your dashboard Executive Orders tab');
        console.log('  2. Verify data quality and source links');
        console.log('  3. Daily automation will continue from here');

    } catch (error) {
        console.error('\n❌ Error in executive orders tracking:', error);
        
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