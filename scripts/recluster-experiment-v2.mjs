import { createClient } from '@supabase/supabase-js';
import { clusterArticle } from './rss/hybrid-clustering.js';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const BATCH_SIZE = 50; // Small test batch

async function run() {
  // Get single-article stories
  const singleStories = JSON.parse(fs.readFileSync('logs/single_article_stories.json'));
  const batch = singleStories.slice(0, BATCH_SIZE);

  const storyIds = batch.map(s => s.story_id);
  const articleIds = batch.map(s => s.article_id);

  console.log(`\n=== RECLUSTER EXPERIMENT V2 ===`);
  console.log(`Testing with ${BATCH_SIZE} single-article stories\n`);

  // Step 1: Backup stories
  console.log('Step 1: Backing up stories...');
  const { data: storiesBackup, error: backupErr } = await supabase
    .from('stories')
    .select('*')
    .in('id', storyIds);

  if (backupErr) {
    console.error('Backup error:', backupErr);
    process.exit(1);
  }

  fs.writeFileSync('logs/stories_backup_v2.json', JSON.stringify(storiesBackup, null, 2));
  console.log(`Backed up ${storiesBackup.length} stories`);

  // Step 2: Delete article_story entries
  console.log('\nStep 2: Deleting article_story entries...');
  const { error: junctionErr } = await supabase
    .from('article_story')
    .delete()
    .in('article_id', articleIds);

  if (junctionErr) {
    console.error('Junction delete error:', junctionErr);
    process.exit(1);
  }
  console.log('Deleted junction entries');

  // Step 3: Delete the stories themselves
  console.log('\nStep 3: Deleting stories...');
  const { error: storyErr } = await supabase
    .from('stories')
    .delete()
    .in('id', storyIds);

  if (storyErr) {
    console.error('Story delete error:', storyErr);
    process.exit(1);
  }
  console.log('Deleted stories');

  // Step 4: Recluster articles
  console.log('\nStep 4: Reclustering articles (watch for SHADOW_POLICY_DIFF)...\n');

  let success = 0, failed = 0;

  for (const articleId of articleIds) {
    try {
      await clusterArticle(articleId);
      success++;
      if (success % 10 === 0) {
        console.log(`Progress: ${success}/${articleIds.length}`);
      }
    } catch (e) {
      console.error('Failed:', articleId, e.message);
      failed++;
    }
  }

  console.log('\n=== COMPLETE ===');
  console.log('Success:', success);
  console.log('Failed:', failed);
  console.log('\nCheck output above for SHADOW_POLICY_DIFF entries');
  console.log('Backup saved to logs/stories_backup_v2.json if restore needed');
}

run().catch(console.error);
