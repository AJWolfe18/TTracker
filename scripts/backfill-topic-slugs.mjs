#!/usr/bin/env node
/**
 * TTRC-306: Backfill topic slugs for existing articles
 * Cost: ~$0.0005/article (~$0.92 for 1,830 articles)
 *
 * Usage:
 *   node scripts/backfill-topic-slugs.mjs [--limit N] [--since YYYY-MM-DD]
 *
 * Options:
 *   --limit N       Process only N articles (for testing)
 *   --since DATE    Only process articles published after DATE
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { extractTopicSlug } from './rss/topic-extraction.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Parse CLI args
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const sinceIdx = args.indexOf('--since');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : null;
const since = sinceIdx >= 0 ? args[sinceIdx + 1] : null;

async function backfillTopicSlugs() {
  console.log('TTRC-306: Backfilling topic slugs...');
  if (limit) console.log(`  --limit ${limit}`);
  if (since) console.log(`  --since ${since}`);

  // Get articles without slugs
  // EGRESS OPTIMIZATION: Only fetch title + excerpt (not content)
  // Slug extraction only uses first 500 chars anyway
  // This reduces egress from ~9MB to ~1MB for 1800 articles
  let query = supabase
    .from('articles')
    .select('id, title, excerpt')
    .is('topic_slug', null)
    .order('published_at', { ascending: false });

  if (since) {
    query = query.gte('published_at', since);
  }
  if (limit) {
    query = query.limit(limit);
  }

  const { data: articles, error } = await query;
  if (error) throw error;

  console.log(`Found ${articles.length} articles without slugs`);

  if (articles.length === 0) {
    console.log('No articles to process.');
    return;
  }

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  const MAX_ERROR_LOG = 25;  // Cap full error logs to keep output sane

  for (const article of articles) {
    try {
      // EGRESS OPTIMIZATION: Only using excerpt (not content)
      // extractTopicSlug uses title + first 500 chars of content anyway
      const excerpt = article.excerpt || '';

      const slug = await extractTopicSlug(
        article.title,
        '',  // No content fetched - egress optimization
        excerpt,
        openai
      );

      if (slug) {
        const { error: updateError } = await supabase
          .from('articles')
          .update({ topic_slug: slug })
          .eq('id', article.id);

        if (updateError) {
          console.error(`Update error for ${article.id}:`, updateError.message);
          failed++;
        } else {
          succeeded++;
        }
      } else {
        failed++;
      }

      processed++;

      if (processed % 50 === 0) {
        console.log(`Progress: ${processed}/${articles.length} (${succeeded} slugs, ${failed} failed)`);
      }

      // Rate limit: ~2 per second
      await new Promise(r => setTimeout(r, 500));

    } catch (err) {
      failed++;
      if (failed <= MAX_ERROR_LOG) {
        console.error(`Error processing ${article.id}:`, err.message);
      } else if (failed === MAX_ERROR_LOG + 1) {
        console.error(`... suppressing further error details (${MAX_ERROR_LOG} logged)`);
      }
    }
  }

  console.log('\nBackfill complete!');
  console.log(`Total: ${processed}, Succeeded: ${succeeded}, Failed: ${failed}`);

  // Estimate cost
  const estimatedCost = succeeded * 0.0005;
  console.log(`Estimated cost: ~$${estimatedCost.toFixed(2)}`);
}

backfillTopicSlugs().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
