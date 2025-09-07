// daily-tracker-supabase.js
// Updated version that uses Supabase with EXACT prompts from daily-tracker.js
import fetch from 'node-fetch';
import { supabaseRequest } from '../config/supabase-config-node.js';
import { generateSpicySummary } from './spicy-summaries-integration.js';

// Only load dotenv for local testing (not in GitHub Actions)
if (!process.env.GITHUB_ACTIONS) {
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
}

console.log('🚀 DAILY POLITICAL TRACKER - SUPABASE VERSION (EXACT PROMPTS)');
console.log('=============================================================\n');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY environment variable is required');
    process.exit(1);
}

// ID generation removed - Database uses SERIAL PRIMARY KEY which auto-generates IDs
// Per TTRC-86 fix: Never manually set ID field when inserting to political_entries

// Date range helper - can be overridden by command line args for backfill
function getDateRangePrompt() {
    const args = process.argv.slice(2);
    const daysBack = args.find(arg => arg.startsWith('--days='));
    
    const endDate = new Date();
    const startDate = new Date();
    
    if (daysBack) {
        const days = parseInt(daysBack.split('=')[1]);
        startDate.setDate(startDate.getDate() - days);
        console.log(`📅 BACKFILL MODE: Searching ${days} days of history`);
    } else {
        startDate.setDate(startDate.getDate() - 3); // Default 3-day window
    }
    
    return `between ${startDate.toISOString().split('T')[0]} and ${endDate.toISOString().split('T')[0]}`;
}

// Duplicate detection configuration with validation
function validateConfig() {
    const comparisonLength = parseInt(process.env.DUPLICATE_COMPARISON_LENGTH || '200');
    const similarityThreshold = parseFloat(process.env.DUPLICATE_SIMILARITY_THRESHOLD || '0.85');
    const wordThreshold = parseFloat(process.env.DUPLICATE_WORD_THRESHOLD || '0.60');
    const scoreThreshold = parseInt(process.env.DUPLICATE_SCORE_THRESHOLD || '80');
    
    // Validate all configuration values
    if (isNaN(comparisonLength) || comparisonLength < 50 || comparisonLength > 500) {
        console.error(`❌ Invalid DUPLICATE_COMPARISON_LENGTH: ${process.env.DUPLICATE_COMPARISON_LENGTH}`);
        console.log('   Must be a number between 50 and 500. Using default: 200');
        return { error: true, field: 'DUPLICATE_COMPARISON_LENGTH' };
    }
    
    if (isNaN(similarityThreshold) || similarityThreshold < 0 || similarityThreshold > 1) {
        console.error(`❌ Invalid DUPLICATE_SIMILARITY_THRESHOLD: ${process.env.DUPLICATE_SIMILARITY_THRESHOLD}`);
        console.log('   Must be a number between 0 and 1. Using default: 0.85');
        return { error: true, field: 'DUPLICATE_SIMILARITY_THRESHOLD' };
    }
    
    if (isNaN(wordThreshold) || wordThreshold < 0 || wordThreshold > 1) {
        console.error(`❌ Invalid DUPLICATE_WORD_THRESHOLD: ${process.env.DUPLICATE_WORD_THRESHOLD}`);
        console.log('   Must be a number between 0 and 1. Using default: 0.60');
        return { error: true, field: 'DUPLICATE_WORD_THRESHOLD' };
    }
    
    if (isNaN(scoreThreshold) || scoreThreshold < 0 || scoreThreshold > 100) {
        console.error(`❌ Invalid DUPLICATE_SCORE_THRESHOLD: ${process.env.DUPLICATE_SCORE_THRESHOLD}`);
        console.log('   Must be a number between 0 and 100. Using default: 80');
        return { error: true, field: 'DUPLICATE_SCORE_THRESHOLD' };
    }
    
    return {
        COMPARISON_LENGTH: isNaN(comparisonLength) ? 200 : comparisonLength,
        SIMILARITY_THRESHOLD: isNaN(similarityThreshold) ? 0.85 : similarityThreshold,
        WORD_OVERLAP_THRESHOLD: isNaN(wordThreshold) ? 0.60 : wordThreshold,
        SCORE_THRESHOLD: isNaN(scoreThreshold) ? 80 : scoreThreshold,
        DEBUG_LOG: process.env.DUPLICATE_DEBUG_LOG === 'true',
        STOP_WORDS: ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'with', 'of', 'from', 'by', 'as', 'is', 'was', 'are', 'were', 'been', 'be'],
        COMMON_POLITICAL_TERMS: ['federal', 'state', 'announces', 'new', 'report', 'reports', 'investigation', 'investigates']
    };
}

// Initialize and validate configuration
const configResult = validateConfig();
if (configResult.error) {
    console.log('⚠️ Using default configuration values due to validation error\n');
}
const DUPLICATE_CONFIG = configResult.error ? validateConfig() : configResult;

// Enhanced text normalization for better matching
function normalizeText(text, removeCommonTerms = false) {
    if (!text) return '';
    
    let normalized = text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')  // Replace punctuation with spaces
        .replace(/\s+/g, ' ')           // Normalize whitespace
        .trim();
    
    // Remove stop words
    const words = normalized.split(' ').filter(word => 
        word.length > 2 && !DUPLICATE_CONFIG.STOP_WORDS.includes(word)
    );
    
    // Optionally remove common political terms for entity matching
    if (removeCommonTerms) {
        return words.filter(word => 
            !DUPLICATE_CONFIG.COMMON_POLITICAL_TERMS.includes(word)
        ).join(' ');
    }
    
    return words.join(' ');
}

// Calculate string similarity (Dice coefficient)
function calculateStringSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;
    
    const len1 = str1.length;
    const len2 = str2.length;
    if (len1 < 2 || len2 < 2) return 0;
    
    const bigrams1 = new Set();
    const bigrams2 = new Set();
    
    for (let i = 0; i < len1 - 1; i++) {
        bigrams1.add(str1.substring(i, i + 2));
    }
    
    for (let i = 0; i < len2 - 1; i++) {
        bigrams2.add(str2.substring(i, i + 2));
    }
    
    const intersection = new Set([...bigrams1].filter(x => bigrams2.has(x)));
    
    return (2 * intersection.size) / (bigrams1.size + bigrams2.size);
}

// Calculate comprehensive similarity score
function calculateSimilarityScore(entry1, entry2) {
    let score = 0;
    let reasons = [];
    
    // URL similarity (0-30 points)
    if (entry1.source_url && entry2.source_url) {
        if (entry1.source_url === entry2.source_url) {
            score += 30;
            reasons.push('exact_url');
        } else {
            try {
                const url1 = new URL(entry1.source_url);
                const url2 = new URL(entry2.source_url);
                if (url1.hostname === url2.hostname) {
                    score += 10;
                    reasons.push('same_domain');
                }
            } catch (e) {
                // Invalid URLs, ignore
            }
        }
    }
    
    // Title similarity using first 200 characters (0-40 points)
    const title1 = normalizeText(entry1.title).substring(0, DUPLICATE_CONFIG.COMPARISON_LENGTH);
    const title2 = normalizeText(entry2.title).substring(0, DUPLICATE_CONFIG.COMPARISON_LENGTH);
    const titleSim = calculateStringSimilarity(title1, title2);
    score += titleSim * 40;
    
    if (titleSim > DUPLICATE_CONFIG.SIMILARITY_THRESHOLD) {
        reasons.push(`title_${Math.round(titleSim * 100)}%`);
    }
    
    // Date proximity (0-15 points)
    if (entry1.date && entry2.date) {
        const date1 = new Date(entry1.date);
        const date2 = new Date(entry2.date);
        const daysDiff = Math.abs((date1 - date2) / (1000 * 60 * 60 * 24));
        score += Math.max(0, 15 - (daysDiff * 5));
        if (daysDiff === 0) reasons.push('same_date');
        else if (daysDiff <= 1) reasons.push('adjacent_date');
    }
    
    // Actor match (0-15 points)
    if (entry1.actor && entry2.actor) {
        const actorSim = calculateStringSimilarity(
            normalizeText(entry1.actor),
            normalizeText(entry2.actor)
        );
        score += actorSim * 15;
        if (actorSim > 0.8) reasons.push('same_actor');
    }
    
    return {
        score: Math.round(Math.min(100, score)),
        reasons: reasons.join(', '),
        titleSimilarity: titleSim,
        isDuplicate: score >= DUPLICATE_CONFIG.SCORE_THRESHOLD
    };
}

// Enhanced duplicate detection with similarity scoring
async function checkForDuplicate(entry) {
    try {
        if (DUPLICATE_CONFIG.DEBUG_LOG) {
            console.log(`\n🔍 Duplicate Check for: "${entry.title.substring(0, 60)}..."`);
        }
        
        // Step 1: Check exact URL match
        if (entry.source_url) {
            const urlMatch = await supabaseRequest(
                `political_entries?source_url=eq.${encodeURIComponent(entry.source_url)}&limit=1`
            );
            if (urlMatch && urlMatch.length > 0) {
                console.log('  ⚠️ Exact URL duplicate detected');
                return {
                    isDuplicate: true,
                    originalId: urlMatch[0].id,
                    score: 100,
                    reason: 'exact_url'
                };
            }
        }
        
        // Step 2: Get recent entries for comparison (last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const dateFilter = sevenDaysAgo.toISOString().split('T')[0];
        
        const recentEntries = await supabaseRequest(
            `political_entries?date=gte.${dateFilter}&select=id,title,date,actor,source_url&order=created_at.desc&limit=100`
        );
        
        if (!recentEntries || recentEntries.length === 0) {
            return { isDuplicate: false };
        }
        
        if (DUPLICATE_CONFIG.DEBUG_LOG) {
            console.log(`  Comparing against ${recentEntries.length} recent entries`);
        }
        
        // Step 3: Calculate similarity scores
        let bestMatch = null;
        let highestScore = 0;
        
        for (const existing of recentEntries) {
            const similarity = calculateSimilarityScore(entry, existing);
            
            // Log high-scoring comparisons for debugging
            if (DUPLICATE_CONFIG.DEBUG_LOG && similarity.score > 60) {
                console.log(`  📊 Score: ${similarity.score}/100 with ID:${existing.id}`);
                console.log(`     Reasons: ${similarity.reasons}`);
                console.log(`     Title: "${existing.title.substring(0, 50)}..."`);
            }
            
            if (similarity.score > highestScore) {
                highestScore = similarity.score;
                bestMatch = {
                    isDuplicate: similarity.isDuplicate,
                    originalId: existing.id,
                    score: similarity.score,
                    reason: similarity.reasons,
                    originalTitle: existing.title
                };
            }
            
            // Short circuit if we find a definite duplicate
            if (similarity.score >= 95) {
                console.log(`  ⚠️ High-confidence duplicate detected (score: ${similarity.score})`);
                return bestMatch;
            }
        }
        
        if (bestMatch && bestMatch.isDuplicate) {
            console.log(`  ⚠️ Duplicate detected (score: ${bestMatch.score})`);
            console.log(`     Original: "${bestMatch.originalTitle.substring(0, 60)}..."`);
            return bestMatch;
        }
        
        return { isDuplicate: false };
        
    } catch (error) {
        console.error('Error in duplicate detection:', error.message);
        return { isDuplicate: false }; // Don't block on errors
    }
}

// Severity assessment - Updated for 4-tier system
function assessSeverity(title, description) {
    const content = `${title} ${description}`.toLowerCase();
    
    // Critical - Democracy threats and authoritarianism
    const criticalSeverity = [
        'coup', 'insurrection', 'martial law', 'suspend constitution',
        'overturn election', 'steal election', 'voting machines',
        'authoritarian', 'fascism', 'dictatorship', 'democracy threat',
        'civil war', 'political violence', 'assassination'
    ];
    
    // High - Criminal activity and serious violations
    const highSeverity = [
        'arrest', 'indictment', 'conviction', 'felony', 'fraud', 'corruption',
        'constitutional crisis', 'impeachment', 'treason', 'sedition',
        'emergency', 'shutdown', 'crisis', 'violation', 'breach',
        'criminal', 'prosecute', 'jail', 'prison'
    ];
    
    // Medium - Investigations and controversies
    const mediumSeverity = [
        'investigation', 'subpoena', 'lawsuit', 'hearing', 'testimony',
        'controversy', 'conflict', 'ethics', 'challenge', 'dispute',
        'allegation', 'concern', 'criticism', 'scandal', 'probe'
    ];
    
    // Check in order of severity
    if (criticalSeverity.some(keyword => content.includes(keyword))) {
        return 'critical';
    } else if (highSeverity.some(keyword => content.includes(keyword))) {
        return 'high';
    } else if (mediumSeverity.some(keyword => content.includes(keyword))) {
        return 'medium';
    } else {
        return 'low';
    }
}

// Source verification - same as daily-tracker.js
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

// Format category for display - Convert from database format to display format
function formatCategoryDisplay(category) {
    if (!category) return 'Other';
    
    const displayNames = {
        'corruption_scandals': 'Corruption & Scandals',
        'democracy_elections': 'Democracy & Elections',
        'policy_legislation': 'Policy & Legislation',
        'justice_legal': 'Justice & Legal',
        'executive_actions': 'Executive Actions',
        'foreign_policy': 'Foreign Policy',
        'corporate_financial': 'Corporate & Financial',
        'civil_liberties': 'Civil Liberties',
        'media_disinformation': 'Media & Disinformation',
        'epstein_associates': 'Epstein & Associates',
        'other': 'Other'
    };
    
    return displayNames[category] || 'Other';
}

// Clean and validate category - Using new 11-category system
function normalizeCategory(category) {
    if (!category) return 'other';
    
    // Remove any brackets or extra text
    const cleaned = category.toLowerCase()
        .replace(/\[.*?\]/g, '') // Remove brackets
        .replace(/\(.*?\)/g, '')  // Remove parentheses
        .replace(/&/g, 'and')     // Replace & with 'and'
        .replace(/\s+/g, '_')     // Replace spaces with underscores
        .trim();
    
    // Valid 11 categories
    const validCategories = [
        'corruption_scandals',
        'democracy_elections',
        'policy_legislation',
        'justice_legal',
        'executive_actions',
        'foreign_policy',
        'corporate_financial',
        'civil_liberties',
        'media_disinformation',
        'epstein_associates',
        'other'
    ];
    
    // Check if it's already valid
    if (validCategories.includes(cleaned)) {
        return cleaned;
    }
    
    // Map old categories to new consolidated 11-category system
    const categoryMapping = {
        // Corruption & Scandals
        'corruption': 'corruption_scandals',
        'scandal': 'corruption_scandals',
        'ethics': 'corruption_scandals',
        'investigation': 'corruption_scandals',
        'grift': 'corruption_scandals',
        'bribery': 'corruption_scandals',
        'conflicts': 'corruption_scandals',
        
        // Democracy & Elections (includes ALL election shenanigans)
        'democracy': 'democracy_elections',
        'election': 'democracy_elections',
        'voting': 'democracy_elections',
        'voter': 'democracy_elections',
        'ballot': 'democracy_elections',
        'gerrymandering': 'democracy_elections',
        'election_interference': 'democracy_elections',
        'fake_electors': 'democracy_elections',
        'subversion': 'democracy_elections',
        
        // Policy & Legislation
        'policy': 'policy_legislation',
        'legislation': 'policy_legislation',
        'regulatory': 'policy_legislation',
        'regulation': 'policy_legislation',
        'law': 'policy_legislation',
        'congress': 'policy_legislation',
        'bill': 'policy_legislation',
        'budget': 'policy_legislation',
        
        // Justice & Legal
        'justice': 'justice_legal',
        'judicial': 'justice_legal',
        'legal': 'justice_legal',
        'court': 'justice_legal',
        'judge': 'justice_legal',
        'doj': 'justice_legal',
        'prosecution': 'justice_legal',
        'indictment': 'justice_legal',
        'lawsuit': 'justice_legal',
        
        // Executive Actions
        'executive': 'executive_actions',
        'presidential': 'executive_actions',
        'whitehouse': 'executive_actions',
        'executive_order': 'executive_actions',
        'appointment': 'executive_actions',
        
        // Foreign Policy
        'foreign': 'foreign_policy',
        'international': 'foreign_policy',
        'trade': 'foreign_policy',
        'diplomacy': 'foreign_policy',
        'treaty': 'foreign_policy',
        'sanctions': 'foreign_policy',
        
        // Corporate & Financial
        'corporate': 'corporate_financial',
        'financial': 'corporate_financial',
        'lobbying': 'corporate_financial',
        'pac': 'corporate_financial',
        'campaign_finance': 'corporate_financial',
        'dark_money': 'corporate_financial',
        
        // Civil Liberties
        'civil_liberties': 'civil_liberties',
        'surveillance': 'civil_liberties',
        'protest': 'civil_liberties',
        'free_speech': 'civil_liberties',
        'censorship': 'civil_liberties',
        'civil_rights': 'civil_liberties',
        'fisa': 'civil_liberties',
        
        // Media & Disinformation
        'media': 'media_disinformation',
        'disinformation': 'media_disinformation',
        'propaganda': 'media_disinformation',
        'fake_news': 'media_disinformation',
        'misinformation': 'media_disinformation',
        
        // Epstein & Associates
        'epstein': 'epstein_associates',
        'trafficking': 'epstein_associates',
        'maxwell': 'epstein_associates'
    };
    
    // Try direct mapping first
    if (categoryMapping[cleaned]) {
        return categoryMapping[cleaned];
    }
    
    // Try to find keywords in the category string
    for (const [keyword, mappedCategory] of Object.entries(categoryMapping)) {
        if (cleaned.includes(keyword)) {
            return mappedCategory;
        }
    }
    
    // Default fallback
    console.warn(`Unknown category: ${category}, defaulting to 'other'`);
    return 'other';
}

// Actor normalization - keeping it informal per site tone
function normalizeActor(actor) {
    if (!actor) return 'Unknown';
    
    const actorMapping = {
        // Trump variations - all become just "Trump"
        'President Trump': 'Trump',
        'Donald Trump': 'Trump',
        'Trump Administration': 'White House',
        'The President': 'Trump',
        'President Donald Trump': 'Trump',
        
        // Department variations
        'Department of Justice': 'DOJ',
        'Justice Department': 'DOJ',
        'Dept. of Defense': 'DOD',
        'Pentagon': 'DOD',
        'State Department': 'State',
        'Department of State': 'State',
        'Department of Education': 'Education',
        'Dept. of Education': 'Education',
        'Department of Homeland Security': 'DHS',
        'Homeland Security': 'DHS',
        
        // Court variations
        'SCOTUS': 'Supreme Court',
        'U.S. Supreme Court': 'Supreme Court',
        'The Supreme Court': 'Supreme Court',
        
        // Congress variations
        'House Republicans': 'House GOP',
        'Senate Dems': 'Senate Democrats',
        'Congressional Republicans': 'Congress GOP',
        'Congressional Democrats': 'Congress Democrats'
    };
    
    // Check for exact match in normalization map
    if (actorMapping[actor]) {
        return actorMapping[actor];
    }
    
    // Return as-is if already in correct format
    return actor;
}

// Entry validation - same as daily-tracker.js
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

async function fetchPoliticalUpdates() {
    console.log('=== REAL NEWS POLITICAL TRACKER ===');
    console.log('Date:', new Date().toDateString());
    console.log('Time:', new Date().toISOString());

    // EXACT prompts from daily-tracker.js
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

        'DOGE & Government Efficiency': `Search for recent news about DOGE (Department of Government Efficiency) operations and government efficiency initiatives ${dateRange}. Focus on:
- NEW DOGE operations and government efficiency recommendations
- RECENT federal agency restructuring or elimination proposals
- LATEST government spending cuts or efficiency measures
- CURRENT recommendations from the efficiency commission
- EMERGING conflicts of interest within DOGE operations

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

    console.log(`\n=== SEARCHING FOR REAL POLITICAL NEWS ===`);
    console.log(`📅 Date range: ${dateRange}`);
    console.log(`🚀 Using BATCHED duplicate detection for efficiency\n`);
    
    const allEntries = [];
    let totalApiCallsSaved = 0; // Track API call savings
    const promises = Object.entries(REAL_NEWS_PROMPTS).map(async ([category, prompt]) => {
        try {
            console.log(`🔍 Searching real news for: ${category}`);
            
            // Use the correct OpenAI Responses API with web search
            const response = await fetch('https://api.openai.com/v1/responses', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
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
  "category": "[SELECT BASED ON CONTENT - Choose ONE: corruption_scandals, democracy_elections, policy_legislation, justice_legal, executive_actions, foreign_policy, corporate_financial, civil_liberties, media_disinformation, epstein_associates, other]",
  "title": "Headline under 100 characters",
  "description": "2-3 sentence factual summary",
  "source_url": "Full URL to original article",
  "verified": true,
  "severity": "critical|high|medium|low"
}

IMPORTANT: The category must reflect the article's actual content, not the search topic. Use these exact values:
- Articles about scandals/ethics/grift/bribery/conflicts = "corruption_scandals"
- Articles about elections/voting/gerrymandering/fake electors = "democracy_elections"
- Articles about laws/regulations/budget/bills/congress = "policy_legislation"
- Articles about courts/DOJ/prosecutions/indictments/lawsuits = "justice_legal"
- Articles about presidential actions/EOs/appointments/directives = "executive_actions"
- Articles about international relations/trade/sanctions/diplomacy = "foreign_policy"
- Articles about lobbying/PACs/dark money/campaign finance = "corporate_financial"
- Articles about surveillance/protests/civil rights/FISA/censorship = "civil_liberties"
- Articles about propaganda/fake news/disinformation/media manipulation = "media_disinformation"
- Articles about Epstein/trafficking/Maxwell network = "epstein_associates"
- Articles that don't fit = "other"

SEVERITY GUIDE:
- "critical" = Democracy threats, coups, election theft attempts, authoritarianism
- "high" = Criminal activity, arrests, indictments, major corruption
- "medium" = Investigations, lawsuits, controversies, ethics concerns
- "low" = Minor issues, political theater, embarrassments

Return ONLY a JSON array of relevant political developments found. Only include real news from credible sources. Each entry must be unique - no duplicates. Do not include any text before or after the JSON array.`,
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
            console.log(`  Cost: ${((data.usage?.total_tokens || 0) * 0.00000015).toFixed(5)}`);

            // Extract JSON from the response
            let entries = [];
            try {
                // Remove markdown code blocks if present
                let cleanContent = content;
                if (content.includes('```json')) {
                    cleanContent = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
                } else if (content.includes('```')) {
                    cleanContent = content.replace(/```\s*/g, '').trim();
                }
                
                // Try to find JSON in the response
                const jsonMatch = cleanContent.match(/\[[\s\S]*?\]/);
                if (jsonMatch) {
                    entries = JSON.parse(jsonMatch[0]);
                } else {
                    // If no JSON array found, try to parse the whole response
                    entries = JSON.parse(cleanContent);
                }
            } catch (parseError) {
                console.log(`  ❌ Could not parse JSON response`);
                entries = [];
            }

            if (!Array.isArray(entries)) {
                entries = entries ? [entries] : [];
            }

            // Validate entries first
            const validEntries = [];
            for (const entry of entries) {
                if (!entry || typeof entry !== 'object') continue;
                if (validateEntry(entry)) {
                    validEntries.push(entry);
                }
            }

            // BATCHED DUPLICATE CHECKING - Fetch recent entries ONCE
            console.log(`\n  🔍 Batch checking ${validEntries.length} entries for duplicates...`);
            
            // Track API call savings from batching
            const savedCalls = Math.max(0, validEntries.length - 1); // We save N-1 calls by batching
            totalApiCallsSaved += savedCalls;
            if (savedCalls > 0) {
                console.log(`  💰 Saving ${savedCalls} API calls by batching`);
            }
            
            // Get recent entries for comparison (last 7 days) - SINGLE API CALL
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            const dateFilter = sevenDaysAgo.toISOString().split('T')[0];
            
            const recentEntries = await supabaseRequest(
                `political_entries?date=gte.${dateFilter}&select=id,title,date,actor,source_url&order=created_at.desc&limit=100`
            );
            
            // Process entries with batched duplicate detection
            const processedEntries = [];
            for (const entry of validEntries) {
                // Check exact URL duplicate first
                let isDuplicate = false;
                let duplicateInfo = null;
                
                if (entry.source_url) {
                    const urlMatch = await supabaseRequest(
                        `political_entries?source_url=eq.${encodeURIComponent(entry.source_url)}&limit=1`
                    );
                    if (urlMatch && urlMatch.length > 0) {
                        isDuplicate = true;
                        duplicateInfo = {
                            originalId: urlMatch[0].id,
                            score: 100,
                            reason: 'exact_url'
                        };
                    }
                }
                
                // If not URL duplicate, check similarity against CACHED entries
                if (!isDuplicate && recentEntries && recentEntries.length > 0) {
                    let bestMatch = null;
                    let highestScore = 0;
                    
                    for (const existing of recentEntries) {
                        const similarity = calculateSimilarityScore(entry, existing);
                        
                        if (similarity.score > highestScore) {
                            highestScore = similarity.score;
                            bestMatch = {
                                isDuplicate: similarity.isDuplicate,
                                originalId: existing.id,
                                score: similarity.score,
                                reason: similarity.reasons
                            };
                        }
                        
                        // Short circuit on high confidence
                        if (similarity.score >= 95) break;
                    }
                    
                    if (bestMatch && bestMatch.isDuplicate) {
                        isDuplicate = true;
                        duplicateInfo = bestMatch;
                    }
                }
                
                if (isDuplicate) {
                    console.log(`  ⏭️ Skipping duplicate: ${entry.title.substring(0, 50)}...`);
                    if (duplicateInfo) {
                        console.log(`     Duplicate of ID: ${duplicateInfo.originalId} (Score: ${duplicateInfo.score})`);
                    }
                    continue;
                }
                
                // Generate spicy summary for this entry
                let spicyEnhanced = {};
                try {
                    console.log(`  🌶️ Generating spicy summary for: ${entry.title.substring(0, 50)}...`);
                    spicyEnhanced = await generateSpicySummary({
                        title: entry.title,
                        description: entry.description,
                        severity: entry.severity || assessSeverity(entry.title, entry.description)
                    });
                } catch (spicyError) {
                    console.log(`  ⚠️ Spicy summary generation failed, using defaults:`, spicyError.message);
                    // If spicy generation fails, use empty values
                    spicyEnhanced = {
                        spicy_summary: null,
                        shareable_hook: null,
                        severity_label_inapp: null,
                        severity_label_share: null
                    };
                }
                
                const processedEntry = {
                    // Note: id is auto-generated by database (SERIAL PRIMARY KEY)
                    date: entry.date,
                    actor: normalizeActor(entry.actor) || 'Unknown',
                    category: normalizeCategory(entry.category),
                    title: entry.title,
                    description: entry.description,
                    source_url: entry.source_url,
                    source: entry.source_url ? new URL(entry.source_url).hostname.replace('www.', '') : 'unknown',  // Extract domain name as source
                    verified: entry.source_url ? isVerifiedSource(entry.source_url) : false,
                    severity: entry.severity || assessSeverity(entry.title, entry.description),
                    status: 'published',
                    manual_submission: false,
                    added_at: new Date().toISOString(),
                    // Add spicy summary fields
                    // Note: editorial_summary field removed per schema (use description instead)
                    spicy_summary: spicyEnhanced.spicy_summary,
                    shareable_hook: spicyEnhanced.shareable_hook,
                    severity_label_inapp: spicyEnhanced.severity_label_inapp,
                    severity_label_share: spicyEnhanced.severity_label_share
                };
                
                processedEntries.push(processedEntry);
            }

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
    if (totalApiCallsSaved > 0) {
        console.log(`🎉 API CALLS SAVED BY BATCHING: ${totalApiCallsSaved}`);
        console.log(`   (Reduced from ~${allEntries.length * 2} to ~${allEntries.length + 6} calls)`);
    }
    
    return allEntries;
}

async function saveToSupabase(entries) {
    if (!entries || entries.length === 0) {
        console.log('\n⚠️ No new entries to save');
        return;
    }

    console.log(`\n💾 Saving ${entries.length} new entries to Supabase...`);
    
    try {
        // Remove any existing id field from entries and let database auto-generate
        const entriesWithoutIds = entries.map(entry => {
            const { id, ...cleanEntry } = entry; // Remove any existing id field
            return cleanEntry;
        });
        
        // Insert all entries at once (Supabase handles batches well)
        // Database will auto-generate sequential IDs using SERIAL PRIMARY KEY
        const result = await supabaseRequest('political_entries', 'POST', entriesWithoutIds);
        console.log(`✅ Successfully saved ${entriesWithoutIds.length} entries to Supabase`);
        
        // Enhanced summary matching daily-tracker.js
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
        
        console.log('================================\n');
        
    } catch (error) {
        console.error('❌ Error saving to Supabase:', error.message);
        throw error;
    }
}

async function main() {
    try {
        console.log('🚀 Starting Real News Political Tracker...');
        console.log('🔍 Using OpenAI Responses API with web search capabilities\n');
        
        const entries = await fetchPoliticalUpdates();
        
        if (entries.length === 0) {
            console.log('\nℹ️  No relevant political news found in current search');
            console.log('This is normal - not every search yields new developments');
            return;
        }

        await saveToSupabase(entries);

    } catch (error) {
        console.error('❌ Error in main execution:', error.message);
        console.error('Stack trace:', error.stack);
        
        // Don't throw error - let GitHub Actions continue
        console.log('Script completed with errors but continuing...');
    }
}

// Run the tracker
main();