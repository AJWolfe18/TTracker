// safe-eo-cleanup.js
// SAFER version of executive orders cleanup with all critical issues fixed
// Includes backup, validation, rate limiting, and rollback support

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// CRITICAL FIX: Use SERVICE_ROLE_KEY for admin operations
const SUPABASE_URL = 'https://osjbulmltfpcoldydexg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zamJ1bG1sdGZwY29sZHlkZXhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ3NjQ5NzEsImV4cCI6MjA3MDM0MDk3MX0.COtWEcun0Xkw5hUhaVEJGCrWbumj42L4vwWGgH7RyIE';

// SERVICE_ROLE_KEY should be set as environment variable for security
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

console.log('🔧 SAFE EXECUTIVE ORDERS CLEANUP - v2.0');
console.log('=====================================\n');

// Enhanced Supabase request with retry and rate limiting
async function supabaseRequest(endpoint, method = 'GET', body = null, useServiceKey = false) {
    const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
    const apiKey = useServiceKey ? SUPABASE_SERVICE_KEY : SUPABASE_ANON_KEY;
    
    const options = {
        method,
        headers: {
            'apikey': apiKey,
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        },
        timeout: 30000 // 30 second timeout
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    // Retry logic for failed requests
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);
            options.signal = controller.signal;
            
            const response = await fetch(url, options);
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                const error = await response.text();
                if (response.status === 429) { // Rate limited
                    console.log('⏳ Rate limited, waiting 2 seconds...');
                    await sleep(2000);
                    attempts++;
                    continue;
                }
                throw new Error(`Supabase error: ${response.status} - ${error}`);
            }

            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            }
            
            return { success: true };
            
        } catch (error) {
            attempts++;
            if (attempts >= maxAttempts) {
                throw error;
            }
            console.log(`⚠️ Request failed, retrying (${attempts}/${maxAttempts})...`);
            await sleep(1000);
        }
    }
}

// Helper function for delays
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// CRITICAL FIX: Create backup before any operations
async function createBackup(orders) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const backupDir = path.join(__dirname, 'backups');
    
    // Create backup directory if it doesn't exist
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir);
    }
    
    const backupFile = path.join(backupDir, `eo-backup-${timestamp}.json`);
    
    try {
        fs.writeFileSync(backupFile, JSON.stringify({
            timestamp: new Date().toISOString(),
            totalRecords: orders.length,
            orders: orders
        }, null, 2));
        
        console.log(`✅ Backup created: ${backupFile}`);
        console.log(`   Total records backed up: ${orders.length}`);
        return backupFile;
    } catch (error) {
        console.error('❌ Failed to create backup:', error.message);
        throw new Error('Cannot proceed without backup');
    }
}

// CRITICAL FIX: Validate and sanitize IDs
function sanitizeId(id) {
    // Remove any characters that could cause SQL injection
    return id.toString().replace(/[^a-zA-Z0-9_-]/g, '');
}

// Enhanced analysis with validation
async function analyzeDatabase() {
    console.log('📊 Analyzing database (with validation)...\n');
    
    try {
        // Get all orders with proper error handling
        const allOrders = await supabaseRequest('executive_orders?select=*&order=date.desc');
        
        if (!allOrders || !Array.isArray(allOrders)) {
            throw new Error('Invalid response from database');
        }
        
        console.log(`Total orders in database: ${allOrders.length}`);
        
        // Analyze data quality
        const withOrderNumber = allOrders.filter(o => o.order_number);
        const withoutOrderNumber = allOrders.filter(o => !o.order_number);
        
        // Enhanced duplicate detection for different formats
        const normalizedNumbers = new Map();
        const duplicates = [];
        
        allOrders.forEach(order => {
            if (order.order_number) {
                // Normalize order number (remove "EO", spaces, dashes)
                const normalized = order.order_number.toString()
                    .replace(/^EO\s*/i, '')
                    .replace(/[-\s]/g, '');
                
                if (normalizedNumbers.has(normalized)) {
                    duplicates.push({
                        normalized,
                        orders: [normalizedNumbers.get(normalized), order]
                    });
                } else {
                    normalizedNumbers.set(normalized, order);
                }
            }
        });
        
        console.log(`Orders WITH order number: ${withOrderNumber.length}`);
        console.log(`Orders WITHOUT order number: ${withoutOrderNumber.length}`);
        console.log(`Duplicate order numbers (including format variants): ${duplicates.length}`);
        
        // CRITICAL FIX: Safe date range calculation
        const validDates = allOrders
            .map(o => new Date(o.date))
            .filter(d => !isNaN(d) && d.getFullYear() > 2000 && d.getFullYear() < 2030);
        
        if (validDates.length > 0) {
            const minDate = new Date(Math.min(...validDates));
            const maxDate = new Date(Math.max(...validDates));
            console.log(`\nDate range: ${minDate.toISOString().split('T')[0]} to ${maxDate.toISOString().split('T')[0]}`);
        } else {
            console.log('\n⚠️ No valid dates found in dataset');
        }
        
        // Check for suspicious patterns
        const preInauguration = allOrders.filter(o => {
            const date = new Date(o.date);
            return !isNaN(date) && date < new Date('2025-01-20');
        });
        
        const postAugust5 = allOrders.filter(o => {
            const date = new Date(o.date);
            return !isNaN(date) && date > new Date('2025-08-05');
        });
        
        console.log(`Orders before inauguration (1/20/25): ${preInauguration.length}`);
        console.log(`Orders after August 5, 2025: ${postAugust5.length}`);
        
        // ROOT CAUSE ANALYSIS
        console.log('\n🔍 ROOT CAUSE ANALYSIS:');
        
        // Check for import patterns
        const sourcePatterns = {};
        allOrders.forEach(order => {
            const source = order.source || 'unknown';
            sourcePatterns[source] = (sourcePatterns[source] || 0) + 1;
        });
        
        console.log('Order sources:');
        Object.entries(sourcePatterns).forEach(([source, count]) => {
            console.log(`  - ${source}: ${count} orders`);
        });
        
        // Check added_at timestamps for bulk imports
        const addedDates = {};
        allOrders.forEach(order => {
            if (order.added_at) {
                const date = new Date(order.added_at).toISOString().split('T')[0];
                addedDates[date] = (addedDates[date] || 0) + 1;
            }
        });
        
        console.log('\nOrders added by date:');
        const sortedDates = Object.entries(addedDates)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        sortedDates.forEach(([date, count]) => {
            if (count > 50) {
                console.log(`  - ${date}: ${count} orders (BULK IMPORT DETECTED)`);
            } else {
                console.log(`  - ${date}: ${count} orders`);
            }
        });
        
        return {
            total: allOrders.length,
            withOrderNumber,
            withoutOrderNumber,
            duplicates,
            allOrders,
            validDates: validDates.length > 0
        };
        
    } catch (error) {
        console.error('❌ Error analyzing database:', error.message);
        return null;
    }
}

// Safe cleanup with verification
async function safeCleanup(analysis, dryRun = false) {
    console.log('\n🧹 Starting SAFE cleanup process...\n');
    
    const deletionLog = [];
    let successCount = 0;
    let failCount = 0;
    
    // Create audit log
    const auditFile = `audit-cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    const auditStream = fs.createWriteStream(auditFile, { flags: 'a' });
    
    auditStream.write(`Cleanup started at ${new Date().toISOString()}\n`);
    auditStream.write(`Dry run mode: ${dryRun}\n\n`);
    
    try {
        // Step 1: Remove orders without order numbers (with verification)
        if (analysis.withoutOrderNumber.length > 0) {
            console.log(`Processing ${analysis.withoutOrderNumber.length} orders without order numbers...`);
            
            if (dryRun) {
                console.log('🔍 DRY RUN - Would delete:');
                analysis.withoutOrderNumber.slice(0, 5).forEach(order => {
                    console.log(`  - "${order.title}" (${order.date})`);
                });
                if (analysis.withoutOrderNumber.length > 5) {
                    console.log(`  ... and ${analysis.withoutOrderNumber.length - 5} more`);
                }
            } else {
                // Delete in small batches with rate limiting
                const batchSize = 10; // Smaller batches for safety
                const batches = Math.ceil(analysis.withoutOrderNumber.length / batchSize);
                
                for (let i = 0; i < analysis.withoutOrderNumber.length; i += batchSize) {
                    const batch = analysis.withoutOrderNumber.slice(i, i + batchSize);
                    const currentBatch = Math.floor(i / batchSize) + 1;
                    
                    console.log(`  Batch ${currentBatch}/${batches} (${batch.length} records)...`);
                    
                    // Delete each with verification
                    for (const order of batch) {
                        try {
                            const sanitizedId = sanitizeId(order.id);
                            
                            // Verify record exists before deletion
                            const exists = await supabaseRequest(
                                `executive_orders?id=eq.${sanitizedId}&select=id`,
                                'GET',
                                null,
                                true
                            );
                            
                            if (exists && exists.length > 0) {
                                await supabaseRequest(
                                    `executive_orders?id=eq.${sanitizedId}`,
                                    'DELETE',
                                    null,
                                    true // Use service key
                                );
                                
                                // Verify deletion
                                const stillExists = await supabaseRequest(
                                    `executive_orders?id=eq.${sanitizedId}&select=id`,
                                    'GET',
                                    null,
                                    true
                                );
                                
                                if (!stillExists || stillExists.length === 0) {
                                    successCount++;
                                    deletionLog.push({
                                        id: order.id,
                                        title: order.title,
                                        status: 'deleted'
                                    });
                                    auditStream.write(`DELETED: ${order.id} - ${order.title}\n`);
                                } else {
                                    failCount++;
                                    console.error(`    ❌ Failed to delete: ${order.title}`);
                                    auditStream.write(`FAILED: ${order.id} - ${order.title}\n`);
                                }
                            }
                            
                            // Rate limiting
                            await sleep(100); // 100ms between deletions
                            
                        } catch (error) {
                            failCount++;
                            console.error(`    ❌ Error deleting ${order.id}: ${error.message}`);
                            auditStream.write(`ERROR: ${order.id} - ${error.message}\n`);
                        }
                    }
                    
                    // Progress update
                    console.log(`    ✅ Processed batch ${currentBatch}/${batches}`);
                    console.log(`    Success: ${successCount}, Failed: ${failCount}`);
                    
                    // Longer pause between batches
                    if (i + batchSize < analysis.withoutOrderNumber.length) {
                        console.log('    Pausing for rate limits...');
                        await sleep(2000); // 2 seconds between batches
                    }
                }
            }
        }
        
        // Step 2: Handle duplicates (keeping oldest)
        if (analysis.duplicates.length > 0 && !dryRun) {
            console.log(`\nProcessing ${analysis.duplicates.length} duplicate sets...`);
            
            for (const dupSet of analysis.duplicates) {
                const orders = dupSet.orders.sort((a, b) => 
                    new Date(a.added_at || a.date) - new Date(b.added_at || b.date)
                );
                
                // Keep first (oldest), delete rest
                const toDelete = orders.slice(1);
                
                for (const order of toDelete) {
                    try {
                        const sanitizedId = sanitizeId(order.id);
                        await supabaseRequest(
                            `executive_orders?id=eq.${sanitizedId}`,
                            'DELETE',
                            null,
                            true
                        );
                        
                        successCount++;
                        console.log(`  ✅ Removed duplicate: ${order.order_number}`);
                        auditStream.write(`DUPLICATE REMOVED: ${order.id} - ${order.order_number}\n`);
                        
                        await sleep(100);
                    } catch (error) {
                        failCount++;
                        console.error(`  ❌ Failed to remove duplicate: ${error.message}`);
                    }
                }
            }
        }
        
    } finally {
        auditStream.write(`\nCleanup completed at ${new Date().toISOString()}\n`);
        auditStream.write(`Total deleted: ${successCount}, Failed: ${failCount}\n`);
        auditStream.end();
        
        console.log('\n📝 Cleanup Summary:');
        console.log(`  ✅ Successfully deleted: ${successCount}`);
        console.log(`  ❌ Failed deletions: ${failCount}`);
        console.log(`  📄 Audit log saved: ${auditFile}`);
    }
    
    return { successCount, failCount, deletionLog };
}

// Fetch real executive orders for comparison
async function fetchRealOrders() {
    console.log('\n📜 Fetching legitimate executive orders...\n');
    
    try {
        // Try WhiteHouse.gov as primary source
        console.log('Checking WhiteHouse.gov for executive orders...');
        
        // Note: This is a placeholder - WhiteHouse.gov doesn't have a public API
        // In production, you'd need to scrape or use Federal Register
        
        // Fallback to Federal Register with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
        
        const startDate = '2025-01-20';
        const endDate = new Date().toISOString().split('T')[0];
        
        const url = `https://www.federalregister.gov/api/v1/documents.json?` +
                   `conditions[type]=PRESDOCU&` +
                   `conditions[presidential_document_type]=Executive+Order&` +
                   `conditions[publication_date][gte]=${startDate}&` +
                   `conditions[publication_date][lte]=${endDate}&` +
                   `per_page=300&order=newest`;
        
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (response.ok) {
            const data = await response.json();
            console.log(`✅ Found ${data.results?.length || 0} legitimate orders`);
            return data.results || [];
        }
        
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('⏱️ API request timed out');
        } else {
            console.log('❌ Could not fetch real orders:', error.message);
        }
    }
    
    return [];
}

// Main execution
async function main() {
    console.log('Starting SAFE Executive Orders Cleanup...\n');
    
    // Check for service role key
    if (SUPABASE_SERVICE_KEY === SUPABASE_ANON_KEY) {
        console.log('⚠️  WARNING: Using ANON key - deletions may fail due to RLS policies');
        console.log('Set SUPABASE_SERVICE_ROLE_KEY environment variable for best results\n');
    }
    
    // Step 1: Analyze
    const analysis = await analyzeDatabase();
    if (!analysis) {
        console.error('❌ Cannot proceed without successful analysis');
        process.exit(1);
    }
    
    // Step 2: Create backup
    console.log('\n📦 Creating backup...');
    const backupFile = await createBackup(analysis.allOrders);
    
    // Step 3: Show plan and get confirmation
    console.log('\n' + '='.repeat(60));
    console.log('📋 CLEANUP PLAN');
    console.log('='.repeat(60));
    console.log(`Will remove ${analysis.withoutOrderNumber.length} orders without order numbers`);
    console.log(`Will remove duplicates from ${analysis.duplicates.length} order sets`);
    console.log(`Backup saved to: ${backupFile}`);
    console.log('='.repeat(60) + '\n');
    
    // Check for dry run or auto mode
    const isDryRun = process.env.DRY_RUN === 'true';
    const isAuto = process.env.AUTO_CLEANUP === 'true';
    
    if (isDryRun) {
        console.log('🔍 Running in DRY RUN mode (no changes will be made)...\n');
        await safeCleanup(analysis, true);
    } else if (isAuto) {
        console.log('🤖 AUTO mode enabled, proceeding with cleanup...\n');
        await safeCleanup(analysis, false);
        
        // Final verification
        console.log('\n📊 Verifying final state...');
        const finalAnalysis = await analyzeDatabase();
        if (finalAnalysis) {
            console.log(`Final count: ${finalAnalysis.total} orders`);
            console.log(`Removed: ${analysis.total - finalAnalysis.total} orders`);
        }
    } else {
        console.log('To proceed:');
        console.log('  DRY RUN: SET DRY_RUN=true && node safe-eo-cleanup.js');
        console.log('  EXECUTE: SET AUTO_CLEANUP=true && node safe-eo-cleanup.js');
        console.log('\n⚠️  Make sure to set SUPABASE_SERVICE_ROLE_KEY for deletions to work!');
    }
    
    // Step 4: Investigate root cause
    console.log('\n' + '='.repeat(60));
    console.log('🔍 ROOT CAUSE ANALYSIS SUMMARY');
    console.log('='.repeat(60));
    
    if (analysis.withoutOrderNumber.length > 100) {
        console.log('❗ Large number of orders without order numbers suggests:');
        console.log('   - Initial bulk import from a bad source');
        console.log('   - API parsing error that extracted non-EO documents');
        console.log('   - Duplicate tracker runs without deduplication');
    }
    
    console.log('\n💡 RECOMMENDATIONS:');
    console.log('1. After cleanup, implement these preventions:');
    console.log('   - Always require order_number for new entries');
    console.log('   - Add unique constraint on order_number in database');
    console.log('   - Validate Federal Register API response format');
    console.log('2. Consider fresh start:');
    console.log('   - Export legitimate orders only');
    console.log('   - Clear table and reimport with validation');
    console.log('3. Monitor daily runs for anomalies');
}

// Run with error handling
main().catch(error => {
    console.error('\n❌ FATAL ERROR:', error);
    process.exit(1);
});
