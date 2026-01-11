/**
 * JIRA vs ADO Gap Analysis
 *
 * Compares JIRA export (full-migration-data.json) with ADO export (ado-export.json)
 * to find:
 * 1. Items in JIRA but missing from ADO (need to create)
 * 2. Items in ADO but lacking descriptions (need to update)
 * 3. Items with mismatched parent links
 */

const fs = require('fs');
const path = require('path');

const SCRIPTS_DIR = 'C:/Users/Josh/OneDrive/Desktop/GitHub/TTracker/scripts';

// Load exports
const jiraData = JSON.parse(fs.readFileSync(path.join(SCRIPTS_DIR, 'full-migration-data.json'), 'utf8'));
const adoData = JSON.parse(fs.readFileSync(path.join(SCRIPTS_DIR, 'ado-export.json'), 'utf8'));

console.log('=== JIRA vs ADO Gap Analysis ===\n');
console.log(`JIRA items: ${jiraData.items?.length || jiraData.totalItems}`);
console.log(`ADO items: ${adoData.count}`);
console.log('');

// Build ADO lookup by JIRA key (from tags)
const adoByJiraKey = new Map();
const adoItemsWithoutJiraTag = [];

adoData.items.forEach(item => {
  if (item.jiraKey) {
    // Normalize to uppercase TTRC-XXX format
    const normalizedKey = item.jiraKey.toUpperCase();
    if (adoByJiraKey.has(normalizedKey)) {
      console.log(`WARNING: Duplicate JIRA key in ADO: ${normalizedKey}`);
    }
    adoByJiraKey.set(normalizedKey, item);
  } else {
    adoItemsWithoutJiraTag.push(item);
  }
});

console.log(`ADO items with JIRA tags: ${adoByJiraKey.size}`);
console.log(`ADO items without JIRA tags: ${adoItemsWithoutJiraTag.length}`);
console.log('');

// Find gaps
const missingFromAdo = [];
const existsButNoDescription = [];
const existsWithDescription = [];

jiraData.items.forEach(jiraItem => {
  const key = jiraItem.jiraKey.toUpperCase();
  const adoItem = adoByJiraKey.get(key);

  if (!adoItem) {
    missingFromAdo.push(jiraItem);
  } else {
    // Check if ADO item has description
    if (!adoItem.hasDescription) {
      existsButNoDescription.push({
        jiraKey: jiraItem.jiraKey,
        adoId: adoItem.id,
        title: jiraItem.title,
        hasJiraDescription: jiraItem.hasDescription,
        jiraDescription: jiraItem.description
      });
    } else {
      existsWithDescription.push({
        jiraKey: jiraItem.jiraKey,
        adoId: adoItem.id,
        title: jiraItem.title
      });
    }
  }
});

console.log('=== GAP ANALYSIS RESULTS ===\n');
console.log(`Missing from ADO (need to create): ${missingFromAdo.length}`);
console.log(`In ADO but no description (need update): ${existsButNoDescription.length}`);
console.log(`In ADO with description (complete): ${existsWithDescription.length}`);
console.log('');

// Group missing by type
const missingByType = {};
missingFromAdo.forEach(item => {
  const type = item.adoType || item.type;
  if (!missingByType[type]) missingByType[type] = [];
  missingByType[type].push(item);
});

console.log('Missing by type:');
Object.entries(missingByType).forEach(([type, items]) => {
  console.log(`  ${type}: ${items.length}`);
});
console.log('');

// Show first 20 missing
console.log('First 20 missing items:');
missingFromAdo.slice(0, 20).forEach(item => {
  console.log(`  ${item.jiraKey} (${item.adoType}): ${item.title.substring(0, 50)}`);
});
if (missingFromAdo.length > 20) {
  console.log(`  ... and ${missingFromAdo.length - 20} more`);
}
console.log('');

// Show items needing description update
console.log(`Items needing description update (first 10):`);
existsButNoDescription.slice(0, 10).forEach(item => {
  console.log(`  ADO #${item.adoId} (${item.jiraKey}): ${item.title.substring(0, 40)}`);
});
if (existsButNoDescription.length > 10) {
  console.log(`  ... and ${existsButNoDescription.length - 10} more`);
}

// Build JIRA key to ADO ID mapping for parent resolution
const jiraKeyToAdoId = {};
adoData.items.forEach(item => {
  if (item.jiraKey) {
    jiraKeyToAdoId[item.jiraKey.toUpperCase()] = item.id;
  }
});

// Prepare output
const gapAnalysis = {
  analyzedAt: new Date().toISOString(),
  summary: {
    jiraTotal: jiraData.items?.length || jiraData.totalItems,
    adoTotal: adoData.count,
    adoWithJiraTags: adoByJiraKey.size,
    missingFromAdo: missingFromAdo.length,
    needDescriptionUpdate: existsButNoDescription.length,
    complete: existsWithDescription.length
  },
  missingByType,
  // Full list of items to create
  toCreate: missingFromAdo.map(item => ({
    jiraKey: item.jiraKey,
    title: item.title,
    adoType: item.adoType,
    adoState: item.adoState,
    description: item.description,
    parentJiraKey: item.parentJiraKey,
    parentAdoId: item.parentJiraKey ? jiraKeyToAdoId[item.parentJiraKey.toUpperCase()] : null
  })),
  // Items that exist but need description
  toUpdateDescription: existsButNoDescription.map(item => ({
    adoId: item.adoId,
    jiraKey: item.jiraKey,
    title: item.title,
    description: item.jiraDescription
  })),
  // Mapping for reference
  jiraKeyToAdoId
};

// Save gap analysis
const outputPath = path.join(SCRIPTS_DIR, 'gap-analysis.json');
fs.writeFileSync(outputPath, JSON.stringify(gapAnalysis, null, 2));
console.log('');
console.log(`Gap analysis saved to: ${outputPath}`);
