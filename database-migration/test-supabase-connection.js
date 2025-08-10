// test-supabase-connection.js
// Quick test to verify your Supabase setup is working
// Usage: SUPABASE_URL=your-url SUPABASE_ANON_KEY=your-key node test-supabase-connection.js

import fetch from 'node-fetch';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('❌ Missing environment variables!');
    console.error('\nUsage:');
    console.error('SUPABASE_URL=https://xxxxx.supabase.co SUPABASE_ANON_KEY=your-key node test-supabase-connection.js');
    console.error('\nGet these from your Supabase dashboard:');
    console.error('1. Project URL: Settings → API → Project URL');
    console.error('2. Anon Key: Settings → API → anon public key');
    process.exit(1);
}

console.log('🧪 SUPABASE CONNECTION TEST');
console.log('===========================\n');
console.log(`📍 URL: ${SUPABASE_URL}`);
console.log(`🔑 Key: ${SUPABASE_ANON_KEY.substring(0, 20)}...`);
console.log('');

async function testConnection() {
    try {
        // Test 1: Basic connection
        console.log('1️⃣ Testing basic connection...');
        const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            }
        });

        if (response.ok) {
            console.log('   ✅ Basic connection successful!\n');
        } else {
            console.log('   ❌ Connection failed:', response.status, response.statusText);
            return;
        }

        // Test 2: Check if tables exist
        console.log('2️⃣ Checking if tables exist...');
        
        const tables = ['political_entries', 'executive_orders', 'pending_submissions'];
        
        for (const table of tables) {
            try {
                const tableResponse = await fetch(`${SUPABASE_URL}/rest/v1/${table}?limit=0`, {
                    headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                        'Prefer': 'count=exact'
                    }
                });

                if (tableResponse.ok) {
                    const count = tableResponse.headers.get('content-range');
                    console.log(`   ✅ Table '${table}' exists`);
                } else if (tableResponse.status === 404 || tableResponse.status === 400) {
                    console.log(`   ⚠️  Table '${table}' not found - run schema SQL first`);
                } else {
                    console.log(`   ❌ Error checking '${table}':`, tableResponse.status);
                }
            } catch (error) {
                console.log(`   ❌ Error checking '${table}':`, error.message);
            }
        }

        console.log('\n3️⃣ Testing write permissions...');
        
        // Try to insert a test record (will fail if RLS is properly configured, which is good!)
        const testInsert = await fetch(`${SUPABASE_URL}/rest/v1/political_entries`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
                id: `test_${Date.now()}`,
                date: new Date().toISOString().split('T')[0],
                title: 'Test Entry',
                description: 'This is a test',
                severity: 'low'
            })
        });

        if (testInsert.ok) {
            console.log('   ⚠️  Public writes are allowed (RLS might need configuration)');
        } else if (testInsert.status === 401 || testInsert.status === 403) {
            console.log('   ✅ RLS is properly configured (public cannot write)');
        } else {
            console.log('   ❓ Unexpected response:', testInsert.status);
        }

        console.log('\n✨ Connection test complete!');
        console.log('\n📋 Next steps:');
        console.log('   1. If tables don\'t exist, run 01-create-schema.sql in Supabase SQL Editor');
        console.log('   2. Run the migration: node database-migration/migrate-to-supabase.js');
        console.log('   3. Update your application code to use Supabase');

    } catch (error) {
        console.error('\n❌ Connection test failed:', error.message);
        console.error('\n💡 Check your SUPABASE_URL and SUPABASE_ANON_KEY');
    }
}

testConnection();