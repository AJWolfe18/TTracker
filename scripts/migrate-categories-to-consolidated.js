// migrate-categories-to-consolidated.js
// Migrates existing political entries from 8 categories to new 7-category system
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

// Detect which branch and use appropriate config
const isTestBranch = fs.existsSync(join(__dirname, '..', 'TEST_BRANCH_MARKER.md'));
const configPath = isTestBranch ? '../config/supabase-config-test.js' : '../config/supabase-config-node.js';
const { supabaseRequest } = await import(configPath);

console.log('🔄 CATEGORY CONSOLIDATION MIGRATION');
console.log('=====================================\n');
console.log(`📍 Environment: ${isTestBranch ? 'TEST' : 'PRODUCTION'} database\n`);

// Category mapping from old to new - Including common search prompt contamination
const CATEGORY_MAPPING = {
    // ========== VALID OLD CATEGORIES ==========
    // Old 8-category system → New 7-category system
    'corruption': 'corruption_scandals',
    'scandal': 'corruption_scandals',
    'ethics': 'corruption_scandals',
    'investigation': 'corruption_scandals',
    
    'democracy': 'democracy_elections',
    'election': 'democracy_elections',
    'voting': 'democracy_elections',
    
    'policy': 'policy_legislation',
    'legislation': 'policy_legislation',
    'regulatory': 'policy_legislation',
    
    'justice': 'justice_legal',
    'judicial': 'justice_legal',
    'legal': 'justice_legal',
    'doj': 'justice_legal',
    
    'executive': 'executive_actions',
    'presidential': 'executive_actions',
    
    'foreign': 'foreign_policy',
    'international': 'foreign_policy',
    'trade': 'foreign_policy',
    
    // ========== BEST EFFORT MAPPING FOR CONTAMINATED DATA ==========
    // These are search prompt names that leaked into categories
    // Map them as best we can, knowing they'll be re-analyzed soon
    
    // Corruption/Ethics related
    'government oversight': 'corruption_scandals',
    'corporate ethics': 'corruption_scandals',
    'platform manipulation': 'corruption_scandals',
    'financial': 'corruption_scandals',
    'government contracts': 'corruption_scandals',
    'corporate & financial': 'corruption_scandals',
    'business': 'corruption_scandals',
    'ethics': 'corruption_scandals',
    
    // Legal/Justice related  
    'legal proceedings': 'justice_legal',
    'legal proceeding': 'justice_legal',
    'doj & law enforcement': 'justice_legal',
    'courts & legal': 'justice_legal',
    'legal': 'justice_legal',
    'legal analysis': 'justice_legal',
    
    // Policy/Government related
    'policy': 'policy_legislation',
    'government efficiency': 'policy_legislation',
    'policy implementation changes': 'policy_legislation',
    'policy implementation': 'policy_legislation',
    'regulatory actions': 'policy_legislation',
    'regulatory action': 'policy_legislation',
    'regulatory actions or rollbacks': 'policy_legislation',
    'federal agencies': 'policy_legislation',
    'agency restructuring': 'policy_legislation',
    'agency restructuring or closures': 'policy_legislation',
    'budget and operational changes': 'policy_legislation',
    'budget or operational changes': 'policy_legislation',
    'budget': 'policy_legislation',
    'leadership appointments': 'policy_legislation',
    'leadership appointments or departures': 'policy_legislation',
    'government efficiency recommendations': 'policy_legislation',
    'policy announcement': 'policy_legislation',
    'policy shifts in enforcement priorities': 'policy_legislation',
    'public statements on government policy': 'policy_legislation',
    'elon musk & doge': 'policy_legislation',
    
    // Democracy/Political related
    'election integrity': 'democracy_elections',
    'political influence': 'democracy_elections',
    'political interference concerns': 'democracy_elections',
    'political news': 'democracy_elections',
    'political support': 'democracy_elections',
    'civil liberties': 'democracy_elections',
    
    // Executive related
    'trump & family': 'executive_actions',
    
    // Keep these as-is if already correct
    'corruption_scandals': 'corruption_scandals',
    'democracy_elections': 'democracy_elections',
    'policy_legislation': 'policy_legislation',
    'justice_legal': 'justice_legal',
    'executive_actions': 'executive_actions',
    'foreign_policy': 'foreign_policy',
    'other': 'other'
};

// Command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : null;

console.log('📊 Configuration:');
console.log(`   Dry run: ${dryRun}`);
console.log(`   Limit: ${limit || 'No limit (all entries)'}\n`);

async function analyzeCategories() {
    console.log('📈 Analyzing current category distribution...\n');
    
    try {
        // Get all unique categories and their counts
        const query = 'political_entries?select=category';
        const entries = await supabaseRequest(query);
        
        if (!entries || entries.length === 0) {
            console.log('No entries found in database');
            return {};
        }
        
        // Count categories
        const categoryCounts = {};
        entries.forEach(entry => {
            const cat = entry.category || 'null';
            categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
        });
        
        // Display current distribution
        console.log('Current Categories:');
        Object.entries(categoryCounts)
            .sort((a, b) => b[1] - a[1])
            .forEach(([cat, count]) => {
                const newCat = CATEGORY_MAPPING[cat] || 'other';
                const arrow = cat !== newCat ? ` → ${newCat}` : ' (no change)';
                console.log(`  ${cat}: ${count} entries${arrow}`);
            });
        
        return categoryCounts;
        
    } catch (error) {
        console.error('❌ Error analyzing categories:', error.message);
        return {};
    }
}

async function migrateCategories() {
    console.log('\n🚀 Starting category migration...\n');
    
    try {
        // Get all entries that need migration
        let query = 'political_entries?select=id,category&order=id.asc';
        if (limit) {
            query += `&limit=${limit}`;
        }
        
        const entries = await supabaseRequest(query);
        
        if (!entries || entries.length === 0) {
            console.log('No entries to migrate');
            return;
        }
        
        console.log(`Found ${entries.length} entries to check\n`);
        
        // Track migration stats
        let migrated = 0;
        let skipped = 0;
        let errors = 0;
        
        // Process each entry
        for (const entry of entries) {
            const oldCategory = entry.category;
            // Normalize to lowercase for mapping
        const normalizedCategory = oldCategory ? oldCategory.toLowerCase().trim() : null;
        const newCategory = CATEGORY_MAPPING[normalizedCategory] || 'other';
            
            // Skip if already correct
            if (oldCategory === newCategory) {
                skipped++;
                continue;
            }
            
            if (dryRun) {
                console.log(`  [DRY RUN] ID ${entry.id}: ${oldCategory} → ${newCategory}`);
                migrated++;
            } else {
                try {
                    // Update the category
                    await supabaseRequest(
                        `political_entries?id=eq.${entry.id}`,
                        'PATCH',
                        { category: newCategory }
                    );
                    console.log(`  ✅ ID ${entry.id}: ${oldCategory} → ${newCategory}`);
                    migrated++;
                } catch (updateError) {
                    console.error(`  ❌ ID ${entry.id}: Failed - ${updateError.message}`);
                    errors++;
                }
            }
            
            // Progress indicator every 50 entries
            if ((migrated + skipped) % 50 === 0) {
                console.log(`    Progress: ${migrated + skipped}/${entries.length} processed...`);
            }
        }
        
        // Final summary
        console.log('\n' + '='.repeat(50));
        console.log('📊 MIGRATION SUMMARY:\n');
        console.log(`  Total entries processed: ${entries.length}`);
        console.log(`  Migrated: ${migrated}`);
        console.log(`  Skipped (already correct): ${skipped}`);
        console.log(`  Errors: ${errors}`);
        
        if (dryRun) {
            console.log('\n⚠️  DRY RUN - No actual changes were made');
            console.log('   Remove --dry-run flag to apply changes');
        }
        
    } catch (error) {
        console.error('❌ Migration error:', error.message);
    }
}

async function verifyMigration() {
    console.log('\n✅ Verifying migration results...\n');
    
    const categoryCounts = await analyzeCategories();
    
    // Check for any old categories remaining
    const oldCategories = Object.keys(categoryCounts).filter(cat => 
        !['corruption_scandals', 'democracy_elections', 'policy_legislation', 
          'justice_legal', 'executive_actions', 'foreign_policy', 'other'].includes(cat)
    );
    
    if (oldCategories.length > 0) {
        console.log('\n⚠️  Old categories still present:');
        oldCategories.forEach(cat => {
            console.log(`  - ${cat}: ${categoryCounts[cat]} entries`);
        });
    } else {
        console.log('\n✅ All categories successfully migrated to new system!');
    }
}

// Main execution
async function main() {
    console.log('Starting category consolidation migration...\n');
    
    // Step 1: Analyze current state
    await analyzeCategories();
    
    // Step 2: Confirm before proceeding
    if (!dryRun && !args.includes('--yes')) {
        console.log('\n⚠️  This will update categories in the database');
        console.log('   Add --dry-run to preview changes');
        console.log('   Add --yes to skip confirmation\n');
        
        const readline = await import('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        const answer = await new Promise(resolve => {
            rl.question('Proceed with migration? (y/n): ', resolve);
        });
        rl.close();
        
        if (answer.toLowerCase() !== 'y') {
            console.log('Migration cancelled');
            return;
        }
    }
    
    // Step 3: Run migration
    await migrateCategories();
    
    // Step 4: Verify results
    if (!dryRun) {
        await verifyMigration();
    }
    
    console.log('\n✨ Migration complete!');
}

// Run the migration
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
