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

- Donald Trump: legal issues, business dealings, policy announcements, executive orders, public statements, social media activity (especially on Truth Social or X), meme coins, campaign finance violations, and actions involving Trump family members
- Elon Musk: platform policies (especially on X), government contracts (including with DOGE), regulatory pressure, AI initiatives, censorship or content moderation, algorithmic changes, and political entanglements
- Russell Vought (OMB Director): budget cuts, Schedule F civil service purges, Project 2025 implementation, federal grant/loan freezes, DEI program elimination, regulatory rollbacks, and conflicts with Congress over appropriated funds
- Pam Bondi (Attorney General): DOJ task force shutdowns, prosecution targeting, FBI changes, Foreign Influence Task Force elimination, FARA enforcement rollbacks, and politicization of Justice Department operations
- Pete Hegseth (Defense Secretary): Pentagon "woke" policy rollbacks, military leadership purges, defense contractor changes, troop deployments to borders, warrior culture implementation, and women in combat policy changes
- Kash Patel (FBI Director nominee): "enemies list" targeting, Bureau restructuring plans, Jan 6 pardons stance, foreign business dealings, and politicization of federal law enforcement
- Tulsi Gabbard (DNI nominee): intelligence community changes, Snowden sympathies, foreign adversary connections, Syria/Russia stances, and surveillance program modifications
- RFK Jr. (HHS Secretary nominee): vaccine policy changes, FDA regulatory rollbacks, public health program modifications, anti-vaccine activism, and health agency restructuring
- Federal agencies and key heads: DOJ, FBI, ICE, DHS, Department of Education, OPM, EPA (Lee Zeldin), Commerce, HHS - leadership changes, internal purges, prosecutions, rulemaking, enforcement priorities, whistleblower retaliation, and Schedule F implementations
- Senate dealings: controversial confirmation votes, ethics violations, procedural manipulation, party-line blocking of oversight measures, Supreme Court ethics obstruction, filibuster abuse, and conflicts of interest in voting patterns
- Federal workforce: mass layoffs, loyalty tests, civil service protections changes, union disputes, and OPM policy changes
- Budget conflicts: unauthorized fund withholding, grant/loan freezes, agency defunding, and Congressional appropriations disputes
- Surveillance and privacy: new or expanding federal surveillance programs, Palantir contracts, facial recognition use, court rulings, Fourth Amendment implications, or intelligence agency overreach
- Election-related: voting rights, ballot access changes, redistricting, election integrity claims, campaign finance violations, political violence, and state-level election interference
- Corporate accountability: unethical lobbying, dark money networks, government-corporate entanglements, PAC funding revelations, and conflicts of interest (especially among tech, defense, and energy sectors)
- Civil rights & DEI: program elimination, office closures, discrimination enforcement changes, LGBTQ+ rollbacks, and religious liberty conflicts
- Court rulings: especially those with significant implications for civil liberties, executive power, election law, or federal workforce protections — include dissent summaries and legal expert analysis where available
- Project 2025: specific policy implementations, Christian nationalist agenda items, executive power expansion, and Congressional oversight bypassing

Focus on verifiable reporting from reputable sources (e.g., AP, Reuters, ProPublica, The Guardian, Washington Post, New York Times, NPR, Politico, Government Executive, Federal News Network). Include major unverified but widely reported claims — clearly flagged as unverified.

Only return new developments from the past 24 hours. Do not repeat prior stories or re-report stale coverage. Avoid duplicates.

Return ONLY a valid JSON array with this exact structure:`;
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
    
    // Clean quotes in entries before saving
    entries.forEach(entry => {
        if (entry.description) {
            entry.description = entry.description.replace(/"/g, '\\"');
        }
        if (entry.title) {
            entry.title = entry.title.replace(/"/g, '\\"');
        }
        // Auto-verify reputable sources
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
