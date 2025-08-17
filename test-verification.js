// test-verification.js
// Comprehensive test to verify repository reorganization
// Run this to ensure all imports and paths work correctly

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🔍 TRUMPYTRACKER VERIFICATION SCRIPT');
console.log('=====================================\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const issues = [];

// Color codes for terminal output
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

async function testFile(path, description) {
    totalTests++;
    try {
        await fs.access(path);
        console.log(`${GREEN}✅${RESET} ${description}`);
        passedTests++;
        return true;
    } catch (error) {
        console.log(`${RED}❌${RESET} ${description}`);
        console.log(`   Missing: ${path}`);
        failedTests++;
        issues.push({ severity: 'CRITICAL', description: `Missing file: ${path}` });
        return false;
    }
}

async function testImport(modulePath, description) {
    totalTests++;
    try {
        await import(modulePath);
        console.log(`${GREEN}✅${RESET} ${description}`);
        passedTests++;
        return true;
    } catch (error) {
        console.log(`${RED}❌${RESET} ${description}`);
        console.log(`   Error: ${error.message}`);
        failedTests++;
        issues.push({ 
            severity: 'CRITICAL', 
            description: `Import failed: ${description}`,
            error: error.message 
        });
        return false;
    }
}

async function checkFileContent(path, searchString, description) {
    totalTests++;
    try {
        const content = await fs.readFile(path, 'utf8');
        if (content.includes(searchString)) {
            console.log(`${GREEN}✅${RESET} ${description}`);
            passedTests++;
            return true;
        } else {
            console.log(`${YELLOW}⚠️${RESET} ${description}`);
            console.log(`   String not found: "${searchString}"`);
            failedTests++;
            issues.push({ 
                severity: 'MAJOR', 
                description: `Content check failed: ${description}` 
            });
            return false;
        }
    } catch (error) {
        console.log(`${RED}❌${RESET} ${description}`);
        console.log(`   Error: ${error.message}`);
        failedTests++;
        issues.push({ 
            severity: 'CRITICAL', 
            description: `Cannot read file: ${path}` 
        });
        return false;
    }
}

async function runTests() {
    console.log('📁 TESTING FOLDER STRUCTURE\n');
    
    // Test new folder structure
    await testFile(join(__dirname, 'scripts'), 'Scripts folder exists');
    await testFile(join(__dirname, 'scripts/batch'), 'Batch folder exists');
    await testFile(join(__dirname, 'config'), 'Config folder exists');
    await testFile(join(__dirname, 'sql'), 'SQL folder exists');
    await testFile(join(__dirname, 'docs'), 'Docs folder exists');
    await testFile(join(__dirname, 'test'), 'Test folder exists');
    await testFile(join(__dirname, 'public'), 'Public folder exists');
    
    console.log('\n📄 TESTING CRITICAL FILES\n');
    
    // Test critical files in new locations
    await testFile(join(__dirname, 'scripts/daily-tracker-supabase.js'), 'Daily tracker script');
    await testFile(join(__dirname, 'scripts/executive-orders-tracker-supabase.js'), 'EO tracker script');
    await testFile(join(__dirname, 'scripts/manual-article-processor.js'), 'Manual processor script');
    await testFile(join(__dirname, 'config/supabase-config.js'), 'Supabase config');
    await testFile(join(__dirname, 'config/supabase-config-node.js'), 'Supabase Node config');
    
    console.log('\n🔧 TESTING GITHUB ACTIONS\n');
    
    // Test GitHub Actions workflows
    await testFile(join(__dirname, '.github/workflows/daily-tracker.yml'), 'Daily tracker workflow');
    await testFile(join(__dirname, '.github/workflows/executive-orders-tracker.yml'), 'EO tracker workflow');
    await testFile(join(__dirname, '.github/workflows/process-manual-article.yml'), 'Manual article workflow');
    
    // Check if workflows have correct paths
    await checkFileContent(
        join(__dirname, '.github/workflows/daily-tracker.yml'),
        'node scripts/daily-tracker-supabase.js',
        'Daily workflow has correct script path'
    );
    
    await checkFileContent(
        join(__dirname, '.github/workflows/executive-orders-tracker.yml'),
        'node scripts/executive-orders-tracker-supabase.js',
        'EO workflow has correct script path'
    );
    
    console.log('\n🔗 TESTING IMPORTS\n');
    
    // Test if scripts can import their dependencies
    const configExists = await testFile(join(__dirname, 'config/supabase-config-node.js'), 'Config file exists for import');
    
    if (configExists) {
        // Check import paths in scripts
        await checkFileContent(
            join(__dirname, 'scripts/daily-tracker-supabase.js'),
            '../config/supabase-config-node.js',
            'Daily tracker has correct import path'
        );
        
        await checkFileContent(
            join(__dirname, 'scripts/executive-orders-tracker-supabase.js'),
            '../config/supabase-config-node.js',
            'EO tracker has correct import path'
        );
        
        await checkFileContent(
            join(__dirname, 'scripts/wipe-executive-orders.js'),
            '../config/supabase-config-node.js',
            'Wipe script has correct import path'
        );
    }
    
    console.log('\n📚 TESTING DOCUMENTATION\n');
    
    // Test documentation files
    await testFile(join(__dirname, 'README.md'), 'README.md exists');
    await testFile(join(__dirname, 'docs/ARCHITECTURE.md'), 'Architecture doc exists');
    await testFile(join(__dirname, 'docs/API.md'), 'API doc exists');
    await testFile(join(__dirname, 'docs/DEPLOYMENT.md'), 'Deployment doc exists');
    await testFile(join(__dirname, 'docs/TESTING.md'), 'Testing doc exists');
    await testFile(join(__dirname, 'docs/TROUBLESHOOTING.md'), 'Troubleshooting doc exists');
    await testFile(join(__dirname, 'docs/CHANGELOG.md'), 'Changelog exists');
    await testFile(join(__dirname, 'docs/CONTRIBUTING.md'), 'Contributing guide exists');
    
    console.log('\n🎯 TESTING ENVIRONMENT DETECTION\n');
    
    // Check branch to determine if TEST_BRANCH_MARKER should exist
    try {
        const gitHead = await fs.readFile(join(__dirname, '.git/HEAD'), 'utf8');
        const isTestBranch = gitHead.includes('test');
        
        if (isTestBranch) {
            // On test branch, marker should be in root
            const markerInRoot = await testFile(join(__dirname, 'TEST_BRANCH_MARKER.md'), 'TEST_BRANCH_MARKER.md in root (required for test branch)');
            if (!markerInRoot) {
                issues.push({
                    severity: 'CRITICAL',
                    description: 'TEST_BRANCH_MARKER.md missing - test environment won\'t be detected!'
                });
            }
        } else {
            // On main branch, marker should NOT exist
            totalTests++;
            try {
                await fs.access(join(__dirname, 'TEST_BRANCH_MARKER.md'));
                console.log(`${RED}❌${RESET} TEST_BRANCH_MARKER.md exists on main branch (should not!)`);
                failedTests++;
                issues.push({
                    severity: 'CRITICAL',
                    description: 'TEST_BRANCH_MARKER.md found on main branch - remove it!'
                });
            } catch {
                console.log(`${GREEN}✅${RESET} TEST_BRANCH_MARKER.md not on main (correct)`);
                passedTests++;
            }
        }
    } catch (error) {
        console.log(`${YELLOW}⚠️${RESET} Cannot determine branch, skipping marker test`);
    }
    
    console.log('\n🔍 TESTING PUBLIC FILES\n');
    
    // Test critical public files
    await testFile(join(__dirname, 'public/index.html'), 'Dashboard HTML exists');
    await testFile(join(__dirname, 'public/dashboard.js'), 'Dashboard JS exists');
    await testFile(join(__dirname, 'public/admin-supabase.html'), 'Admin panel exists');
    
    console.log('\n⚙️ TESTING PACKAGE.JSON\n');
    
    // Check package.json scripts
    await checkFileContent(
        join(__dirname, 'package.json'),
        '"daily": "node scripts/daily-tracker-supabase.js"',
        'Package.json has daily script'
    );
    
    await checkFileContent(
        join(__dirname, 'package.json'),
        '"server": "node scripts/simple-server.js"',
        'Package.json has server script'
    );
    
    console.log('\n🚫 TESTING .GITIGNORE\n');
    
    // Test .gitignore exists
    await testFile(join(__dirname, '.gitignore'), '.gitignore exists');
    
    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(50));
    console.log(`Total Tests: ${totalTests}`);
    console.log(`${GREEN}Passed: ${passedTests}${RESET}`);
    console.log(`${RED}Failed: ${failedTests}${RESET}`);
    
    if (failedTests > 0) {
        console.log('\n❌ ISSUES FOUND:');
        const critical = issues.filter(i => i.severity === 'CRITICAL');
        const major = issues.filter(i => i.severity === 'MAJOR');
        
        if (critical.length > 0) {
            console.log(`\n${RED}CRITICAL ISSUES:${RESET}`);
            critical.forEach(issue => {
                console.log(`  • ${issue.description}`);
                if (issue.error) console.log(`    ${issue.error}`);
            });
        }
        
        if (major.length > 0) {
            console.log(`\n${YELLOW}MAJOR ISSUES:${RESET}`);
            major.forEach(issue => {
                console.log(`  • ${issue.description}`);
            });
        }
        
        console.log('\n🔧 RECOMMENDED ACTIONS:');
        console.log('1. Fix all CRITICAL issues before deploying');
        console.log('2. Review and fix MAJOR issues');
        console.log('3. Run this test again after fixes');
        
        process.exit(1);
    } else {
        console.log(`\n${GREEN}✅ ALL TESTS PASSED!${RESET}`);
        console.log('Repository reorganization is complete and working correctly.');
        console.log('\n🚀 Ready to commit and deploy!');
        process.exit(0);
    }
}

// Run the tests
console.log('Starting verification...\n');
runTests().catch(error => {
    console.error(`${RED}Fatal error during testing:${RESET}`, error);
    process.exit(1);
});