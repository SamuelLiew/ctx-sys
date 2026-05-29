/**
 * F10i.1: Core Service — thin delegation facade.
 *
 * All business logic lives in domain services. CoreService delegates
 * to them, preserving the original public API for backwards compatibility.
 *
 * v2 F1.0: Conversation, agent-patterns (checkpoint / memory / reflection),
 * and git-hooks layers removed. Surviving facade covers project / entity /
 * indexing / graph / retrieval only.
 */

import { AppContext } from '../context';
import { ProjectConfig } from '../project/types';
import { EntityType } from '../entities/types';

import { ProjectService } from './project-service';
import { EntityService } from './entity-service';
import { IndexingService } from './indexing-service';
import { GraphService } from './graph-service';
import { RetrievalService } from './retrieval-service';

import {
  CreateEntityInput,
  CreateRelationshipInput,
  IndexOptions,
  GitSyncOptions,
  QueryOptions,
  RelationshipQueryOptions,
  GraphQueryOptions,
  DocumentIndexOptions,
} from './types';

/**
 * Unified service layer for all ctx-sys operations.
 * Delegates to focused domain services.
 */
export class CoreService {
  readonly projects: ProjectService;
  readonly entities: EntityService;
  readonly indexing: IndexingService;
  readonly graph: GraphService;
  readonly retrieval: RetrievalService;

  constructor(private context: AppContext) {
    this.projects = new ProjectService(context);
    this.entities = new EntityService(context);
    this.indexing = new IndexingService(context);
    this.graph = new GraphService(context);
    this.retrieval = new RetrievalService(context);
  }

  // ── Project Management ───────────────────────────────────
  async createProject(name: string, path: string, config?: Partial<ProjectConfig>) { return this.projects.createProject(name, path, config); }
  async getProject(nameOrId: string) { return this.projects.getProject(nameOrId); }
  async listProjects() { return this.projects.listProjects(); }
  async setActiveProject(nameOrId: string) { return this.projects.setActiveProject(nameOrId); }
  async deleteProject(nameOrId: string, keepData?: boolean) {
    const project = await this.projects.getProject(nameOrId);
    await this.projects.deleteProject(nameOrId, keepData);
    if (project) this.clearProjectCache(project.id);
  }
  async getActiveProject() { return this.projects.getActiveProject(); }

  // ── Entity Management ────────────────────────────────────
  async addEntity(projectId: string, input: CreateEntityInput) { return this.entities.addEntity(projectId, input); }
  async getEntity(projectId: string, id: string) { return this.entities.getEntity(projectId, id); }
  async getEntityByName(projectId: string, qualifiedName: string) { return this.entities.getEntityByName(projectId, qualifiedName); }
  async searchEntities(projectId: string, query: string, options?: { type?: EntityType; limit?: number }) { return this.entities.searchEntities(projectId, query, options); }
  async deleteEntity(projectId: string, id: string) { return this.entities.deleteEntity(projectId, id); }
  async resolveEntityId(projectId: string, nameOrId: string) { return this.entities.resolveEntityId(projectId, nameOrId); }

  // ── Codebase Indexing ────────────────────────────────────
  async indexCodebase(projectId: string, path: string, options?: IndexOptions) { return this.indexing.indexCodebase(projectId, path, options); }
  async indexFile(projectId: string, filePath: string) { return this.indexing.indexFile(projectId, filePath); }
  async syncFromGit(projectId: string, options?: GitSyncOptions) { return this.indexing.syncFromGit(projectId, options); }
  async getIndexStatus(projectId: string) { return this.indexing.getIndexStatus(projectId); }
  async indexDocument(projectId: string, filePath: string, options?: DocumentIndexOptions) { return this.indexing.indexDocument(projectId, filePath, options); }

  // ── Graph RAG ────────────────────────────────────────────
  async addRelationship(projectId: string, input: CreateRelationshipInput) { return this.graph.addRelationship(projectId, input); }
  async getRelationships(projectId: string, entityId: string, options?: RelationshipQueryOptions) { return this.graph.getRelationships(projectId, entityId, options); }
  async queryGraph(projectId: string, startEntityId: string, options?: GraphQueryOptions) { return this.graph.queryGraph(projectId, startEntityId, options); }
  async getGraphStats(projectId: string) { return this.graph.getGraphStats(projectId); }

  // ── Context Retrieval ────────────────────────────────────
  async queryContext(projectId: string, query: string, options?: QueryOptions) { return this.retrieval.queryContext(projectId, query, options); }

  // ── Utilities ────────────────────────────────────────────
  clearProjectCache(projectId: string): void {
    this.indexing.clearProjectCache(projectId);
    this.graph.clearProjectCache(projectId);
    this.retrieval.clearProjectCache(projectId);
    this.context.clearProjectCache(projectId);
  }
}
