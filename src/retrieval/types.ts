/**
 * Shared types for the retrieval module.
 */

import { Entity } from '../entities';

/**
 * A search result with relevance score.
 */
export interface SearchResult {
  /** The matched entity */
  entity: Entity;
  /** Relevance score (0-1) */
  score: number;
  /** Which strategy found this result */
  source: SearchStrategy;
  /** Additional match metadata */
  matchInfo?: {
    /** Matched text snippet */
    snippet?: string;
    /** Matched field (name, content, summary) */
    field?: string;
    /** Highlight positions */
    highlights?: Array<{ start: number; end: number }>;
  };
}

/**
 * Search strategy types.
 */
export type SearchStrategy =
  | 'keyword'     // Exact/fuzzy keyword matching
  | 'semantic'    // Embedding-based similarity
  | 'graph'       // Graph traversal
  | 'structural'  // Code structure matching
  | 'hybrid';     // Combined strategies

/**
 * Configuration for search behavior.
 */
export interface SearchConfig {
  /** Maximum results to return */
  limit?: number;
  /** Minimum relevance threshold */
  minScore?: number;
  /** Entity types to include */
  entityTypes?: string[];
  /** Search strategies to use */
  strategies?: SearchStrategy[];
  /** Whether to include graph context */
  includeGraphContext?: boolean;
  /** Maximum depth for graph expansion */
  graphDepth?: number;
}
