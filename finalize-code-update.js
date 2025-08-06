import fs from 'fs/promises';

async function updateDailyTrackerCode() {
  console.log('🔧 Finalizing code changes for data folder organization...\n');
  
  try {
    // Read the current file
    const filePath = 'daily-tracker.js';
    const content = await fs.readFile(filePath, 'utf8');
    
    // Show current status
    console.log('📄 Reading daily-tracker.js...');
    
    // First replacement: Update filename variable
    let updatedContent = content;
    
    // Pattern 1: Replace the filename definition
    const oldFilenamePattern = /const filename = `real-news-tracker-\$\{today\}\.json`;/;
    const newFilenameCode = `const dataDir = 'data';
  const filename = path.join(dataDir, \`real-news-tracker-\${today}.json\`);`;
    
    if (oldFilenamePattern.test(content)) {
      updatedContent = updatedContent.replace(oldFilenamePattern, newFilenameCode);
      console.log('✅ Step 1: Updated filename to use data folder');
    } else {
      console.log('⚠️  Step 1: Could not find exact filename pattern');
      
      // Try alternate patterns
      const alternatePattern1 = /const filename = `real-news-tracker-\${today}\.json`;/;
      const alternatePattern2 = /filename = `real-news-tracker-\${today}\.json`/;
      
      if (alternatePattern1.test(content)) {
        updatedContent = updatedContent.replace(alternatePattern1, newFilenameCode);
        console.log('✅ Step 1: Found alternate pattern and updated');
      } else if (alternatePattern2.test(content)) {
        updatedContent = updatedContent.replace(alternatePattern2, `dataDir = 'data';\n  ${alternatePattern2.source.replace('filename', 'filename = path.join(dataDir, \`real-news-tracker-${today}.json\`)')}`);
        console.log('✅ Step 1: Found second alternate pattern and updated');
      } else {
        console.log('❌ Could not find filename pattern to update');
        return;
      }
    }
    
    // Pattern 2: Add mkdir before writeFile (only if not already there)
    if (!updatedContent.includes("await fs.mkdir(dataDir")) {
      const writeFilePattern = /await fs\.writeFile\(filename, JSON\.stringify\(uniqueEntries, null, 2\)\);/;
      const mkdirReplacement = `// Ensure data directory exists
    await fs.mkdir(dataDir, { recursive: true });
    
    await fs.writeFile(filename, JSON.stringify(uniqueEntries, null, 2));`;
      
      if (writeFilePattern.test(updatedContent)) {
        updatedContent = updatedContent.replace(writeFilePattern, mkdirReplacement);
        console.log('✅ Step 2: Added data directory creation');
      } else {
        console.log('⚠️  Step 2: Could not find writeFile pattern - you may need to add mkdir manually');
      }
    } else {
      console.log('✅ Step 2: Data directory creation already exists');
    }
    
    // Write the updated file
    await fs.writeFile(filePath, updatedContent);
    
    console.log('\n🎉 Code update complete!');
    console.log('📂 Future daily files will be saved to: data/real-news-tracker-YYYY-MM-DD.json');
    console.log('🧹 Your main directory will stay clean!');
    
    // Test that the changes were applied
    const verification = await fs.readFile(filePath, 'utf8');
    if (verification.includes("dataDir = 'data'") && verification.includes("path.join(dataDir")) {
      console.log('✅ Verification: Changes successfully applied');
    } else {
      console.log('⚠️  Verification: Some changes may not have been applied correctly');
    }
    
  } catch (error) {
    console.error('❌ Error updating file:', error.message);
  }
}

// Run the update
updateDailyTrackerCode();
