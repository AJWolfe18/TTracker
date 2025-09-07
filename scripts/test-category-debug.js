// test-category-debug.js
// Debug script to understand why AI is categorizing everything as "other"

import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

console.log('🔍 CATEGORY DEBUG TEST');
console.log('======================\n');

// Test a single article to see what category the AI returns
async function testSingleArticle() {
    const testPrompt = `Search for recent news involving Donald Trump legal proceedings from 2025-01-01 to 2025-01-10. Focus on:
- NEW legal proceedings, court cases, or rulings

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

Return ONLY a JSON array of 1-2 relevant political developments found. Only include real news from credible sources.`;

    try {
        console.log('Sending test request to OpenAI...\n');
        
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
                input: testPrompt,
                max_output_tokens: 1000
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        
        // Extract content from response
        const content = data.output?.find(item => item.type === 'message')?.content?.[0]?.text || '';
        
        console.log('Raw AI Response:');
        console.log('================');
        console.log(content);
        console.log('\n');

        // Try to parse JSON
        let entries = [];
        try {
            // Remove markdown code blocks if present
            let cleanContent = content;
            if (content.includes('```json')) {
                cleanContent = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            } else if (content.includes('```')) {
                cleanContent = content.replace(/```\s*/g, '').trim();
            }
            
            const jsonMatch = cleanContent.match(/\[[\s\S]*?\]/);
            if (jsonMatch) {
                entries = JSON.parse(jsonMatch[0]);
            } else {
                entries = JSON.parse(cleanContent);
            }
        } catch (parseError) {
            console.log('❌ Could not parse JSON from response:', parseError.message);
            return;
        }

        if (!Array.isArray(entries)) {
            entries = entries ? [entries] : [];
        }

        console.log('Parsed Entries:');
        console.log('===============');
        entries.forEach((entry, index) => {
            console.log(`\nEntry ${index + 1}:`);
            console.log(`  Title: ${entry.title}`);
            console.log(`  Category from AI: "${entry.category}"`);
            console.log(`  Actor: ${entry.actor}`);
            console.log(`  Date: ${entry.date}`);
            
            // Test normalizeCategory function
            const normalized = normalizeCategory(entry.category);
            console.log(`  Normalized to: "${normalized}"`);
            
            if (normalized === 'other') {
                console.log(`  ⚠️ WARNING: Category defaulted to 'other'!`);
                console.log(`     Original value: "${entry.category}"`);
            }
        });

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

// The normalizeCategory function from daily-tracker-supabase.js
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
        
        // Democracy & Elections
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
    console.warn(`Unknown category: "${category}" (cleaned: "${cleaned}"), defaulting to 'other'`);
    return 'other';
}

// Run the test
testSingleArticle();
