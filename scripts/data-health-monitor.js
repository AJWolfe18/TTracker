// Dashboard data health monitor - adds indicator for missing fields
// This script can be integrated into the admin panel or run periodically

const fetch = require('node-fetch');

// Production database configuration
const PROD_SUPABASE_URL = 'https://osjbulmltfpcoldydexg.supabase.co';
const PROD_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zamJ1bG1sdGZwY29sZHlkZXhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ3NjQ5NzEsImV4cCI6MjA3MDM0MDk3MX0.COtWEcun0Xkw5hUhaVEJGCrWbumj42L4vwWGgH7RyIE';

// Test database configuration (if different)
const TEST_SUPABASE_URL = process.env.SUPABASE_TEST_URL || PROD_SUPABASE_URL;
const TEST_SUPABASE_ANON_KEY = process.env.SUPABASE_TEST_ANON_KEY || PROD_SUPABASE_ANON_KEY;

async function checkDataHealth(environment = 'production') {
    const url = environment === 'test' ? TEST_SUPABASE_URL : PROD_SUPABASE_URL;
    const key = environment === 'test' ? TEST_SUPABASE_ANON_KEY : PROD_SUPABASE_ANON_KEY;
    
    console.log(`\n🏥 Data Health Check - ${environment.toUpperCase()}`);
    console.log('='.repeat(60));
    
    const report = {
        timestamp: new Date().toISOString(),
        environment,
        executiveOrders: {
            total: 0,
            complete: 0,
            missingFields: [],
            critical: []
        },
        politicalEntries: {
            total: 0,
            withSpicy: 0,
            withoutSpicy: 0,
            recentWithoutSpicy: []
        },
        recommendations: []
    };
    
    try {
        // Check Executive Orders
        const eoResponse = await fetch(`${url}/rest/v1/executive_orders?order=order_number.desc`, {
            headers: {
                'apikey': key,
                'Authorization': `Bearer ${key}`
            }
        });
        
        const eos = await eoResponse.json();
        report.executiveOrders.total = eos.length;
        
        eos.forEach(eo => {
            const hasImpact = !!eo.eo_impact_type;
            const hasSpicy = !!eo.spicy_summary;
            
            if (hasImpact && hasSpicy) {
                report.executiveOrders.complete++;
            } else {
                const issue = {
                    number: eo.order_number,
                    title: eo.title?.substring(0, 50),
                    missingImpact: !hasImpact,
                    missingSpicy: !hasSpicy
                };
                report.executiveOrders.missingFields.push(issue);
                
                // Check for specific critical EOs
                if (eo.order_number === '14338') {
                    report.executiveOrders.critical.push({
                        ...issue,
                        note: 'User specifically reported this EO'
                    });
                }
            }
        });
        
        // Check Political Entries (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const dateStr = thirtyDaysAgo.toISOString().split('T')[0];
        
        const politicalResponse = await fetch(
            `${url}/rest/v1/political_entries?date=gte.${dateStr}&order=date.desc`,
            {
                headers: {
                    'apikey': key,
                    'Authorization': `Bearer ${key}`
                }
            }
        );
        
        const politicalEntries = await politicalResponse.json();
        report.politicalEntries.total = politicalEntries.length;
        
        politicalEntries.forEach(entry => {
            if (entry.spicy_summary) {
                report.politicalEntries.withSpicy++;
            } else {
                report.politicalEntries.withoutSpicy++;
                report.politicalEntries.recentWithoutSpicy.push({
                    id: entry.id,
                    title: entry.title?.substring(0, 50),
                    date: entry.date
                });
            }
        });
        
        // Generate recommendations
        if (report.executiveOrders.missingFields.length > 0) {
            report.recommendations.push({
                priority: 'HIGH',
                action: 'Run EO spicy translation backfill',
                command: 'node scripts/backfill-executive-spicy-v2.js --limit 500 --yes',
                impact: `Fix ${report.executiveOrders.missingFields.length} EOs missing fields`,
                estimatedTime: '5-10 minutes',
                estimatedCost: '$0.15-0.30'
            });
        }
        
        if (report.politicalEntries.recentWithoutSpicy.length > 10) {
            report.recommendations.push({
                priority: 'MEDIUM',
                action: 'Run political entries spicy backfill',
                command: 'node scripts/backfill-political-spicy.js --recent',
                impact: `Add spicy summaries to ${report.politicalEntries.recentWithoutSpicy.length} recent articles`,
                estimatedTime: '10-15 minutes',
                estimatedCost: '$0.30-0.50'
            });
        }
        
        // Output report
        console.log('\n📊 EXECUTIVE ORDERS');
        console.log(`   Total: ${report.executiveOrders.total}`);
        console.log(`   ✅ Complete: ${report.executiveOrders.complete} (${(report.executiveOrders.complete/report.executiveOrders.total*100).toFixed(1)}%)`);
        console.log(`   ❌ Missing fields: ${report.executiveOrders.missingFields.length}`);
        
        if (report.executiveOrders.critical.length > 0) {
            console.log('\n   🚨 CRITICAL ISSUES:');
            report.executiveOrders.critical.forEach(eo => {
                console.log(`      EO ${eo.number}: ${eo.note}`);
                console.log(`         Missing: ${eo.missingImpact ? 'impact_type' : ''} ${eo.missingSpicy ? 'spicy_summary' : ''}`);
            });
        }
        
        console.log('\n📰 POLITICAL ENTRIES (Last 30 days)');
        console.log(`   Total: ${report.politicalEntries.total}`);
        console.log(`   ✅ With spicy: ${report.politicalEntries.withSpicy}`);
        console.log(`   ❌ Without spicy: ${report.politicalEntries.withoutSpicy}`);
        
        if (report.recommendations.length > 0) {
            console.log('\n💡 RECOMMENDATIONS');
            report.recommendations.forEach(rec => {
                console.log(`\n   [${rec.priority}] ${rec.action}`);
                console.log(`   Impact: ${rec.impact}`);
                console.log(`   Command: ${rec.command}`);
                console.log(`   Time: ${rec.estimatedTime} | Cost: ${rec.estimatedCost}`);
            });
        } else {
            console.log('\n✅ No immediate actions required - data is healthy!');
        }
        
        // Return report for potential API integration
        return report;
        
    } catch (error) {
        console.error('❌ Error checking data health:', error.message);
        report.error = error.message;
        return report;
    }
}

// If running directly
if (require.main === module) {
    const env = process.argv.includes('--test') ? 'test' : 'production';
    checkDataHealth(env).then(report => {
        // Could write to file or send to monitoring service
        if (process.argv.includes('--json')) {
            console.log('\n📄 JSON Report:');
            console.log(JSON.stringify(report, null, 2));
        }
    });
}

module.exports = { checkDataHealth };
