import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Load the 200 article IDs we reclustered
const reclusteredIds = JSON.parse(fs.readFileSync('logs/recluster_batch.json'));

// Load the original backup to get original story IDs
const backup = JSON.parse(fs.readFileSync('logs/article_story_backup.json'));
const originalMap = {};
backup.forEach(r => {
  originalMap[r.article_id] = r.story_id;
});

console.log('Comparing', reclusteredIds.length, 'reclustered articles...\n');

// Query current assignments
const { data: current, error } = await supabase
  .from('article_story')
  .select('article_id, story_id, similarity_score')
  .in('article_id', reclusteredIds);

if (error) {
  console.error('Error:', error);
  process.exit(1);
}

const currentMap = {};
current.forEach(r => {
  currentMap[r.article_id] = { story_id: r.story_id, score: r.similarity_score };
});

// Compare
let same = 0, different = 0, notFound = 0, noOriginal = 0;
const differentCases = [];

for (const articleId of reclusteredIds) {
  const original = originalMap[articleId];
  const now = currentMap[articleId];

  if (!original) {
    noOriginal++;
    continue;
  }

  if (!now) {
    notFound++;
    continue;
  }

  if (original === now.story_id) {
    same++;
  } else {
    different++;
    differentCases.push({
      article_id: articleId,
      original_story: original,
      new_story: now.story_id,
      score: now.score
    });
  }
}

console.log('=== RECLUSTER COMPARISON ===');
console.log('Matched SAME story:', same);
console.log('Matched DIFFERENT story:', different);
console.log('Not found (no current assignment):', notFound);
console.log('No original record:', noOriginal);
console.log('');

if (different > 0) {
  console.log('=== DIFFERENT MATCHES (these should have shadow diffs) ===');
  differentCases.forEach(c => {
    console.log(`  ${c.article_id}: ${c.original_story} → ${c.new_story} (score: ${c.score})`);
  });
}

if (same > 0 && different === 0) {
  console.log('CONCLUSION: Experiment failed - all articles matched back to their original stories.');
  console.log('This is because we only deleted junction entries, not the stories themselves.');
  console.log('The slug-matching found the original stories and re-attached at high similarity.');
}
