#!/usr/bin/env node
/**
 * Export story clusters for review - one article per row
 *
 * Format:
 * story_id | headline | article_count | article_num | article_title | source | correct
 *
 * This makes it easy to mark individual articles as belonging or not belonging
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';
import { mkdirSync } from 'fs';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function exportReview() {
  console.log('Fetching story clusters...');

  // Get all article-story links
  const { data: links } = await supabase
    .from('article_story')
    .select('article_id, story_id, similarity_score');

  // Group by story
  const storyGroups = {};
  for (const link of links) {
    if (!storyGroups[link.story_id]) {
      storyGroups[link.story_id] = [];
    }
    storyGroups[link.story_id].push({
      article_id: link.article_id,
      score: link.similarity_score
    });
  }

  // Get stories with 2+ articles
  const multiArticleStoryIds = Object.keys(storyGroups)
    .filter(id => storyGroups[id].length >= 2)
    .map(id => parseInt(id));

  console.log(`Found ${multiArticleStoryIds.length} multi-article stories`);

  // Fetch story details
  const { data: stories } = await supabase
    .from('stories')
    .select('id, primary_headline, top_entities')
    .in('id', multiArticleStoryIds);

  // Fetch all articles
  const allArticleIds = multiArticleStoryIds.flatMap(id =>
    storyGroups[id].map(a => a.article_id)
  );

  const { data: articles } = await supabase
    .from('articles')
    .select('id, title, source_name, published_at')
    .in('id', allArticleIds);

  const articleMap = new Map(articles.map(a => [a.id, a]));
  const storyMap = new Map(stories.map(s => [s.id, s]));

  // Build rows - one per article
  const rows = [];

  // Sort stories by article count descending
  const sortedStoryIds = multiArticleStoryIds.sort(
    (a, b) => storyGroups[b].length - storyGroups[a].length
  );

  for (const storyId of sortedStoryIds) {
    const story = storyMap.get(storyId);
    if (!story) continue;

    const group = storyGroups[storyId];
    const articleCount = group.length;

    // Sort articles by similarity score descending
    group.sort((a, b) => (b.score || 0) - (a.score || 0));

    for (let i = 0; i < group.length; i++) {
      const articleData = group[i];
      const article = articleMap.get(articleData.article_id);
      if (!article) continue;

      rows.push({
        story_id: storyId,
        headline: story.primary_headline,
        top_entities: (story.top_entities || []).slice(0, 5).join(', '),
        article_count: articleCount,
        article_num: i + 1,
        article_title: article.title,
        source: article.source_name,
        similarity: articleData.score ? articleData.score.toFixed(3) : 'N/A',
        belongs: ''  // User fills: yes or no
      });
    }
  }

  // Escape CSV
  const escapeCsv = (str) => {
    if (!str) return '';
    const s = String(str).replace(/"/g, '""');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
  };

  // Write CSV
  const header = 'story_id,story_headline,top_entities,article_count,article_num,article_title,source,similarity,belongs';
  const csvLines = [header];

  for (const row of rows) {
    csvLines.push([
      row.story_id,
      escapeCsv(row.headline),
      escapeCsv(row.top_entities),
      row.article_count,
      row.article_num,
      escapeCsv(row.article_title),
      escapeCsv(row.source),
      row.similarity,
      row.belongs
    ].join(','));
  }

  try {
    mkdirSync('./exports', { recursive: true });
  } catch (e) {}

  const filename = `clustering-review-${new Date().toISOString().split('T')[0]}.csv`;
  const filepath = `./exports/${filename}`;
  writeFileSync(filepath, csvLines.join('\n'));

  console.log('');
  console.log('='.repeat(60));
  console.log('EXPORT COMPLETE');
  console.log('='.repeat(60));
  console.log('');
  console.log('File:', filepath);
  console.log('Total rows:', rows.length);
  console.log('Stories:', multiArticleStoryIds.length);
  console.log('');
  console.log('HOW TO REVIEW:');
  console.log('  1. Open in Excel/Google Sheets');
  console.log('  2. Filter by story_id to see all articles in a cluster');
  console.log('  3. For each article, fill "belongs" column:');
  console.log('     yes = article belongs in this story');
  console.log('     no  = article does NOT belong (was incorrectly clustered)');
  console.log('');
  console.log('  Focus on stories with 3+ articles first (most impact)');
}

exportReview().catch(console.error);
