#!/usr/bin/env node
// Seed RSS feeds in feed_registry for testing
// Used by GitHub workflow to ensure test feeds exist

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function seedFeeds() {
  console.log('🌱 Seeding RSS feeds in feed_registry...\n');
  
  const feeds = [
    {
      feed_url: 'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml',
      feed_name: 'NYT Politics',
      source_name: 'NYT Politics',
      topics: ['politics', 'congress', 'executive'],
      source_tier: 1,
      is_active: true
    },
    {
      feed_url: 'https://feeds.washingtonpost.com/rss/politics',
      feed_name: 'WaPo Politics',
      source_name: 'WaPo Politics',
      topics: ['politics', 'congress', 'executive'],
      source_tier: 1,
      is_active: true
    },
    {
      feed_url: 'https://feeds.reuters.com/Reuters/PoliticsNews',
      feed_name: 'Reuters Politics',
      source_name: 'Reuters Politics',
      topics: ['politics', 'congress', 'executive'],
      source_tier: 1,
      is_active: true
    },
    {
      feed_url: 'https://feeds.apnews.com/rss/apf-usnews',
      feed_name: 'AP News US',
      source_name: 'AP News US',
      topics: ['politics', 'congress', 'executive'],
      source_tier: 1,
      is_active: true
    },
    {
      feed_url: 'https://www.politico.com/rss/politicopicks.xml',
      feed_name: 'Politico Top',
      source_name: 'Politico Top',
      topics: ['politics', 'congress', 'executive'],
      source_tier: 2,
      is_active: true
    }
  ];
  
  let seeded = 0;
  let existing = 0;
  
  for (const feed of feeds) {
    const { error } = await supabase
      .from('feed_registry')
      .upsert(feed, { onConflict: 'feed_url' });
    
    if (!error) {
      console.log(`✅ Seeded: ${feed.feed_name}`);
      seeded++;
    } else {
      console.log(`⚠️ Feed issue for ${feed.feed_name}:`, error.message);
      existing++;
    }
  }
  
  // List all active feeds
  const { data: activeFeeds, error: listError } = await supabase
    .from('feed_registry')
    .select('*')
    .eq('is_active', true);
    
  if (listError) {
    console.error('❌ Failed to list feeds:', listError.message);
    process.exit(1);
  }
  
  console.log(`\n📊 Active feeds in registry: ${activeFeeds?.length || 0}`);
  activeFeeds?.forEach(f => console.log(`   - ${f.feed_name}: ${f.feed_url}`));
  
  if (!activeFeeds || activeFeeds.length === 0) {
    console.error('\n❌ No active feeds found!');
    process.exit(1);
  }
  
  console.log('\n✅ Feed registry ready');
}

seedFeeds().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
