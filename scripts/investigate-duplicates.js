// investigate-duplicates.js
// Script to investigate why certain headlines are being marked as duplicates
import { supabaseRequest } from '../config/supabase-config-node.js';

// Load dotenv for local testing
try {
    const dotenv = await import('dotenv');
    const { fileURLToPath } = await import('url');
    const { dirname, join } = await import('path');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    dotenv.config({ path: join(__dirname, '..', '.env') });
} catch (e) {
    // dotenv not available, that's okay in production
}

console.log('🔍 DUPLICATE INVESTIGATION TOOL');
console.log('================================\n');

// Headlines reported as duplicates but not found
const searchTerms = [
    { title: 'Federal Court Rules on Redistricting Controversy', partial: 'Redistricting Controvers' },
    { title: 'Supreme Court Accepts Case on Voting Rights', partial: 'Supreme Court' },
    { title: 'FEC Investigates Possible Campaign Finance Violati', partial: 'FEC Investigates' },
    { title: 'New Report on Dark Money in Political Campaigns Re', partial: 'Dark Money' },
    { title: 'Investigation Launched Into Defense Contracting Co', partial: 'Defense Contracting' },
    { title: 'SEC Announces New Guidelines for Financial Disclos', partial: 'SEC Announces' }
];

async function searchForHeadline(searchInfo) {
    console.log(`\n📰 Searching for: "${searchInfo.title}"`);
    console.log('   Partial search: "' + searchInfo.partial + '"');
    
    try {
        // Method 1: Search by partial title (case-insensitive)
        const partialSearch = await supabaseRequest(
            `political_entries?title=ilike.%25${encodeURIComponent(searchInfo.partial)}%25&order=created_at.desc&limit=5`
        );
        
        if (partialSearch && partialSearch.length > 0) {
            console.log(`   ✅ Found ${partialSearch.length} entries with similar titles:`);
            partialSearch.forEach((entry, i) => {
                console.log(`      ${i+1}. [${entry.date}] "${entry.title}"`);
                console.log(`         ID: ${entry.id}, Actor: ${entry.actor}`);
                console.log(`         URL: ${entry.source_url}`);
            });
        } else {
            console.log('   ❌ No entries found with partial match');
        }
        
        // Method 2: Search by key words
        const keywords = searchInfo.partial.split(' ').filter(w => w.length > 3);
        console.log(`\n   🔍 Searching by keywords: ${keywords.join(', ')}`);
        
        for (const keyword of keywords) {
            const keywordSearch = await supabaseRequest(
                `political_entries?title=ilike.%25${encodeURIComponent(keyword)}%25&order=created_at.desc&limit=3`
            );
            
            if (keywordSearch && keywordSearch.length > 0) {
                console.log(`      Found ${keywordSearch.length} entries containing "${keyword}":`);
                keywordSearch.forEach(entry => {
                    console.log(`         - [${entry.date}] "${entry.title.substring(0, 60)}..."`);
                });
            }
        }
        
        // Method 3: Check recent entries (last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const dateString = sevenDaysAgo.toISOString().split('T')[0];
        
        console.log(`\n   📅 Checking entries since ${dateString}...`);
        const recentEntries = await supabaseRequest(
            `political_entries?date=gte.${dateString}&select=id,title,date,actor&order=date.desc`
        );
        
        if (recentEntries && recentEntries.length > 0) {
            // Look for similar titles using normalized comparison
            const normalizedSearch = searchInfo.title.toLowerCase().replace(/[^a-z0-9\s]/g, '');
            const searchWords = normalizedSearch.split(' ').filter(w => w.length > 3);
            
            const possibleMatches = recentEntries.filter(entry => {
                const normalizedTitle = entry.title.toLowerCase().replace(/[^a-z0-9\s]/g, '');
                const titleWords = normalizedTitle.split(' ').filter(w => w.length > 3);
                
                // Count matching words
                const matchingWords = searchWords.filter(w => titleWords.includes(w));
                const matchRatio = matchingWords.length / Math.max(searchWords.length, titleWords.length);
                
                return matchRatio > 0.5; // 50% word match
            });
            
            if (possibleMatches.length > 0) {
                console.log(`   🎯 Possible matches based on word similarity:`);
                possibleMatches.forEach(entry => {
                    console.log(`      - [${entry.date}] ID:${entry.id} "${entry.title}"`);
                });
            } else {
                console.log(`   ⚠️ No similar titles found in recent entries`);
            }
            
            console.log(`   📊 Total recent entries: ${recentEntries.length}`);
        }
        
    } catch (error) {
        console.error(`   ❌ Error searching: ${error.message}`);
    }
}

async function checkDuplicateDetectionLogic() {
    console.log('\n\n🔬 TESTING DUPLICATE DETECTION LOGIC');
    console.log('=====================================\n');
    
    // Get today's date
    const today = new Date().toISOString().split('T')[0];
    
    console.log('Testing the same queries used by isDuplicate() function:\n');
    
    // Test case 1: URL duplicate check
    const testUrl = 'https://www.nytimes.com/2025/01/01/test-article';
    console.log(`1. Testing URL duplicate check for: ${testUrl}`);
    const urlCheck = await supabaseRequest(
        `political_entries?source_url=eq.${encodeURIComponent(testUrl)}&limit=1`
    );
    console.log(`   Result: ${urlCheck && urlCheck.length > 0 ? 'Would be duplicate' : 'Not a duplicate'}`);
    
    // Test case 2: Similar title on same date
    const testTitle = 'Supreme Court';
    console.log(`\n2. Testing similar title check for: "${testTitle}" on ${today}`);
    const titleCheck = await supabaseRequest(
        `political_entries?title=ilike.%25${encodeURIComponent(testTitle)}%25&date=eq.${today}&limit=1`
    );
    console.log(`   Result: ${titleCheck && titleCheck.length > 0 ? 'Would be duplicate' : 'Not a duplicate'}`);
    
    // Test case 3: Get recent entries for word matching
    console.log(`\n3. Testing word-matching logic (fetches last 50 entries from today)`);
    const recentForMatching = await supabaseRequest(
        `political_entries?date=eq.${today}&select=title,actor&limit=50&order=created_at.desc`
    );
    console.log(`   Fetched ${recentForMatching ? recentForMatching.length : 0} entries for comparison`);
    
    if (recentForMatching && recentForMatching.length > 0) {
        console.log('   Sample entries that would be compared:');
        recentForMatching.slice(0, 3).forEach(entry => {
            console.log(`      - "${entry.title.substring(0, 60)}..."`);
        });
    }
}

async function main() {
    // Search for each missing headline
    for (const searchTerm of searchTerms) {
        await searchForHeadline(searchTerm);
        console.log('\n' + '='.repeat(80));
    }
    
    // Test the duplicate detection logic
    await checkDuplicateDetectionLogic();
    
    console.log('\n\n📋 INVESTIGATION SUMMARY');
    console.log('========================');
    console.log('The duplicate detection may be too aggressive.');
    console.log('It checks for:');
    console.log('1. Exact URL matches');
    console.log('2. Similar titles on the same date (using ILIKE with partial match)');
    console.log('3. Word-based similarity (75% threshold) for entries on the same date');
    console.log('\nPossible issues:');
    console.log('- The word similarity check might match unrelated articles');
    console.log('- The "similar title on same date" check uses a very broad ILIKE query');
    console.log('- Normalized headline comparison removes too much context');
}

// Run the investigation
main().catch(console.error);
