// test-environment-check.js
// Verifies test environment is properly configured

const fs = require('fs');
const path = require('path');

console.log('🔍 Test Environment Verification');
console.log('=================================\n');

// Check for TEST_BRANCH_MARKER
const markerPath = path.join(__dirname, 'TEST_BRANCH_MARKER.md');
if (fs.existsSync(markerPath)) {
    console.log('✅ TEST_BRANCH_MARKER.md found - Test environment detected');
} else {
    console.log('❌ TEST_BRANCH_MARKER.md MISSING - Will use PRODUCTION database!');
}

// Check config files
const configFiles = [
    'config/supabase-config.js',
    'config/supabase-config-node.js',
    'config/supabase-config-test.js',
    'config/supabase-config-wrapper.js'
];

console.log('\n📁 Configuration Files:');
configFiles.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
        console.log(`  ✅ ${file}`);
    } else {
        console.log(`  ❌ ${file} - MISSING`);
    }
});

// Check scripts
const scripts = [
    'scripts/daily-tracker-supabase.js',
    'scripts/executive-orders-tracker-supabase.js',
    'scripts/manual-article-processor.js'
];

console.log('\n📜 Script Files:');
scripts.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
        console.log(`  ✅ ${file}`);
    } else {
        console.log(`  ❌ ${file} - MISSING`);
    }
});

console.log('\n🌐 Test Environment URL:');
console.log('  https://test--taupe-capybara-0ff2ed.netlify.app/');
console.log('\n⚠️  REMINDER: Never merge test into main!');
console.log('  Use cherry-pick for specific commits only.');
