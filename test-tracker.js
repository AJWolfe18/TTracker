// daily-tracker.js - Multi-call version
import fetch from 'node-fetch';
import { writeFileSync, readFileSync, existsSync } from 'fs';

async function callOpenAI(prompt, category) {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
        console.error('OpenAI API key not found');
        return [];
    }

    try {
        console.log(`Making request to OpenAI for: ${category}`);
        
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `You are a political accountability researcher. Always return valid JSON arrays. Today is ${new Date().toDateString()}`
                    },
                    {
                        role: 'user', 
                        content: prompt
                    }
                ],
                max_tokens: 1500,
                temperature: 0.7,
                top_p: 0.9,
                frequency_penalty: 0.1,
                presence_penalty: 0.1
            })
        });

        if (!response.ok) {
            console.error(`OpenAI API error for ${category}:`, response.status);
            return [];
        }

        const data = await response.json();
        const gptResponse = data.choices[0].message.content;
        
        console.log(`${category} - Response length: ${gptResponse.length}`);
        console.log(`${category} - Raw response: "${gptResponse}"`); // Added debug line
        console.log(`${category} - Tokens used: ${data.usage.completion_tokens}`);
        
        // Clean the response
        const cleanedResponse = gptResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        
        let entries;
        try {
            entries = JSON.parse(cleanedResponse);
        } catch (parseError) {
            console.error(`Error parsing ${category} response:`, parseError);
            return [];
        }

        if (!Array.isArray(entries)) {
            console.error(`${category} response is not an array`);
            return [];
        }

        console.log(`${category} - Found ${entries.length} entries`);
        return entries;

    } catch (error) {
        console.error(`Error fetching ${category} updates:`, error);
        return [];
    }
}

async function fetchAllPoliticalUpdates() {
    const today = new Date().toISOString().split('T')[0];
    
    const prompts = [
        {
            category: "Trump & Family",
            prompt: `Return exactly this JSON: [{"date": "${today}", "actor": "Donald Trump", "category": "Financial", "title": "Test entry", "description": "This is a test.", "source_url": "https://example.com", "verified": true, "severity": "medium"}]`
        },
        {
            category: "Elon Musk & DOGE",
            prompt: `Find political news from the past 24 hours about Elon Musk, X/Twitter platform, Department of Government Efficiency (DOGE), or Musk's government roles.

Focus on: platform policies, government contracts, regulatory issues, content moderation, algorithm changes, DOGE activities, conflicts of interest.

Return JSON array:
[{"date": "${today}", "actor": "Elon Musk", "category": "Platform Manipulation", "title": "Brief headline", "description": "2-3 sentence summary", "source_url": "https://url.com", "verified": true, "severity": "medium"}]

If no developments, return [].`
        },
        {
            category: "DOJ & Law Enforcement",
            prompt: `Find political news from the past 24 hours about Department of Justice, Attorney General Pam Bondi, FBI, prosecutions, civil rights enforcement, or law enforcement leadership.

Focus on: DOJ leadership changes, prosecutions, civil rights cases, FBI actions, task force changes, whistleblower issues.

Return JSON array:
[{"date": "${today}", "actor": "DOJ", "category": "Legal Proceedings", "title": "Brief headline", "description": "2-3 sentence summary", "source_url": "https://url.com", "verified": true, "severity": "medium"}]

If no developments, return [].`
        },
        {
            category: "Federal Agencies",
            prompt: `Find political news from the past 24 hours about ICE, DHS, Department of Education, EPA, or other federal agencies and their leadership.

Focus on: policy changes, leadership appointments, enforcement actions, budget issues, regulatory changes, agency restructuring.

Return JSON array:
[{"date": "${today}", "actor": "ICE", "category": "Government Oversight", "title": "Brief headline", "description": "2-3 sentence summary", "source_url": "https://url.com", "verified": true, "severity": "medium"}]

If no developments, return [].`
        },
        {
            category: "Courts & Legal",
            prompt: `Find political news from the past 24 hours about Supreme Court, federal court rulings, election law cases, civil liberties cases, or significant legal developments.

Focus on: court rulings, Supreme Court decisions, election-related cases, civil liberties implications, constitutional issues.

Return JSON array:
[{"date": "${today}", "actor": "Supreme Court", "category": "Civil Liberties", "title": "Brief headline", "description": "2-3 sentence summary", "source_url": "https://url.com", "verified": true, "severity": "medium"}]

If no developments, return [].`
        },
        {
            category: "Corporate & Financial",
            prompt: `Find political news from the past 24 hours about corporate lobbying, PAC funding, conflicts of interest, dark money, government contracts, or business-government entanglements.

Focus on: lobbying activities, campaign finance, conflicts of interest, government contracts, corporate accountability, ethics violations.

Return JSON array:
[{"date": "${today}", "actor": "Corporate Entity", "category": "Corporate Ethics", "title": "Brief headline", "description": "2-3 sentence summary", "source_url": "https://url.com", "verified": true, "severity": "medium"}]

If no developments, return [].`
        }
    ];

    console.log('=== STARTING MULTI-CATEGORY POLITICAL SEARCH ===');
    
    let allEntries = [];
    
    for (const { category, prompt } of prompts) {
        const entries = await callOpenAI(prompt, category);
        allEntries.push(...entries);
        
        // Small delay between calls to be respectful to API
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log(`=== TOTAL ENTRIES FOUND: ${allEntries.length} ===`);
    return allEntries;
}

function isReputableSource(url) {
    if (!url || typeof url !== 'string') return false;
    
    const reputableDomains = [
        'ap.org', 'reuters.com', 'propublica.org', 'theguardian.com',
        'washingtonpost.com', 'nytimes.com', 'npr.org', 'politico.com',
        'govexec.com', 'federalnewsnetwork.com', 'wsj.com', 'bloomberg.com',
        'cnn.com', 'bbc.com', 'axios.com', 'thehill.com', 'aclu.org',
        'sfgate.com', 'meidasnews.com', 'thedailybeast.com', 'newrepublic.com'
    ];
    
    return reputableDomains.some(domain => url.includes(domain));
}

async function saveToFile(entries) {
    const timestamp = new Date().toISOString();
    const filename = `tracker-data-${new Date().toISOString().split('T')[0]}.json`;
    
    // Clean quotes and auto-verify
    entries.forEach(entry => {
        if (entry.description) {
            entry.description = entry.description.replace(/"/g, '\\"');
        }
        if (entry.title) {
            entry.title = entry.title.replace(/"/g, '\\"');
        }
        if (!entry.hasOwnProperty('verified')) {
            entry.verified = isReputableSource(entry.source_url);
        }
    });
    
    const output = {
        generated_at: timestamp,
        date: new Date().toISOString().split('T')[0],
        total_entries: entries.length,
        entries: entries
    };

    console.log('Saving to file:', filename);

    // Save daily file
    writeFileSync(filename, JSON.stringify(output, null, 2));
    
    // Load and update master log
    let masterLog = [];
    if (existsSync('master-tracker-log.json')) {
        console.log('Loading existing master log...');
        const existingData = readFileSync('master-tracker-log.json', 'utf8');
        masterLog = JSON.parse(existingData);
    } else {
        console.log('Creating new master log...');
    }
    
    // Add new entries to master log
    entries.forEach(entry => {
        masterLog.push({
            ...entry,
            id: Date.now() + Math.random(),
            added_at: timestamp
        });
    });
    
    writeFileSync('master-tracker-log.json', JSON.stringify(masterLog, null, 2));
    
    // Copy to public folder for website
    try {
        writeFileSync('public/master-tracker-log.json', JSON.stringify(masterLog, null, 2));
        console.log('Updated public master log for website');
    } catch (error) {
        console.log('Note: Could not update public folder (may not exist yet)');
    }
    
    console.log(`Saved ${entries.length} entries to ${filename}`);
    console.log(`Master log now contains ${masterLog.length} total entries`);
    
    return { filename, totalEntries: entries.length, masterLogSize: masterLog.length };
}

async function main() {
    console.log('=== STARTING MULTI-CALL DAILY POLITICAL TRACKER ===');
    console.log('Date:', new Date().toDateString());
    console.log('Time:', new Date().toISOString());
    
    const entries = await fetchAllPoliticalUpdates();
    
    if (entries.length === 0) {
        console.log('No new political developments found today across all categories.');
    } else {
        console.log(`Found ${entries.length} new developments:`);
        entries.forEach((entry, index) => {
            console.log(`${index + 1}. [${entry.severity?.toUpperCase()}] ${entry.actor}: ${entry.title}`);
        });
    }
    
    const result = await saveToFile(entries);
    
    console.log('\n=== DAILY SUMMARY ===');
    console.log(`Date: ${new Date().toDateString()}`);
    console.log(`New entries today: ${result.totalEntries}`);
    console.log(`Total entries in database: ${result.masterLogSize}`);
    console.log(`Data file: ${result.filename}`);
    console.log('====================\n');
}

main().catch(error => {
    console.error('=== FATAL ERROR ===');
    console.error(error);
    process.exit(1);
});
