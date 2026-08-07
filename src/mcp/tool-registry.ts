import { AppContext } from '../context';
import { EntityType } from '../entities/types';
import { CoreService } from '../services';
import { ProjectConfig } from '../project/types';
import { isIndexDepth, isDocumentType, isSearchStrategy, isGraphRelationshipType, asGraphRelationshipType } from '../utils/type-guards';

/**
 * Tool definition for MCP.
 */
export interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

interface RegisteredTool {
  definition: Tool;
  handler: ToolHandler;
}

/**
 * MCP tool registry. v2 F1.0: trimmed from 12 action-based tools to 5.
 *
 * Surviving tools cover the core "hybrid RAG over a code knowledge graph"
 * surface: `project`, `entity`, `index`, `graph`, `context_query`. The
 * conversational-memory layer (`session` / `message` / `decision` /
 * `checkpoint` / `reflection` / `memory`) and the `hooks` git-integration
 * tool were removed — those domains are owned better by sibling tools
 * (lean-ctx, mem0, Claude Code native memory) or by plain-markdown ADRs.
 */
export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();
  private coreService: CoreService;

  constructor(private context: AppContext) {
    this.coreService = new CoreService(context);
    this.registerAllTools();
  }

  register(definition: Tool, handler: ToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
  }

  getToolDefinitions(): Tool[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool.handler(args);
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  getCoreService(): CoreService {
    return this.coreService;
  }

  private requireParams(args: Record<string, unknown>, required: string[]): void {
    const missing = required.filter(p => args[p] === undefined || args[p] === null);
    if (missing.length > 0) {
      throw new Error(`Missing required parameter(s) for action "${args.action}": ${missing.join(', ')}`);
    }
  }

  private registerAllTools(): void {
    this.registerProjectTool();
    this.registerEntityTool();
    this.registerIndexTool();
    this.registerGraphTool();
    this.registerContextQueryTool();
  }

  // ── 1. project ───────────────────────────────────────────

  private registerProjectTool(): void {
    this.register(
      {
        name: 'project',
        description: 'Manage projects. Actions: create (register a project), list (show all), set_active (set working project), delete (remove a project)',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['create', 'list', 'set_active', 'delete'], description: 'The operation to perform' },
            name: { type: 'string', description: 'Project name (required for: create, set_active, delete)' },
            path: { type: 'string', description: 'Project root path (required for: create)' },
            config: { type: 'object', description: 'Optional configuration (for: create)' },
            keep_data: { type: 'boolean', description: 'Keep data when deleting (for: delete)' },
          },
          required: ['action'],
        },
      },
      async (args) => {
        const a = args as Record<string, any>;
        switch (a.action) {
          case 'create': {
            this.requireParams(a, ['name', 'path']);
            const project = await this.coreService.createProject(a.name, a.path, a.config as Partial<ProjectConfig>);
            return { success: true, project: { id: project.id, name: project.name, path: project.path } };
          }
          case 'list': {
            const projects = await this.coreService.listProjects();
            const active = await this.coreService.getActiveProject();
            return {
              projects: projects.map(p => ({
                name: p.name, path: p.path,
                lastIndexed: p.lastIndexedAt?.toISOString(),
                isActive: p.id === active?.id,
              })),
              activeProject: active?.name,
            };
          }
          case 'set_active': {
            this.requireParams(a, ['name']);
            await this.coreService.setActiveProject(a.name);
            return { success: true, activeProject: a.name };
          }
          case 'delete': {
            this.requireParams(a, ['name']);
            await this.coreService.deleteProject(a.name, a.keep_data);
            return { success: true, deleted: a.name };
          }
          default:
            throw new Error(`Unknown action: ${a.action}. Valid: create, list, set_active, delete`);
        }
      },
    );
  }

  // ── 2. entity ────────────────────────────────────────────

  private registerEntityTool(): void {
    this.register(
      {
        name: 'entity',
        description: 'Manage entities. Actions: add (create entity), get (by ID or qualified name), search (text query), delete',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['add', 'get', 'search', 'delete'], description: 'The operation to perform' },
            type: { type: 'string', description: 'Entity type (for: add, search filter)' },
            name: { type: 'string', description: 'Entity name (for: add)' },
            content: { type: 'string', description: 'Entity content (for: add)' },
            summary: { type: 'string', description: 'Brief summary (for: add)' },
            metadata: { type: 'object', description: 'Additional metadata (for: add)' },
            id: { type: 'string', description: 'Entity ID (for: get, delete)' },
            qualified_name: { type: 'string', description: 'Qualified name (for: get)' },
            query: { type: 'string', description: 'Search query (for: search)' },
            limit: { type: 'number', description: 'Max results (for: search, default: 10)' },
            project: { type: 'string', description: 'Target project (default: active)' },
          },
          required: ['action'],
        },
      },
      async (args) => {
        const a = args as Record<string, any>;
        const projectId = await this.resolveProjectId(a.project);
        switch (a.action) {
          case 'add': {
            this.requireParams(a, ['type', 'name']);
            const entity = await this.coreService.addEntity(projectId, {
              type: a.type as EntityType, name: a.name,
              content: a.content, summary: a.summary, metadata: a.metadata,
            });
            return { success: true, entity: { id: entity.id, type: entity.type, name: entity.name } };
          }
          case 'get': {
            if (!a.id && !a.qualified_name) throw new Error('Either id or qualified_name is required');
            const entity = a.id
              ? await this.coreService.getEntity(projectId, a.id)
              : await this.coreService.getEntityByName(projectId, a.qualified_name);
            if (!entity) return { success: false, error: 'Entity not found' };
            return { success: true, entity };
          }
          case 'search': {
            this.requireParams(a, ['query']);
            const entities = await this.coreService.searchEntities(projectId, a.query, {
              type: a.type as EntityType, limit: a.limit || 10,
            });
            return {
              success: true, count: entities.length,
              entities: entities.map(e => ({ id: e.id, type: e.type, name: e.name, qualifiedName: e.qualifiedName, summary: e.summary })),
            };
          }
          case 'delete': {
            this.requireParams(a, ['id']);
            await this.coreService.deleteEntity(projectId, a.id);
            return { success: true, deleted: a.id };
          }
          default:
            throw new Error(`Unknown action: ${a.action}. Valid: add, get, search, delete`);
        }
      },
    );
  }

  // ── 3. index ─────────────────────────────────────────────

  private registerIndexTool(): void {
    this.register(
      {
        name: 'index',
        description: 'Index code and documents. Actions: codebase (full index), document (single doc), sync (git changes), status (check index state)',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['codebase', 'document', 'sync', 'status'], description: 'The operation to perform' },
            path: { type: 'string', description: 'Path to codebase or document (for: codebase, document)' },
            depth: { type: 'string', description: 'Indexing depth (for: codebase)' },
            ignore: { type: 'array', items: { type: 'string' }, description: 'Patterns to ignore (for: codebase)' },
            languages: { type: 'array', items: { type: 'string' }, description: 'Languages to index (for: codebase)' },
            force: { type: 'boolean', description: 'Force re-index (for: codebase)' },
            type: { type: 'string', description: 'Document type (for: document)' },
            link_to_code: { type: 'boolean', description: 'Link to code entities (for: document, default: true)' },
            since: { type: 'string', description: 'Commit SHA (for: sync)' },
            summarize: { type: 'boolean', description: 'Generate summaries (for: sync)' },
            project: { type: 'string', description: 'Target project (default: active)' },
          },
          required: ['action'],
        },
      },
      async (args) => {
        const a = args as Record<string, any>;
        const projectId = await this.resolveProjectId(a.project);
        switch (a.action) {
          case 'codebase': {
            const proj = await this.coreService.getProject(projectId);
            const indexPath = a.path || proj?.path;
            if (!indexPath) throw new Error('No path specified and project has no path');
            const result = await this.coreService.indexCodebase(projectId, indexPath, {
              depth: a.depth && isIndexDepth(a.depth) ? a.depth : undefined,
              ignore: a.ignore, languages: a.languages, force: a.force,
            });
            return { success: true, ...result };
          }
          case 'document': {
            this.requireParams(a, ['path']);
            const result = await this.coreService.indexDocument(projectId, a.path, {
              type: a.type && isDocumentType(a.type) ? a.type : undefined,
              linkToCode: a.link_to_code ?? true,
            });
            return { success: true, ...result };
          }
          case 'sync': {
            const result = await this.coreService.syncFromGit(projectId, { since: a.since, summarize: a.summarize });
            return { success: true, ...result };
          }
          case 'status': {
            const status = await this.coreService.getIndexStatus(projectId);
            return { success: true, ...status };
          }
          default:
            throw new Error(`Unknown action: ${a.action}. Valid: codebase, document, sync, status`);
        }
      },
    );
  }

  // ── 4. graph ─────────────────────────────────────────────

  private registerGraphTool(): void {
    this.register(
      {
        name: 'graph',
        description: 'Manage entity relationships. Actions: link (create relationship), query (traverse graph), stats (get statistics)',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['link', 'query', 'stats'], description: 'The operation to perform' },
            source: { type: 'string', description: 'Source entity ID or name (for: link)' },
            target: { type: 'string', description: 'Target entity ID or name (for: link)' },
            type: { type: 'string', description: 'Relationship type (for: link)' },
            weight: { type: 'number', description: 'Relationship strength 0-1 (for: link, default: 1.0)' },
            metadata: { type: 'object', description: 'Relationship metadata (for: link)' },
            entity: { type: 'string', description: 'Starting entity ID or name (for: query)' },
            depth: { type: 'number', description: 'Max hops (for: query, default: 2)' },
            relationships: { type: 'array', items: { type: 'string' }, description: 'Filter relationship types (for: query)' },
            direction: { type: 'string', enum: ['in', 'out', 'both'], description: 'Traversal direction (for: query)' },
            project: { type: 'string', description: 'Target project (default: active)' },
          },
          required: ['action'],
        },
      },
      async (args) => {
        const a = args as Record<string, any>;
        const projectId = await this.resolveProjectId(a.project);
        switch (a.action) {
          case 'link': {
            this.requireParams(a, ['source', 'target', 'type']);
            const sourceId = await this.coreService.resolveEntityId(projectId, a.source);
            const targetId = await this.coreService.resolveEntityId(projectId, a.target);
            const result = await this.coreService.addRelationship(projectId, {
              sourceId, targetId, type: asGraphRelationshipType(a.type),
              weight: a.weight ?? 1.0, metadata: a.metadata,
            });
            return { success: true, relationship: result };
          }
          case 'query': {
            this.requireParams(a, ['entity']);
            const entityId = await this.coreService.resolveEntityId(projectId, a.entity);
            const result = await this.coreService.queryGraph(projectId, entityId, {
              depth: a.depth ?? 2,
              relationships: a.relationships?.filter(isGraphRelationshipType),
              direction: a.direction ?? 'both',
            });
            return { success: true, ...result };
          }
          case 'stats': {
            const stats = await this.coreService.getGraphStats(projectId);
            return { success: true, ...stats };
          }
          default:
            throw new Error(`Unknown action: ${a.action}. Valid: link, query, stats`);
        }
      },
    );
  }

  // ── 5. context_query ─────────────────────────────────────

  private registerContextQueryTool(): void {
    this.register(
      {
        name: 'context_query',
        description: 'Query for relevant context using hybrid RAG (vector + graph + keyword). Defaults: expand=true (auto-includes related entities), gate=true (skips trivial queries).',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query' },
            max_tokens: { type: 'number', description: 'Token budget for response (default: 4000)' },
            strategies: { type: 'array', items: { type: 'string', enum: ['keyword', 'semantic', 'graph'] }, description: 'Search strategies to use (default: all)' },
            include_types: { type: 'array', items: { type: 'string' }, description: 'Entity types to include' },
            include_sources: { type: 'boolean', description: 'Include source attribution (default: true)' },
            min_score: { type: 'number', description: 'Minimum relevance score 0-1 (default: 0.3)' },
            expand: { type: 'boolean', description: 'Auto-include parent classes, imports, type definitions' },
            expand_tokens: { type: 'number', description: 'Token budget for expansion (default: 2000)' },
            decompose: { type: 'boolean', description: 'Break complex queries into sub-queries' },
            gate: { type: 'boolean', description: 'Skip retrieval for trivial queries' },
            hyde: { type: 'boolean', description: 'Use HyDE for better semantic search' },
            hyde_model: { type: 'string', description: 'Model for HyDE generation' },
            project: { type: 'string', description: 'Target project (default: active)' },
          },
          required: ['query'],
        },
      },
      async (args) => {
        const a = args as Record<string, any>;
        const projectId = await this.resolveProjectId(a.project);
        const result = await this.coreService.queryContext(projectId, a.query, {
          maxTokens: a.max_tokens ?? 4000,
          strategies: a.strategies?.filter(isSearchStrategy),
          includeTypes: a.include_types,
          includeSources: a.include_sources ?? true,
          minScore: a.min_score,
          expand: a.expand ?? true,
          expandTokens: a.expand_tokens
        });
        return {
          success: true,
          context: result.context, sources: result.sources,
          confidence: result.confidence, tokensUsed: result.tokensUsed,
          truncated: result.truncated,
        };
      },
    );
  }

  // ── Utilities ────────────────────────────────────────────

  private async resolveProjectId(projectName?: string): Promise<string> {
    if (projectName) {
      const project = await this.coreService.getProject(projectName);
      if (!project) throw new Error(`Project not found: ${projectName}`);
      return project.id;
    }
    const active = await this.coreService.getActiveProject();
    if (active) return active.id;
    const cwd = process.cwd();
    const projects = await this.coreService.listProjects();
    const matching = projects.find(p => cwd.startsWith(p.path));
    if (matching) {
      await this.coreService.setActiveProject(matching.id);
      return matching.id;
    }
    throw new Error('No active project. Use project action=create or project action=set_active first.');
  }
}
