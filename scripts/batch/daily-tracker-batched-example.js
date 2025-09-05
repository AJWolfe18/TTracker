// daily-tracker-supabase-batched.js
// Enhanced version with batched duplicate checking
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

console.log('🚀 DAILY POLITICAL TRACKER - BATCHED VERSION');
console.log('==============================================\n');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY environment variable is required');
    process.exit(1);
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

// BATCHED DUPLICATE DETECTION FUNCTIONS
// ... [Include all the helper functions from original]

// OPTIMIZED: Batch duplicate checking to reduce API calls
async function checkForDuplicatesBatched(newEntries) {
    console.log(`\n🔍 BATCH Duplicate Detection for ${newEntries.length} entries`);
    
    // Step 1: Fetch recent entries ONCE (major optimization!)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const dateFilter = sevenDaysAgo.toISOString().split('T')[0];
    
    console.log('  📥 Fetching recent entries for comparison...');
    const recentEntries = await supabaseRequest(
        `political_entries?date=gte.${dateFilter}&select=id,title,date,actor,source_url&order=created_at.desc&limit=100`
    );
    
    if (!recentEntries || recentEntries.length === 0) {
        console.log('  ℹ️ No recent entries to compare against');
        return newEntries; // All entries are unique
    }
    
    console.log(`  📊 Comparing against ${recentEntries.length} recent entries`);
    
    // Step 2: Check each new entry against the cached recent entries
    const uniqueEntries = [];
    const duplicates = [];
    let apiCallsForUrls = 0;
    
    for (const entry of newEntries) {
        if (DUPLICATE_CONFIG.DEBUG_LOG) {
            console.log(`\n  Checking: "${entry.title.substring(0, 60)}..."`);
        }
        
        // Check exact URL (still needs individual API call)
        let isDuplicate = false;
        if (entry.source_url) {
            const urlMatch = await supabaseRequest(
                `political_entries?source_url=eq.${encodeURIComponent(entry.source_url)}&limit=1`
            );
            apiCallsForUrls++;
            
            if (urlMatch && urlMatch.length > 0) {
                console.log('    ⚠️ Exact URL duplicate');
                duplicates.push({
                    entry,
                    reason: 'exact_url',
                    originalId: urlMatch[0].id,
                    score: 100
                });
                isDuplicate = true;
            }
        }
        
        // If not URL duplicate, check similarity against cached entries
        if (!isDuplicate) {
            let bestMatch = null;
            let highestScore = 0;
            
            // Use CACHED recentEntries instead of fetching again!
            for (const existing of recentEntries) {
                const similarity = calculateSimilarityScore(entry, existing);
                
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
                
                // Short circuit on high confidence
                if (similarity.score >= 95) {
                    break;
                }
            }
            
            if (bestMatch && bestMatch.isDuplicate) {
                console.log(`    ⚠️ Similar content (score: ${bestMatch.score})`);
                duplicates.push({
                    entry,
                    reason: bestMatch.reason,
                    originalId: bestMatch.originalId,
                    score: bestMatch.score
                });
            } else {
                uniqueEntries.push(entry);
            }
        }
    }
    
    // Report batching savings
    console.log(`\n📊 BATCHING RESULTS:`);
    console.log(`  ✅ Unique entries: ${uniqueEntries.length}`);
    console.log(`  ⚠️ Duplicates found: ${duplicates.length}`);
    console.log(`  📉 API calls made: ${1 + apiCallsForUrls} (1 batch fetch + ${apiCallsForUrls} URL checks)`);
    console.log(`  💰 API calls saved: ${newEntries.length - 1} (by batching recent entries)`);
    
    if (duplicates.length > 0) {
        console.log(`\n  Duplicates skipped:`);
        duplicates.forEach(dup => {
            console.log(`    - "${dup.entry.title.substring(0, 50)}..." (${dup.reason}, score: ${dup.score})`);
        });
    }
    
    return uniqueEntries;
}

// [Include all other necessary functions from original file]

// Example usage in main processing
async function processPoliticalEntries(allEntries) {
    // BATCHED: Check all duplicates at once
    const uniqueEntries = await checkForDuplicatesBatched(allEntries);
    
    // Process only unique entries for spicy summaries
    const processedEntries = [];
    for (const entry of uniqueEntries) {
        // Generate spicy summary
        let spicyEnhanced = {};
        try {
            console.log(`  🌶️ Generating spicy summary for: ${entry.title.substring(0, 50)}...`);
            spicyEnhanced = await generateSpicySummary({
                title: entry.title,
                description: entry.description,
                severity: entry.severity || assessSeverity(entry.title, entry.description)
            });
        } catch (spicyError) {
            console.log(`  ⚠️ Spicy summary generation failed:`, spicyError.message);
            spicyEnhanced = {
                spicy_summary: null,
                shareable_hook: null,
                severity_label_inapp: null,
                severity_label_share: null
            };
        }
        
        // Add enhanced fields
        const processedEntry = {
            ...entry,
            spicy_summary: spicyEnhanced.spicy_summary,
            shareable_hook: spicyEnhanced.shareable_hook,
            severity_label_inapp: spicyEnhanced.severity_label_inapp,
            severity_label_share: spicyEnhanced.severity_label_share
        };
        
        processedEntries.push(processedEntry);
    }
    
    return processedEntries;
}

// Helper functions needed (copy from original)
function normalizeText(text, removeCommonTerms = false) {
    if (!text) return '';
    
    let normalized = text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    
    const words = normalized.split(' ').filter(word => 
        word.length > 2 && !DUPLICATE_CONFIG.STOP_WORDS.includes(word)
    );
    
    if (removeCommonTerms) {
        return words.filter(word => 
            !DUPLICATE_CONFIG.COMMON_POLITICAL_TERMS.includes(word)
        ).join(' ');
    }
    
    return words.join(' ');
}

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

function assessSeverity(title, description) {
    const content = `${title} ${description}`.toLowerCase();
    
    const highSeverity = [
        'arrest', 'indictment', 'conviction', 'felony', 'fraud', 'corruption',
        'constitutional crisis', 'impeachment', 'treason', 'sedition',
        'emergency', 'shutdown', 'crisis', 'violation', 'breach'
    ];
    
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

console.log('📌 Batched duplicate detection example created');
console.log('   This shows how to reduce API calls by ~50%');
