// Simple test verification for TrumpyTracker
// This replaces the more complex verification from the reorganization

console.log('='.repeat(50));
console.log('TrumpyTracker Test Verification');
console.log('='.repeat(50));

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tests = [];

// Test 1: Check if we're on test branch
try {
    const gitHead = fs.readFileSync(path.join(__dirname, '.git', 'HEAD'), 'utf-8').trim();
    const isTestBranch = gitHead.includes('test');
    tests.push({
        name: 'Branch Detection',
        passed: isTestBranch,
        message: isTestBranch ? '✅ On test branch' : '❌ Not on test branch'
    });
} catch (error) {
    tests.push({
        name: 'Branch Detection',
        passed: false,
        message: '❌ Could not detect branch'
    });
}

// Test 2: Check for TEST_BRANCH_MARKER
const markerExists = fs.existsSync(path.join(__dirname, 'TEST_BRANCH_MARKER.md'));
tests.push({
    name: 'Test Branch Marker',
    passed: markerExists,
    message: markerExists ? '✅ TEST_BRANCH_MARKER.md exists' : '❌ TEST_BRANCH_MARKER.md missing'
});

// Test 3: Check for test Supabase config
const testConfigExists = fs.existsSync(path.join(__dirname, 'supabase-config-test.js'));
tests.push({
    name: 'Test Supabase Config',
    passed: testConfigExists,
    message: testConfigExists ? '✅ Test database config exists' : '❌ Test database config missing'
});

// Test 4: Check key files exist
const keyFiles = [
    'public/index.html',
    'public/dashboard.js',
    'public/admin-supabase.html',
    'scripts/daily-tracker-supabase.js',
    'scripts/manual-article-processor.js'
];

keyFiles.forEach(file => {
    const exists = fs.existsSync(path.join(__dirname, file));
    tests.push({
        name: `File: ${file}`,
        passed: exists,
        message: exists ? `✅ ${file} exists` : `❌ ${file} missing`
    });
});

// Display results
console.log('\nTest Results:');
console.log('-'.repeat(50));
tests.forEach(test => {
    console.log(test.message);
});

const passed = tests.filter(t => t.passed).length;
const total = tests.length;

console.log('-'.repeat(50));
console.log(`\n${passed}/${total} tests passed`);

if (passed === total) {
    console.log('✅ All tests passed!');
} else {
    console.log('❌ Some tests failed - review above');
}
