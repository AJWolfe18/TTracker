// manual-article-processor.js
import fs from 'fs/promises';
import fetch from 'node-fetch';

console.log('🔄 MANUAL ARTICLE PROCESSOR');
console.log('============================\n');

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

// Fetch article content from URL
async function fetchArticleContent(url) {
    try {
        console.log(`  📄 Fetching content from: ${url}`);
        
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: 10000
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const html = await response.text();
        
        // Extract title
        const titleMatches = [
            html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i),
            html.match(/<meta[^>]+name="twitter:title"[^>]+content="([^"]+)"/i),
            html.match(/<title[^>]*>([^<]+)<\/title>/i)
        ];
        
        const titleMatch = titleMatches.find(match => match);
        const title = titleMatch ? titleMatch[1].trim().replace(/&quot;/g, '"').replace(/&amp;/g, '&') : 
                     `Article from ${new URL(url).hostname}`;
        
        // Extract description
        const descMatches = [
            html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i),
            html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i),
            html.match(/<meta[^>]+name="twitter:description"[^>]+content="([^"]+)"/i)
        ];
        
        const descMatch = descMatches.find(match => match);
        const description = descMatch ? descMatch[1].trim().replace(/&quot;/g, '"').replace(/&amp;/g, '&') : 
                          `Political article from ${new URL(url).hostname}`;
        
        // Extract date
        const dateMatches = [
            html.match(/<meta[^>]+property="article:published_time"[^>]+content="([^"]+)"/i),
            html.match(/<meta[^>]+name="publish-date"[^>]+content="([^"]+)"/i),
            html.match(/<time[^>]+datetime="([^"]+)"/i),
            html.match(/(\d{4}-\d{2}-\d{2})/),
        ];
        
        const dateMatch = dateMatches.find(match => match);
        let articleDate;
        
        if (dateMatch) {
            try {
                articleDate = new Date(dateMatch[1]).toISOString().split('T')[0];
            } catch {
                articleDate = new Date().toISOString().split('T')[0];
            }
        } else {
            articleDate = new Date().toISOString().split('T')[0];
        }
        
        console.log(`  ✅ Extracted: "${title.substring(0, 50)}..."`);
        
        return { title, description, date: articleDate };
        
    } catch (error) {
        console.error(`  ❌ Failed to fetch content: ${error.message}`);
        throw error;
    }
}

// Analyze article with OpenAI
async function analyzeArticleWithAI(title, description, url) {
    try {
        console.log(`  🤖 Analyzing article with AI...`);
        
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
                        content: `Analyze this article and return ONLY valid JSON with the following structure:

Title: ${title}
Description: ${description}
Source URL: ${url}

Return exactly this JSON format:
{
  "actor": "main person, organization, or agency involved (e.g., 'Donald Trump', 'Department of Justice', 'Elon Musk')",
  "category": "Financial|Civil Liberties|Platform Manipulation|Government Oversight|Election Integrity|Corporate Ethics|Legal Proceedings",
  "severity": "low|medium|high",
  "verified": true|false,
  "political_relevance": "brief explanation of why this is politically significant"
}

Important:
- Choose the MOST relevant category from the exact list provided
- Actor should be the primary political figure or agency
- Severity: high=major scandals/violations, medium=significant developments, low=routine political news
- Verified should be true for credible news sources
- Return ONLY the JSON object, no other text`
                    }
                ],
                max_tokens: 500,
                temperature: 0.3
            })
        });

        if (!response.ok) {
            console.warn(`  ⚠️ OpenAI API failed (${response.status}), using fallback analysis`);
            return getFallbackAnalysis(url);
        }

        const data = await response.json();
        const aiResponse = data.choices[0].message.content.trim();
        
        // Clean up the response to extract JSON
        let jsonStr = aiResponse;
        if (aiResponse.includes('```json')) {
            const match = aiResponse.match(/```json\s*([\s\S]*?)\s*```/);
            if (match) jsonStr = match[1];
        }
        
        try {
            const analysis = JSON.parse(jsonStr);
            
            // Validate and clean the analysis
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

// Validate category against allowed values
function validateCategory(category) {
    const validCategories = [
        'Financial', 'Civil Liberties', 'Platform Manipulation', 
        'Government Oversight', 'Election Integrity', 'Corporate Ethics', 'Legal Proceedings'
    ];
    
    if (validCategories.includes(category)) {
        return category;
    }
    
    // Try to find closest match
    const categoryLower = category?.toLowerCase() || '';
    if (categoryLower.includes('financial') || categoryLower.includes('money')) return 'Financial';
    if (categoryLower.includes('civil') || categoryLower.includes('rights')) return 'Civil Liberties';
    if (categoryLower.includes('platform') || categoryLower.includes('social')) return 'Platform Manipulation';
    if (categoryLower.includes('election') || categoryLower.includes('voting')) return 'Election Integrity';
    if (categoryLower.includes('corporate') || categoryLower.includes('business')) return 'Corporate Ethics';
    if (categoryLower.includes('legal') || categoryLower.includes('court')) return 'Legal Proceedings';
    
    return 'Government Oversight'; // Default fallback
}

// Validate severity
function validateSeverity(severity) {
    const validSeverities = ['low', 'medium', 'high'];
    return validSeverities.includes(severity?.toLowerCase()) ? severity.toLowerCase() : 'medium';
}

// Fallback analysis when AI fails
function getFallbackAnalysis(url) {
    return {
        actor: 'Manual Submission',
        category: 'Government Oversight',
        severity: 'medium',
        verified: isVerifiedSource(url),
        political_relevance: 'Manually submitted political article'
    };
}

// Process all pending submissions
async function processManualSubmissions() {
    try {
        // Check if pending submissions file exists
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
        
        // Load existing tracker data
        let existingEntries;
        try {
            const masterData = await fs.readFile('master-tracker-log.json', 'utf8');
            existingEntries = JSON.parse(masterData);
        } catch (error) {
            console.log('⚠️ Could not load existing entries, starting fresh');
            existingEntries = [];
        }
        
        const processedEntries = [];
        const failedSubmissions = [];
        
        // Process each pending submission
        for (let i = 0; i < pendingSubmissions.length; i++) {
            const submission = pendingSubmissions[i];
            console.log(`\n🔄 Processing ${i + 1}/${pendingSubmissions.length}: ${submission.url}`);
            
            try {
                // Fetch article content
                const content = await fetchArticleContent(submission.url);
                
                // Analyze with AI
                const analysis = await analyzeArticleWithAI(content.title, content.description, submission.url);
                
                // Create processed entry
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
                console.error(`  ❌ Failed to process: ${error.message}`);
                failedSubmissions.push({
                    ...submission,
                    error: error.message,
                    failed_at: new Date().toISOString()
                });
            }
        }
        
        // Update master tracker log
        if (processedEntries.length > 0) {
            // Add new entries at the beginning (most recent first)
            const updatedEntries = [...processedEntries, ...existingEntries];
            
            // Sort by date (newest first) then by added_at
            updatedEntries.sort((a, b) => {
                const dateA = new Date(a.date || a.added_at);
                const dateB = new Date(b.date || b.added_at);
                return dateB - dateA;
            });
            
            await fs.writeFile('master-tracker-log.json', JSON.stringify(updatedEntries, null, 2));
            console.log(`\n💾 Updated master tracker log with ${processedEntries.length} new entries`);
        }
        
        // Handle failed submissions
        if (failedSubmissions.length > 0) {
            await fs.writeFile('failed-submissions.json', JSON.stringify(failedSubmissions, null, 2));
            console.log(`\n⚠️ ${failedSubmissions.length} submissions failed - saved to failed-submissions.json`);
        }
        
        // Clear pending submissions (successful ones)
        if (processedEntries.length === pendingSubmissions.length) {
            // All processed successfully, remove pending file
            await fs.unlink('pending-submissions.json');
            console.log('🧹 Cleared pending submissions file');
        } else {
            // Some failed, keep only the failed ones in pending
            await fs.writeFile('pending-submissions.json', JSON.stringify(failedSubmissions, null, 2));
            console.log('📝 Updated pending submissions with failed items only');
        }
        
        // Summary
        console.log('\n📊 PROCESSING SUMMARY:');
        console.log('====================');
        console.log(`✅ Successfully processed: ${processedEntries.length}`);
        console.log(`❌ Failed to process: ${failedSubmissions.length}`);
        console.log(`📄 Total entries in tracker: ${(existingEntries.length + processedEntries.length)}`);
        
    } catch (error) {
        console.error('❌ Fatal error in processing:', error);
        process.exit(1);
    }
}

// Run the processor
processManualSubmissions();
