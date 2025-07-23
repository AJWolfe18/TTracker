import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';

// Simple ID generator - no dependencies needed
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Duplicate prevention functions
function removeDuplicates(newEntries, existingEntries) {
  const existingMap = new Map();
  
  // Create a map of existing entries for faster lookup
  existingEntries.forEach(entry => {
    // Use multiple keys for duplicate detection
    const titleKey = entry.title.toLowerCase().trim();
    const urlKey = entry.source_url;
    const dateActorKey = `${entry.date}-${entry.actor.toLowerCase()}`;
    
    existingMap.set(titleKey, entry);
    existingMap.set(urlKey, entry);
    existingMap.set(dateActorKey, entry);
  });
  
  const uniqueEntries = [];
  const duplicates = [];
  
  newEntries.forEach(entry => {
    const titleKey = entry.title.toLowerCase().trim();
    const urlKey = entry.source_url;
    const dateActorKey = `${entry.date}-${entry.actor.toLowerCase()}`;
    
    // Check if this is a duplicate
    if (existingMap.has(titleKey) || existingMap.has(urlKey) || 
        (existingMap.has(dateActorKey) && isSimilarTitle(entry.title, existingMap.get(dateActorKey).title))) {
      duplicates.push({
        title: entry.title,
        reason: existingMap.has(urlKey) ? 'duplicate URL' : 'duplicate title/content'
      });
    } else {
      uniqueEntries.push(entry);
      // Add to map to prevent duplicates within the same batch
      existingMap.set(titleKey, entry);
      existingMap.set(urlKey, entry);
      existingMap.set(dateActorKey, entry);
    }
  });
  
  if (duplicates.length > 0) {
    console.log(`\n⚠️  Removed ${duplicates.length} duplicate entries:`);
    duplicates.forEach(dup => console.log(`  - "${dup.title}" (${dup.reason})`));
  }
  
  return uniqueEntries;
}

// Helper function for fuzzy title matching
function isSimilarTitle(title1, title2) {
  const clean1 = title1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const clean2 = title2.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  // Check if one title contains most of the other
  const shorter = clean1.length < clean2.length ? clean1 : clean2;
  const longer = clean1.length < clean2.length ? clean2 : clean1;
  
  // If shorter title is contained in longer one, likely a duplicate
  if (longer.includes(shorter) && shorter.length > 20) {
    return true;
  }
  
  // Calculate similarity ratio
  const similarity = calculateSimilarity(clean1, clean2);
  return similarity > 0.85; // 85% similarity threshold
}

function calculateSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter.substr(i, 3))) matches++;
  }
  
  return matches / shorter.length;
}

// Date range helper
function getDateRangePrompt() {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 3); // 3-day window for fresher news
  
  return `between ${startDate.toISOString().split('T')[0]} and ${endDate.toISOString().split('T')[0]}`;
}

// Entry validation
function validateEntry(entry) {
  const required = ['date', 'actor', 'category', 'title', 'description', 'source_url'];
  const missing = required.filter(field => !entry[field]);
  
  if (missing.length > 0) {
    console.log(`  ⚠️  Entry missing required fields: ${missing.join(', ')}`);
    return false;
  }
  
  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
    console.log(`  ⚠️  Invalid date format: ${entry.date}`);
    return false;
  }
  
  // Validate URL
  try {
    new URL(entry.source_url);
  } catch {
    console.log(`  ⚠️  Invalid URL: ${entry.source_url}`);
    return false;
  }
  
  return true;
}

console.log('=== REAL NEWS POLITICAL TRACKER ===');
console.log('Date:', new Date().toDateString());
console.log('Time:', new Date().toISOString());

// Real news search prompts with improved date handling
const dateRange = getDateRangePrompt();
const REAL_NEWS_PROMPTS = {
  'Trump & Family': `Search for recent news involving Donald Trump or Trump family members ${dateRange}. Focus on:
- NEW legal proceedings, court cases, or rulings
- RECENT business dealings and financial disclosures  
- LATEST campaign activities and political statements
- CURRENT policy announcements or government actions
- EMERGING conflicts of interest or ethics concerns

IMPORTANT: Only include news from the specified date range. Each story must be unique - do not include multiple versions of the same story. Prioritize breaking news and new developments over ongoing stories.

CRITICAL: Extract the ACTUAL publication date from each article. Do NOT use today's date unless the article was actually published today. Find the real date when the article was published in the article's metadata or content. If the article is older than 1 week, DO NOT include it. The 'date' field must be the article's real publication date in YYYY-MM-DD format.

Find credible news sources and return specific, factual developments with proper citations.`,

  'Elon Musk & DOGE': `Search for recent news about Elon Musk's role in government, DOGE (Department of Government Efficiency), or his political influence ${dateRange}. Focus on:
- NEW DOGE operations and government efficiency recommendations
- RECENT government contracts involving his companies (Tesla, SpaceX, etc.)
- LATEST X/Twitter platform policy changes affecting political discourse
- EMERGING conflicts between business interests and government responsibilities
- CURRENT public statements on government policy

IMPORTANT: Only include unique stories from the date range. No duplicate coverage of the same event.

CRITICAL: Extract the ACTUAL publication date from each article. Do NOT use today's date unless the article was actually published today. Find the real date when the article was published in the article's metadata or content. If the article is older than 1 week, DO NOT include it. The 'date' field must be the article's real publication date in YYYY-MM-DD format.

Find current news with credible sources and citations.`,

  'DOJ & Law Enforcement': `Search for recent developments involving the Department of Justice, FBI, or federal law enforcement ${dateRange}. Focus on:
- NEW prosecutions or investigations announced
- RECENT leadership changes or appointments
- LATEST policy shifts in enforcement priorities
- CURRENT civil rights investigations or actions
- EMERGING political interference concerns
- NEW whistleblower reports

IMPORTANT: Only include developments from the specified dates. Each entry must be a unique story.

CRITICAL: Extract the ACTUAL publication date from each article. Do NOT use today's date unless the article was actually published today. Find the real date when the article was published in the article's metadata or content. If the article is older than 1 week, DO NOT include it. The 'date' field must be the article's real publication date in YYYY-MM-DD format.

Find current news from credible legal and political sources.`,

  'Federal Agencies': `Search for recent news about federal agencies (ICE, DHS, Department of Education, EPA, etc.) ${dateRange}. Focus on:
- NEW policy implementation changes
- RECENT regulatory actions or rollbacks
- LATEST leadership appointments or departures
- CURRENT budget or operational changes
- EMERGING congressional oversight issues
- NEW agency restructuring or closures

IMPORTANT: Focus on new developments only. No repeated coverage of ongoing situations.

CRITICAL: Extract the ACTUAL publication date from each article. Do NOT use today's date unless the article was actually published today. Find the real date when the article was published in the article's metadata or content. If the article is older than 1 week, DO NOT include it. The 'date' field must be the article's real publication date in YYYY-MM-DD format.

Find current developments from reliable government and news sources.`,

  'Courts & Legal': `Search for recent federal court rulings, Supreme Court developments, or major legal proceedings ${dateRange}. Focus on:
- NEW Supreme Court decisions or case acceptances
- RECENT federal court rulings on political matters
- LATEST legal challenges to government policies
- CURRENT civil rights or constitutional cases
- NEW appeals court decisions
- EMERGING legal expert analysis

IMPORTANT: Only include rulings and developments from the specified date range.

CRITICAL: Extract the ACTUAL publication date from each article. Do NOT use today's date unless the article was actually published today. Find the real date when the article was published in the article's metadata or content. If the article is older than 1 week, DO NOT include it. The 'date' field must be the article's real publication date in YYYY-MM-DD format.

Find current legal developments with proper case citations and sources.`,

  'Corporate & Financial': `Search for recent developments involving corporate influence, lobbying, campaign finance, or financial conflicts of interest ${dateRange}. Focus on:
- NEW major corporate lobbying efforts
- RECENT campaign finance violations or investigations
- LATEST PAC activities and dark money flows
- CURRENT government contracts and potential conflicts
- EMERGING corporate regulatory issues
- NEW financial disclosure problems

IMPORTANT: Each entry must be a unique development from the date range specified.

CRITICAL: Extract the ACTUAL publication date from each article. Do NOT use today's date unless the article was actually published today. Find the real date when the article was published in the article's metadata or content. If the article is older than 1 week, DO NOT include it. The 'date' field must be the article's real publication date in YYYY-MM-DD format.

Find current financial and corporate accountability news from credible business and political sources.`
};

// Updated reputable news sources for verification
const REPUTABLE_SOURCES = [
  // Wire Services & News Agencies
  'reuters.com', 
  'ap.org',
  'apnews.com',
  
  // Major Newspapers
  'wsj.com',           // Wall Street Journal
  'nytimes.com',       // New York Times
  'washingtonpost.com', // Washington Post
  'usatoday.com',      // USA Today
  
  // International News
  'bbc.com',           // BBC
  'bbc.co.uk',         // BBC UK domain
  'guardian.com',      // The Guardian
  'theguardian.com',   // The Guardian alternate
  'economist.com',     // The Economist
  'ft.com',            // Financial Times
  
  // Broadcast Networks
  'cnn.com',           // CNN
  'foxnews.com',       // Fox News (right-leaning)
  'foxbusiness.com',   // Fox Business (right-leaning)
  'nbcnews.com',       // NBC News
  'abcnews.go.com',    // ABC News
  'cbsnews.com',       // CBS News
  'msnbc.com',         // MSNBC
  
  // Public Media
  'npr.org',           // National Public Radio
  'pbs.org',           // Public Broadcasting Service
  
  // Political & Policy News
  'politico.com',      // Politico
  'thehill.com',       // The Hill
  'axios.com',         // Axios
  'realclearpolitics.com', // RealClearPolitics (center-right)
  'washingtonexaminer.com', // Washington Examiner (right-leaning)
  'nationalreview.com', // National Review (conservative)
  
  // Business & Financial
  'bloomberg.com',     // Bloomberg
  'cnbc.com',          // CNBC
  'marketwatch.com',   // MarketWatch
  'forbes.com',        // Forbes
  'businessinsider.com', // Business Insider
  
  // Investigative & Legal
  'propublica.org',    // ProPublica
  'courthousenews.com', // Courthouse News
  'lawfaremedia.org',  // Lawfare
  'lawfareblog.com',   // Lawfare Blog
  
  // Government Sources
  '.gov',              // All government domains
  'supremecourt.gov',  // Supreme Court
  'justice.gov',       // Department of Justice
  'whitehouse.gov',    // White House
  'congress.gov',      // Congress
  'senate.gov',        // Senate
  'house.gov',         // House of Representatives
  'state.gov',         // State Department
  'defense.gov',       // Department of Defense
  'treasury.gov',      // Treasury Department
  'fbi.gov',           // FBI
  'cia.gov',           // CIA
  'dhs.gov',           // Department of Homeland Security
  'ed.gov',            // Department of Education
  'fec.gov',           // Federal Election Commission
  'sec.gov',           // Securities and Exchange Commission
];

// Enhanced verification function with better .gov handling
function isVerifiedSource(url) {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname.toLowerCase();
    
    // Special handling for .gov domains
    if (domain.endsWith('.gov')) {
      return true;
    }
    
    // Check against the reputable sources list
    return REPUTABLE_SOURCES.some(source => {
      // Handle .gov as special case (already checked above)
      if (source === '.gov') return false;
      
      // For other sources, check if domain includes the source
      return domain.includes(source) || domain.endsWith(source);
    });
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

  console.log('\n=== SEARCHING FOR REAL POLITICAL NEWS ===');
  console.log(`📅 Date range: ${dateRange}\n`);
  
  const allEntries = [];
  const promises = Object.entries(REAL_NEWS_PROMPTS).map(async ([category, prompt]) => {
    try {
      console.log(`🔍 Searching real news for: ${category}`);
      
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

Return a JSON array of relevant political developments found. Only include real news from credible sources. Each entry must be unique - no duplicates.`,
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
      
      console.log(`  Response length: ${content.length}`);
      console.log(`  Tokens used: ${data.usage?.total_tokens || 'unknown'}`);

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
        console.log(`  ❌ Could not parse JSON response`);
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
      }).filter(entry => entry !== null && validateEntry(entry));

      console.log(`  ✅ Found ${processedEntries.length} valid entries`);
      
      if (processedEntries.length > 0) {
        processedEntries.forEach((entry, index) => {
          console.log(`    ${index + 1}. [${entry.severity.toUpperCase()}] ${entry.actor}: ${entry.title.substring(0, 60)}...`);
        });
      }

      return processedEntries;

    } catch (error) {
      console.error(`  ❌ Error searching ${category}:`, error.message);
      return [];
    }
  });

  const results = await Promise.all(promises);
  results.forEach(entries => allEntries.push(...entries));

  console.log(`\n=== TOTAL VALID ENTRIES FOUND: ${allEntries.length} ===`);
  
  return allEntries;
}

// Add this debugging version to temporarily replace your saveToFile function

async function saveToFile(entries) {
  const today = new Date().toISOString().split('T')[0];
  const filename = `real-news-tracker-${today}.json`;
  const masterFilename = 'master-tracker-log.json';
  const publicDir = 'public';
  const publicMasterFile = path.join(publicDir, masterFilename);

  try {
    // Load existing master log
    console.log('\n📁 Loading existing master log...');
    let masterLog = [];
    try {
      const masterData = await fs.readFile(masterFilename, 'utf8');
      masterLog = JSON.parse(masterData);
      console.log(`  Found ${masterLog.length} existing entries`);
    } catch (error) {
      console.log('  No existing master log found, creating new one');
    }

    console.log(`\n🔍 DEBUG: About to check ${entries.length} new entries for duplicates`);
    
    // Remove duplicates before saving
    const uniqueEntries = removeDuplicates(entries, masterLog);
    
    console.log(`📊 DEBUG: After duplicate removal:`);
    console.log(`  - Started with: ${entries.length} new entries`);
    console.log(`  - Unique entries: ${uniqueEntries.length}`);
    console.log(`  - Duplicates removed: ${entries.length - uniqueEntries.length}`);
    
    if (uniqueEntries.length === 0) {
      console.log('\n⚠️  All entries were duplicates - no new data to save');
      return;
    }

    // Save daily file with unique entries only
    await fs.writeFile(filename, JSON.stringify(uniqueEntries, null, 2));
    console.log(`\n✅ Saved ${uniqueEntries.length} unique entries to ${filename}`);

    // IMPORTANT: Only add unique entries to master log
    console.log(`\n🔍 DEBUG: Master log before adding new entries: ${masterLog.length}`);
    masterLog.push(...uniqueEntries);
    console.log(`📊 DEBUG: Master log after adding new entries: ${masterLog.length}`);
    console.log(`📊 DEBUG: Should have added ${uniqueEntries.length} entries`);
    console.log(`📊 DEBUG: Math check: ${masterLog.length} should equal ${masterLog.length - uniqueEntries.length} + ${uniqueEntries.length}`);

    // Sort master log by date (newest first)
    masterLog.sort((a, b) => {
      const dateCompare = b.date.localeCompare(a.date);
      if (dateCompare !== 0) return dateCompare;
      return b.added_at.localeCompare(a.added_at);
    });

    // Save updated master log
    await fs.writeFile(masterFilename, JSON.stringify(masterLog, null, 2));
    console.log(`\n📊 DEBUG: Saved master log with ${masterLog.length} total entries`);

    // Ensure public directory exists and copy master log
    try {
      await fs.mkdir(publicDir, { recursive: true });
      await fs.writeFile(publicMasterFile, JSON.stringify(masterLog, null, 2));
      console.log('✅ Updated public master log for website');
      
      // Verify the public file
      const publicData = await fs.readFile(publicMasterFile, 'utf8');
      const publicEntries = JSON.parse(publicData);
      console.log(`📊 DEBUG: Public file now has ${publicEntries.length} entries`);
      
      if (publicEntries.length !== masterLog.length) {
        console.error('❌ WARNING: Public file entry count does not match master log!');
      }
    } catch (publicError) {
      console.error('❌ Error updating public master log:', publicError.message);
    }

    console.log(`\n📊 Database Summary:`);
    console.log(`  - New unique entries added: ${uniqueEntries.length}`);
    console.log(`  - Total entries in database: ${masterLog.length}`);

  } catch (error) {
    console.error('❌ Error saving files:', error.message);
    throw error;
  }
}

async function main() {
  try {
    console.log('🚀 Starting Real News Political Tracker...');
    console.log('🔍 Using OpenAI Responses API with web search capabilities\n');
    
    const entries = await fetchRealPoliticalNews();
    
    if (entries.length === 0) {
      console.log('\nℹ️  No relevant political news found in current search');
      console.log('This is normal - not every search yields new developments');
      return;
    }

    await saveToFile(entries);

    // Enhanced summary
    console.log('\n=== DAILY TRACKING SUMMARY ===');
    console.log('📅 Date:', new Date().toDateString());
    console.log('🕐 Time:', new Date().toLocaleTimeString());
    console.log('📰 New entries found:', entries.length);
    
    // Category breakdown
    const categoryCount = {};
    entries.forEach(e => {
      categoryCount[e.category] = (categoryCount[e.category] || 0) + 1;
    });
    
    console.log('\n📊 By Category:');
    Object.entries(categoryCount).forEach(([cat, count]) => {
      console.log(`  - ${cat}: ${count}`);
    });
    
    // Severity breakdown
    const highSeverity = entries.filter(e => e.severity === 'high').length;
    const mediumSeverity = entries.filter(e => e.severity === 'medium').length;
    const lowSeverity = entries.filter(e => e.severity === 'low').length;
    
    console.log(`\n⚠️  Severity: ${highSeverity} high, ${mediumSeverity} medium, ${lowSeverity} low`);
    
    // Verification status
    const verified = entries.filter(e => e.verified).length;
    console.log(`✓ Verified sources: ${verified} of ${entries.length} (${Math.round(verified/entries.length*100)}%)`);
    
    // Get total count from master log
    try {
      const masterData = await fs.readFile('master-tracker-log.json', 'utf8');
      const masterLog = JSON.parse(masterData);
      console.log(`\n📈 Total entries in database: ${masterLog.length}`);
    } catch (error) {
      console.log('\n❌ Could not read master log for total count');
    }
    
    console.log('================================\n');

  } catch (error) {
    console.error('❌ Error in main execution:', error.message);
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
