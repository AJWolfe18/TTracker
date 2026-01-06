#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_TEST_URL,
  process.env.SUPABASE_TEST_SERVICE_KEY
);

async function getStoryHeadlines() {
  const storyIds = [15915, 15819, 15916, 15668];

  const { data: stories, error } = await supabase
    .from('stories')
    .select('id, primary_headline')
    .in('id', storyIds)
    .order('id', { ascending: true });

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('Story Headlines:\n');
  stories.forEach(story => {
    console.log(`Story ${story.id}:`);
    console.log(`  ${story.primary_headline}`);
    console.log('');
  });
}

getStoryHeadlines();
