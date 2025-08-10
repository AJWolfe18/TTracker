// daily-tracker-supabase.js
// Updated version that uses Supabase instead of JSON files
import fetch from 'node-fetch';
import { supabaseRequest } from './supabase-config.js';

console.log('🚀 DAILY POLITICAL TRACKER - SUPABASE VERSION');
console.log('==============================================\n');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY environment variable is required');
    process.exit(1);
}

// Generate unique ID
function generateId() {
    return Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

// Get date range for searches
function getDateRange() {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    return {
        today: today.toISOString().split('T')[0],
        yesterday: yesterday.toISOString().split('T')[0],
        weekAgo: weekAgo.toISOString().split('T')[0],
        searchRange: `after:${weekAgo.toISOString().split('T')[0]}`
    };
}

// Check if an entry already exists in the database
async function isDuplicate(title, date) {
    try {
        // Search for similar titles on the same date
        const query = `title.ilike.%${title.slice(0, 50)}%&date=eq.${date}`;
        const existing = await supabaseRequest(`political_entries?${query}&limit=1`);
        return existing && existing.length > 0;
    } catch (error) {
        console.error('Error checking for duplicates:', error.message);
        return false; // Assume not duplicate if check fails
    }
}

async function fetchPoliticalUpdates() {
    const dates = getDateRange();
    console.log(`📅 Searching for political news from ${dates.weekAgo} to ${dates.today}\n`);
    
    const categories = [
        {
            name: 'Trump & Family',
            prompt: `Search for recent factual news about Donald Trump, Trump family members, or Trump administration from ${dates.searchRange}. Focus on concrete developments: legal proceedings, policy announcements, business dealings, or official statements. Find 3-5 unique, significant stories from different credible news sources.`
        },
        {
            name: 'Elon Musk & DOGE',
            prompt: `Search for recent news about Elon Musk's role in government, DOGE (Department of Government Efficiency), or his political influence from ${dates.searchRange}. Focus on actual developments, government contracts, policy influence, or conflicts of interest. Find 3-5 unique stories.`
        },
        {
            name: 'DOJ & Law Enforcement',
            prompt: `Search for recent Department of Justice, FBI, or federal law enforcement news from ${dates.searchRange}. Focus on new prosecutions, investigations, policy changes, or leadership appointments. Find 3-5 significant developments.`
        },
        {
            name: 'Federal Agencies',
            prompt: `Search for recent news about federal agencies (ICE, DHS, Education, EPA, etc.) from ${dates.searchRange}. Focus on policy changes, personnel changes, or significant actions. Find 3-5 important updates.`
        },
        {
            name: 'Courts & Legal',
            prompt: `Search for recent court decisions, judicial appointments, or legal challenges involving the administration from ${dates.searchRange}. Focus on significant rulings or cases. Find 3-5 major legal developments.`
        },
        {
            name: 'Corporate & Financial',
            prompt: `Search for recent news about corporate responses to administration policies, stock market impacts, or economic policy changes from ${dates.searchRange}. Find 3-5 significant business/financial stories.`
        }
    ];

    const allEntries = [];
    
    for (const category of categories) {
        console.log(`\n🔍 Searching: ${category.name}`);
        
        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [
                        {
                            role: 'system',
                            content: `You are a political news aggregator that searches for and returns REAL, FACTUAL news from the last week. 
                            You must return actual news stories with real URLs from credible sources.
                            Each story must be unique - do not include multiple versions of the same story.
                            Prioritize breaking news and new developments over ongoing stories.
                            
                            CRITICAL: Extract the ACTUAL publication date from each article. Do NOT use today's date unless the article was actually published today.
                            
                            Return a JSON array with this structure:
                            [{
                                "title": "Exact headline from the news source",
                                "description": "2-3 sentence factual summary of the story",
                                "source_url": "https://actual-url-to-article",
                                "date": "YYYY-MM-DD format of when article was published",
                                "actor": "Primary person/entity involved",
                                "severity": "low/medium/high/critical based on impact",
                                "verified": true/false based on source credibility
                            }]`
                        },
                        {
                            role: 'user',
                            content: category.prompt
                        }
                    ],
                    temperature: 0.3,
                    max_tokens: 2000,
                    tools: [{
                        type: 'web_search',
                        web_search: {
                            queries: [`${category.name} news ${dates.searchRange}`]
                        }
                    }]
                })
            });

            const data = await response.json();
            
            if (!data.choices?.[0]?.message?.content) {
                console.log(`   ⚠️ No content returned for ${category.name}`);
                continue;
            }

            const content = data.choices[0].message.content;
            let stories = [];
            
            try {
                const jsonMatch = content.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    stories = JSON.parse(jsonMatch[0]);
                }
            } catch (parseError) {
                console.log(`   ⚠️ Could not parse stories for ${category.name}`);
                continue;
            }

            console.log(`   ✅ Found ${stories.length} stories`);
            
            // Process each story
            for (const story of stories) {
                // Check for duplicates
                const duplicate = await isDuplicate(story.title, story.date);
                if (duplicate) {
                    console.log(`   ⏭️ Skipping duplicate: ${story.title.substring(0, 50)}...`);
                    continue;
                }
                
                const entry = {
                    id: generateId(),
                    date: story.date || dates.today,
                    actor: story.actor || 'Unknown',
                    category: category.name,
                    title: story.title,
                    description: story.description,
                    source_url: story.source_url,
                    verified: story.verified !== false,
                    severity: story.severity || 'medium',
                    status: 'published',
                    added_at: new Date().toISOString()
                };
                
                allEntries.push(entry);
            }
            
            // Add a small delay between categories
            await new Promise(resolve => setTimeout(resolve, 1000));
            
        } catch (error) {
            console.error(`   ❌ Error processing ${category.name}:`, error.message);
        }
    }
    
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
        
        // Log what was added
        console.log('\n📊 Summary of new entries:');
        const byCategory = {};
        entries.forEach(entry => {
            byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
        });
        
        Object.entries(byCategory).forEach(([cat, count]) => {
            console.log(`   ${cat}: ${count} entries`);
        });
        
    } catch (error) {
        console.error('❌ Error saving to Supabase:', error.message);
        throw error;
    }
}

async function main() {
    try {
        console.log('🔍 Fetching political updates...\n');
        const entries = await fetchPoliticalUpdates();
        
        if (entries.length > 0) {
            await saveToSupabase(entries);
            console.log('\n✨ Daily tracking complete!');
        } else {
            console.log('\n📭 No new political updates found today');
        }
        
    } catch (error) {
        console.error('\n❌ Fatal error:', error);
        process.exit(1);
    }
}

// Run the tracker
main();