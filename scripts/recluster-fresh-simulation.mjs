import { createClient } from '@supabase/supabase-js';
import { clusterArticle } from './rss/hybrid-clustering.js';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const BATCH_SIZE = 200;

async function run() {
  // Get single-article stories (use a fresh slice, skip the first 50 we already messed with)
  const singleStories = JSON.parse(fs.readFileSync('logs/single_article_stories.json'));
  const batch = singleStories.slice(100, 100 + BATCH_SIZE); // Skip first 100 (already processed)

  const storyIds = batch.map(s => s.story_id);
  const articleIds = batch.map(s => s.article_id);

  console.log(`\n=== FRESH RSS SIMULATION ===`);
  console.log(`Simulating ${BATCH_SIZE} articles as fresh RSS ingestion\n`);

  // Step 1: Backup stories
  console.log('Step 1: Backing up stories...');
  const { data: storiesBackup, error: backupErr } = await supabase
    .from('stories')
    .select('*')
    .in('id', storyIds);

  if (backupErr) throw backupErr;
  fs.writeFileSync('logs/stories_backup_fresh.json', JSON.stringify(storiesBackup, null, 2));
  console.log(`Backed up ${storiesBackup.length} stories`);

  // Step 2: Backup article slugs
  console.log('\nStep 2: Backing up article slugs...');
  const { data: articlesBackup, error: artErr } = await supabase
    .from('articles')
    .select('id, topic_slug')
    .in('id', articleIds);

  if (artErr) throw artErr;
  fs.writeFileSync('logs/article_slugs_backup.json', JSON.stringify(articlesBackup, null, 2));
  console.log(`Backed up ${articlesBackup.length} article slugs`);

  // Step 3: Delete article_story entries
  console.log('\nStep 3: Deleting article_story entries...');
  const { error: junctionErr } = await supabase
    .from('article_story')
    .delete()
    .in('article_id', articleIds);

  if (junctionErr) throw junctionErr;
  console.log('Deleted junction entries');

  // Step 4: Delete the stories
  console.log('\nStep 4: Deleting stories...');
  const { error: storyErr } = await supabase
    .from('stories')
    .delete()
    .in('id', storyIds);

  if (storyErr) throw storyErr;
  console.log('Deleted stories');

  // Step 5: Clear article slugs (simulate fresh RSS)
  console.log('\nStep 5: Clearing article slugs...');
  const { error: slugErr } = await supabase
    .from('articles')
    .update({ topic_slug: null })
    .in('id', articleIds);

  if (slugErr) throw slugErr;
  console.log('Cleared slugs - articles now simulate fresh RSS');

  // Step 6: Recluster articles
  console.log('\nStep 6: Reclustering (watch for SHADOW_POLICY_DIFF)...\n');
  console.log('-------------------------------------------\n');

  let success = 0, failed = 0, shadowDiffs = 0;

  for (const articleId of articleIds) {
    try {
      await clusterArticle(articleId);
      success++;
      if (success % 10 === 0) {
        console.log(`\nProgress: ${success}/${articleIds.length}\n`);
      }
    } catch (e) {
      console.error('Failed:', articleId, e.message);
      failed++;
    }
  }

  console.log('\n=== COMPLETE ===');
  console.log('Success:', success);
  console.log('Failed:', failed);
  console.log('\nCheck output for SHADOW_POLICY_DIFF / CROSS_RUN_NEAR_MISS entries');
  console.log('Backups saved to logs/stories_backup_fresh.json and logs/article_slugs_backup.json');
}

run().catch(console.error);
