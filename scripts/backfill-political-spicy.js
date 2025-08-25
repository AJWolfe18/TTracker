// backfill-political-spicy.js
// Adds spicy summaries to existing political entries that don't have them
import { supabaseRequest } from '../config/supabase-config-node.js';
import { generateSpicySummary } from './spicy-summaries-integration.js';

console.log('🔥 POLITICAL ENTRIES SPICY SUMMARIES BACKFILL');
console.log('==============================================\n');

// Command line arguments
const args = process.argv.slice(2);
const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 10;
const autoConfirm = args.includes('--yes');
const dryRun = args.includes('--dry-run');

console.log('📊 Configuration:');
console.log(`   Limit: ${limit} articles`);
console.log(`   Auto-confirm: ${autoConfirm}`);
console.log(`   Dry run: ${dryRun}\n`);

async function getEntriesWithoutSpicySummaries(limit) {
    try {
        // Get entries that don't have spicy summaries yet
        const query = `political_entries?spicy_summary=is.null&limit=${limit}&order=date.desc&select=id,title,description,severity,date,actor`;
        const entries = await supabaseRequest(query);
        
        if (!entries || entries.length === 0) {
            console.log('✅ All political entries already have spicy summaries!');
            return [];
        }
        
        console.log(`📰 Found ${entries.length} political entries without spicy summaries`);
        return entries;
        
    } catch (error) {
        console.error('❌ Error fetching entries:', error.message);
        return [];
    }
}

async function updateEntry(entry) {
    try {
        // Generate spicy summary
        const spicyEnhanced = await generateSpicySummary({
            title: entry.title,
            description: entry.description,
            severity: entry.severity || 'medium'
        });
        
        // Update the entry in the database
        const updateData = {
            editorial_summary: entry.description, // Keep original as editorial
            spicy_summary: spicyEnhanced.spicy_summary,
            shareable_hook: spicyEnhanced.shareable_hook,
            severity_label_inapp: spicyEnhanced.severity_label_inapp,
            severity_label_share: spicyEnhanced.severity_label_share
        };
        
        if (!dryRun) {
            await supabaseRequest(`political_entries?id=eq.${entry.id}`, 'PATCH', updateData);
        }
        
        return { success: true, data: spicyEnhanced };
        
    } catch (error) {
        console.error(`   ❌ Error updating entry ${entry.id}:`, error.message);
        return { success: false, error: error.message };
    }
}

async function main() {
    try {
        // Get entries without spicy summaries
        const entries = await getEntriesWithoutSpicySummaries(limit);
        
        if (entries.length === 0) {
            console.log('\n✨ No entries to process!');
            return;
        }
        
        // Show what we're about to do
        console.log('\n📋 Entries to process:');
        entries.forEach((entry, idx) => {
            console.log(`   ${idx + 1}. [${entry.date}] ${entry.actor}: ${entry.title.substring(0, 60)}...`);
        });
        
        // Calculate cost
        const estimatedCost = entries.length * 0.00075; // Average cost per article
        console.log(`\n💰 Estimated cost: $${estimatedCost.toFixed(4)}`);
        
        // Confirm if not auto-confirmed
        if (!autoConfirm && !dryRun) {
            console.log('\n⚠️  Press Ctrl+C to cancel, or wait 5 seconds to continue...');
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
        if (dryRun) {
            console.log('\n🔍 DRY RUN MODE - No changes will be made\n');
        } else {
            console.log('\n🚀 Starting backfill...\n');
        }
        
        // Process each entry
        let successCount = 0;
        let failCount = 0;
        let totalCost = 0;
        
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            console.log(`\n[${i + 1}/${entries.length}] Processing: ${entry.title.substring(0, 60)}...`);
            
            const result = await updateEntry(entry);
            
            if (result.success) {
                successCount++;
                totalCost += 0.00075; // Track actual cost
                console.log(`   ✅ Success!`);
                if (result.data.shareable_hook) {
                    console.log(`   📱 Hook: "${result.data.shareable_hook}"`);
                }
            } else {
                failCount++;
                console.log(`   ❌ Failed: ${result.error}`);
            }
            
            // Add small delay to avoid rate limiting
            if (!dryRun && i < entries.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        // Summary
        console.log('\n' + '='.repeat(50));
        console.log('📊 BACKFILL COMPLETE\n');
        console.log(`   Processed: ${entries.length} entries`);
        console.log(`   Success: ${successCount}`);
        console.log(`   Failed: ${failCount}`);
        console.log(`   Total cost: $${totalCost.toFixed(4)}`);
        
        if (dryRun) {
            console.log('\n   (This was a dry run - no changes were made)');
        }
        
    } catch (error) {
        console.error('\n❌ Fatal error:', error.message);
        process.exit(1);
    }
}

// Run the backfill
main();
