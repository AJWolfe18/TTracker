#!/usr/bin/env node
/**
 * TTRC-302/306: Backfill topic slugs for existing articles
 * Cost: ~$0.0005/article (~$0.60 for ~1,200 articles)
 *
 * Usage:
 *   node scripts/backfill-topic-slugs.mjs [options]
 *
 * Options:
 *   --limit N       Process only N articles (for testing)
 *   --since DATE    Only process articles published after DATE
 *   --force         Re-extract slugs for ALL articles (not just NULL)
 *                   Does NOT null out existing slugs if extraction fails
 *
 * Examples:
 *   node scripts/backfill-topic-slugs.mjs --limit 5 --force  # Test with 5 articles
 *   node scripts/backfill-topic-slugs.mjs --force            # Full re-extraction
 *   node scripts/backfill-topic-slugs.mjs                    # Only fill NULLs
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
const FORCE = args.includes('--force');

async function backfillTopicSlugs() {
  console.log('TTRC-302: Backfilling topic slugs...');
  if (limit) console.log(`  --limit ${limit}`);
  if (since) console.log(`  --since ${since}`);
  if (FORCE) console.log(`  --force (overwriting existing slugs)`);

  // TTRC-302 FIX: Include content field for consistency with RSS pipeline
  // Pipeline uses content || excerpt, backfill must do the same
  let query = supabase
    .from('articles')
    .select('id, title, content, excerpt')
    .order('published_at', { ascending: true });  // Oldest first for consistent ordering

  // Only filter for NULL slugs if NOT forcing
  if (!FORCE) {
    query = query.is('topic_slug', null);
  }

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
      // TTRC-302 FIX: Use content || excerpt for consistency with RSS pipeline
      const content = article.content || '';
      const excerpt = article.excerpt || '';

      const slug = await extractTopicSlug(
        article.title || '',
        content,  // Now properly using content field
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
        // In --force mode, don't null out existing slugs - leave as-is
        // In non-force mode, slug is already null, so no action needed
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
