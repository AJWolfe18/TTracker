#!/usr/bin/env node
/**
 * Export story clusters for golden set validation
 *
 * Generates a CSV with story clusters for manual review.
 * Focus on multi-article stories to validate clustering quality.
 *
 * Output columns:
 * - story_id: Database ID
 * - headline: Primary story headline
 * - article_count: Number of articles in cluster
 * - source_count: Number of unique sources
 * - top_entities: Key entities (comma-separated)
 * - avg_similarity: Average similarity score of matched articles
 * - article_titles: Article titles (semicolon-separated)
 * - article_sources: Article sources (semicolon-separated)
 * - correct: Empty - fill with: yes, split, merge
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function exportGoldenSet() {
  console.log('Fetching story clusters...');

  // Get all article-story links with similarity scores
  const { data: links, error: linkErr } = await supabase
    .from('article_story')
    .select('article_id, story_id, similarity_score');

  if (linkErr) {
    console.error('Failed to fetch links:', linkErr);
    return;
  }

  // Group by story
  const storyGroups = {};
  for (const link of links) {
    if (!storyGroups[link.story_id]) {
      storyGroups[link.story_id] = { articles: [], scores: [] };
    }
    storyGroups[link.story_id].articles.push(link.article_id);
    if (link.similarity_score) {
      storyGroups[link.story_id].scores.push(link.similarity_score);
    }
  }

  // Get stories with 2+ articles (multi-article clusters to review)
  const multiArticleStoryIds = Object.keys(storyGroups)
    .filter(id => storyGroups[id].articles.length >= 2)
    .map(id => parseInt(id));

  console.log(`Found ${multiArticleStoryIds.length} multi-article stories to export`);

  // Fetch story details
  const { data: stories, error: storyErr } = await supabase
    .from('stories')
    .select('id, primary_headline, top_entities')
    .in('id', multiArticleStoryIds);

  if (storyErr) {
    console.error('Failed to fetch stories:', storyErr);
    return;
  }

  // Fetch all articles
  const allArticleIds = multiArticleStoryIds.flatMap(id => storyGroups[id].articles);
  const { data: articles, error: artErr } = await supabase
    .from('articles')
    .select('id, title, source_name')
    .in('id', allArticleIds);

  if (artErr) {
    console.error('Failed to fetch articles:', artErr);
    return;
  }

  const articleMap = new Map(articles.map(a => [a.id, a]));
  const storyMap = new Map(stories.map(s => [s.id, s]));

  // Build CSV rows
  const rows = [];

  // Sort by article count descending (biggest clusters first)
  const sortedStoryIds = multiArticleStoryIds.sort(
    (a, b) => storyGroups[b].articles.length - storyGroups[a].articles.length
  );

  for (const storyId of sortedStoryIds) {
    const story = storyMap.get(storyId);
    if (!story) continue;

    const group = storyGroups[storyId];
    const storyArticles = group.articles
      .map(id => articleMap.get(id))
      .filter(Boolean);

    const sources = [...new Set(storyArticles.map(a => a.source_name))];
    const avgScore = group.scores.length > 0
      ? (group.scores.reduce((a, b) => a + b, 0) / group.scores.length).toFixed(3)
      : 'N/A';

    // Escape and format for CSV
    const escapeCsv = (str) => {
      if (!str) return '';
      const s = String(str).replace(/"/g, '""');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
    };

    const row = {
      story_id: storyId,
      headline: escapeCsv(story.primary_headline),
      article_count: storyArticles.length,
      source_count: sources.length,
      top_entities: escapeCsv((story.top_entities || []).join(', ')),
      avg_similarity: avgScore,
      article_titles: escapeCsv(storyArticles.map(a => a.title).join('; ')),
      article_sources: escapeCsv(sources.join('; ')),
      correct: ''
    };

    rows.push(row);
  }

  // Write CSV
  const header = 'story_id,headline,article_count,source_count,top_entities,avg_similarity,article_titles,article_sources,correct';
  const csvLines = [header];

  for (const row of rows) {
    csvLines.push([
      row.story_id,
      row.headline,
      row.article_count,
      row.source_count,
      row.top_entities,
      row.avg_similarity,
      row.article_titles,
      row.article_sources,
      row.correct
    ].join(','));
  }

  const filename = `clustering-golden-set-${new Date().toISOString().split('T')[0]}.csv`;
  const filepath = `./exports/${filename}`;

  // Ensure exports directory exists
  try {
    await import('fs').then(fs => fs.mkdirSync('./exports', { recursive: true }));
  } catch (e) {}

  writeFileSync(filepath, csvLines.join('\n'));

  console.log('');
  console.log('='.repeat(60));
  console.log('EXPORT COMPLETE');
  console.log('='.repeat(60));
  console.log('');
  console.log('File:', filepath);
  console.log('Stories exported:', rows.length);
  console.log('');
  console.log('Review instructions:');
  console.log('  - Fill "correct" column with:');
  console.log('    yes   = All articles belong together');
  console.log('    split = Some articles should be separate stories');
  console.log('    merge = Should be combined with another story');
  console.log('');
  console.log('Focus on largest clusters first (top of file)');
}

exportGoldenSet().catch(console.error);
