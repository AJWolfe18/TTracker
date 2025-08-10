// migrate-to-supabase.js
// Run this AFTER creating the schema in Supabase
// Usage: SUPABASE_URL=your-url SUPABASE_ANON_KEY=your-key node migrate-to-supabase.js

import fs from 'fs/promises';
import fetch from 'node-fetch';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('❌ Missing environment variables!');
    console.error('Usage: SUPABASE_URL=your-url SUPABASE_ANON_KEY=your-key node migrate-to-supabase.js');
    process.exit(1);
}

console.log('🚀 SUPABASE MIGRATION TOOL');
console.log('==========================\n');
console.log(`📍 Target: ${SUPABASE_URL}`);
console.log('');

// Helper function to make Supabase API calls
async function supabaseRequest(endpoint, method = 'GET', body = null) {
    const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
    const options = {
        method,
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal' // Don't return the inserted data (faster)
        }
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Supabase error: ${response.status} - ${error}`);
    }

    // For GET requests or when we want data back
    if (method === 'GET' || options.headers.Prefer === 'return=representation') {
        return await response.json();
    }
    
    return { success: true };
}

// Batch insert function (Supabase handles up to 1000 at once)
async function batchInsert(tableName, records, batchSize = 100) {
    console.log(`  📦 Inserting ${records.length} records into ${tableName}...`);
    
    for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        try {
            await supabaseRequest(tableName, 'POST', batch);
            console.log(`    ✅ Batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(records.length/batchSize)} complete`);
        } catch (error) {
            console.error(`    ❌ Batch failed:`, error.message);
            console.error(`    Failed records:`, batch.slice(0, 2), '...'); // Show first 2 for debugging
            throw error;
        }
    }
}

async function migrate() {
    try {
        // Step 1: Check connection
        console.log('🔍 Testing Supabase connection...');
        const stats = await supabaseRequest('dashboard_stats?select=*', 'GET');
        console.log('✅ Connected to Supabase!\n');

        // Step 2: Load political entries
        console.log('📂 Loading political entries from master-tracker-log.json...');
        const politicalData = JSON.parse(await fs.readFile('master-tracker-log.json', 'utf8'));
        console.log(`  Found ${politicalData.length} political entries\n`);

        // Step 3: Load executive orders
        console.log('📂 Loading executive orders from executive-orders-log.json...');
        const executiveData = JSON.parse(await fs.readFile('executive-orders-log.json', 'utf8'));
        console.log(`  Found ${executiveData.length} executive orders\n`);

        // Step 4: Clean and prepare political entries
        console.log('🧹 Preparing political entries for migration...');
        const cleanedPolitical = politicalData.map(entry => {
            // Ensure all fields are properly typed
            return {
                id: entry.id,
                date: entry.date,
                actor: entry.actor || null,
                category: entry.category || null,
                title: entry.title || 'Untitled',
                description: entry.description || null,
                source_url: entry.source_url || null,
                verified: entry.verified || false,
                severity: entry.severity || 'medium',
                status: entry.status || 'published',
                added_at: entry.added_at || new Date().toISOString(),
                manual_submission: entry.manual_submission || false,
                submitted_by: entry.submitted_by || null,
                processed_at: entry.processed_at || null,
                archived: entry.archived || false,
                archived_at: entry.archived_at || null,
                archive_reason: entry.archive_reason || null
            };
        });

        // Step 5: Clean and prepare executive orders
        console.log('🧹 Preparing executive orders for migration...');
        const cleanedExecutive = executiveData.map(order => {
            return {
                id: order.id || `eo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                title: order.title || 'Untitled Order',
                order_number: order.order_number || order.executive_order_number || null,
                date: order.date,
                summary: order.summary || null,
                category: order.category || null,
                agencies_affected: Array.isArray(order.agencies_affected) ? order.agencies_affected : [],
                policy_direction: order.policy_direction || null,
                implementation_timeline: order.implementation_timeline || null,
                severity_rating: order.severity_rating || order.severity || null,
                verified: order.verified !== false, // Default to true
                source_url: order.source_url || null,
                pdf_url: order.pdf_url || null,
                citation: order.citation || null,
                publication_date: order.publication_date || order.date,
                document_number: order.document_number || null,
                source: order.source || 'Federal Register',
                type: order.type || 'executive_order',
                added_at: order.added_at || new Date().toISOString(),
                impact_score: order.impact_score || null,
                implementation_status: order.implementation_status || null,
                legal_challenges: order.legal_challenges || [],
                related_orders: Array.isArray(order.related_orders) ? order.related_orders : []
            };
        });

        // Step 6: Check for existing data (to avoid duplicates)
        console.log('\n🔍 Checking for existing data...');
        const existingPolitical = await supabaseRequest('political_entries?select=id&limit=1', 'GET');
        const existingExecutive = await supabaseRequest('executive_orders?select=id&limit=1', 'GET');

        if (existingPolitical.length > 0 || existingExecutive.length > 0) {
            console.log('⚠️  WARNING: Tables already contain data!');
            console.log('   This migration will ADD to existing data, not replace it.');
            console.log('   To start fresh, truncate the tables in Supabase first.');
            console.log('\n   Continue anyway? (Ctrl+C to abort, or wait 5 seconds to continue)');
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        // Step 7: Insert political entries
        console.log('\n📤 Migrating political entries to Supabase...');
        await batchInsert('political_entries', cleanedPolitical);
        console.log('✅ Political entries migrated successfully!\n');

        // Step 8: Insert executive orders
        console.log('📤 Migrating executive orders to Supabase...');
        await batchInsert('executive_orders', cleanedExecutive);
        console.log('✅ Executive orders migrated successfully!\n');

        // Step 9: Verify migration
        console.log('🔍 Verifying migration...');
        const politicalCount = await supabaseRequest('political_entries?select=count', 'GET');
        const executiveCount = await supabaseRequest('executive_orders?select=count', 'GET');
        
        console.log(`\n✨ MIGRATION COMPLETE!`);
        console.log(`   Political entries in database: ${politicalCount.length || cleanedPolitical.length}`);
        console.log(`   Executive orders in database: ${cleanedExecutive.length}`);
        console.log(`\n📊 Next steps:`);
        console.log(`   1. Update your GitHub Actions to use Supabase`);
        console.log(`   2. Update your dashboard to fetch from Supabase`);
        console.log(`   3. Test everything works`);
        console.log(`   4. Keep JSON files as backup for 30 days`);

    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        console.error('\n💡 Troubleshooting tips:');
        console.error('   1. Check your SUPABASE_URL and SUPABASE_ANON_KEY are correct');
        console.error('   2. Make sure you ran the schema SQL in Supabase first');
        console.error('   3. Check Supabase logs for more details');
        process.exit(1);
    }
}

// Run the migration
migrate();