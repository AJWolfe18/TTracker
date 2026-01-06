import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Simulated thresholds
const CURRENT = { tierA: 0.90, marginBypassEmbed: 0.905 };
const PROPOSED_TIERB = { tierB: 0.88 }; // Expand Tier B, keep Tier A

async function checkWouldHaveMerged() {
  console.log('=== WOULD-HAVE-MERGED ANALYSIS ===\n');

  // Get recent single-article stories (fragmentation candidates)
  const { data: recentStories } = await supabase
    .from('stories')
    .select('id, primary_headline, top_entities, topic_slugs, first_seen_at')
    .order('first_seen_at', { ascending: false })
    .limit(30);

  // Check each against similar stories
  for (const story of recentStories.slice(0, 15)) {
    // Get embedding
    const { data: storyData } = await supabase
      .from('stories')
      .select('centroid_embedding_v1')
      .eq('id', story.id)
      .single();

    if (!storyData || !storyData.centroid_embedding_v1) continue;

    // Find similar stories
    const { data: similar } = await supabase.rpc('find_similar_stories', {
      query_embedding: storyData.centroid_embedding_v1,
      match_limit: 5,
      min_similarity: 0.85
    });

    if (!similar || similar.length <= 1) continue;

    // Get the best match that's NOT this story and was created BEFORE this one
    const candidates = similar.filter(s => s.id !== story.id);
    if (candidates.length === 0) continue;

    const best = candidates[0];
    const second = candidates[1];

    // Check if this story was created AFTER the candidate (meaning it could have merged)
    const storyTime = new Date(story.first_seen_at).getTime();
    const candidateTime = new Date(best.first_seen_at).getTime();

    if (storyTime <= candidateTime) continue; // Story was created first, skip

    // Calculate what would have happened
    const embedBest = best.similarity;
    const embedSecond = second ? second.similarity : 0;
    const margin = embedBest - embedSecond;
    const timeDiffHours = (storyTime - candidateTime) / (1000 * 60 * 60);

    // Entity overlap
    const storyEntities = new Set(story.top_entities || []);
    const candidateEntities = new Set(best.top_entities || []);
    const entityOverlap = [...storyEntities].filter(e => candidateEntities.has(e)).length;

    // Entity overlap with normalization (strip prefix)
    const normalizeEntity = (e) => e.replace(/^(US|ORG|LOC|EVT|PERSON)-/, '');
    const storyEntitiesNorm = new Set([...(story.top_entities || [])].map(normalizeEntity));
    const candidateEntitiesNorm = new Set([...(best.top_entities || [])].map(normalizeEntity));
    const entityOverlapNormalized = [...storyEntitiesNorm].filter(e => candidateEntitiesNorm.has(e)).length;

    // Slug overlap
    const storySlugs = new Set(story.topic_slugs || []);
    const candidateSlugs = new Set(best.topic_slugs || []);
    const slugOverlap = [...storySlugs].filter(s => candidateSlugs.has(s)).length > 0;

    // Title token overlap (simple)
    const storyWords = new Set((story.primary_headline || '').toLowerCase().split(/\s+/).filter(w => w.length > 4));
    const candidateWords = new Set((best.primary_headline || '').toLowerCase().split(/\s+/).filter(w => w.length > 4));
    const titleOverlap = [...storyWords].filter(w => candidateWords.has(w)).length;

    // Decisions
    const marginOk = margin >= 0.04;
    const passesTierA = embedBest >= 0.90 && timeDiffHours <= 48 && marginOk;
    const passesTierAWithMarginBypass = embedBest >= 0.90 && timeDiffHours <= 48 && !marginOk && (
      entityOverlap >= 1 ||
      slugOverlap ||
      (titleOverlap >= 1 && embedBest >= 0.905)
    );
    const passesTierAWithNormalizedEntities = embedBest >= 0.90 && timeDiffHours <= 48 && !marginOk && (
      entityOverlapNormalized >= 1 ||
      slugOverlap ||
      (titleOverlap >= 1 && embedBest >= 0.905)
    );
    const passesTierBProposed = embedBest >= 0.88 && timeDiffHours <= 48 && (
      entityOverlap >= 1 || slugOverlap || titleOverlap >= 1
    );
    const passesTierBWithNormalized = embedBest >= 0.88 && timeDiffHours <= 48 && (
      entityOverlapNormalized >= 1 || slugOverlap || titleOverlap >= 1
    );

    const wouldMergeCurrent = passesTierA || passesTierAWithMarginBypass;
    const wouldMergeWithNormalization = passesTierA || passesTierAWithNormalizedEntities;
    const wouldMergeProposed = passesTierA || passesTierAWithMarginBypass || passesTierBProposed;
    const wouldMergeProposedWithNorm = passesTierA || passesTierAWithNormalizedEntities || passesTierBWithNormalized;

    // Only show cases where there's a difference or high similarity
    if (embedBest >= 0.87) {
      console.log('---');
      console.log('Story ' + story.id + ': "' + story.primary_headline.substring(0, 50) + '..."');
      console.log('Best candidate ' + best.id + ': "' + (best.primary_headline || 'N/A').substring(0, 50) + '..."');
      console.log('');
      console.log('  embed=' + embedBest.toFixed(3) + ', margin=' + margin.toFixed(3) + ', time=' + timeDiffHours.toFixed(1) + 'h');
      console.log('  entity_overlap=' + entityOverlap + ' (normalized=' + entityOverlapNormalized + ')');
      console.log('  slug_overlap=' + slugOverlap + ', title_overlap=' + titleOverlap);
      console.log('  Story entities: ' + JSON.stringify(story.top_entities));
      console.log('  Candidate entities: ' + JSON.stringify(best.top_entities));
      console.log('');
      console.log('  CURRENT system: ' + (wouldMergeCurrent ? 'MERGE' : 'CREATE NEW'));
      console.log('  With entity normalization: ' + (wouldMergeWithNormalization ? 'MERGE' : 'CREATE NEW'));
      console.log('  Proposed Tier B (0.88): ' + (wouldMergeProposed ? 'MERGE' : 'CREATE NEW'));
      console.log('  Proposed + normalization: ' + (wouldMergeProposedWithNorm ? 'MERGE' : 'CREATE NEW'));
      console.log('');

      if (!wouldMergeCurrent && wouldMergeProposedWithNorm) {
        console.log('  >>> WOULD FIX FRAGMENTATION');
      }
      if (wouldMergeWithNormalization && !wouldMergeCurrent) {
        console.log('  >>> ENTITY NORMALIZATION ALONE FIXES THIS');
      }
    }
  }
}

checkWouldHaveMerged();
