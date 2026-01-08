import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function analyzeRecentMerges() {
  // Get last 50 article-story links
  const { data: links, error } = await supabase
    .from('article_story')
    .select('article_id, story_id, similarity_score, is_primary_source, matched_at')
    .order('matched_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Error fetching links:', error);
    return;
  }

  console.log('Found ' + links.length + ' recent article-story links\n');

  // Get article details
  const articleIds = links.map(l => l.article_id);
  const { data: articles } = await supabase
    .from('articles')
    .select('id, title, published_at')
    .in('id', articleIds);

  const articleMap = new Map((articles || []).map(a => [a.id, a]));

  // Get story details
  const storyIds = [...new Set(links.map(l => l.story_id))];
  const { data: stories } = await supabase
    .from('stories')
    .select('id, primary_headline, article_count')
    .in('id', storyIds);

  const storyMap = new Map((stories || []).map(s => [s.id, s]));

  // Group by story
  const storyGroups = new Map();
  for (const link of links) {
    if (!storyGroups.has(link.story_id)) {
      storyGroups.set(link.story_id, []);
    }
    const article = articleMap.get(link.article_id);
    storyGroups.get(link.story_id).push({
      articleId: link.article_id,
      title: article ? article.title : 'Unknown',
      score: link.similarity_score,
      isPrimary: link.is_primary_source
    });
  }

  console.log('=== RECENT CLUSTERING ANALYSIS (Last 50 article links) ===\n');

  // Multi-article stories
  console.log('--- STORIES WITH MULTIPLE RECENT ARTICLES (Good Merges) ---\n');
  let mergeCount = 0;
  for (const [storyId, arts] of storyGroups) {
    if (arts.length > 1) {
      mergeCount++;
      const story = storyMap.get(storyId);
      console.log('Story ' + storyId + ' (' + (story ? story.article_count : '?') + ' total): "' + (story ? story.primary_headline.substring(0, 55) : 'N/A') + '..."');
      for (const art of arts) {
        const scoreStr = art.score ? art.score.toFixed(3) : 'N/A';
        const primaryStr = art.isPrimary ? ' (PRIMARY)' : '';
        console.log('  [' + scoreStr + ']' + primaryStr + ' ' + (art.title ? art.title.substring(0, 55) : 'N/A'));
      }
      console.log('');
    }
  }

  // Single-article stories
  console.log('\n--- SINGLE-ARTICLE STORIES (Check for Fragmentation) ---\n');
  const singles = [];
  for (const [storyId, arts] of storyGroups) {
    if (arts.length === 1) {
      const story = storyMap.get(storyId);
      singles.push({
        storyId,
        headline: story ? story.primary_headline : 'N/A',
        articleTitle: arts[0].title,
        totalArticles: story ? story.article_count : 0,
        score: arts[0].score
      });
    }
  }

  // Sort by total articles to find true single-article stories
  singles.sort((a, b) => a.totalArticles - b.totalArticles);

  for (const s of singles.slice(0, 20)) {
    console.log('Story ' + s.storyId + ' (' + s.totalArticles + ' total): "' + (s.headline ? s.headline.substring(0, 50) : 'N/A') + '..."');
    console.log('  [' + (s.score ? s.score.toFixed(3) : 'N/A') + '] "' + (s.articleTitle ? s.articleTitle.substring(0, 50) : 'N/A') + '..."\n');
  }

  console.log('\n--- SUMMARY ---');
  console.log('Stories with multiple recent articles: ' + mergeCount);
  console.log('Stories with single recent article: ' + singles.length);
  console.log('Total unique stories touched: ' + storyGroups.size);
  console.log('Recent merge rate: ' + (mergeCount / storyGroups.size * 100).toFixed(1) + '%');

  // Check for potential missed merges by looking at story headlines
  console.log('\n\n--- POTENTIAL FRAGMENTATION CHECK ---');
  console.log('Looking for similar headlines among single-article stories...\n');

  const headlineWords = new Map();
  for (const s of singles) {
    if (!s.headline) continue;
    // Extract key words
    const words = s.headline.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 4 && !['trump', 'about', 'after', 'their', 'would', 'could', 'being', 'which', 'there', 'where', 'these', 'those'].includes(w));

    for (const word of words) {
      if (!headlineWords.has(word)) {
        headlineWords.set(word, []);
      }
      headlineWords.get(word).push(s);
    }
  }

  // Find words appearing in multiple stories
  const duplicateWords = [];
  for (const [word, stories] of headlineWords) {
    if (stories.length >= 2) {
      duplicateWords.push({ word, stories });
    }
  }
  duplicateWords.sort((a, b) => b.stories.length - a.stories.length);

  for (const { word, stories: relatedStories } of duplicateWords.slice(0, 5)) {
    console.log('Keyword "' + word + '" appears in ' + relatedStories.length + ' stories:');
    for (const s of relatedStories) {
      console.log('  - Story ' + s.storyId + ': "' + s.headline.substring(0, 50) + '..."');
    }
    console.log('');
  }
}

analyzeRecentMerges();
