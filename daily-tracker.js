import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';

// Simple ID generator - no dependencies needed
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

console.log('=== REAL NEWS POLITICAL TRACKER ===');
console.log('Date:', new Date().toDateString());
console.log('Time:', new Date().toISOString());

// Real news search prompts using the new Responses API
const REAL_NEWS_PROMPTS = {
  'Trump & Family': `Search for recent news involving Donald Trump or Trump family members from the past week. Focus on:
- Legal proceedings and court cases
- Business dealings and financial issues  
- Campaign activities and political statements
- Policy announcements or government actions
- Conflicts of interest or ethics concerns

Find credible news sources and return specific, factual developments with proper citations.`,

  'Elon Musk & DOGE': `Search for recent news about Elon Musk's role in government, DOGE (Department of Government Efficiency), or his political influence from the past 24-48 hours. Focus on:
- DOGE operations and government efficiency recommendations
- Government contracts involving his companies (Tesla, SpaceX, etc.)
- X/Twitter platform policy changes affecting political discourse
- Conflicts between business interests and government responsibilities
- Public statements on government policy

Find current news with credible sources and citations.`,

  'DOJ & Law Enforcement': `Search for recent developments involving the Department of Justice, FBI, or federal law enforcement from the past 24-48 hours. Focus on:
- New prosecutions or investigations
- Leadership changes or appointments
- Policy shifts in enforcement priorities
- Civil rights investigations or actions
- Political interference concerns
- Whistleblower reports

Find current news from credible legal and political sources.`,

  'Federal Agencies': `Search for recent news about federal agencies (ICE, DHS, Department of Education, EPA, etc.) from the past 24-48 hours. Focus on:
- Policy implementation changes
- Regulatory actions or rollbacks
- Leadership appointments or departures
- Budget or operational changes
- Congressional oversight issues
- Agency restructuring or closures

Find current developments from reliable government and news sources.`,

  'Courts & Legal': `Search for recent federal court rulings, Supreme Court developments, or major legal proceedings from the past 24-48 hours. Focus on:
- Supreme Court decisions or case acceptances
- Federal court rulings on political matters
- Legal challenges to government policies
- Civil rights or constitutional cases
- Appeals court decisions
- Legal expert analysis

Find current legal developments with proper case citations and sources.`,

  'Corporate & Financial': `Search for recent developments involving corporate influence, lobbying, campaign finance, or financial conflicts of interest from the past 24-48 hours. Focus on:
- Major corporate lobbying efforts
- Campaign finance violations or investigations
- PAC activities and dark money flows
- Government contracts and potential conflicts
- Corporate regulatory issues
- Financial disclosure problems

Find current financial and corporate accountability news from credible business and political sources.`
};

// Reputable news sources for verification
const REPUTABLE_SOURCES = [
  'reuters.com', 'ap.org', 'wsj.com', 'nytimes.com', 'washingtonpost.com',
  'politico.com', 'cnn.com', 'nbcnews.com', 'abcnews.go.com', 'cbsnews.com',
  'npr.org', 'pbs.org', 'bloomberg.com', 'axios.com', 'thehill.com',
  'propublica.org', 'courthousenews.com', 'lawfaremedia.org'
];

function isVerifiedSource(url) {
  try {
    const domain = new URL(url).hostname.toLowerCase();
    return REPUTABLE_SOURCES.some(source => domain.includes(source));
  } catch {
    return false;
  }
}

function escapeQuotes(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/"/g, '\\"').replace(/'/g, "\\'");
}

// Severity assessment based on content
function assessSeverity(title, description) {
  const content = `${title} ${description}`.toLowerCase();
  
  // High severity keywords
  const highSeverity = [
    'arrest', 'indictment', 'conviction', 'felony', 'fraud', 'corruption',
    'constitutional crisis', 'impeachment', 'treason', 'sedition',
    'emergency', 'shutdown', 'crisis', 'violation', 'breach'
  ];
  
  // Medium severity keywords  
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

async function fetchRealPoliticalNews() {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('OpenAI API key not found in environment variables');
  }

  console.log('=== SEARCHING FOR REAL POLITICAL NEWS ===');
  
  const allEntries = [];
  const promises = Object.entries(REAL_NEWS_PROMPTS).map(async ([category, prompt]) => {
    try {
      console.log(`Searching real news for: ${category}`);
      
      // Use the new Responses API with web search
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
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

Return a JSON array of relevant political developments found. Only include real news from credible sources.`,
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
      
      console.log(`${category} - Response length: ${content.length}`);
      console.log(`${category} - Tokens used: ${data.usage?.total_tokens || 'unknown'}`);
      console.log(`${category} - Content preview:`, content.substring(0, 200));

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
        console.log(`${category} - Could not parse JSON response`);
        console.log(`${category} - Raw content:`, content.substring(0, 500));
        entries = [];
      }

      if (!Array.isArray(entries)) {
        entries = entries ? [entries] : [];
      }

      // Process and enhance entries
      const processedEntries = entries.map(entry => {
        if (!entry || typeof entry !== 'object') return null;
        
        return {
          ...entry,
          id: generateId(),
          added_at: new Date().toISOString(),
          verified: entry.source_url ? isVerifiedSource(entry.source_url) : false,
          title: escapeQuotes(entry.title || ''),
          description: escapeQuotes(entry.description || ''),
          actor: escapeQuotes(entry.actor || ''),
          severity: entry.severity || assessSeverity(entry.title, entry.description),
          date: entry.date || new Date().toISOString().split('T')[0]
        };
      }).filter(entry => entry !== null && entry.title && entry.description);

      console.log(`${category} - Found ${processedEntries.length} real news entries`);
      
      if (processedEntries.length > 0) {
        processedEntries.forEach((entry, index) => {
          console.log(`  ${index + 1}. [${entry.severity.toUpperCase()}] ${entry.actor}: ${entry.title}`);
        });
      }

      return processedEntries;

    } catch (error) {
      console.error(`Error searching ${category}:`, error.message);
      return [];
    }
  });

  const results = await Promise.all(promises);
  results.forEach(entries => allEntries.push(...entries));

  console.log(`=== TOTAL REAL NEWS ENTRIES FOUND: ${allEntries.length} ===`);
  
  return allEntries;
}

async function saveToFile(entries) {
  const today = new Date().toISOString().split('T')[0];
  const filename = `real-news-tracker-${today}.json`;
  const masterFilename = 'master-tracker-log.json';
  const publicDir = 'public';
  const publicMasterFile = path.join(publicDir, masterFilename);

  try {
    // Save daily file
    await fs.writeFile(filename, JSON.stringify(entries, null, 2));
    console.log(`Saving real news to file: ${filename}`);

    // Load existing master log
    console.log('Loading existing master log...');
    let masterLog = [];
    try {
      const masterData = await fs.readFile(masterFilename, 'utf8');
      masterLog = JSON.parse(masterData);
    } catch (error) {
      console.log('No existing master log found, creating new one');
    }

    // Add new entries to master log
    masterLog.push(...entries);

    // Save updated master log
    await fs.writeFile(masterFilename, JSON.stringify(masterLog, null, 2));

    // Ensure public directory exists and copy master log
    try {
      await fs.mkdir(publicDir, { recursive: true });
      await fs.writeFile(publicMasterFile, JSON.stringify(masterLog, null, 2));
      console.log('Updated public master log for website');
    } catch (publicError) {
      console.error('Error updating public master log:', publicError.message);
    }

    console.log(`Saved ${entries.length} real news entries to ${filename}`);
    console.log(`Master log now contains ${masterLog.length} total entries`);

  } catch (error) {
    console.error('Error saving files:', error.message);
    throw error;
  }
}

async function main() {
  try {
    console.log('🔍 Searching for real political news using OpenAI Responses API with web search...');
    
    const entries = await fetchRealPoliticalNews();
    
    if (entries.length === 0) {
      console.log('ℹ️  No relevant political news found in current search');
      console.log('This is normal - not every day has major political developments');
      return;
    }

    await saveToFile(entries);

    console.log('\n=== DAILY REAL NEWS SUMMARY ===');
    console.log('Date:', new Date().toDateString());
    console.log('Real news entries found:', entries.length);
    
    // Show summary by severity
    const highSeverity = entries.filter(e => e.severity === 'high').length;
    const mediumSeverity = entries.filter(e => e.severity === 'medium').length;
    const lowSeverity = entries.filter(e => e.severity === 'low').length;
    
    console.log(`Severity breakdown: ${highSeverity} high, ${mediumSeverity} medium, ${lowSeverity} low`);
    
    // Get total count from master log
    try {
      const masterData = await fs.readFile('master-tracker-log.json', 'utf8');
      const masterLog = JSON.parse(masterData);
      console.log('Total entries in database:', masterLog.length);
    } catch (error) {
      console.log('Could not read master log for total count');
    }
    
    console.log('Data file:', filename);
    console.log('================================');

  } catch (error) {
    console.error('Error in main execution:', error.message);
    console.error('Stack trace:', error.stack);
    
    // Don't throw error - let GitHub Actions continue
    console.log('Script completed with errors but continuing...');
  }
}

// Check if this is being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { fetchRealPoliticalNews, saveToFile, main };
