/**
 * Embedding model configuration
 *
 * IMPORTANT: Changing this model requires a coordinated migration:
 * 1. Backfill all existing embeddings with new model
 * 2. Update this constant
 * 3. Verify all consumers import from this file
 *
 * Current model: text-embedding-ada-002 (1536 dimensions)
 * Cost: ~$0.0001 per 1K tokens
 */
export const EMBEDDING_MODEL_V1 = 'text-embedding-ada-002';
