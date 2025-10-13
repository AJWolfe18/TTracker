/**
 * Test real-world clustering with 4 Trump/Netanyahu pardon articles
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { clusterArticle } from './rss/hybrid-clustering.js';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const testArticles = [
  {
    url: 'https://www.politico.eu/article/more-than-cigars-and-champagne-donald-trump-benjamin-netanyahu-israel/',
    title: 'More than cigars and champagne: What Trump could gain from a Netanyahu pardon',
    source_name: 'Politico EU',
    source_domain: 'politico.eu'
  },
  {
    url: 'https://www.reuters.com/world/middle-east/trump-urges-israels-president-pardon-netanyahu-2025-10-13/',
    title: 'Trump urges Israel\'s president to pardon Netanyahu',
    source_name: 'Reuters',
    source_domain: 'reuters.com'
  },
  {
    url: 'https://www.foxnews.com/world/trump-calls-netanyahu-pardon-after-hailing-swift-removal-left-wing-lawmakers-security',
    title: 'Trump calls for Netanyahu pardon after hailing \'swift removal\' of left-wing lawmakers\' security',
    source_name: 'Fox News',
    source_domain: 'foxnews.com'
  },
  {
    url: 'https://nypost.com/2025/10/13/us-news/trump-urges-israeli-president-to-pardon-netanyahu/',
    title: 'Trump urges Israeli president to pardon Netanyahu',
    source_name: 'New York Post',
    source_domain: 'nypost.com'
  }
];

async function testRealClustering() {
  console.log('='.repeat(70));
  console.log('TTRC-230 Real-World Clustering Test: Trump/Netanyahu Pardon');
  console.log('='.repeat(70));
  console.log('');
  console.log('Testing if 4 articles about the same event cluster together...');
  console.log('');

  const articleIds = [];
  const storyIds = [];
  const scores = [];

  // Create articles
  for (const article of testArticles) {
    const articleId = `art-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    console.log(`Creating article: ${article.source_name}`);
    console.log(`  Title: ${article.title}`);

    const { error } = await supabase
      .from('articles')
      .insert({
        id: articleId,
        url: article.url,
        url_hash: `test-hash-${Date.now()}-${Math.random()}`,
        title: article.title,
        source_name: article.source_name,
        source_domain: article.source_domain,
        published_at: new Date().toISOString(),
        entities: [
          { id: 'US-TRUMP', name: 'Donald Trump', type: 'PERSON', confidence: 0.95 },
          { id: 'IL-NETANYAHU', name: 'Benjamin Netanyahu', type: 'PERSON', confidence: 0.95 },
          { id: 'IL-PRESIDENT', name: 'Israeli President', type: 'PERSON', confidence: 0.85 },
          { id: 'PARDON', name: 'Pardon', type: 'EVENT', confidence: 0.90 }
        ]
      });

    if (error) {
      console.error(`  ❌ Failed:`, error.message);
      continue;
    }

    console.log(`  ✅ Created: ${articleId}`);
    articleIds.push(articleId);

    // Wait for article to be created
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('');
  console.log('-'.repeat(70));
  console.log('Running clustering...');
  console.log('-'.repeat(70));
  console.log('');

  // Cluster each article
  for (let i = 0; i < articleIds.length; i++) {
    const articleId = articleIds[i];
    const article = testArticles[i];

    console.log(`\n[${i + 1}/${articleIds.length}] Clustering: ${article.source_name}`);

    try {
      const result = await clusterArticle(articleId);

      storyIds.push(result.story_id);
      scores.push(result.score);

      console.log(`  Story ID: ${result.story_id}`);
      console.log(`  Score: ${result.score?.toFixed(3) || 'N/A'}`);
      console.log(`  Status: ${result.status}`);
      console.log(`  Created new: ${result.created_new}`);

    } catch (error) {
      console.error(`  ❌ Error:`, error.message);
    }

    // Small delay between clustering
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Analysis
  console.log('');
  console.log('='.repeat(70));
  console.log('CLUSTERING ANALYSIS');
  console.log('='.repeat(70));
  console.log('');

  const uniqueStories = [...new Set(storyIds)];

  console.log(`Articles processed: ${articleIds.length}`);
  console.log(`Unique stories created: ${uniqueStories.length}`);
  console.log('');

  if (uniqueStories.length === 1) {
    console.log('✅ SUCCESS: All articles clustered to the SAME story!');
    console.log(`   Story ID: ${uniqueStories[0]}`);
    console.log('');
    console.log('Similarity scores:');
    scores.forEach((score, i) => {
      if (i === 0) {
        console.log(`   Article ${i + 1}: 1.000 (first article)`);
      } else {
        console.log(`   Article ${i + 1}: ${score?.toFixed(3) || 'N/A'}`);
      }
    });
  } else {
    console.log(`⚠️  ISSUE: Articles split across ${uniqueStories.length} stories`);
    console.log('');
    console.log('Story distribution:');
    storyIds.forEach((storyId, i) => {
      console.log(`   Article ${i + 1} (${testArticles[i].source_name}): Story ${storyId}`);
    });
    console.log('');
    console.log('This suggests clustering thresholds may need adjustment.');
  }

  // Fetch final story details
  if (uniqueStories.length === 1) {
    const { data: story } = await supabase
      .from('stories')
      .select('id, primary_headline, source_count, lifecycle_state')
      .eq('id', uniqueStories[0])
      .single();

    if (story) {
      console.log('');
      console.log('Final story:');
      console.log(`   ID: ${story.id}`);
      console.log(`   Headline: ${story.primary_headline}`);
      console.log(`   Sources: ${story.source_count}`);
      console.log(`   State: ${story.lifecycle_state}`);
    }
  }
}

testRealClustering().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
