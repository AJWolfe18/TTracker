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
    console.log(`\n⚠️  [TEST] Removed ${duplicates.length} duplicate entries:`);
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

// Date range helper (TEST: shorter window to avoid too much API usage)
function getDateRangePrompt() {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 1); // TEST: 1-day window vs 3-day in production
  
  return `between ${startDate.toISOString().split('T')[0]} and ${endDate.toISOString().split('T')[0]}`;
}

// Entry validation
function validateEntry(entry) {
  const required = ['date', 'actor', 'category', 'title', 'description', 'source_url'];
  const missing = required.filter(field => !entry[field]);
  
  if (missing.length > 0) {
    console.log(`  ⚠️  [TEST] Entry missing required fields: ${missing.join(', ')}`);
    return false;
  }
  
  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
    console.log(`  ⚠️  [TEST] Invalid date format: ${entry.date}`);
    return false;
  }
  
  // Validate URL
  try {
    new URL(entry.source_url);
  } catch {
    console.log(`  ⚠️  [TEST] Invalid URL: ${entry.source_url}`);
    return false;
  }
  
  return true;
}

console.log('=== 🧪 TEST MODE: REAL NEWS POLITICAL TRACKER ===');
console.log('🧪 This is the TEST version - safe for experimentation');
console.log('Date:', new Date().toDateString());
console.log('Time:', new Date().toISOString());

// TEST: Smaller subset of prompts to save API costs during testing
const dateRange = getDateRangePrompt();
const TEST_REAL_NEWS_PROMPTS = {
  'Trump & Family': `[TEST] Search for recent news involving Donald Trump or Trump family members ${dateRange}. Focus on:
- NEW legal proceedings, court cases, or rulings
- RECENT business dealings and financial disclosures  
- LATEST campaign activities and political statements

IMPORTANT: Only include news from the specified date range. This is a TEST run.

Find credible news sources and return specific, factual developments with proper citations.`,

  'Elon Musk & DOGE': `[TEST] Search for recent news about Elon Musk's role in government or DOGE ${dateRange}. Focus on:
- NEW DOGE operations and government efficiency recommendations
- RECENT government contracts involving his companies
- LATEST X/Twitter platform policy changes

IMPORTANT: Only include unique stories from the date range. This is a TEST run.

Find current news with credible sources and citations.`
};

// Updated reputable news sources for verification (same as production)
const REPUTABLE_SOURCES = [
  'reuters.com', 'ap.org', 'apnews.com', 'wsj.com', 'nytimes.com', 'washingtonpost.com', 'usatoday.com',
  'bbc.com', 'bbc.co.uk', 'guardian.com', 'theguardian.com', 'economist.com', 'ft.com',
  'cnn.com', 'foxnews.com', 'foxbusiness.com', 'nbcnews.com', 'abcnews.go.com', 'cbsnews.com', 'msnbc.com',
  'npr.org', 'pbs.org', 'politico.com', 'thehill.com', 'axios.com', 'realclearpolitics.com', 
  'washingtonexaminer.com', 'nationalreview.com', 'bloomberg.com', 'cnbc.com', 'marketwatch.com', 
  'forbes.com', 'businessinsider.com', 'propublica.org', 'courthousenews.com', 'lawfaremedia.org', 
  'lawfareblog.com', '.gov', 'supremecourt.gov', 'justice.gov', 'whitehouse.gov', 'congress.gov', 
  'senate.gov', 'house.gov', 'state.gov', 'defense.gov', 'treasury.gov', 'fbi.gov', 'cia.gov', 
  'dhs.gov', 'ed.gov', 'fec.gov', 'sec.gov'
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

  console.log('\n=== 🧪 TEST: SEARCHING FOR REAL POLITICAL NEWS ===');
  console.log(`📅 Date range: ${dateRange}`);
  console.log('🔬 Using reduced prompt set to save API costs during testing\n');
  
  const allEntries = [];
  const promises = Object.entries(TEST_REAL_NEWS_PROMPTS).map(async ([category, prompt]) => {
    try {
      console.log(`🔍 [TEST] Searching real news for: ${category}`);
      
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
  "category": "${category.includes('Trump') ? 'Financial' : category.includes('Musk') ? 'Platform Manipulation' : 'Government Oversight'}",
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
      
      console.log(`  [TEST] Response length: ${content.length}`);
      console.log(`  [TEST] Tokens used: ${data.usage?.total_tokens || 'unknown'}`);

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
        console.log(`  ❌ [TEST] Could not parse JSON response`);
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

      console.log(`  ✅ [TEST] Found ${processedEntries.length} valid entries`);
      
      if (processedEntries.length > 0) {
        processedEntries.forEach((entry, index) => {
          console.log(`    ${index + 1}. [${entry.severity.toUpperCase()}] ${entry.actor}: ${entry.title.substring(0, 60)}...`);
        });
      }

      return processedEntries;

    } catch (error) {
      console.error(`  ❌ [TEST] Error searching ${category}:`, error.message);
      return [];
    }
  });

  const results = await Promise.all(promises);
  results.forEach(entries => allEntries.push(...entries));

  console.log(`\n=== 🧪 TEST: TOTAL VALID ENTRIES FOUND: ${allEntries.length} ===`);
  
  return allEntries;
}

async function saveToFile(entries) {
  const today = new Date().toISOString().split('T')[0];
  const filename = `test-news-tracker-${today}.json`; // TEST: different filename
  const masterFilename = 'master-tracker-log.json';
  const publicDir = 'public';
  const publicMasterFile = path.join(publicDir, masterFilename);

  try {
    // Load existing master log
    console.log('\n📁 [TEST] Loading existing master log...');
    let masterLog = [];
    try {
      const masterData = await fs.readFile(masterFilename, 'utf8');
      masterLog = JSON.parse(masterData);
      console.log(`  [TEST] Found ${masterLog.length} existing entries`);
    } catch (error) {
      console.log('  [TEST] No existing master log found, creating new one');
    }

    console.log(`\n🔍 [TEST] DEBUG: About to check ${entries.length} new entries for duplicates`);
    
    // Remove duplicates before saving
    const uniqueEntries = removeDuplicates(entries, masterLog);
    
    console.log(`📊 [TEST] DEBUG: After duplicate removal:`);
    console.log(`  - Started with: ${entries.length} new entries`);
    console.log(`  - Unique entries: ${uniqueEntries.length}`);
    console.log(`  - Duplicates removed: ${entries.length - uniqueEntries.length}`);
    
    if (uniqueEntries.length === 0) {
      console.log('\n⚠️  [TEST] All entries were duplicates - no new data to save');
      return;
    }

    // Save daily file with unique entries only
    await fs.writeFile(filename, JSON.stringify(uniqueEntries, null, 2));
    console.log(`\n✅ [TEST] Saved ${uniqueEntries.length} unique entries to ${filename}`);

    // IMPORTANT: Only add unique entries to master log
    console.log(`\n🔍 [TEST] DEBUG: Master log before adding new entries: ${masterLog.length}`);
    masterLog.push(...uniqueEntries);
    console.log(`📊 [TEST] DEBUG: Master log after adding new entries: ${masterLog.length}`);

    // Sort master log by date (newest first)
    masterLog.sort((a, b) => {
      const dateCompare = b.date.localeCompare(a.date);
      if (dateCompare !== 0) return dateCompare;
      return b.added_at.localeCompare(a.added_at);
    });

    // Save updated master log
    await fs.writeFile(masterFilename, JSON.stringify(masterLog, null, 2));
    console.log(`\n📊 [TEST] DEBUG: Saved master log with ${masterLog.length} total entries`);

    // Ensure public directory exists and copy master log
    try {
      await fs.mkdir(publicDir, { recursive: true });
      await fs.writeFile(publicMasterFile, JSON.stringify(masterLog, null, 2));
      console.log('✅ [TEST] Updated public master log for website');
      
      // Verify the public file
      const publicData = await fs.readFile(publicMasterFile, 'utf8');
      const publicEntries = JSON.parse(publicData);
      console.log(`📊 [TEST] DEBUG: Public file now has ${publicEntries.length} entries`);
      
      if (publicEntries.length !== masterLog.length) {
        console.error('❌ [TEST] WARNING: Public file entry count does not match master log!');
      } else {
        console.log('✅ [TEST] SUCCESS: Public file sync working correctly!');
      }
    } catch (publicError) {
      console.error('❌ [TEST] Error updating public master log:', publicError.message);
    }

    console.log(`\n📊 [TEST] Database Summary:`);
    console.log(`  - New unique entries added: ${uniqueEntries.length}`);
    console.log(`  - Total entries in database: ${masterLog.length}`);

  } catch (error) {
    console.error('❌ [TEST] Error saving files:', error.message);
    throw error;
  }
}

async function main() {
  try {
    console.log('🚀 [TEST] Starting Test Mode Real News Political Tracker...');
    console.log('🔍 [TEST] Using OpenAI Responses API with web search capabilities');
    console.log('🧪 [TEST] Reduced API calls to save costs during testing\n');
    
    const entries = await fetchRealPoliticalNews();
    
    if (entries.length === 0) {
      console.log('\nℹ️  [TEST] No relevant political news found in current search');
      console.log('[TEST] This is normal - not every search yields new developments');
      return;
    }

    await saveToFile(entries);

    // Enhanced summary
    console.log('\n=== 🧪 TEST MODE TRACKING SUMMARY ===');
    console.log('📅 Date:', new Date().toDateString());
    console.log('🕐 Time:', new Date().toLocaleTimeString());
    console.log('📰 New entries found:', entries.length);
    
    // Category breakdown
    const categoryCount = {};
    entries.forEach(e => {
      categoryCount[e.category] = (categoryCount[e.category] || 0) + 1;
    });
    
    console.log('\n📊 [TEST] By Category:');
    Object.entries(categoryCount).forEach(([cat, count]) => {
      console.log(`  - ${cat}: ${count}`);
    });
    
    // Severity breakdown
    const highSeverity = entries.filter(e => e.severity === 'high').length;
    const mediumSeverity = entries.filter(e => e.severity === 'medium').length;
    const lowSeverity = entries.filter(e => e.severity === 'low').length;
    
    console.log(`\n⚠️  [TEST] Severity: ${highSeverity} high, ${mediumSeverity} medium, ${lowSeverity} low`);
    
    // Verification status
    const verified = entries.filter(e => e.verified).length;
    console.log(`✓ [TEST] Verified sources: ${verified} of ${entries.length} (${Math.round(verified/entries.length*100)}%)`);
    
    console.log('\n🧪 TEST MODE COMPLETED SUCCESSFULLY');
    console.log('===================================\n');

  } catch (error) {
    console.error('❌ [TEST] Error in main execution:', error.message);
    console.error('[TEST] Stack trace:', error.stack);
    
    // Don't throw error - let GitHub Actions continue
    console.log('[TEST] Script completed with errors but continuing...');
  }
}

// Check if this is being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { fetchRealPoliticalNews, saveToFile, main };
