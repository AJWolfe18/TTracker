import { clusterArticle } from './rss/hybrid-clustering.js';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const articleIds = JSON.parse(fs.readFileSync('logs/recluster_batch.json'));
console.log('Reclustering', articleIds.length, 'articles with shadow logging...');
console.log('Watch for SHADOW_POLICY_DIFF lines in output\n');

let success = 0, failed = 0, shadowDiffs = 0;

for (const id of articleIds) {
  try {
    const result = await clusterArticle(id);
    success++;
    if (success % 20 === 0) {
      console.log(`Progress: ${success}/${articleIds.length}`);
    }
  } catch (e) {
    console.error('Failed:', id, e.message);
    failed++;
  }
}

console.log('\n=== RECLUSTER COMPLETE ===');
console.log('Success:', success);
console.log('Failed:', failed);
console.log('\nCheck output above for SHADOW_POLICY_DIFF entries');
