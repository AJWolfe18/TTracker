import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://wnrjrywpcadwutfykflu.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function analyze() {
  // Get stories created in the last 24 hours
  const { data: stories, error } = await supabase
    .from('stories')
    .select('id, primary_headline, source_count, first_seen_at, topic_slugs, primary_source')
    .gte('first_seen_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('first_seen_at', { ascending: false });

  if (error) { console.error(error); return; }

  console.log('=== STORIES CREATED IN LAST 24 HOURS ===');
  console.log('Total:', stories.length);
  console.log('');

  // Group by topic_slugs to find potential duplicates
  const bySlug = {};
  for (const s of stories) {
    const slugs = s.topic_slugs || [];
    for (const slug of slugs) {
      if (!bySlug[slug]) bySlug[slug] = [];
      bySlug[slug].push(s);
    }
  }

  // Find slugs with multiple stories (potential duplicates)
  console.log('=== POTENTIAL DUPLICATES (same topic_slug) ===');
  let hasDupes = false;
  for (const [slug, group] of Object.entries(bySlug)) {
    if (group.length > 1) {
      hasDupes = true;
      console.log('\nSlug:', slug, '- Stories:', group.length);
      for (const s of group) {
        console.log('  ID:', s.id, '|', s.primary_headline.substring(0, 60));
      }
    }
  }
  if (!hasDupes) console.log('None found!\n');

  console.log('\n=== ALL RECENT STORIES (by headline similarity groups) ===');

  // Simple grouping by first significant words
  const groups = {};
  for (const s of stories) {
    // Extract key words from headline
    const words = s.primary_headline.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'will', 'about', 'after', 'been', 'into', 'over', 'says', 'said', 'could', 'would', 'trump', 'trumps'].includes(w))
      .slice(0, 3)
      .join(' ');

    if (!groups[words]) groups[words] = [];
    groups[words].push(s);
  }

  // Sort groups by size (largest first) and show potential issues
  const sortedGroups = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);

  console.log('\n--- Stories grouped by key headline words ---');
  for (const [key, group] of sortedGroups.slice(0, 20)) {
    if (group.length > 1) {
      console.log(`\n[${group.length} stories] "${key}":`);
      for (const s of group) {
        console.log(`  ${s.id}: ${s.primary_headline.substring(0, 65)}... (${s.source_count} sources)`);
      }
    }
  }

  console.log('\n--- Single-article stories ---');
  let singles = 0;
  for (const [key, group] of sortedGroups) {
    if (group.length === 1) {
      singles++;
      const s = group[0];
      if (singles <= 15) {
        console.log(`  ${s.id}: ${s.primary_headline.substring(0, 65)}...`);
      }
    }
  }
  console.log(`  ... and ${Math.max(0, singles - 15)} more single-article stories`);
}

analyze();

// Additional analysis: Look at specific duplicate cases
async function analyzeEpsteinDupes() {
  console.log('\n\n=== EPSTEIN DUPLICATE DEEP DIVE ===\n');

  // Get all Epstein stories
  const { data: stories, error } = await supabase
    .from('stories')
    .select('id, primary_headline, source_count, first_seen_at, topic_slugs, entity_counter, top_entities')
    .or('topic_slugs.cs.{EPSTEIN-FILES-RELEASE},topic_slugs.cs.{EPSTEIN-FILES-RELEASED}')
    .order('first_seen_at', { ascending: true });

  if (error) { console.error(error); return; }

  console.log('Epstein-related stories:', stories.length);
  console.log('');

  for (const s of stories) {
    const entityCount = s.entity_counter ? Object.keys(s.entity_counter).length : 0;
    console.log(`Story ${s.id}:`);
    console.log(`  Headline: ${s.primary_headline.substring(0, 60)}...`);
    console.log(`  Created: ${s.first_seen_at}`);
    console.log(`  Sources: ${s.source_count}`);
    console.log(`  Slugs: ${(s.topic_slugs || []).join(', ')}`);
    console.log(`  Entities: ${entityCount} (${(s.top_entities || []).slice(0, 3).join(', ')})`);
    console.log('');
  }
}

analyzeEpsteinDupes();
