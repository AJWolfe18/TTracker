import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const stories = JSON.parse(fs.readFileSync('logs/single_article_stories.json'));
const batch = stories.slice(0, 200); // First 200 only

const articleIds = batch.map(s => s.article_id);

console.log('Removing', articleIds.length, 'article_story entries...');

const { error } = await supabase
  .from('article_story')
  .delete()
  .in('article_id', articleIds);

if (error) {
  console.error('Error:', error);
  process.exit(1);
}

console.log('Removed', articleIds.length, 'article_story entries');
fs.writeFileSync('logs/recluster_batch.json', JSON.stringify(articleIds, null, 2));
console.log('Saved batch to logs/recluster_batch.json');
