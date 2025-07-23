import fs from 'fs/promises';

console.log('🔍 POLITICAL TRACKER DATE AUDIT');
console.log('===============================\n');

async function auditDates() {
  try {
    // Load the master log
    console.log('📁 Loading master-tracker-log.json...');
    const masterData = await fs.readFile('master-tracker-log.json', 'utf8');
    const entries = JSON.parse(masterData);
    console.log(`Found ${entries.length} total entries\n`);

    // Define what we consider "too old" - anything before 2025
    const cutoffDate = new Date('2025-01-01');
    const now = new Date();
    
    const suspiciousEntries = [];
    const futureEntries = [];
    const recentEntries = [];
    
    entries.forEach(entry => {
      const entryDate = new Date(entry.date);
      
      if (isNaN(entryDate.getTime())) {
        suspiciousEntries.push({
          ...entry,
          issue: 'Invalid date format'
        });
      } else if (entryDate < cutoffDate) {
        suspiciousEntries.push({
          ...entry,
          issue: `Too old (${entryDate.getFullYear()})`
        });
      } else if (entryDate > now) {
        futureEntries.push({
          ...entry,
          issue: 'Future date'
        });
      } else {
        recentEntries.push(entry);
      }
    });

    // Report findings
    console.log('📊 AUDIT RESULTS:');
    console.log('==================');
    console.log(`✅ Valid recent entries: ${recentEntries.length}`);
    console.log(`⚠️  Suspicious old entries: ${suspiciousEntries.length}`);
    console.log(`🔮 Future dated entries: ${futureEntries.length}\n`);

    if (suspiciousEntries.length > 0) {
      console.log('🚨 SUSPICIOUS OLD ENTRIES:');
      console.log('===========================');
      suspiciousEntries.forEach((entry, index) => {
        console.log(`${index + 1}. [${entry.date}] ${entry.title}`);
        console.log(`   Actor: ${entry.actor}`);
        console.log(`   Issue: ${entry.issue}`);
        console.log(`   Source: ${entry.source_url}`);
        console.log(`   Added: ${entry.added_at}`);
        console.log('');
      });
    }

    if (futureEntries.length > 0) {
      console.log('🔮 FUTURE DATED ENTRIES:');
      console.log('=========================');
      futureEntries.forEach((entry, index) => {
        console.log(`${index + 1}. [${entry.date}] ${entry.title}`);
        console.log(`   Actor: ${entry.actor}`);
        console.log('');
      });
    }

    // Create cleaned data (remove suspicious entries)
    if (suspiciousEntries.length > 0 || futureEntries.length > 0) {
      console.log('💾 CREATING CLEANED VERSION:');
      console.log('=============================');
      
      // Backup original
      await fs.writeFile('master-tracker-log.backup.json', masterData);
      console.log('✅ Backup saved as master-tracker-log.backup.json');
      
      // Create cleaned version
      const cleanedEntries = entries.filter(entry => {
        const entryDate = new Date(entry.date);
        return !isNaN(entryDate.getTime()) && 
               entryDate >= cutoffDate && 
               entryDate <= now;
      });
      
      await fs.writeFile('master-tracker-log.cleaned.json', JSON.stringify(cleanedEntries, null, 2));
      console.log(`✅ Cleaned version saved with ${cleanedEntries.length} valid entries`);
      console.log(`📊 Removed ${entries.length - cleanedEntries.length} problematic entries`);
      
      console.log('\n🔄 TO APPLY THE CLEANED VERSION:');
      console.log('1. Review the cleaned file: master-tracker-log.cleaned.json');
      console.log('2. If satisfied, replace master-tracker-log.json with the cleaned version');
      console.log('3. Copy to public folder: cp master-tracker-log.cleaned.json public/master-tracker-log.json');
      console.log('4. Commit the changes to GitHub');
    } else {
      console.log('✅ No problematic dates found - all entries look good!');
    }

    // Show date range of valid entries
    if (recentEntries.length > 0) {
      const dates = recentEntries.map(e => new Date(e.date)).sort((a, b) => a - b);
      const oldest = dates[0];
      const newest = dates[dates.length - 1];
      
      console.log(`\n📅 VALID DATE RANGE:`);
      console.log(`Oldest entry: ${oldest.toDateString()}`);
      console.log(`Newest entry: ${newest.toDateString()}`);
    }

  } catch (error) {
    console.error('❌ Error during audit:', error.message);
  }
}

auditDates();
