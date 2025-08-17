// test-environment-check.js 
// Verifies test environment is properly configured 
import { SUPABASE_URL } from './supabase-config-wrapper.js'; 
 
console.log('Environment Check:'); 
console.log('================='); 
console.log('Supabase URL:', SUPABASE_URL); 
 
if (SUPABASE_URL.includes('wnrjrywpcadwutfykflu')) { 
    console.log('✅ Test environment correctly configured!'); 
} else if (SUPABASE_URL.includes('osjbulmltfpcoldydexg')) { 
    console.log('⚠️  WARNING: Using production database!'); 
} else { 
    console.log('❌ ERROR: Unknown database configuration!'); 
} 
