// check-political-status.js
// Check the current status of political entries spicy summaries

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

// Detect which branch we're on and use appropriate config
const isTestBranch = fs.existsSync(join(__dirname, '..', 'TEST_BRANCH_MARKER.md'));
const configPath = isTestBranch ? '../config/supabase-config-test.js' : '../config/supabase-config-node.js';
const { supabaseRequest } = await import(configPath);

console.log('🔍 CHECKING POLITICAL ENTRIES STATUS');
console.log('=====================================\n');
console.log(`📍 Environment: ${isTestBranch ? 'TEST' : 'PRODUCTION'} database\n`);

try {
    // Get total count of political entries
    const totalEntries = await supabaseRequest('political_entries?select=id&limit=1000');
    console.log(`📊 Total Political Entries: ${totalEntries.length}`);
    
    // Get entries with spicy summaries
    const withSpicy = await supabaseRequest('political_entries?spicy_summary=not.is.null&select=id');
    console.log(`✅ With Spicy Summaries: ${withSpicy.length}`);
    
    // Get entries without spicy summaries
    const withoutSpicy = await supabaseRequest('political_entries?spicy_summary=is.null&select=id,title,actor&limit=5');
    console.log(`❌ Without Spicy Summaries: ${totalEntries.length - withSpicy.length}`);
    
    // Check severity distribution
    const highSev = await supabaseRequest('political_entries?severity=eq.high&select=id');
    const medSev = await supabaseRequest('political_entries?severity=eq.medium&select=id');
    const lowSev = await supabaseRequest('political_entries?severity=eq.low&select=id');
    
    console.log(`\n📈 Severity Distribution:`);
    console.log(`   High: ${highSev.length}`);
    console.log(`   Medium: ${medSev.length}`);
    console.log(`   Low: ${lowSev.length}`);
    
    // Show sample of entries without spicy summaries
    if (withoutSpicy.length > 0) {
        console.log('\n📝 Sample entries needing summaries:');
        withoutSpicy.slice(0, 5).forEach(entry => {
            console.log(`   - [${entry.actor || 'No Actor'}] ${entry.title.substring(0, 50)}...`);
        });
    }
    
    // Get a sample entry with spicy summary to verify format
    const sampleWithSpicy = await supabaseRequest('political_entries?spicy_summary=not.is.null&select=title,actor,spicy_summary,severity,severity_label_inapp,shareable_hook&limit=1');
    if (sampleWithSpicy && sampleWithSpicy.length > 0) {
        console.log('\n✨ Sample entry with spicy summary:');
        const sample = sampleWithSpicy[0];
        console.log(`   Title: ${sample.title.substring(0, 50)}...`);
        console.log(`   Actor: ${sample.actor || 'N/A'}`);
        console.log(`   Severity: ${sample.severity}`);
        console.log(`   Label: ${sample.severity_label_inapp || 'Not set'}`);
        console.log(`   Spicy: "${sample.spicy_summary.substring(0, 100)}..."`);
        console.log(`   Hook: "${sample.shareable_hook || 'Not set'}"`);
    }
    
} catch (error) {
    console.error('❌ Error checking status:', error.message);
    process.exit(1);
}

console.log('\n✅ Status check complete!');
