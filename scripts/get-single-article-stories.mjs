import fs from 'fs';

const backup = JSON.parse(fs.readFileSync('logs/article_story_backup.json'));

const counts = {};
const articleMap = {};
backup.forEach(r => {
  counts[r.story_id] = (counts[r.story_id] || 0) + 1;
  if (!articleMap[r.story_id]) articleMap[r.story_id] = [];
  articleMap[r.story_id].push(r.article_id);
});

const singleArticleStories = Object.entries(counts)
  .filter(([id, count]) => count === 1)
  .map(([id]) => ({ story_id: Number(id), article_id: articleMap[id][0] }));

fs.writeFileSync('logs/single_article_stories.json', JSON.stringify(singleArticleStories, null, 2));
console.log('Found', singleArticleStories.length, 'single-article stories');
