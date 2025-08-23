/**
 * Manual Article Processor
 * Processes articles that are manually submitted through the admin interface
 * Uses Playwright as fallback for sites that block normal requests
 */

import fetch from 'node-fetch';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🔄 MANUAL ARTICLE PROCESSOR');
console.log('============================\n');

// Environment validation
if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY environment variable is required');
    process.exit(1);
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.error('❌ SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required');
    process.exit(1);
}

// Use environment variables directly from GitHub Actions
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Detect environment for logging purposes
const isTestBranch = fs.existsSync(path.join(__dirname, '..', 'TEST_BRANCH_MARKER.md'));
console.log(`📍 Environment: ${isTestBranch ? 'TEST' : 'PRODUCTION'}`);
console.log(`📍 Supabase URL: ${SUPABASE_URL ? SUPABASE_URL.substring(0, 30) + '...' : 'NOT SET'}`);

// Create Supabase client with environment variables
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Get input from GitHub Actions or environment
const inputData = JSON.parse(process.env.INPUT_DATA || '{}');
const { url, title, category, submitted_by } = inputData;

if (!url) {
    console.error('❌ No URL provided');
    process.exit(1);
}

// Validate URL format
function isValidArticleUrl(urlString) {
    try {
        const u = new URL(urlString);
        if (!['http:', 'https:'].includes(u.protocol)) {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

if (!isValidArticleUrl(url)) {
    console.error('❌ Invalid URL format. Only HTTP/HTTPS URLs are allowed.');
    process.exit(1);
}

console.log(`📋 Processing request:`);
console.log(`  URL: ${url}`);
console.log(`  Title: ${title || 'To be extracted'}`);
console.log(`  Category: ${category || 'Political News'}`);
console.log(`  Submitted by: ${submitted_by || 'admin'}\n`);

// Generate unique ID
function generateId() {
    return Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

// Normalize URL to detect duplicates
function normalizeUrl(urlString) {
    try {
        const u = new URL(urlString);
        
        // Remove common tracking parameters
        const trackingParams = [
            'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
            'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref', 'referer',
            'fb_action_ids', 'fb_action_types', 'fb_source',
            '_ga', '_gid', '__twitter_impression',
            'amp', 's', 'sh', 'smid', 'CMP'
        ];
        
        trackingParams.forEach(param => u.searchParams.delete(param));
        
        // Standardize hostname (remove www)
        u.hostname = u.hostname.replace(/^www\./, '');
        
        // Remove trailing slash and fragment
        let normalized = u.toString().replace(/\/$/, '').replace(/#.*$/, '');
        
        // Convert to lowercase for consistency
        normalized = normalized.toLowerCase();
        
        return normalized;
    } catch (error) {
        console.error('Error normalizing URL:', error);
        return urlString;
    }
}

// Check for duplicate articles with retry logic
async function checkDuplicate(url, title) {
    const normalizedUrl = normalizeUrl(url);
    console.log(`  🔍 Checking for duplicates...`);
    console.log(`     Normalized URL: ${normalizedUrl}`);
    
    // Retry wrapper for Supabase operations
    async function withRetry(operation, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                return await operation();
            } catch (error) {
                if (i === retries - 1) throw error;
                console.log(`  ⚠️ Retry ${i + 1}/${retries} after error:`, error.message);
                await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
            }
        }
    }
    
    // Check exact URL match with retry
    const result = await withRetry(async () => {
        return await supabase
            .from('political_entries')
            .select('id, title, date, source_url')
            .eq('source_url', normalizedUrl)
            .single();
    });
    
    const { data: urlMatch, error: urlError } = result;
    
    if (urlMatch && !urlError) {
        console.log(`  ⚠️ Duplicate URL found: "${urlMatch.title}" from ${urlMatch.date}`);
        return { 
            isDuplicate: true, 
            type: 'exact_url', 
            existing: urlMatch,
            message: `This article already exists: "${urlMatch.title}" from ${urlMatch.date}`
        };
    }
    
    // Check for similar titles (if we have a title)
    if (title && title.length > 20) {
        const titleStart = title.substring(0, 50).replace(/[^a-zA-Z0-9\s]/g, '');
        const { data: titleMatches } = await supabase
            .from('political_entries')
            .select('id, title, source_url, date')
            .ilike('title', `${titleStart}%`)
            .limit(3);
        
        if (titleMatches && titleMatches.length > 0) {
            console.log(`  ℹ️ Found ${titleMatches.length} similar article(s):`);
            titleMatches.forEach(match => {
                console.log(`     - "${match.title.substring(0, 60)}..." from ${match.date}`);
            });
            // Don't block, just warn
            return { 
                isDuplicate: false, 
                type: 'similar_titles',
                similar: titleMatches,
                message: 'Similar articles found but proceeding with new entry'
            };
        }
    }
    
    console.log(`  ✅ No duplicates found`);
    return { isDuplicate: false };
}

// Check if source is verified
function isVerifiedSource(url) {
    const verifiedDomains = [
        'reuters.com', 'ap.org', 'apnews.com', 'wsj.com', 'nytimes.com',
        'washingtonpost.com', 'usatoday.com', 'bbc.com', 'bbc.co.uk',
        'cnn.com', 'foxnews.com', 'nbcnews.com', 'abcnews.go.com', 
        'cbsnews.com', 'msnbc.com', 'npr.org', 'pbs.org', 'politico.com',
        'thehill.com', 'axios.com', 'bloomberg.com', 'cnbc.com', 'forbes.com',
        'propublica.org', 'courthousenews.com', 'whitehouse.gov'
    ];
    
    try {
        const domain = new URL(url).hostname.toLowerCase();
        return verifiedDomains.some(verified => domain.includes(verified)) || domain.endsWith('.gov');
    } catch {
        return false;
    }
}

// Extract article data from HTML
function extractArticleData(html, url) {
    try {
        // Extract title
        const titleMatches = [
            html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i),
            html.match(/<meta[^>]+name="twitter:title"[^>]+content="([^"]+)"/i),
            html.match(/<title[^>]*>([^<]+)<\/title>/i),
            html.match(/<h1[^>]*>([^<]+)<\/h1>/i)
        ];
        
        const titleMatch = titleMatches.find(match => match);
        let extractedTitle = titleMatch ? titleMatch[1].trim() : '';
        
        // Clean up title
        extractedTitle = extractedTitle
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ')
            .trim();
        
        // Remove site name from title
        const siteName = new URL(url).hostname.replace('www.', '');
        extractedTitle = extractedTitle.replace(new RegExp(`\\s*[-|–]\\s*${siteName}.*$`, 'i'), '');
        
        if (!extractedTitle) {
            extractedTitle = title || `Article from ${siteName}`;
        }
        
        // Extract description
        const descMatches = [
            html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i),
            html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i),
            html.match(/<meta[^>]+name="twitter:description"[^>]+content="([^"]+)"/i)
        ];
        
        const descMatch = descMatches.find(match => match);
        let description = descMatch ? descMatch[1].trim() : '';
        
        // Clean up description
        description = description
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ')
            .trim();
        
        if (!description || description.length < 20) {
            description = `Political article from ${siteName} requiring review`;
        }
        
        // Extract date
        const dateMatches = [
            html.match(/<meta[^>]+property="article:published_time"[^>]+content="([^"]+)"/i),
            html.match(/<meta[^>]+name="publish-date"[^>]+content="([^"]+)"/i),
            html.match(/<time[^>]+datetime="([^"]+)"/i)
        ];
        
        let articleDate = new Date().toISOString().split('T')[0];
        
        for (const dateMatch of dateMatches) {
            if (dateMatch && dateMatch[1]) {
                try {
                    const parsedDate = new Date(dateMatch[1]);
                    if (!isNaN(parsedDate.getTime())) {
                        articleDate = parsedDate.toISOString().split('T')[0];
                        break;
                    }
                } catch (e) {
                    continue;
                }
            }
        }
        
        return {
            success: true,
            title: extractedTitle,
            description: description,
            date: articleDate,
            extraction_method: 'simple_fetch'
        };
        
    } catch (error) {
        console.error(`  ❌ Error extracting article data: ${error.message}`);
        return {
            success: false,
            error: error.message
        };
    }
}

// Try simple fetch first (fastest method)
async function trySimpleFetch(url) {
    console.log('📄 Attempting simple fetch...');
    
    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0'
    ];
    
    for (let attempt = 0; attempt < userAgents.length; attempt++) {
        try {
            const userAgent = userAgents[attempt];
            console.log(`  🔄 Attempt ${attempt + 1}/${userAgents.length}...`);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(url, {
                headers: {
                    'User-Agent': userAgent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'DNT': '1',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1'
                },
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const html = await response.text();
                console.log(`  ✅ Simple fetch successful (${html.length} bytes)`);
                return extractArticleData(html, url);
            } else {
                console.log(`  ⚠️ Attempt ${attempt + 1} failed: HTTP ${response.status}`);
            }
            
        } catch (error) {
            console.log(`  ⚠️ Attempt ${attempt + 1} error: ${error.message}`);
        }
        
        // Wait before next attempt
        if (attempt < userAgents.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    
    return { success: false, error: 'All simple fetch attempts failed' };
}

// Use Playwright for complex sites (fallback method)
async function tryPlaywrightExtraction(url) {
    console.log('🎭 Simple fetch failed, using Playwright...');
    
    let browser = null;
    let page = null;
    
    try {
        // Launch browser in headless mode
        browser = await chromium.launch({
            headless: true,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--disable-features=site-per-process'
            ]
        });
        
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 1080 },
            locale: 'en-US',
            timezoneId: 'America/New_York'
        });
        
        page = await context.newPage();
        
        // Set additional headers
        await page.setExtraHTTPHeaders({
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        });
        
        console.log(`  🔍 Navigating to: ${url}`);
        
        // Navigate to the page
        const response = await page.goto(url, {
            waitUntil: 'networkidle',
            timeout: 30000
        });
        
        // Wait for common article selectors
        try {
            await page.waitForSelector('article, main, [role="main"], .article-content, .story-body', {
                timeout: 5000
            });
        } catch (e) {
            console.log('  ⚠️ Standard article selectors not found, continuing...');
        }
        
        // Extract content
        const content = await page.evaluate(() => {
            const getMeta = (name) => {
                const meta = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
                return meta ? meta.content : null;
            };
            
            // Get full text for analysis
            const articleSelectors = [
                'article', 'main article', '[role="main"]',
                '.article-content', '.story-body', '.entry-content',
                '.post-content', '#article-body', '.article__body'
            ];
            
            let articleElement = null;
            for (const selector of articleSelectors) {
                articleElement = document.querySelector(selector);
                if (articleElement) break;
            }
            
            if (!articleElement) {
                articleElement = document.body;
            }
            
            const fullText = articleElement.innerText || articleElement.textContent || '';
            
            return {
                title: document.title || getMeta('og:title') || getMeta('twitter:title'),
                description: getMeta('description') || getMeta('og:description') || getMeta('twitter:description'),
                author: getMeta('author') || getMeta('article:author'),
                publishDate: getMeta('article:published_time') || getMeta('datePublished'),
                fullText: fullText.substring(0, 4000), // Increased to 4000 chars for better context
                wordCount: fullText.split(/\s+/).length
            };
        });
        
        console.log(`  ✅ Playwright extraction successful (${content.wordCount} words)`);
        
        // Parse the date
        let articleDate = new Date().toISOString().split('T')[0];
        if (content.publishDate) {
            try {
                const parsedDate = new Date(content.publishDate);
                if (!isNaN(parsedDate.getTime())) {
                    articleDate = parsedDate.toISOString().split('T')[0];
                }
            } catch (e) {
                // Keep default date
            }
        }
        
        return {
            success: true,
            title: content.title || title || 'Article',
            description: content.description || 'Article extracted via Playwright',
            date: articleDate,
            author: content.author,
            full_content: content.fullText,
            word_count: content.wordCount,
            extraction_method: 'playwright'
        };
        
    } catch (error) {
        console.error(`  ❌ Playwright extraction failed: ${error.message}`);
        return {
            success: false,
            error: error.message
        };
    } finally {
        if (page) await page.close();
        if (browser) await browser.close();
    }
}

// Simple rate limiter for OpenAI API
const rateLimiter = {
    lastCall: 0,
    minDelay: 1000, // Minimum 1 second between calls
    
    async throttle() {
        const now = Date.now();
        const timeSinceLastCall = now - this.lastCall;
        if (timeSinceLastCall < this.minDelay) {
            await new Promise(r => setTimeout(r, this.minDelay - timeSinceLastCall));
        }
        this.lastCall = Date.now();
    }
};

// Analyze with OpenAI
async function analyzeWithOpenAI(articleData) {
    console.log('🤖 Analyzing with OpenAI...');
    
    // Apply rate limiting
    await rateLimiter.throttle();
    
    const prompt = `Analyze this political news article and provide comprehensive analysis:
    
    REQUIRED ANALYSIS:
    1. actor: Main political actor or organization (e.g., "Donald Trump", "DOJ")
    2. category: Financial|Civil Liberties|Platform Manipulation|Government Oversight|Election Integrity|Corporate Ethics|Legal Proceedings|Political News
    3. severity: low|medium|high
    4. summary: Factual summary (2-3 sentences) - What actually happened?
    5. spin: How is this being presented/framed by the source?
    6. reality: What does this really mean? (cut through the spin)
    7. implications: Why does this matter for democracy/citizens?
    8. missing_context: What important context or facts are not mentioned?
    
    Article (${articleData.word_count || 'unknown'} total words):
    Title: ${articleData.title}
    Source: ${new URL(url).hostname}
    ${articleData.author ? `Author: ${articleData.author}` : ''}
    ${articleData.date ? `Date: ${articleData.date}` : ''}
    Description: ${articleData.description}
    ${articleData.full_content ? `Content Preview:\n${articleData.full_content.substring(0, 3500)}` : ''}
    
    Return a JSON object with ALL fields listed above. Be objective and analytical.`;
    
    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a political analyst providing objective analysis of news articles.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.3,
                max_tokens: 500
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            const content = data.choices[0].message.content;
            
            // Try to parse as JSON
            try {
                const analysis = JSON.parse(content);
                console.log('  ✅ OpenAI analysis complete');
                return analysis;
            } catch {
                // Fallback if not valid JSON
                console.log('  ⚠️ OpenAI response not valid JSON, using defaults');
                return {
                    actor: 'Political Actor',
                    category: 'Political News',
                    severity: 'medium',
                    summary: articleData.description,
                    spin: 'Unable to analyze',
                    reality: 'Unable to analyze',
                    implications: 'Unable to analyze',
                    missing_context: 'Unable to analyze'
                };
            }
        } else {
            console.log(`  ⚠️ OpenAI API error: ${response.status}`);
            return null;
        }
    } catch (error) {
        console.log(`  ⚠️ OpenAI error: ${error.message}`);
        return null;
    }
}

// Main processing function
async function processArticle() {
    // Check for duplicates first (quick check before expensive processing)
    const duplicateCheck = await checkDuplicate(url, title);
    if (duplicateCheck.isDuplicate) {
        console.log(`\n⚠️ Duplicate detected: ${duplicateCheck.message}`);
        console.log('Article already in database, skipping processing.');
        return duplicateCheck.existing;
    }
    if (duplicateCheck.similar) {
        console.log(`\nℹ️ Note: ${duplicateCheck.similar.length} similar articles exist, but continuing...\n`);
    }
    
    let articleData = null;
    
    // Step 1: Try simple fetch first (it's faster)
    const simpleFetch = await trySimpleFetch(url);
    
    if (simpleFetch.success) {
        articleData = simpleFetch;
    } else {
        // Step 2: If simple fetch fails, use Playwright
        console.log('\n⚡ Escalating to Playwright for complex site...\n');
        const playwrightResult = await tryPlaywrightExtraction(url);
        
        if (playwrightResult.success) {
            articleData = playwrightResult;
        } else {
            // Step 3: If both fail, create manual entry
            console.log('\n⚠️ All extraction methods failed, creating basic entry...\n');
            const siteName = new URL(url).hostname.replace('www.', '');
            articleData = {
                success: true,
                title: title || `Manual Entry from ${siteName}`,
                description: 'Content could not be extracted automatically. Requires manual review.',
                date: new Date().toISOString().split('T')[0],
                extraction_method: 'manual_fallback'
            };
        }
    }
    
    // Step 4: Analyze with OpenAI if we have content
    let analysis = null;
    if (articleData.success) {
        analysis = await analyzeWithOpenAI(articleData);
    }
    
    // Step 5: Prepare entry for Supabase
    const entry = {
        // Note: id is auto-generated by database (SERIAL PRIMARY KEY)
        title: title || articleData.title,  // Use admin-provided title first, then extracted title
        source_url: normalizeUrl(url),  // Store normalized URL for consistent duplicate detection
        description: analysis?.summary || articleData.description,
        category: analysis?.category || category || 'Political News',
        date: articleData.date,
        actor: analysis?.actor || 'Political Actor',
        severity: analysis?.severity || 'medium',
        verified: isVerifiedSource(url),
        source: new URL(url).hostname.replace('www.', '')  // Extract domain name as source
    };
    
    // Step 6: Insert to Supabase with retry logic
    console.log('\n💾 Saving to Supabase...');
    
    // Retry wrapper for critical operations
    async function insertWithRetry(entry, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                const { data, error } = await supabase
                    .from('political_entries')
                    .insert([entry])
                    .select();
                
                if (error) throw error;
                return { data, error: null };
            } catch (error) {
                console.log(`  ⚠️ Insert attempt ${i + 1}/${retries} failed:`, error.message);
                if (i === retries - 1) {
                    return { data: null, error };
                }
                // Exponential backoff: 1s, 2s, 4s
                await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
            }
        }
    }
    
    const { data, error } = await insertWithRetry(entry);
    
    if (error) {
        console.error('❌ Supabase error after retries:', error);
        process.exit(1);
    }
    
    console.log('✅ Entry saved successfully!');
    console.log(`  Title: ${entry.title}`);
    console.log(`  Category: ${entry.category}`);
    
    // Step 7: Get statistics
    try {
        const { count, error: statsError } = await supabase
            .from('political_entries')
            .select('*', { count: 'exact', head: true });
        
        if (!statsError && count !== null) {
            console.log(`\n📊 Total entries in database: ${count}`);
        }
    } catch (statsErr) {
        // Statistics are optional, don't fail if they error
        console.log('  (Statistics unavailable)');
    }
    
    return entry;
}

// Run the processor
try {
    const result = await processArticle();
    console.log('\n✅ Processing complete!');
    process.exit(0);
} catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
}
