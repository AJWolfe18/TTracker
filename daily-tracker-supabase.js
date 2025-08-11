// daily-tracker-supabase.js
// Updated version that uses Supabase with EXACT prompts from daily-tracker.js
import fetch from 'node-fetch';
import { supabaseRequest } from './supabase-config-node.js';

console.log('🚀 DAILY POLITICAL TRACKER - SUPABASE VERSION (EXACT PROMPTS)');
console.log('=============================================================\n');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY environment variable is required');
    process.exit(1);
}

// Generate unique ID - same as daily-tracker.js
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Date range helper - same as daily-tracker.js
function getDateRangePrompt() {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 3); // 3-day window for fresher news
    
    return `between ${startDate.toISOString().split('T')[0]} and ${endDate.toISOString().split('T')[0]}`;
}

// Enhanced duplicate detection for Supabase
async function isDuplicate(title, sourceUrl, date) {
    try {
        // Check exact URL match first
        if (sourceUrl) {
            const urlMatch = await supabaseRequest(`political_entries?source_url=eq.${encodeURIComponent(sourceUrl)}&limit=1`);
            if (urlMatch && urlMatch.length > 0) {
                return true;
            }
        }
        
        // Check similar titles on same date
        const cleanTitle = title.substring(0, 50).replace(/[^a-zA-Z0-9\s]/g, '');
        const titleMatch = await supabaseRequest(
            `political_entries?title.ilike.%25${encodeURIComponent(cleanTitle)}%25&date=eq.${date}&limit=1`
        );
        return titleMatch && titleMatch.length > 0;
        
    } catch (error) {
        console.error('Error checking for duplicates:', error.message);
        return false; // Assume not duplicate if check fails
    }
}

// Severity assessment - same as daily-tracker.js
function assessSeverity(title, description) {
    const content = `${title} ${description}`.toLowerCase();
    
    const highSeverity = [
        'arrest', 'indictment', 'conviction', 'felony', 'fraud', 'corruption',
        'constitutional crisis', 'impeachment', 'treason', 'sedition',
        'emergency', 'shutdown', 'crisis', 'violation', 'breach'
    ];
    
    const mediumSeverity = [
        'investigation', 'subpoena', 'lawsuit', 'hearing', 'testimony',
        'controversy', 'conflict', 'ethics', 'challenge', 'dispute',
        'allegation', 'concern', 'criticism'
    ];
    
    if (highSeverity.some(keyword => content.includes(keyword))) {
        return 'high';
    } else if (mediumSeverity.some(keyword => content.includes(keyword))) {
        return 'medium';
    } else {
        return 'low';
    }
}

// Source verification - same as daily-tracker.js
const REPUTABLE_SOURCES = [
    // Wire Services & News Agencies
    'reuters.com', 
    'ap.org',
    'apnews.com',
    
    // Major Newspapers
    'wsj.com',           // Wall Street Journal
    'nytimes.com',       // New York Times
    'washingtonpost.com', // Washington Post
    'usatoday.com',      // USA Today
    
    // International News
    'bbc.com',           // BBC
    'bbc.co.uk',         // BBC UK domain
    'guardian.com',      // The Guardian
    'theguardian.com',   // The Guardian alternate
    'economist.com',     // The Economist
    'ft.com',            // Financial Times
    
    // Broadcast Networks
    'cnn.com',           // CNN
    'foxnews.com',       // Fox News (right-leaning)
    'foxbusiness.com',   // Fox Business (right-leaning)
    'nbcnews.com',       // NBC News
    'abcnews.go.com',    // ABC News
    'cbsnews.com',       // CBS News
    'msnbc.com',         // MSNBC
    
    // Public Media
    'npr.org',           // National Public Radio
    'pbs.org',           // Public Broadcasting Service
    
    // Political & Policy News
    'politico.com',      // Politico
    'thehill.com',       // The Hill
    'axios.com',         // Axios
    'realclearpolitics.com', // RealClearPolitics (center-right)
    'washingtonexaminer.com', // Washington Examiner (right-leaning)
    'nationalreview.com', // National Review (conservative)
    
    // Business & Financial
    'bloomberg.com',     // Bloomberg
    'cnbc.com',          // CNBC
    'marketwatch.com',   // MarketWatch
    'forbes.com',        // Forbes
    'businessinsider.com', // Business Insider
    
    // Investigative & Legal
    'propublica.org',    // ProPublica
    'courthousenews.com', // Courthouse News
    'lawfaremedia.org',  // Lawfare
    'lawfareblog.com',   // Lawfare Blog
    
    // Government Sources
    '.gov',              // All government domains
    'supremecourt.gov',  // Supreme Court
    'justice.gov',       // Department of Justice
    'whitehouse.gov',    // White House
    'congress.gov',      // Congress
    'senate.gov',        // Senate
    'house.gov',         // House of Representatives
    'state.gov',         // State Department
    'defense.gov',       // Department of Defense
    'treasury.gov',      // Treasury Department
    'fbi.gov',           // FBI
    'cia.gov',           // CIA
    'dhs.gov',           // Department of Homeland Security
    'ed.gov',            // Department of Education
    'fec.gov',           // Federal Election Commission
    'sec.gov',           // Securities and Exchange Commission
];

function isVerifiedSource(url) {
    try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname.toLowerCase();
        
        // Special handling for .gov domains
        if (domain.endsWith('.gov')) {
            return true;
        }
        
        // Check against the reputable sources list
        return REPUTABLE_SOURCES.some(source => {
            // Handle .gov as special case (already checked above)
            if (source === '.gov') return false;
            
            // For other sources, check if domain includes the source
            return domain.includes(source) || domain.endsWith(source);
        });
    } catch {
        return false;
    }
}

// Entry validation - same as daily-tracker.js
function validateEntry(entry) {
    const required = ['date', 'actor', 'category', 'title', 'description', 'source_url'];
    const missing = required.filter(field => !entry[field]);
    
    if (missing.length > 0) {
        console.log(`  ⚠️  Entry missing required fields: ${missing.join(', ')}`);
        return false;
    }
    
    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
        console.log(`  ⚠️  Invalid date format: ${entry.date}`);
        return false;
    }
    
    // Validate URL
    try {
        new URL(entry.source_url);
    } catch {
        console.log(`  ⚠️  Invalid URL: ${entry.source_url}`);
        return false;
    }
    
    return true;
}

async function fetchPoliticalUpdates() {
    console.log('=== REAL NEWS POLITICAL TRACKER ===');
    console.log('Date:', new Date().toDateString());
    console.log('Time:', new Date().toISOString());

    // EXACT prompts from daily-tracker.js
    const dateRange = getDateRangePrompt();
    const REAL_NEWS_PROMPTS = {
        'Trump & Family': `Search for recent news involving Donald Trump or Trump family members ${dateRange}. Focus on:
- NEW legal proceedings, court cases, or rulings
- RECENT business dealings and financial disclosures  
- LATEST campaign activities and political statements
- CURRENT policy announcements or government actions
- EMERGING conflicts of interest or ethics concerns

IMPORTANT: Only include news from the specified date range. Each story must be unique - do not include multiple versions of the same story. Prioritize breaking news and new developments over ongoing stories.

CRITICAL: Extract the ACTUAL publication date from each article. Do NOT use today's date unless the article was actually published today. Find the real date when the article was published in the article's metadata or content. If the article is older than 1 week, DO NOT include it. The 'date' field must be the article's real publication date in YYYY-MM-DD format.

Find credible news sources and return specific, factual developments with proper citations.`,

        'Elon Musk & DOGE': `Search for recent news about Elon Musk's role in government, DOGE (Department of Government Efficiency), or his political influence ${dateRange}. Focus on:
- NEW DOGE operations and government efficiency recommendations
- RECENT government contracts involving his companies (Tesla, SpaceX, etc.)
- LATEST X/Twitter platform policy changes affecting political discourse
- EMERGING conflicts between business interests and government responsibilities
- CURRENT public statements on government policy

IMPORTANT: Only include unique stories from the date range. No duplicate coverage of the same event.

CRITICAL: Extract the ACTUAL publication date from each article. Do NOT use today's date unless the article was actually published today. Find the real date when the article was published in the article's metadata or content. If the article is older than 1 week, DO NOT include it. The 'date' field must be the article's real publication date in YYYY-MM-DD format.

Find current news with credible sources and citations.`,

        'DOJ & Law Enforcement': `Search for recent developments involving the Department of Justice, FBI, or federal law enforcement ${dateRange}. Focus on:
- NEW prosecutions or investigations announced
- RECENT leadership changes or appointments
- LATEST policy shifts in enforcement priorities
- CURRENT civil rights investigations or actions
- EMERGING political interference concerns
- NEW whistleblower reports

IMPORTANT: Only include developments from the specified dates. Each entry must be a unique story.

CRITICAL: Extract the ACTUAL publication date from each article. Do NOT use today's date unless the article was actually published today. Find the real date when the article was published in the article's metadata or content. If the article is older than 1 week, DO NOT include it. The 'date' field must be the article's real publication date in YYYY-MM-DD format.

Find current news from credible legal and political sources.`,

        'Federal Agencies': `Search for recent news about federal agencies (ICE, DHS, Department of Education, EPA, etc.) ${dateRange}. Focus on:
- NEW policy implementation changes
- RECENT regulatory actions or rollbacks
- LATEST leadership appointments or departures
- CURRENT budget or operational changes
- EMERGING congressional oversight issues
- NEW agency restructuring or closures

IMPORTANT: Focus on new developments only. No repeated coverage of ongoing situations.

CRITICAL: Extract the ACTUAL publication date from each article. Do NOT use today's date unless the article was actually published today. Find the real date when the article was published in the article's metadata or content. If the article is older than 1 week, DO NOT include it. The 'date' field must be the article's real publication date in YYYY-MM-DD format.

Find current developments from reliable government and news sources.`,

        'Courts & Legal': `Search for recent federal court rulings, Supreme Court developments, or major legal proceedings ${dateRange}. Focus on:
- NEW Supreme Court decisions or case acceptances
- RECENT federal court rulings on political matters
- LATEST legal challenges to government policies
- CURRENT civil rights or constitutional cases
- NEW appeals court decisions
- EMERGING legal expert analysis

IMPORTANT: Only include rulings and developments from the specified date range.

CRITICAL: Extract the ACTUAL publication date from each article. Do NOT use today's date unless the article was actually published today. Find the real date when the article was published in the article's metadata or content. If the article is older than 1 week, DO NOT include it. The 'date' field must be the article's real publication date in YYYY-MM-DD format.

Find current legal developments with proper case citations and sources.`,

        'Corporate & Financial': `Search for recent developments involving corporate influence, lobbying, campaign finance, or financial conflicts of interest ${dateRange}. Focus on:
- NEW major corporate lobbying efforts
- RECENT campaign finance violations or investigations
- LATEST PAC activities and dark money flows
- CURRENT government contracts and potential conflicts
- EMERGING corporate regulatory issues
- NEW financial disclosure problems

IMPORTANT: Each entry must be a unique development from the date range specified.

CRITICAL: Extract the ACTUAL publication date from each article. Do NOT use today's date unless the article was actually published today. Find the real date when the article was published in the article's metadata or content. If the article is older than 1 week, DO NOT include it. The 'date' field must be the article's real publication date in YYYY-MM-DD format.

Find current financial and corporate accountability news from credible business and political sources.`
    };

    console.log(`\n=== SEARCHING FOR REAL POLITICAL NEWS ===`);
    console.log(`📅 Date range: ${dateRange}\n`);
    
    const allEntries = [];
    const promises = Object.entries(REAL_NEWS_PROMPTS).map(async ([category, prompt]) => {
        try {
            console.log(`🔍 Searching real news for: ${category}`);
            
            // Use the correct OpenAI Responses API with web search
            const response = await fetch('https://api.openai.com/v1/responses', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
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
                    input: `${prompt}

For each relevant news story found, extract and format as JSON:
{
  "date": "YYYY-MM-DD",
  "actor": "Person or Organization", 
  "category": "${category.includes('Trump') ? 'Financial' : category.includes('Musk') ? 'Platform Manipulation' : category.includes('DOJ') ? 'Government Oversight' : category.includes('Courts') ? 'Legal Proceedings' : category.includes('Corporate') ? 'Corporate Ethics' : 'Government Oversight'}",
  "title": "Headline under 100 characters",
  "description": "2-3 sentence factual summary",
  "source_url": "Full URL to original article",
  "verified": true,
  "severity": "low|medium|high"
}

Return a JSON array of relevant political developments found. Only include real news from credible sources. Each entry must be unique - no duplicates.`,
                    max_output_tokens: 2000
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            
            // Extract content from the correct location in response
            const content = data.output?.find(item => item.type === 'message')?.content?.[0]?.text || '';
            
            console.log(`  Response length: ${content.length}`);
            console.log(`  Tokens used: ${data.usage?.total_tokens || 'unknown'}`);

            // Extract JSON from the response
            let entries = [];
            try {
                // Try to find JSON in the response
                const jsonMatch = content.match(/\[[\s\S]*?\]/);
                if (jsonMatch) {
                    entries = JSON.parse(jsonMatch[0]);
                } else {
                    // If no JSON array found, try to parse the whole response
                    entries = JSON.parse(content);
                }
            } catch (parseError) {
                console.log(`  ❌ Could not parse JSON response`);
                entries = [];
            }

            if (!Array.isArray(entries)) {
                entries = entries ? [entries] : [];
            }

            // Process and enhance entries
            const processedEntries = [];
            for (const entry of entries) {
                if (!entry || typeof entry !== 'object') continue;
                
                if (!validateEntry(entry)) continue;
                
                // Check for duplicates
                const duplicate = await isDuplicate(entry.title, entry.source_url, entry.date);
                if (duplicate) {
                    console.log(`  ⏭️ Skipping duplicate: ${entry.title.substring(0, 50)}...`);
                    continue;
                }
                
                const processedEntry = {
                    id: generateId(),
                    date: entry.date,
                    actor: entry.actor || 'Unknown',
                    category: category,
                    title: entry.title,
                    description: entry.description,
                    source_url: entry.source_url,
                    verified: entry.source_url ? isVerifiedSource(entry.source_url) : false,
                    severity: entry.severity || assessSeverity(entry.title, entry.description),
                    status: 'published',
                    manual_submission: false,
                    added_at: new Date().toISOString()
                };
                
                processedEntries.push(processedEntry);
            }

            console.log(`  ✅ Found ${processedEntries.length} valid entries`);
            
            if (processedEntries.length > 0) {
                processedEntries.forEach((entry, index) => {
                    console.log(`    ${index + 1}. [${entry.severity.toUpperCase()}] ${entry.actor}: ${entry.title.substring(0, 60)}...`);
                });
            }

            return processedEntries;

        } catch (error) {
            console.error(`  ❌ Error searching ${category}:`, error.message);
            return [];
        }
    });

    const results = await Promise.all(promises);
    results.forEach(entries => allEntries.push(...entries));

    console.log(`\n=== TOTAL VALID ENTRIES FOUND: ${allEntries.length} ===`);
    
    return allEntries;
}

async function saveToSupabase(entries) {
    if (!entries || entries.length === 0) {
        console.log('\n⚠️ No new entries to save');
        return;
    }

    console.log(`\n💾 Saving ${entries.length} new entries to Supabase...`);
    
    try {
        // Insert all entries at once (Supabase handles batches well)
        const result = await supabaseRequest('political_entries', 'POST', entries);
        console.log(`✅ Successfully saved ${entries.length} entries to Supabase`);
        
        // Enhanced summary matching daily-tracker.js
        console.log('\n=== DAILY TRACKING SUMMARY ===');
        console.log('📅 Date:', new Date().toDateString());
        console.log('🕐 Time:', new Date().toLocaleTimeString());
        console.log('📰 New entries found:', entries.length);
        
        // Category breakdown
        const categoryCount = {};
        entries.forEach(e => {
            categoryCount[e.category] = (categoryCount[e.category] || 0) + 1;
        });
        
        console.log('\n📊 By Category:');
        Object.entries(categoryCount).forEach(([cat, count]) => {
            console.log(`  - ${cat}: ${count}`);
        });
        
        // Severity breakdown
        const highSeverity = entries.filter(e => e.severity === 'high').length;
        const mediumSeverity = entries.filter(e => e.severity === 'medium').length;
        const lowSeverity = entries.filter(e => e.severity === 'low').length;
        
        console.log(`\n⚠️  Severity: ${highSeverity} high, ${mediumSeverity} medium, ${lowSeverity} low`);
        
        // Verification status
        const verified = entries.filter(e => e.verified).length;
        console.log(`✓ Verified sources: ${verified} of ${entries.length} (${Math.round(verified/entries.length*100)}%)`);
        
        console.log('================================\n');
        
    } catch (error) {
        console.error('❌ Error saving to Supabase:', error.message);
        throw error;
    }
}

async function main() {
    try {
        console.log('🚀 Starting Real News Political Tracker...');
        console.log('🔍 Using OpenAI Responses API with web search capabilities\n');
        
        const entries = await fetchPoliticalUpdates();
        
        if (entries.length === 0) {
            console.log('\nℹ️  No relevant political news found in current search');
            console.log('This is normal - not every search yields new developments');
            return;
        }

        await saveToSupabase(entries);

    } catch (error) {
        console.error('❌ Error in main execution:', error.message);
        console.error('Stack trace:', error.stack);
        
        // Don't throw error - let GitHub Actions continue
        console.log('Script completed with errors but continuing...');
    }
}

// Run the tracker
main();