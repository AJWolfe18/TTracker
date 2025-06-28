// daily-tracker.js
const fetch = require('node-fetch');
const fs = require('fs');

async function fetchPoliticalUpdates() {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
        console.error('OpenAI API key not found');
        process.exit(1);
    }

    const prompt = `You are a political accountability researcher. Search for and analyze recent news and developments from the past 24 hours (${new Date().toDateString()}) related to:

- Donald Trump: legal issues, business dealings, policy statements, social media activity, meme coins, campaign finance violations
- Elon Musk: platform policies, government contracts, regulatory issues, content moderation, algorithm changes  
- Federal agencies: DOJ, FBI, ICE, DHS, Department of Education actions and policy changes
- Surveillance and privacy: new programs, court rulings, civil liberties implications
- Election-related: voting rights, election integrity, campaign finance violations
- Corporate accountability: conflicts of interest, lobbying, unethical practices
- Court rulings with significant civil liberties implications

Focus on verifiable reporting from reputable news sources. Include both confirmed facts and notable unverified claims (clearly flagged as unverified).

Return ONLY a valid JSON array with this exact structure:
[
  {
    "date": "YYYY-MM-DD",
    "actor": "Person or Agency Name", 
    "category": "One of: Financial, Civil Liberties, Platform Manipulation, Government Oversight, Election Integrity, Corporate Ethics, Legal Proceedings",
    "title": "Brief headline (under 100 characters)",
    "description": "2-3 sentence summary with key details",
    "source_url": "https://actual-source-url.com or 'Multiple sources' if aggregated",
    "verified": true/false,
    "severity": "low/medium/high"
  }
]

If no significant developments found, return empty array [].
Do not include explanatory text, just the JSON array.`;

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-4',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a political accountability researcher. Always return valid JSON arrays as requested. Today is ' + new Date().toDateString()
                    },
                    {
                        role: 'user', 
                        content: prompt
                    }
                ],
                max_tokens: 2500,
                temperature: 0.3
            })
        });

        if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const gptResponse = data.choices[0].message.content;
        
        // Clean the response in case GPT adds markdown formatting
        const cleanedResponse = gptResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        
        let newEntries;
        try {
            newEntries = JSON.parse(cleanedResponse);
        } catch (parseError) {
            console.error('Error parsing GPT response:', parseError);
            console.error('Raw response:', gptResponse);
            return [];
        }

        if (!Array.isArray(newEntries)) {
            console.error('Response is not an array:', newEntries);
            return [];
        }

        return newEntries;

    } catch (error) {
        console.error('Error fetching updates:', error);
        return [];
    }
}

async function saveToFile(entries) {
    const timestamp = new Date().toISOString();
    const filename = `tracker-data-${new Date().toISOString().split('T')[0]}.json`;
    
    const output = {
        generated_at: timestamp,
        date: new Date().toISOString().split('T')[0],
        total_entries: entries.length,
        entries: entries
    };

    // Save to file
    fs.writeFileSync(filename, JSON.stringify(output, null, 2));
    
    // Also append to master log
    let masterLog = [];
    if (fs.existsSync('master-tracker-log.json')) {
        const existingData = fs.readFileSync('master-tracker-log.json', 'utf8');
        masterLog = JSON.parse(existingData);
    }
    
    // Add new entries to master log
    entries.forEach(entry => {
        masterLog.push({
            ...entry,
            id: Date.now() + Math.random(), // Simple unique ID
            added_at: timestamp
        });
    });
    
    fs.writeFileSync('master-tracker-log.json', JSON.stringify(masterLog, null, 2));
    
    console.log(`Saved ${entries.length} entries to ${filename}`);
    console.log(`Master log now contains ${masterLog.length} total entries`);
    
    return { filename, totalEntries: entries.length, masterLogSize: masterLog.length };
}

async function main() {
    console.log('Starting daily political tracker update...');
    console.log('Date:', new Date().toDateString());
    
    const entries = await fetchPoliticalUpdates();
    
    if (entries.length === 0) {
        console.log('No new political developments found today.');
    } else {
        console.log(`Found ${entries.length} new developments:`);
        entries.forEach((entry, index) => {
            console.log(`${index + 1}. [${entry.severity.toUpperCase()}] ${entry.actor}: ${entry.title}`);
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

main().catch(console.error);
