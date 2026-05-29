/**
 * Types for the Core Service Layer.
 */

import { EntityType } from '../entities/types';
import { GraphRelationshipType } from '../graph/types';
import { SearchStrategy } from '../retrieval/types';

// ─────────────────────────────────────────────────────────
// INPUT TYPES
// ─────────────────────────────────────────────────────────

export interface CreateEntityInput {
  type: EntityType;
  name: string;
  qualifiedName?: string;
  content?: string;
  summary?: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateRelationshipInput {
  sourceId: string;
  targetId: string;
  type: GraphRelationshipType;
  weight?: number;
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────
// INDEXING
// ─────────────────────────────────────────────────────────

export interface IndexOptions {
  depth?: 'full' | 'signatures' | 'selective';
  ignore?: string[];
  languages?: string[];
  summarize?: boolean;
  force?: boolean;
  /** Generate embeddings for indexed entities (default: true, requires Ollama) */
  generateEmbeddings?: boolean;
}

export interface IndexResult {
  filesProcessed: number;
  entitiesCreated: number;
  entitiesUpdated: number;
  relationshipsCreated: number;
  errors: Array<{ path: string; error: string }>;
  durationMs: number;
  /** Number of embeddings generated (if generateEmbeddings was true) */
  embeddingsGenerated?: number;
}

export interface GitSyncOptions {
  since?: string;
  branch?: string;
  summarize?: boolean;
}

export interface SyncResult {
  filesChanged: number;
  entitiesUpdated: number;
  entitiesCreated: number;
  entitiesDeleted: number;
}

export interface IndexStatus {
  lastIndexed: Date | null;
  filesIndexed: number;
  entitiesCount: number;
  isStale: boolean;
}

// ─────────────────────────────────────────────────────────
// RETRIEVAL
// ─────────────────────────────────────────────────────────

export interface QueryOptions {
  maxTokens?: number;
  includeTypes?: string[];
  includeSources?: boolean;
  strategies?: SearchStrategy[];
  minScore?: number;

  // Opt-in pipeline options (F10e.1)
  expand?: boolean;           // Enable ContextExpander (add parents, imports, types)
  expandTokens?: number;      // Token budget for expansion (default: 2000)
  decompose?: boolean;        // Enable QueryDecomposer (break complex queries)
  gate?: boolean;             // Enable RetrievalGate (skip trivial queries)
  hyde?: boolean;             // Enable HyDE (Hypothetical Document Embeddings)
  hydeModel?: string;         // Model for HyDE generation (default: gemma3:270m after v2 F1.2)
  maxResults?: number;        // Max results to assemble (default: 15)
}

export interface ContextResult {
  context: string;
  sources: ContextSource[];
  confidence: number;
  tokensUsed: number;
  truncated: boolean;
}

export interface ContextSource {
  entityId: string;
  name: string;
  type: string;
  filePath?: string;
  line?: number;
  relevance: number;
}

// ─────────────────────────────────────────────────────────
// GRAPH
// ─────────────────────────────────────────────────────────

export interface RelationshipQueryOptions {
  types?: GraphRelationshipType[];
  minWeight?: number;
  limit?: number;
}

export interface GraphQueryOptions {
  depth?: number;
  relationships?: GraphRelationshipType[];
  direction?: 'in' | 'out' | 'both';
}

export interface GraphQueryResult {
  startEntity: string;
  entities: Array<{
    id: string;
    name: string;
    type: string;
    depth: number;
  }>;
  relationships: Array<{
    id: string;
    source: string;
    target: string;
    type: string;
    weight: number;
  }>;
  totalNodes: number;
  totalEdges: number;
}

export interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  averageDegree: number;
  byType: Record<string, number>;
}

// ─────────────────────────────────────────────────────────
// DOCUMENTS
// ─────────────────────────────────────────────────────────

export interface DocumentIndexOptions {
  type?: 'markdown' | 'text' | 'requirements';
  extractRequirements?: boolean;
  linkToCode?: boolean;
}

export interface DocumentResult {
  entityId: string;
  sectionsCreated: number;
  requirementsExtracted: number;
  codeLinksCreated: number;
}
