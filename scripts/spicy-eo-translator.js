// spicy-eo-translator.js
// Specialized translator for Executive Orders that exposes the real agenda
// Uses different categorization than political articles

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables from .env file FIRST
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

import fetch from 'node-fetch';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
    console.error('⚠️ ERROR: OPENAI_API_KEY not found!');
    console.error('   Environment variables available:', Object.keys(process.env).filter(k => k.includes('OPEN')));
    process.exit(1);
}

// EO-specific impact categories
const EO_IMPACT_TYPES = {
    FASCIST: 'fascist_power_grab',
    AUTHORITARIAN: 'authoritarian_overreach', 
    CORRUPT: 'corrupt_grift',
    PERFORMATIVE: 'performative_bullshit'
};

// Map database values to display labels
const EO_IMPACT_LABELS = {
    'fascist_power_grab': {
        inapp: 'Fascist Power Grab 🔴',
        share: 'Democracy Under Attack'
    },
    'authoritarian_overreach': {
        inapp: 'Authoritarian Overreach 🟠',
        share: 'Police State Expansion'
    },
    'corrupt_grift': {
        inapp: 'Corrupt Grift 🟡',
        share: 'Corruption and Self-Dealing'
    },
    'performative_bullshit': {
        inapp: 'Performative Bullshit 🟢',
        share: 'Political Theater'
    }
};

/**
 * Generates a spicy translation that exposes what the EO really does
 * This is the MAIN function - simplified to do everything in one call
 */
async function generateSpicyEOTranslation(order) {
    const { title, summary, order_number } = order;
    
    const prompt = `You are an anti-fascist translator exposing Trump executive orders.

Executive Order ${order_number}: ${title}
Official Summary: ${summary}

First, categorize this order's REAL intent:
- "fascist_power_grab" - Direct attacks on democracy, voting rights, bypassing Congress, martial law
- "authoritarian_overreach" - Surveillance, federal forces, targeting enemies, purging government
- "corrupt_grift" - Self-dealing, donor payoffs, nepotism, industry handouts
- "performative_bullshit" - Culture war theater, meaningless declarations, distractions

Then write a 4-5 sentence ANGRY translation that:
1. Exposes the REAL agenda (not what they claim)
2. Predicts how Trump will abuse this power
3. Identifies who benefits and who gets screwed
4. Connects to Trump's authoritarian pattern
5. Warns what this leads to next

Also create a one-line shareable hook (max 280 chars).

FORMAT YOUR RESPONSE EXACTLY LIKE THIS:
CATEGORY: [one of the four categories above]
SUMMARY: [Your angry translation]
HOOK: [One-liner for social media]`;

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-5-mini',
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_completion_tokens: 500
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`OpenAI API error ${response.status}:`, errorText);
            throw new Error(`OpenAI API error: ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content;
        
        // Debug: log what we got
        console.log('  📝 Raw API response:', content.substring(0, 200) + '...');
        
        // Parse the response - look for the patterns
        const lines = content.split('\n');
        let category = 'authoritarian_overreach';
        let spicySummary = '';
        let shareableHook = '';
        let currentSection = '';
        
        for (const line of lines) {
            if (line.includes('CATEGORY:')) {
                category = line.split('CATEGORY:')[1].trim().toLowerCase();
                currentSection = 'category';
            } else if (line.includes('SUMMARY:')) {
                currentSection = 'summary';
                const summaryStart = line.split('SUMMARY:')[1];
                if (summaryStart) spicySummary = summaryStart.trim();
            } else if (line.includes('HOOK:')) {
                currentSection = 'hook';
                const hookStart = line.split('HOOK:')[1];
                if (hookStart) shareableHook = hookStart.trim();
            } else if (line.trim()) {
                // Continue building the current section
                if (currentSection === 'summary') {
                    spicySummary += (spicySummary ? ' ' : '') + line.trim();
                } else if (currentSection === 'hook') {
                    shareableHook += (shareableHook ? ' ' : '') + line.trim();
                }
            }
        }
        
        // Ensure we have content
        if (!spicySummary) spicySummary = content;
        if (!shareableHook) shareableHook = spicySummary.substring(0, 280);
        
        // Validate and map category
        let eoImpactType = category;
        if (!Object.values(EO_IMPACT_TYPES).includes(category)) {
            // Try to match partial
            if (category.includes('fascist')) eoImpactType = EO_IMPACT_TYPES.FASCIST;
            else if (category.includes('authoritarian')) eoImpactType = EO_IMPACT_TYPES.AUTHORITARIAN;
            else if (category.includes('corrupt') || category.includes('grift')) eoImpactType = EO_IMPACT_TYPES.CORRUPT;
            else if (category.includes('performative') || category.includes('bullshit')) eoImpactType = EO_IMPACT_TYPES.PERFORMATIVE;
            else eoImpactType = EO_IMPACT_TYPES.AUTHORITARIAN; // Default
        }
        
        // Get the display labels
        const labels = EO_IMPACT_LABELS[eoImpactType];
        
        return {
            eo_impact_type: eoImpactType,
            spicy_summary: spicySummary,
            shareable_hook: shareableHook,
            severity_label_inapp: labels.inapp,
            severity_label_share: labels.share
        };
        
    } catch (error) {
        console.error('Error generating spicy EO translation:', error);
        throw error;
    }
}

/**
 * Calculates API cost for an EO translation
 */
function calculateCost() {
    // All EO translations use gpt-5-mini
    // Rough estimate based on average tokens
    return 0.00054;
}

export { 
    generateSpicyEOTranslation, 
    calculateCost,
    EO_IMPACT_TYPES,
    EO_IMPACT_LABELS 
};
