// Script to check for Executive Orders with missing spicy translation fields
// This helps identify which EOs need to be backfilled

const fetch = require('node-fetch');

const SUPABASE_URL = 'https://wnrjrywpcadwutfykflu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zamJ1bG1sdGZwY29sZHlkZXhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ3NjQ5NzEsImV4cCI6MjA3MDM0MDk3MX0.COtWEcun0Xkw5hUhaVEJGCrWbumj42L4vwWGgH7RyIE';

async function checkMissingFields() {
    console.log('='.repeat(60));
    console.log('EXECUTIVE ORDER FIELD VALIDATION REPORT');
    console.log('='.repeat(60));
    
    try {
        // First check EO 14338 specifically
        console.log('\n📋 Checking EO 14338 specifically...');
        // ADO-285: Ensure proper URL encoding for VARCHAR field
        const eo14338Response = await fetch(`${SUPABASE_URL}/rest/v1/executive_orders?order_number=eq.${encodeURIComponent('14338')}`, {
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            }
        });
        
        const eo14338Data = await eo14338Response.json();
        
        if (eo14338Data && eo14338Data.length > 0) {
            const eo = eo14338Data[0];
            console.log(`\n✅ Found EO 14338: "${eo.title}"`);
            console.log(`   Date: ${eo.date}`);
            console.log(`   eo_impact_type: ${eo.eo_impact_type || '❌ MISSING'}`);
            console.log(`   spicy_summary: ${eo.spicy_summary ? '✅ Present (' + eo.spicy_summary.length + ' chars)' : '❌ MISSING'}`);
            console.log(`   shareable_hook: ${eo.shareable_hook ? '✅ Present' : '❌ MISSING'}`);
            console.log(`   severity_label_inapp: ${eo.severity_label_inapp || '❌ MISSING'}`);
        } else {
            console.log('❌ EO 14338 NOT FOUND in database!');
        }
        
        // Get all EOs to check for missing fields
        console.log('\n📊 Analyzing all Executive Orders...');
        const allEOsResponse = await fetch(`${SUPABASE_URL}/rest/v1/executive_orders?order=order_number.desc`, {
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            }
        });
        
        const allEOs = await allEOsResponse.json();
        
        // Categorize by missing fields
        const analysis = {
            total: allEOs.length,
            complete: [],
            missingBoth: [],
            missingImpactOnly: [],
            missingSpicyOnly: [],
            recentEOs: [] // EOs from last 30 days
        };
        
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        allEOs.forEach(eo => {
            const hasImpact = !!eo.eo_impact_type;
            const hasSpicy = !!eo.spicy_summary;
            const eoDate = new Date(eo.date);
            
            const eoInfo = {
                number: eo.order_number,
                title: eo.title ? eo.title.substring(0, 50) : 'NO TITLE',
                date: eo.date
            };
            
            if (eoDate > thirtyDaysAgo) {
                analysis.recentEOs.push({
                    ...eoInfo,
                    hasImpact,
                    hasSpicy
                });
            }
            
            if (!hasImpact && !hasSpicy) {
                analysis.missingBoth.push(eoInfo);
            } else if (!hasImpact) {
                analysis.missingImpactOnly.push(eoInfo);
            } else if (!hasSpicy) {
                analysis.missingSpicyOnly.push(eoInfo);
            } else {
                analysis.complete.push(eoInfo);
            }
        });
        
        // Print summary
        console.log('\n' + '='.repeat(60));
        console.log('SUMMARY STATISTICS');
        console.log('='.repeat(60));
        console.log(`Total Executive Orders: ${analysis.total}`);
        console.log(`✅ Complete (has both fields): ${analysis.complete.length} (${(analysis.complete.length/analysis.total*100).toFixed(1)}%)`);
        console.log(`❌ Missing BOTH fields: ${analysis.missingBoth.length} (${(analysis.missingBoth.length/analysis.total*100).toFixed(1)}%)`);
        console.log(`⚠️  Missing impact type only: ${analysis.missingImpactOnly.length}`);
        console.log(`⚠️  Missing spicy summary only: ${analysis.missingSpicyOnly.length}`);
        
        // Show recent EOs that might need attention
        if (analysis.recentEOs.length > 0) {
            console.log('\n📅 Recent EOs (last 30 days):');
            analysis.recentEOs.forEach(eo => {
                const status = eo.hasImpact && eo.hasSpicy ? '✅' : '❌';
                console.log(`   ${status} EO ${eo.number} (${eo.date}): ${eo.title}`);
                if (!eo.hasImpact || !eo.hasSpicy) {
                    console.log(`      Missing: ${!eo.hasImpact ? 'impact_type' : ''} ${!eo.hasSpicy ? 'spicy_summary' : ''}`);
                }
            });
        }
        
        // Show EOs needing backfill
        if (analysis.missingBoth.length > 0) {
            console.log('\n🔴 EOs NEEDING FULL BACKFILL (missing both fields):');
            console.log(`   Total: ${analysis.missingBoth.length} orders`);
            
            // Get order number ranges for easier understanding
            const numbers = analysis.missingBoth.map(eo => parseInt(eo.number)).filter(n => !isNaN(n)).sort((a,b) => a-b);
            if (numbers.length > 0) {
                console.log(`   Order number range: ${numbers[0]} to ${numbers[numbers.length-1]}`);
                
                // Show first 5 as examples
                console.log('\n   Examples (first 5):');
                analysis.missingBoth.slice(0, 5).forEach(eo => {
                    console.log(`   - EO ${eo.number} (${eo.date}): ${eo.title}...`);
                });
            }
        }
        
        // Recommendation
        console.log('\n' + '='.repeat(60));
        console.log('RECOMMENDATIONS');
        console.log('='.repeat(60));
        
        if (analysis.missingBoth.length > 0) {
            console.log('🔧 ACTION REQUIRED:');
            console.log(`   ${analysis.missingBoth.length} Executive Orders need spicy translation backfill`);
            console.log('\n   To fix, run:');
            console.log('   node scripts/backfill-executive-spicy-v2.js --limit 500 --yes');
            console.log('\n   Estimated time: ~5-10 minutes');
            console.log('   Estimated cost: ~$0.15-0.30');
        } else if (analysis.missingImpactOnly.length > 0 || analysis.missingSpicyOnly.length > 0) {
            console.log('⚠️  PARTIAL DATA ISSUES:');
            console.log('   Some EOs have incomplete spicy translation data.');
            console.log('   Consider running a targeted backfill.');
        } else {
            console.log('✅ All Executive Orders have complete spicy translation data!');
        }
        
        // Dashboard monitoring suggestion
        console.log('\n💡 MONITORING SUGGESTION:');
        console.log('   Consider adding a dashboard indicator or admin panel widget');
        console.log('   to show when EOs are missing translation fields.');
        console.log('   This would help catch issues before users report them.');
        
    } catch (error) {
        console.error('❌ Error checking database:', error.message);
    }
}

// Run the check
checkMissingFields();
