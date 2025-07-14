import fs from 'fs/promises';
import path from 'path';

console.log('🧹 DUPLICATE CLEANUP SCRIPT');
console.log('==========================\n');

// Helper function for fuzzy title matching
function isSimilarTitle(title1, title2) {
  const clean1 = title1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const clean2 = title2.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  // Check if one title contains most of the other
  const shorter = clean1.length < clean2.length ? clean1 : clean2;
  const longer = clean1.length < clean2.length ? clean2 : clean1;
  
  // If shorter title is contained in longer one, likely a duplicate
  if (longer.includes(shorter) && shorter.length > 20) {
    return true;
  }
  
  // Calculate similarity ratio
  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter.substr(i, 3))) matches++;
  }
  
  const similarity = matches / shorter.length;
  return similarity > 0.85; // 85% similarity threshold
}

async function cleanupDuplicates() {
  try {
    // Load the master log
    console.log('📁 Loading master-tracker-log.json...');
    const masterData = await fs.readFile('master-tracker-log.json', 'utf8');
    const entries = JSON.parse(masterData);
    console.log(`Found ${entries.length} total entries\n`);

    // Create backup first
    console.log('💾 Creating backup...');
    await fs.writeFile('master-tracker-log.backup.json', masterData);
    console.log('Backup saved as master-tracker-log.backup.json\n');

    // Track what we've seen
    const seenUrls = new Map();
    const seenTitles = new Map();
    const seenDateActor = new Map();
    
    const uniqueEntries = [];
    const duplicateGroups = new Map(); // Track duplicate groups for reporting

    // Process each entry
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const url = entry.source_url;
      const titleKey = entry.title?.toLowerCase().trim() || '';
      const dateActorKey = `${entry.date}-${(entry.actor || '').toLowerCase().trim()}`;
      
      let isDuplicate = false;
      let reason = '';
      let originalIndex = -1;

      // Check for URL duplicate
      if (url && seenUrls.has(url)) {
        isDuplicate = true;
        reason = 'duplicate URL';
        originalIndex = seenUrls.get(url);
      }
      // Check for exact title duplicate
      else if (titleKey && seenTitles.has(titleKey)) {
        isDuplicate = true;
        reason = 'exact title match';
        originalIndex = seenTitles.get(titleKey);
      }
      // Check for similar title with same date/actor
      else if (seenDateActor.has(dateActorKey)) {
        const existingIndex = seenDateActor.get(dateActorKey);
        const existingEntry = uniqueEntries[existingIndex];
        if (entry.title && existingEntry.title && isSimilarTitle(entry.title, existingEntry.title)) {
          isDuplicate = true;
          reason = 'similar title on same date/actor';
          originalIndex = existingIndex;
        }
      }

      if (isDuplicate) {
        // Track duplicate groups for reporting
        const key = `${reason}-${originalIndex}`;
        if (!duplicateGroups.has(key)) {
          duplicateGroups.set(key, {
            original: uniqueEntries[originalIndex],
            duplicates: [],
            reason: reason
          });
        }
        duplicateGroups.get(key).duplicates.push(entry);
      } else {
        // This is unique, add it
        const uniqueIndex = uniqueEntries.length;
        uniqueEntries.push(entry);
        
        // Track it to find future duplicates
        if (url) seenUrls.set(url, uniqueIndex);
        if (titleKey) seenTitles.set(titleKey, uniqueIndex);
        seenDateActor.set(dateActorKey, uniqueIndex);
      }
    }

    // Report findings
    console.log('📊 DUPLICATE ANALYSIS:');
    console.log('======================');
    console.log(`Original entries: ${entries.length}`);
    console.log(`Unique entries: ${uniqueEntries.length}`);
    console.log(`Duplicates found: ${entries.length - uniqueEntries.length}\n`);

    // Show some examples of duplicates found
    console.log('📋 DUPLICATE EXAMPLES:');
    let exampleCount = 0;
    for (const group of duplicateGroups.values()) {
      if (exampleCount >= 5) break; // Show first 5 examples
      console.log(`\n${exampleCount + 1}. "${group.original.title}"`);
      console.log(`   Date: ${group.original.date}, Actor: ${group.original.actor}`);
      console.log(`   Reason: ${group.reason}`);
      console.log(`   Found ${group.duplicates.length} duplicate(s)`);
      exampleCount++;
    }

    if (duplicateGroups.size > 5) {
      console.log(`\n... and ${duplicateGroups.size - 5} more duplicate groups`);
    }

    // Sort by date (newest first) and then by added_at
    uniqueEntries.sort((a, b) => {
      const dateCompare = (b.date || '').localeCompare(a.date || '');
      if (dateCompare !== 0) return dateCompare;
      return (b.added_at || '').localeCompare(a.added_at || '');
    });

    // Save cleaned data
    console.log('\n💾 Saving cleaned data...');
    await fs.writeFile('master-tracker-log.json', JSON.stringify(uniqueEntries, null, 2));
    
    // Also update public folder
    const publicDir = 'public';
    const publicMasterFile = path.join(publicDir, 'master-tracker-log.json');
    try {
      await fs.mkdir(publicDir, { recursive: true });
      await fs.writeFile(publicMasterFile, JSON.stringify(uniqueEntries, null, 2));
      console.log('✅ Updated public/master-tracker-log.json');
    } catch (error) {
      console.error('❌ Error updating public file:', error.message);
    }

    console.log('\n✅ CLEANUP COMPLETE!');
    console.log(`Removed ${entries.length - uniqueEntries.length} duplicates`);
    console.log(`Database now contains ${uniqueEntries.length} unique entries`);
    console.log('\n📌 Note: Original data backed up to master-tracker-log.backup.json');

  } catch (error) {
    console.error('❌ Error during cleanup:', error.message);
    console.error(error.stack);
  }
}

// Run the cleanup
cleanupDuplicates();
