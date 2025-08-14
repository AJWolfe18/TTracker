// quick-check-eos.js
// Quick script to check current EO state and identify bad records

import { supabaseRequest } from './supabase-config-node.js';

async function quickCheck() {
    console.log('🔍 QUICK EO DATABASE CHECK');
    console.log('=========================\n');
    
    try {
        // Get all executive orders
        const executiveOrders = await supabaseRequest('executive_orders?select=*&order=date.desc&limit=500');
        console.log(`📊 Total Executive Orders: ${executiveOrders.length}`);
        
        // Check for orders without order_number
        const withoutOrderNumber = executiveOrders.filter(eo => !eo.order_number);
        const withOrderNumber = executiveOrders.filter(eo => eo.order_number);
        
        console.log(`✅ With Order Number: ${withOrderNumber.length}`);
        console.log(`❌ WITHOUT Order Number: ${withoutOrderNumber.length}`);
        
        if (withoutOrderNumber.length > 0) {
            console.log('\n⚠️  Found bad records without order numbers!');
            console.log('These are likely NOT real Executive Orders.\n');
            
            // Show sample of bad records
            console.log('Sample of bad records (first 3):');
            withoutOrderNumber.slice(0, 3).forEach(eo => {
                console.log(`  - ${eo.date}: ${eo.title?.substring(0, 60)}...`);
            });
        }
        
        // Get unique order numbers to check for real count
        const uniqueOrderNumbers = [...new Set(withOrderNumber.map(eo => eo.order_number))];
        console.log(`\n📋 Unique Order Numbers: ${uniqueOrderNumbers.length}`);
        
        // Expected range (Trump's EOs started at 13765 in 2017, likely around 14900s now)
        console.log('\n📈 Order Number Analysis:');
        const orderNums = withOrderNumber
            .map(eo => parseInt(eo.order_number))
            .filter(n => !isNaN(n))
            .sort((a, b) => a - b);
        
        if (orderNums.length > 0) {
            console.log(`  Lowest: ${orderNums[0]}`);
            console.log(`  Highest: ${orderNums[orderNums.length - 1]}`);
            console.log(`  Expected range for 2025: ~14900-15100`);
        }
        
        // Date range check
        const dates = executiveOrders.map(eo => eo.date).filter(d => d).sort();
        if (dates.length > 0) {
            console.log(`\n📅 Date Range: ${dates[0]} to ${dates[dates.length - 1]}`);
        }
        
        console.log('\n' + '='.repeat(50));
        if (withoutOrderNumber.length > 0) {
            console.log('🔧 RECOMMENDATION: Run cleanup to remove bad records');
            console.log(`   This will delete ${withoutOrderNumber.length} records without order numbers`);
        } else {
            console.log('✅ Database looks clean - all EOs have order numbers');
        }
        
    } catch (error) {
        console.error('❌ Error checking database:', error.message);
    }
}

quickCheck();
