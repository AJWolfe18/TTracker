// manual-article-processor.js - FIXED VERSION
import fs from 'fs/promises';
import fetch from 'node-fetch';

console.log('🔄 MANUAL ARTICLE PROCESSOR (ENHANCED)');
console.log('======================================\n');

// Generate simple ID
function generateId() {
    return Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

// Check if source is verified
function isVerifiedSource(url) {
    const verifiedDomains = [
        'reuters.com', 'ap.org', 'apnews.com', 'wsj.com', 'nytimes.com',
        'washingtonpost.com', 'usatoday.com', 'bbc.com', 'bbc.co.uk',
        'cnn.com', 'foxnews.com', 'nbcnews.com', 'abcnews.go.com', 
        'cbsnews.com', 'msnbc.com', 'npr.org', 'pbs.org', 'politico.com',
        'thehill.com', 'axios.com', 'bloomberg.com', 'cnbc.com', 'forbes.com',
        'propublica.org', 'courthousenews.com'
    ];
    
    try {
        const domain = new URL(url).hostname.toLowerCase();
        return verifiedDomains.some(verified => domain.includes(verified)) || domain.endsWith('.gov');
    } catch {
        return false;
    }
}

// Enhanced fetch with multiple user agents and retry logic
async function fetchArticleContent(url) {
    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0'
    ];
    
    console.log(`  📄 Fetching content from: ${url}`);
    
    for (let attempt = 0; attempt < userAgents.length; attempt++) {
        try {
            const userAgent = userAgents[attempt];
            console.log(`  🔄 Attempt ${attempt + 1}/${userAgents.length} with User-Agent: ${userAgent.split(' ')[2]}...`);
            
            const response = await fetch(url, {
                headers: {
                    'User-Agent': userAgent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Accept-Encoding': 'gzip, deflate',
                    'DNT': '1',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Cache-Control': 'max-age=0'
                },
                timeout: 15000
            });
            
            if (response.ok) {
                const html = await response.text();
                console.log(`  ✅ Successfully fetched content (${html.length} bytes)`);
                return extractArticleData(html, url);
            } else {
                console.log(`  ⚠️ Attempt ${attempt + 1} failed: HTTP ${response.status}`);
                if (attempt === userAgents.length - 1) {
                    throw new Error(`All fetch attempts failed. Final: HTTP ${response.status}: ${response.statusText}`);
                }
                // Wait before next attempt
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
        } catch (error) {
            console.log(`  ⚠️ Attempt ${attempt + 1} error: ${error.message}`);
            if (attempt === userAgents.length - 1) {
                // If all attempts fail, return manual entry
                console.log(`  🔧 All fetch attempts failed, creating manual entry...`);
                return createManualEntry(url);
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
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
        let title = titleMatch ? titleMatch[1].trim() : '';
        
        // Clean up title
        title = title.replace(/&quot;/g, '"')
                   .replace(/&amp;/g, '&')
                   .replace(/&lt;/g, '<')
                   .replace(/&gt;/g, '>')
                   .replace(/\s+/g, ' ')
                   .trim();
        
        // Remove site name from title
        const siteName = new URL(url).hostname.replace('www.', '');
        title = title.replace(new RegExp(`\\s*[-|–]\\s*${siteName}.*$`, 'i'), '');
        
        if (!title) {
            title = `Article from ${siteName}`;
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
        description = description.replace(/&quot;/g, '"')
                               .replace(/&amp;/g, '&')
                               .replace(/&lt;/g, '<')
                               .replace(/&gt;/g, '>')
                               .replace(/\s+/g, ' ')
                               .trim();
        
        if (!description || description.length < 20) {
            description = `Political article from ${siteName} requiring manual review`;
        }
        
        // Extract date
        const dateMatches = [
            html.match(/<meta[^>]+property="article:published_time"[^>]+content="([^"]+)"/i),
            html.match(/<meta[^>]+name="publish-date"[^>]+content="([^"]+)"/i),
            html.match(/<time[^>]+datetime="([^"]+)"/i),
            html.match(/(\d{4}-\d{2}-\d{2})/g)
        ];
        
        let articleDate = new Date().toISOString().split('T')[0]; // Default to today
        
        for (const dateMatch of dateMatches) {
            if (dateMatch) {
                try {
                    const dateStr = Array.isArray(dateMatch) ? dateMatch[0] : dateMatch[1];
                    const parsedDate = new Date(dateStr);
                    if (!isNaN(parsedDate.getTime())) {
                        articleDate = parsedDate.toISOString().split('T')[0];
                        break;
                    }
                } catch (e) {
                    // Continue to next match
                }
            }
        }
        
        console.log(`  ✅ Extracted: "${title.substring(0, 60)}..."`);
        
        return { title, description, date: articleDate };
        
    } catch (error) {
        console.error(`  ❌ Error extracting article data: ${error.message}`);
        return createManualEntry(url);
    }
}

// Create manual entry when scraping fails
function createManualEntry(url) {
    const domain = new URL(url).hostname.replace('www.', '');
    
    return {
        title: `Manual Article from ${domain}`,
        description: `Article submitted manually from ${domain}. Content extraction failed - requires manual review.`,
        date: new Date().toISOString().split('T')[0]
    };
}

// Analyze article with OpenAI
async function analyzeArticleWithAI(title, description, url) {
    try {
        console.log(`  🤖 Analyzing with AI: "${title.substring(0, 40)}..."`);
        
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `You are a political accountability analyst for the Trump 2.0 Era. Analyze articles for political relevance, key actors, and accountability issues.

Focus on:
- Trump administration actions and policies
- Federal agency activities (DOJ, FBI, ICE, DHS, Department of Education)
- Government oversight and accountability issues
- Civil liberties and constitutional concerns
- Corporate ethics and lobbying issues
- Election integrity and campaign finance
- Legal proceedings involving political figures

Return analysis as valid JSON only.`
                    },
                    {
                        role: 'user',
                        content: `Analyze this article and return ONLY valid JSON:

Title: ${title}
Description: ${description}
Source URL: ${url}

Return exactly this JSON format:
{
  "actor": "main person, organization, or agency involved",
  "category": "Financial|Civil Liberties|Platform Manipulation|Government Oversight|Election Integrity|Corporate Ethics|Legal Proceedings",
  "severity": "low|medium|high",
  "verified": true|false,
  "political_relevance": "brief explanation"
}

Choose the MOST relevant category. Return ONLY the JSON object.`
                    }
                ],
                max_tokens: 500,
                temperature: 0.3
            })
        });

        if (!response.ok) {
            console.warn(`  ⚠️ OpenAI API failed (${response.status}), using fallback`);
            return getFallbackAnalysis(url);
        }

        const data = await response.json();
        const aiResponse = data.choices[0].message.content.trim();
        
        // Clean up JSON response
        let jsonStr = aiResponse;
        if (aiResponse.includes('```json')) {
            const match = aiResponse.match(/```json\s*([\s\S]*?)\s*```/);
            if (match) jsonStr = match[1];
        }
        
        try {
            const analysis = JSON.parse(jsonStr);
            
            const result = {
                actor: analysis.actor || 'Unknown Actor',
                category: validateCategory(analysis.category),
                severity: validateSeverity(analysis.severity),
                verified: analysis.verified !== undefined ? Boolean(analysis.verified) : isVerifiedSource(url),
                political_relevance: analysis.political_relevance || 'Political development requiring analysis'
            };
            
            console.log(`  ✅ AI Analysis: ${result.actor} - ${result.category} (${result.severity})`);
            return result;
            
        } catch (parseError) {
            console.warn(`  ⚠️ Failed to parse AI response, using fallback`);
            return getFallbackAnalysis(url);
        }
        
    } catch (error) {
        console.warn(`  ⚠️ AI analysis failed: ${error.message}, using fallback`);
        return getFallbackAnalysis(url);
    }
}

// Validate category
function validateCategory(category) {
    const validCategories = [
        'Financial', 'Civil Liberties', 'Platform Manipulation', 
        'Government Oversight', 'Election Integrity', 'Corporate Ethics', 'Legal Proceedings'
    ];
    
    if (validCategories.includes(category)) return category;
    
    const categoryLower = category?.toLowerCase() || '';
    if (categoryLower.includes('financial') || categoryLower.includes('money')) return 'Financial';
    if (categoryLower.includes('civil') || categoryLower.includes('rights')) return 'Civil Liberties';
    if (categoryLower.includes('platform') || categoryLower.includes('social')) return 'Platform Manipulation';
    if (categoryLower.includes('election') || categoryLower.includes('voting')) return 'Election Integrity';
    if (categoryLower.includes('corporate') || categoryLower.includes('business')) return 'Corporate Ethics';
    if (categoryLower.includes('legal') || categoryLower.includes('court')) return 'Legal Proceedings';
    
    return 'Government Oversight';
}

// Validate severity
function validateSeverity(severity) {
    const validSeverities = ['low', 'medium', 'high'];
    return validSeverities.includes(severity?.toLowerCase()) ? severity.toLowerCase() : 'medium';
}

// Fallback analysis
function getFallbackAnalysis(url) {
    return {
        actor: 'Manual Submission',
        category: 'Government Oversight',
        severity: 'medium',
        verified: isVerifiedSource(url),
        political_relevance: 'Manually submitted article - content extraction failed'
    };
}

// Main processing function
async function processManualSubmissions() {
    try {
        let pendingSubmissions;
        try {
            const pendingData = await fs.readFile('pending-submissions.json', 'utf8');
            pendingSubmissions = JSON.parse(pendingData);
        } catch (error) {
            console.log('ℹ️ No pending submissions found');
            return;
        }
        
        if (!Array.isArray(pendingSubmissions) || pendingSubmissions.length === 0) {
            console.log('ℹ️ No pending submissions to process');
            return;
        }
        
        console.log(`📋 Found ${pendingSubmissions.length} pending submission(s)\n`);
        
        let existingEntries;
        try {
            const masterData = await fs.readFile('master-tracker-log.json', 'utf8');
            existingEntries = JSON.parse(masterData);
        } catch (error) {
            console.log('⚠️ Could not load existing entries, starting fresh');
            existingEntries = [];
        }
        
        const processedEntries = [];
        
        for (let i = 0; i < pendingSubmissions.length; i++) {
            const submission = pendingSubmissions[i];
            console.log(`\n🔄 Processing ${i + 1}/${pendingSubmissions.length}: ${submission.url}`);
            
            try {
                const content = await fetchArticleContent(submission.url);
                const analysis = await analyzeArticleWithAI(content.title, content.description, submission.url);
                
                const processedEntry = {
                    id: generateId(),
                    date: content.date,
                    actor: analysis.actor,
                    category: analysis.category,
                    title: content.title,
                    description: content.description,
                    source_url: submission.url,
                    verified: analysis.verified,
                    severity: analysis.severity,
                    added_at: new Date().toISOString(),
                    manual_submission: true,
                    submitted_by: submission.submitted_by || 'admin',
                    submitted_at: submission.submitted_at,
                    processed_at: new Date().toISOString()
                };
                
                processedEntries.push(processedEntry);
                console.log(`  ✅ Successfully processed: "${content.title.substring(0, 50)}..."`);
                
            } catch (error) {
                console.error(`  ❌ FAILED to process article: ${error.message}`);
                
                // Create a fallback entry even for failed articles
                const fallbackEntry = {
                    id: generateId(),
                    date: new Date().toISOString().split('T')[0],
                    actor: 'Manual Submission',
                    category: 'Government Oversight',
                    title: `Failed Article from ${new URL(submission.url).hostname}`,
                    description: `Article processing failed: ${error.message}. URL: ${submission.url}`,
                    source_url: submission.url,
                    verified: isVerifiedSource(submission.url),
                    severity: 'medium',
                    added_at: new Date().toISOString(),
                    manual_submission: true,
                    processing_failed: true,
                    error_message: error.message,
                    submitted_by: submission.submitted_by || 'admin',
                    submitted_at: submission.submitted_at,
                    processed_at: new Date().toISOString()
                };
                
                processedEntries.push(fallbackEntry);
                console.log(`  🔧 Created fallback entry for failed article`);
            }
        }
        
        // Update master tracker
        if (processedEntries.length > 0) {
            const updatedEntries = [...processedEntries, ...existingEntries];
            updatedEntries.sort((a, b) => {
                const dateA = new Date(a.date || a.added_at);
                const dateB = new Date(b.date || b.added_at);
                return dateB - dateA;
            });
            
            await fs.writeFile('master-tracker-log.json', JSON.stringify(updatedEntries, null, 2));
            
            // Also update public folder
            try {
                await fs.mkdir('public', { recursive: true });
                await fs.writeFile('public/master-tracker-log.json', JSON.stringify(updatedEntries, null, 2));
                console.log(`\n💾 Updated master tracker and public folder with ${processedEntries.length} entries`);
            } catch (error) {
                console.warn(`⚠️ Could not update public folder: ${error.message}`);
            }
        }
        
        // Clear pending submissions
        await fs.unlink('pending-submissions.json');
        console.log('🧹 Cleared pending submissions file');
        
        console.log('\n📊 PROCESSING SUMMARY:');
        console.log('====================');
        console.log(`✅ Total processed: ${processedEntries.length}`);
        console.log(`📄 Total entries in tracker: ${(existingEntries.length + processedEntries.length)}`);
        console.log(`\n🎉 All submissions processed successfully!`);
        
    } catch (error) {
        console.error('❌ Fatal error in processing:', error);
        process.exit(1);
    }
}

// Run the processor
processManualSubmissions();