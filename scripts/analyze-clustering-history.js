// Analyze Historical Clustering Performance
// Investigates if clustering was ever working well vs. always broken

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log('🔍 HISTORICAL CLUSTERING ANALYSIS\n');
console.log('='.repeat(80));

async function analyzeClusteringHistory() {
  try {
    // Query 1: Multi-article stories over time
    console.log('\n📊 1. MULTI-ARTICLE STORIES OVER TIME:\n');
    const { data: multiArticleStories, error: error1 } = await supabase
      .rpc('exec_sql', {
        sql_query: `
          SELECT
            DATE(s.created_at) as day,
            COUNT(*) as stories_with_2plus_articles
          FROM stories s
          JOIN article_story a_s ON s.id = a_s.story_id
          GROUP BY s.id, DATE(s.created_at)
          HAVING COUNT(a_s.article_id) >= 2
          ORDER BY day DESC
          LIMIT 30
        `
      });

    if (error1) {
      console.log('❌ Error:', error1.message);

      // Try direct query method
      const { data: stories } = await supabase
        .from('stories')
        .select(`
          id,
          created_at,
          article_story!inner(article_id)
        `);

      if (stories) {
        // Group by day and count
        const storiesByDay = {};
        stories.forEach(story => {
          if (story.article_story && story.article_story.length >= 2) {
            const day = story.created_at.split('T')[0];
            storiesByDay[day] = (storiesByDay[day] || 0) + 1;
          }
        });

        console.log('Stories with 2+ articles by day:');
        Object.entries(storiesByDay)
          .sort(([a], [b]) => b.localeCompare(a))
          .slice(0, 30)
          .forEach(([day, count]) => {
            console.log(`   ${day}: ${count} stories`);
          });
      }
    } else {
      console.log('Stories with 2+ articles by day:');
      multiArticleStories.forEach(row => {
        console.log(`   ${row.day}: ${row.stories_with_2plus_articles} stories`);
      });
    }

    // Query 2: Recent successful attachments
    console.log('\n\n📎 2. RECENT SUCCESSFUL ATTACHMENTS (articles joining existing stories):\n');
    const { data: attachments, error: error2 } = await supabase
      .from('article_story')
      .select(`
        matched_at,
        similarity_score,
        is_primary_source,
        article:articles!inner(title),
        story:stories!inner(primary_headline)
      `)
      .eq('is_primary_source', false)
      .order('matched_at', { ascending: false })
      .limit(20);

    if (error2) {
      console.log('❌ Error:', error2.message);
    } else if (attachments.length === 0) {
      console.log('⚠️  No non-primary articles found (no successful attachments)');
    } else {
      console.log('Recent articles that attached to existing stories:');
      attachments.forEach(a => {
        const score = a.similarity_score ? a.similarity_score.toFixed(3) : 'N/A';
        console.log(`   [${a.matched_at}] Score: ${score}`);
        console.log(`      Article: ${a.article?.title?.substring(0, 60)}...`);
        console.log(`      Story: ${a.story?.primary_headline?.substring(0, 60)}...`);
        console.log('');
      });
    }

    // Query 3: Stories with most articles
    console.log('\n\n🏆 3. STORIES WITH MOST ARTICLES (successful clustering examples):\n');
    const { data: topStories, error: error3 } = await supabase
      .from('stories')
      .select(`
        id,
        primary_headline,
        first_seen_at,
        article_story(article_id)
      `);

    if (error3) {
      console.log('❌ Error:', error3.message);
    } else {
      // Count articles per story
      const storiesWithCounts = topStories
        .map(story => ({
          id: story.id,
          headline: story.primary_headline,
          first_seen_at: story.first_seen_at,
          article_count: story.article_story?.length || 0
        }))
        .sort((a, b) => b.article_count - a.article_count)
        .slice(0, 15);

      console.log('Top stories by article count:');
      storiesWithCounts.forEach(story => {
        console.log(`   Story ${story.id}: ${story.article_count} articles`);
        console.log(`      "${story.headline?.substring(0, 70)}..."`);
        console.log(`      First seen: ${story.first_seen_at}`);
        console.log('');
      });
    }

    // Query 4: Check run_stats for historical patterns
    console.log('\n\n📈 4. RUN STATS (historical RSS tracker runs):\n');
    const { data: runStats, error: error4 } = await supabase
      .from('run_stats')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(10);

    if (error4) {
      console.log('❌ Error or table does not exist:', error4.message);
    } else if (runStats.length === 0) {
      console.log('⚠️  No run_stats records found');
    } else {
      console.log('Recent RSS tracker runs:');
      runStats.forEach(run => {
        console.log(`   [${run.started_at}]`);
        console.log(`      Articles: ${run.articles_processed || 0} processed, ${run.articles_created || 0} created`);
        console.log(`      Stories: ${run.stories_created || 0} created, ${run.stories_updated || 0} updated`);
        console.log(`      Duration: ${run.duration_seconds || 'N/A'}s`);
        console.log('');
      });
    }

    // SUMMARY ANALYSIS
    console.log('\n' + '='.repeat(80));
    console.log('📋 SUMMARY ANALYSIS:\n');

    // Calculate overall stats
    const { data: allStories } = await supabase
      .from('stories')
      .select(`
        id,
        first_seen_at,
        article_story(article_id)
      `);

    if (allStories) {
      const totalStories = allStories.length;
      const multiArticleStories = allStories.filter(s => s.article_story?.length >= 2).length;
      const singleArticleStories = allStories.filter(s => s.article_story?.length === 1).length;
      const multiArticleRate = totalStories > 0 ? (multiArticleStories / totalStories * 100).toFixed(1) : 0;

      console.log('Overall Clustering Performance:');
      console.log(`   Total stories: ${totalStories}`);
      console.log(`   Single-article stories: ${singleArticleStories} (${((singleArticleStories/totalStories)*100).toFixed(1)}%)`);
      console.log(`   Multi-article stories: ${multiArticleStories} (${multiArticleRate}%)`);
      console.log('');

      // Find best clustering periods
      const storiesByDay = {};
      allStories.forEach(story => {
        const day = story.first_seen_at.split('T')[0];
        if (!storiesByDay[day]) {
          storiesByDay[day] = { total: 0, multi: 0 };
        }
        storiesByDay[day].total++;
        if (story.article_story?.length >= 2) {
          storiesByDay[day].multi++;
        }
      });

      const bestDays = Object.entries(storiesByDay)
        .map(([day, stats]) => ({
          day,
          ...stats,
          rate: stats.total > 0 ? (stats.multi / stats.total * 100).toFixed(1) : 0
        }))
        .sort((a, b) => b.rate - a.rate)
        .slice(0, 5);

      console.log('Best clustering days:');
      bestDays.forEach(({ day, total, multi, rate }) => {
        console.log(`   ${day}: ${multi}/${total} stories (${rate}% multi-article rate)`);
      });
    }

    // Check for non-primary articles
    const { count: totalArticleStories } = await supabase
      .from('article_story')
      .select('*', { count: 'exact', head: true });

    const { count: primaryArticles } = await supabase
      .from('article_story')
      .select('*', { count: 'exact', head: true })
      .eq('is_primary_source', true);

    const { count: attachedArticles } = await supabase
      .from('article_story')
      .select('*', { count: 'exact', head: true })
      .eq('is_primary_source', false);

    console.log('\n');
    console.log('Article Attachment Stats:');
    console.log(`   Total article-story links: ${totalArticleStories || 0}`);
    console.log(`   Primary sources (created new story): ${primaryArticles || 0}`);
    console.log(`   Attached to existing story: ${attachedArticles || 0}`);
    console.log('');

    if (attachedArticles === 0) {
      console.log('⚠️  FINDING: No articles have ever attached to existing stories!');
      console.log('   This suggests clustering has NEVER successfully matched articles.');
    } else {
      console.log('✅ FINDING: Some articles have successfully attached to stories.');
      console.log('   Clustering has worked at least partially.');
    }

    // Analyze attachment rate over time
    console.log('\n📅 ATTACHMENT RATE OVER TIME:\n');
    const { data: allAttachments } = await supabase
      .from('article_story')
      .select('matched_at, is_primary_source')
      .order('matched_at', { ascending: true });

    if (allAttachments) {
      // Group by week
      const weeklyStats = {};
      allAttachments.forEach(a => {
        const date = new Date(a.matched_at);
        const weekStart = new Date(date.setDate(date.getDate() - date.getDay()));
        const weekKey = weekStart.toISOString().split('T')[0];

        if (!weeklyStats[weekKey]) {
          weeklyStats[weekKey] = { total: 0, attached: 0 };
        }
        weeklyStats[weekKey].total++;
        if (!a.is_primary_source) {
          weeklyStats[weekKey].attached++;
        }
      });

      const weeklyRates = Object.entries(weeklyStats)
        .map(([week, stats]) => ({
          week,
          total: stats.total,
          attached: stats.attached,
          rate: stats.total > 0 ? (stats.attached / stats.total * 100).toFixed(1) : 0
        }))
        .sort((a, b) => b.week.localeCompare(a.week))
        .slice(0, 10);

      console.log('Weekly attachment rates (last 10 weeks):');
      weeklyRates.forEach(({ week, total, attached, rate }) => {
        console.log(`   Week of ${week}: ${attached}/${total} articles (${rate}% attached to existing stories)`);
      });

      // Check if there's a recent degradation
      const lastWeek = weeklyRates[0];
      const avgOlderWeeks = weeklyRates.slice(1).reduce((sum, w) => sum + parseFloat(w.rate), 0) / (weeklyRates.length - 1);

      console.log('\n');
      if (parseFloat(lastWeek.rate) < avgOlderWeeks * 0.5) {
        console.log(`⚠️  ALERT: Recent week attachment rate (${lastWeek.rate}%) is significantly lower than average (${avgOlderWeeks.toFixed(1)}%)`);
        console.log('   This suggests a RECENT REGRESSION in clustering.');
      } else if (parseFloat(lastWeek.rate) > avgOlderWeeks * 1.5) {
        console.log(`✅ IMPROVEMENT: Recent week attachment rate (${lastWeek.rate}%) is higher than average (${avgOlderWeeks.toFixed(1)}%)`);
        console.log('   Clustering appears to be improving.');
      } else {
        console.log(`📊 STABLE: Recent week attachment rate (${lastWeek.rate}%) is consistent with average (${avgOlderWeeks.toFixed(1)}%)`);
        console.log('   Clustering performance is stable (though overall rate is low).');
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('🎯 RECOMMENDATIONS:\n');

    if (attachedArticles === 0) {
      console.log('Clustering appears to be completely broken:');
      console.log('  1. No articles have ever attached to existing stories');
      console.log('  2. Every article creates a new story (1:1 ratio)');
      console.log('  3. Similarity scoring may be too strict or broken');
      console.log('\nNext steps:');
      console.log('  - Review clustering thresholds in hybrid-clustering.js');
      console.log('  - Test similarity scoring with known duplicate articles');
      console.log('  - Check if embeddings are being generated correctly');
    } else {
      console.log('Clustering has worked historically but may have degraded:');
      console.log('  1. Some successful attachments exist in the database');
      console.log('  2. Multi-article rate is low but not zero');
      console.log('  3. May be a recent regression or threshold issue');
      console.log('\nNext steps:');
      console.log('  - Compare recent vs. historical attachment rates');
      console.log('  - Test with recent articles to see if clustering still works');
      console.log('  - Review any recent code changes to clustering logic');
    }

  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    console.error(error);
  }
}

// Run the analysis
analyzeClusteringHistory();
