import fs from 'fs/promises';

async function updateDailyTracker() {
  console.log('🔧 Updating daily-tracker.js to use data folder...');
  
  try {
    // Read the current file
    const content = await fs.readFile('daily-tracker.js', 'utf8');
    
    // Find and replace the filename line
    const oldPattern = /const filename = `real-news-tracker-\${today}\.json`;/;
    const replacement = `const dataDir = 'data';
  const filename = path.join(dataDir, \`real-news-tracker-\${today}.json\`);`;
    
    if (!oldPattern.test(content)) {
      console.log('❌ Could not find the target line to replace');
      console.log('Looking for pattern:', oldPattern);
      
      // Let's try to find similar patterns
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        if (line.includes('real-news-tracker') && line.includes('filename')) {
          console.log(`Found at line ${index + 1}: ${line}`);
        }
      });
      return;
    }
    
    // Replace the pattern
    const updatedContent = content.replace(oldPattern, replacement);
    
    // Add the mkdir call to ensure data directory exists
    const mkdirPattern = /await fs\.writeFile\(filename, JSON\.stringify\(uniqueEntries, null, 2\)\);/;
    const mkdirReplacement = `// Ensure data directory exists
    await fs.mkdir(dataDir, { recursive: true });
    
    await fs.writeFile(filename, JSON.stringify(uniqueEntries, null, 2));`;
    
    const finalContent = updatedContent.replace(mkdirPattern, mkdirReplacement);
    
    // Write the updated file
    await fs.writeFile('daily-tracker.js', finalContent);
    
    console.log('✅ Successfully updated daily-tracker.js');
    console.log('   - Daily files will now be saved to data/ folder');
    console.log('   - Data directory will be created automatically');
    
  } catch (error) {
    console.error('❌ Error updating file:', error.message);
  }
}

updateDailyTracker();
