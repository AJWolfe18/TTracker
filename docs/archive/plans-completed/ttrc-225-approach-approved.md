 Confirmed Approach

     Full rewrite with expert hybrid scoring system, incorporating all PM/arch feedback. Preserves existing categories and primary_actor logic while adding enhanced entity extraction for better clustering.

     Week 1 Starting Tasks (Days 1-4)

     Day 1: Migration 022 - Future-Proof Schema

     - Add versioned embedding columns (embedding_v1, embedding_model_v1)
     - Add entity/content metadata (entities jsonb, keyphrases, quote_hashes, artifact_urls, geo)
     - Create performance-critical indexes (HNSW for embeddings, GIN for entities/keyphrases)
     - Enable pgvector extension
     - Add cost tracking table (openai_usage)

     Day 2: OpenAI Integration Layer

     - Build scripts/lib/openai-client.js with rate limits, cost tracking, idempotency
     - Implement entity extraction (top-5 entities + your existing primary_actor)
     - Implement embedding generation (ada-002)
     - Add exponential backoff retry logic
     - Wire up to cost tracking table

     Day 3: Enhanced Extraction Pipeline

     - Entity extraction: top-5 entities PLUS primary_actor (preserves existing)
     - Quote fingerprinting (12+ word sentences with normalization)
     - URL canonicalization (strip UTM, resolve redirects)
     - Artifact detection (PDFs, FR docs, press releases)
     - Categories unchanged (your 11 existing categories)

     Day 4: Backfill Existing 180 Articles

     - Process OLDEST → NEWEST (builds stable centroids)
     - Batch 25 at a time (rate limit compliance)
     - Pause every 100 for ANN index refresh
     - Freeze merges until Pass 2
     - Cost monitoring (~$1-2 for full backfill)

     Weeks 2-4: Hybrid Scoring, Clustering Engine, Admin UI

     (Full plan documented in previous message)

     What We're Preserving

     ✅ All 11 categories (Corruption & Scandals, Democracy & Elections, etc.)
     ✅ primary_actor field (Trump, Biden, etc.)
     ✅ Category UI mapping
     ✅ Political focus and story grouping logic

     What We're Adding

     ➕ Additional entities (5 per article) for better clustering
     ➕ Embeddings for semantic similarity
     ➕ Quote fingerprinting for presser detection
     ➕ Hybrid scoring with proven weights

     Next Immediate Step

     Start with Migration 022 - create the schema changes with versioned embeddings and proper indexes.