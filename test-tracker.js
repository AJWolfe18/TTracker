// test-tracker.js
import fetch from 'node-fetch';
import { writeFileSync, readFileSync, existsSync } from 'fs';

async function fetchPoliticalUpdates() {
    const apiKey = process.env.OPENAI_API_KEY;
    
    console.log('API Key present:', !!apiKey);
    
    if (!apiKey) {
        console.error('OpenAI API key not found');
        process.exit(1);
    }

    const prompt = `You are a political news tracker. Create entries for ANY political news, government actions, or public figure developments from recent days. Focus on:

KEY FIGURES: Trump, Musk, Biden, any politicians, government officials
GOVERNMENT: Any federal agency actions, policy announcements, investigations  
BUSINESS/TECH: Major corporate decisions, regulatory issues, platform changes
LEGAL: Court cases, investigations, regulatory actions
POLITICAL: Campaign news, election-related developments, voting issues

Include both major and minor developments. Be liberal in what you consider relevant.

Create 3-8 realistic entries for today (${new Date().toDateString()}) using this structure:

[
  {
    "date": "${new Date().toISOString().split('T')[0]}",
    "actor": "Person or Agency Name", 
    "category": "Financial, Civil Liberties, Platform Manipulation, Government Oversight, Election Integrity, Corporate Ethics, or Legal Proceedings",
    "title": "Brief headline",
    "description": "2-3 sentence summary of the development or action",
    "source_url": "https://example-news-source.com",
    "verified": true,
    "severity": "low, medium, or high"
  }
]

Return ONLY the JSON array. Always include at least 3 entries unless absolutely no political news exists.`;

    try {
        console.log('Making test request to OpenAI...');
        
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
                temperature: 0.7
            })
        });

        console.log('Response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('OpenAI API error:', response.status, response.statusText);
            console.error('Error details:', errorText);
            throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log('OpenAI response received');
        
        const gptResponse = data.choices[0].message.content;
        console.log('GPT response length:', gptResponse.length);
        
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
    const filename = `test-data-${new Date().toISOString().split('T')[0]}.json`;
    
    const output = {
        generated_at: timestamp,
        date: new Date().toISOString().split('T')[0],
        total_entries: entries.length,
        entries: entries
    };

    console.log('Saving to file:', filename);

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
    
    entries.forEach(entry => {
        masterLog.push({
            ...entry,
            id: Date.now() + Math.random(),
            added_at: timestamp
        });
    });
    
    writeFileSync('master-tracker-log.json', JSON.stringify(masterLog, null, 2));
    
    console.log(`Saved ${entries.length} entries to ${filename}`);
    console.log(`Master log now contains ${masterLog.length} total entries`);
    
    return { filename, totalEntries: entries.length, masterLogSize: masterLog.length };
}

async function main() {
    console.log('=== RUNNING TEST TRACKER ===');
    console.log('Date:', new Date().toDateString());
    
    const entries = await fetchPoliticalUpdates();
    
    if (entries.length === 0) {
        console.log('No entries generated.');
    } else {
        console.log(`Generated ${entries.length} test entries:`);
        entries.forEach((entry, index) => {
            console.log(`${index + 1}. [${entry.severity.toUpperCase()}] ${entry.actor}: ${entry.title}`);
        });
    }
    
    const result = await saveToFile(entries);
    
    console.log('\n=== TEST SUMMARY ===');
    console.log(`Test entries: ${result.totalEntries}`);
    console.log(`Total in database: ${result.masterLogSize}`);
    console.log('==================\n');
}

main().catch(error => {
    console.error('=== TEST ERROR ===');
    console.error(error);
    process.exit(1);
