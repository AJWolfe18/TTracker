import fs from 'fs/promises';
import path from 'path';

async function moveDailyFiles() {
  try {
    const files = await fs.readdir('.');
    const dailyFiles = files.filter(file => 
      file.startsWith('real-news-tracker-') || 
      file.startsWith('tracker-data-') ||
      file.startsWith('test-')
    ).filter(file => file.endsWith('.json'));

    console.log(`Found ${dailyFiles.length} daily files to move:`);
    dailyFiles.forEach(file => console.log(`  - ${file}`));

    // Ensure data directory exists
    await fs.mkdir('data', { recursive: true });

    // Move each file
    for (const file of dailyFiles) {
      const sourcePath = file;
      const destPath = path.join('data', file);
      
      try {
        await fs.rename(sourcePath, destPath);
        console.log(`✅ Moved: ${file}`);
      } catch (error) {
        console.log(`❌ Error moving ${file}:`, error.message);
      }
    }

    console.log('\n🎉 Daily files organization complete!');
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

moveDailyFiles();
