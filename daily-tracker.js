// daily-tracker.js
import fetch from 'node-fetch';
import { writeFileSync, readFileSync, existsSync } from 'fs';

async function fetchPoliticalUpdates() {
    const apiKey = process.env.OPENAI_API_KEY;
    
    console.log('API Key present:', !!apiKey);
    console.log('API Key length:', apiKey ? apiKey.length : 0);
    
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
        console.log('Making request to OpenAI...');
        
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

        console.log('Response status:', response.status);
        console.log('Response headers:', response.headers.raw());

        if (!response.ok) {
            const errorText = await response.text();
            console.error('OpenAI API error:', response.status, response.statusText);
            console.error('Error details:', errorText);
            throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log('OpenAI response received:', !!data);
        console.log('Response usage:', data.usage);
        
        const gptResponse = data.choices[0].message.content;
        console.log('GPT response length:', gptResponse.length);
        
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

        console.log('Successfully parsed', newEntries.length, 'entries');
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

    console.log('Saving to file:', filename);

    // Save to file
    writeFileSync(filename, JSON.stringify(output, null, 2));
    
    // Also append to master log
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
            id: Date.now() + Math.random(), // Simple unique ID
            added_at: timestamp
        });
    });
    
    writeFileSync('master-tracker-log.json', JSON.stringify(masterLog, null, 2));
    
    console.log(`Saved ${entries.length} entries to ${filename}`);
    console.log(`Master log now contains ${masterLog.length} total entries`);
    
    return { filename, totalEntries: entries.length, masterLogSize: masterLog.length };
}

async function main() {
    console.log('=== STARTING DAILY POLITICAL TRACKER ===');
    console.log('Date:', new Date().toDateString());
    console.log('Time:', new Date().toISOString());
    
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

main().catch(error => {
    console.error('=== FATAL ERROR ===');
    console.error(error);
    process.exit(1);
});
