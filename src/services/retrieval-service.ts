/**
 * F10i.1: Context retrieval domain service.
 */

import { AppContext } from '../context';
import { EntityType } from '../entities/types';
import { RelationshipStore } from '../graph';
import {
  MultiStrategySearch, ContextAssembler, SearchResult,
  ContextExpander
} from '../retrieval';
import { GraphTraversal } from '../graph';
import { QueryOptions, ContextResult } from './types';

export class RetrievalService {
  private searchServices = new Map<string, MultiStrategySearch>();
  private relationshipStores = new Map<string, RelationshipStore>();
  private graphTraversals = new Map<string, GraphTraversal>();

  constructor(private context: AppContext) {}

  private getRelationshipStore(projectId: string): RelationshipStore {
    if (!this.relationshipStores.has(projectId)) {
      this.relationshipStores.set(projectId, new RelationshipStore(this.context.db, projectId));
    }
    return this.relationshipStores.get(projectId)!;
  }

  private getGraphTraversal(projectId: string): GraphTraversal {
    if (!this.graphTraversals.has(projectId)) {
      const relationshipStore = this.getRelationshipStore(projectId);
      const entityStore = this.context.getEntityStore(projectId);
      this.graphTraversals.set(projectId, new GraphTraversal(
        this.context.db,
        projectId,
        relationshipStore,
        entityStore
      ));
    }
    return this.graphTraversals.get(projectId)!;
  }

  private async getSearchService(projectId: string): Promise<MultiStrategySearch> {
    if (!this.searchServices.has(projectId)) {
      const entityStore = this.context.getEntityStore(projectId);
      const project = await this.context.projectManager.get(projectId);
      const embeddingManager = await this.context.getEmbeddingManager(projectId, project?.config);
      const graphTraversal = this.getGraphTraversal(projectId);
      this.searchServices.set(projectId, new MultiStrategySearch(
        entityStore,
        embeddingManager,
        graphTraversal,
        undefined,
        // RRF + score normalization is the final ranking.
        this.context.logger
      ));
    }
    return this.searchServices.get(projectId)!;
  }

  async queryContext(projectId: string, query: string, options?: QueryOptions): Promise<ContextResult> {
    const searchService = await this.getSearchService(projectId);

    let queryEmbedding: number[] | undefined;

    const maxResults = options?.maxResults ?? 15;

    const searchOpts = {
      strategies: options?.strategies,
      limit: maxResults,
      entityTypes: options?.includeTypes as EntityType[],
      queryEmbedding
    };

    let results: SearchResult[];
    results = await searchService.search(query, searchOpts);

    if (options?.expand && results.length > 0) {
      const entityStore = this.context.getEntityStore(projectId);
      const relationshipStore = this.getRelationshipStore(projectId);
      const expander = new ContextExpander(entityStore, relationshipStore);
      results = await expander.expand(results, {
        maxExpansionTokens: options?.expandTokens || 2000
      });
    }

    const assembler = new ContextAssembler();
    const assembled = assembler.assemble(results, {
      maxTokens: options?.maxTokens || 4000,
      includeSources: options?.includeSources ?? true,
      format: 'markdown',
      minRelevance: options?.minScore ?? 0.1
    });

    const confidence = this.calculateConfidence(results);

    return {
      context: assembled.context,
      sources: assembled.sources,
      confidence,
      tokensUsed: assembled.tokenCount,
      truncated: assembled.truncated
    };
  }

  private calculateConfidence(results: SearchResult[]): number {
    if (results.length === 0) return 0;

    const sorted = [...results].sort((a, b) => b.score - a.score);
    const k = Math.min(5, sorted.length);
    let weightedSum = 0;
    let totalWeight = 0;

    for (let i = 0; i < k; i++) {
      const weight = Math.pow(0.7, i);
      weightedSum += Math.max(0, sorted[i].score) * weight;
      totalWeight += weight;
    }

    const raw = totalWeight > 0 ? weightedSum / totalWeight : 0;
    return Math.min(1.0, raw);
  }

  clearProjectCache(projectId: string): void {
    this.searchServices.delete(projectId);
    this.relationshipStores.delete(projectId);
    this.graphTraversals.delete(projectId);
  }
}
