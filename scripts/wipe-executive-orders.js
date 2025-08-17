// COMPLETE WIPE - Delete ALL executive orders from production
// This cleans the slate so we can start fresh with correct data

import { supabaseRequest } from '../config/supabase-config-node.js';

console.log('🗑️  COMPLETE EXECUTIVE ORDERS WIPE');
console.log('==================================\n');

async function wipeAllExecutiveOrders() {
    try {
        console.log('📊 Checking current database state...');
        
        // Get count first
        const allOrders = await supabaseRequest('executive_orders?select=id,order_number');
        console.log(`   Found ${allOrders.length} executive orders to delete`);
        
        if (allOrders.length === 0) {
            console.log('✨ Database is already clean!');
            return;
        }
        
        console.log('\\n⚠️  WARNING: This will delete ALL executive orders!');
        console.log('   This action cannot be undone.');
        console.log('   Press Ctrl+C to cancel, or wait 5 seconds to proceed...');
        
        // 5 second delay
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        console.log('\\n🗑️  Starting deletion process...');
        
        // Delete in batches of 50 to avoid timeouts
        const batchSize = 50;
        let deleted = 0;
        
        for (let i = 0; i < allOrders.length; i += batchSize) {
            const batch = allOrders.slice(i, i + batchSize);
            
            console.log(`   Deleting batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(allOrders.length/batchSize)} (${batch.length} records)...`);
            
            for (const order of batch) {
                try {
                    await supabaseRequest(`executive_orders?id=eq.${order.id}`, 'DELETE');
                    deleted++;
                } catch (error) {
                    console.error(`     ❌ Failed to delete ${order.id}:`, error.message);
                }
            }
            
            // Small delay between batches
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        console.log(`\\n✨ Wipe complete!`);
        console.log(`   Deleted: ${deleted} executive orders`);
        console.log(`   Database is now clean and ready for fresh import`);
        
        // Verify clean state
        const remaining = await supabaseRequest('executive_orders?select=id');
        console.log(`   Verification: ${remaining.length} records remaining`);
        
    } catch (error) {
        console.error('❌ Error during wipe:', error.message);
        console.log('\\n⚠️  Some records may remain. Check database manually.');
    }
}

// Run the wipe
wipeAllExecutiveOrders();
