import fs from 'fs/promises';
import fetch from 'node-fetch';

console.log('🔍 SMART DATE AUDIT - CHECKING REAL PUBLICATION DATES');
console.log('=====================================================\n');

// Helper function to extract dates from article HTML
function extractDateFromHTML(html, url) {
  const datePatterns = [
    // JSON-LD structured data
    /"datePublished"\s*:\s*"([^"]+)"/i,
    /"published_time"\s*:\s*"([^"]+)"/i,
    
    // Meta tags
    /<meta[^>]+property="article:published_time"[^>]+content="([^"]+)"/i,
    /<meta[^>]+name="publish-date"[^>]+content="([^"]+)"/i,
    /<meta[^>]+name="date"[^>]+content="([^"]+)"/i,
    /<meta[^>]+name="article:published"[^>]+content="([^"]+)"/i,
    
    // Time tags
    /<time[^>]+datetime="([^"]+)"/i,
    /<time[^>]+pubdate[^>]*>([^<]+)</i,
    
    // Common date formats in text
    /Published[:\s]+([A-Za-z]+ \d{1,2},? \d{4})/i,
    /(\d{1,2}\/\d{1,2}\/\d{4})/,
    /(\d{4}-\d{2}-\d{2})/,
    
    // Site-specific patterns
    /teslarati\.com.*(\d{4}\/\d{2}\/\d{2})/i,  // Teslarati URL structure
  ];

  for (const pattern of datePatterns) {
    const match = html.match(pattern);
    if (match) {
      try {
        const dateStr = match[1];
        const date = new Date(dateStr);
        if (!isNaN(date.getTime()) && date.getFullYear() > 2000 && date.getFullYear() < 2030) {
          return date;
        }
      } catch (e) {
        continue;
      }
    }
  }
  
  // Try to extract from URL structure (many news sites have dates in URLs)
  const urlDateMatch = url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
  if (urlDateMatch) {
    try {
      const [, year, month, day] = urlDateMatch;
      const date = new Date(`${year}-${month}-${day}`);
      if (!isNaN(date.getTime())) {
        return date;
      }
    } catch (e) {
      // Continue
    }
  }
  
  return null;
}

// Check if an entry has a suspicious date (likely fake)
function isSuspiciousDate(entry, todayStr) {
  const entryDateStr = entry.date;
  const addedDate = new Date(entry.added_at);
  const entryDate = new Date(entryDateStr);
  
  // Red flags:
  // 1. Date is exactly today or yesterday (very suspicious for news)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  
  if (entryDateStr === todayStr || entryDateStr === yesterdayStr) {
    return true;
  }
  
  // 2. Date is exactly when it was added (within same day)
  const addedDateStr = addedDate.toISOString().split('T')[0];
  if (entryDateStr === addedDateStr) {
    return true;
  }
  
  // 3. Date follows a pattern of being very recent relative to when added
  const daysDiff = Math.abs((entryDate - addedDate) / (1000 * 60 * 60 * 24));
  if (daysDiff < 1) {
    return true;
  }
  
  return false;
}

async function checkRealPublicationDate(entry) {
  try {
    console.log(`  📄 Fetching: ${entry.source_url}`);
    
    const response = await fetch(entry.source_url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000
    });
    
    if (!response.ok) {
      return { error: `HTTP ${response.status}` };
    }
    
    const html = await response.text();
    const realDate = extractDateFromHTML(html, entry.source_url);
    
    if (realDate) {
      const entryDate = new Date(entry.date);
      const daysDiff = Math.abs((realDate - entryDate) / (1000 * 60 * 60 * 24));
      
      return {
        realDate: realDate.toISOString().split('T')[0],
        claimedDate: entry.date,
        daysDifference: Math.round(daysDiff),
        isWrong: daysDiff > 7, // More than a week difference
        realYear: realDate.getFullYear()
      };
    }
    
    return { error: 'No date found in article' };
    
  } catch (error) {
    return { error: error.message };
  }
}

async function smartDateAudit() {
  try {
    // Load the master log
    console.log('📁 Loading master-tracker-log.json...');
    const masterData = await fs.readFile('master-tracker-log.json', 'utf8');
    const entries = JSON.parse(masterData);
    console.log(`Found ${entries.length} total entries\n`);

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    // Find entries with suspicious dates
    console.log('🔍 Phase 1: Finding entries with suspicious dates...');
    const suspiciousEntries = entries.filter(entry => isSuspiciousDate(entry, todayStr));
    
    console.log(`Found ${suspiciousEntries.length} entries with suspicious dates\n`);
    
    if (suspiciousEntries.length === 0) {
      console.log('✅ No suspicious dates found! All entries look good.');
      return;
    }
    
    // Check real publication dates for suspicious entries
    console.log('🌐 Phase 2: Checking real publication dates...');
    const results = [];
    
    for (let i = 0; i < Math.min(suspiciousEntries.length, 20); i++) { // Limit to 20 to avoid overwhelming
      const entry = suspiciousEntries[i];
      console.log(`\n${i + 1}/${Math.min(suspiciousEntries.length, 20)}: Checking "${entry.title.substring(0, 50)}..."`);
      
      const result = await checkRealPublicationDate(entry);
      results.push({
        entry,
        ...result
      });
      
      // Small delay to be nice to servers
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Analyze results
    console.log('\n📊 SMART AUDIT RESULTS:');
    console.log('========================');
    
    const wrongDates = results.filter(r => r.isWrong);
    const oldArticles = results.filter(r => r.realYear && r.realYear < 2025);
    const errors = results.filter(r => r.error);
    
    console.log(`✅ Entries checked: ${results.length}`);
    console.log(`❌ Wrong dates found: ${wrongDates.length}`);
    console.log(`📰 Old articles (pre-2025): ${oldArticles.length}`);
    console.log(`⚠️  Could not verify: ${errors.length}\n`);
    
    if (wrongDates.length > 0) {
      console.log('🚨 ENTRIES WITH WRONG DATES:');
      console.log('==============================');
      wrongDates.forEach((result, index) => {
        console.log(`${index + 1}. "${result.entry.title}"`);
        console.log(`   Claimed date: ${result.claimedDate}`);
        console.log(`   Real date: ${result.realDate}`);
        console.log(`   Difference: ${result.daysDifference} days`);
        console.log(`   Source: ${result.entry.source_url}`);
        console.log('');
      });
    }
    
    if (oldArticles.length > 0) {
      console.log('📰 OLD ARTICLES FOUND:');
      console.log('=======================');
      oldArticles.forEach((result, index) => {
        console.log(`${index + 1}. "${result.entry.title}"`);
        console.log(`   Real publication: ${result.realDate} (${result.realYear})`);
        console.log(`   Tracker claimed: ${result.claimedDate}`);
        console.log(`   Source: ${result.entry.source_url}`);
        console.log('');
      });
    }
    
    // Create fix recommendations
    const entriesToRemove = [...new Set([...wrongDates, ...oldArticles])];
    
    if (entriesToRemove.length > 0) {
      console.log('💡 RECOMMENDATIONS:');
      console.log('====================');
      console.log(`Remove ${entriesToRemove.length} entries with incorrect dates`);
      console.log('Update AI prompts to better extract real publication dates');
      console.log('Add date validation to reject articles older than 1 week');
      
      // Create cleaned dataset
      const entryIdsToRemove = new Set(entriesToRemove.map(r => r.entry.id));
      const cleanedEntries = entries.filter(entry => !entryIdsToRemove.has(entry.id));
      
      await fs.writeFile('master-tracker-log.date-cleaned.json', JSON.stringify(cleanedEntries, null, 2));
      console.log(`\n✅ Created cleaned dataset with ${cleanedEntries.length} entries`);
      console.log('📁 Saved as: master-tracker-log.date-cleaned.json');
    }
    
  } catch (error) {
    console.error('❌ Error during smart audit:', error.message);
  }
}

smartDateAudit();
