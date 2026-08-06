// Main exports for ctx-sys

// Errors
export {
  CtxError,
  ErrorCode,
  OllamaUnavailableError,
  OllamaModelNotFoundError,
  NotFoundError,
  AlreadyExistsError,
  DatabaseError,
  V1DatabaseDetectedError,
  SqliteVecUnavailableError,
  ProviderUnavailableError,
  InvalidInputError,
  FileNotFoundError
} from './errors';

// Configuration
export {
  ConfigManager,
  ConfigManagerOptions,
  DEFAULT_GLOBAL_CONFIG,
  DEFAULT_PROJECT_CONFIG_FILE,
  GlobalConfig,
  ProjectConfigFile,
  ResolvedConfig,
  ProviderSettings,
  ProvidersConfig,
  OllamaProviderConfig,
  OpenAIProviderConfig,
  CLIConfig,
  DefaultsConfig,
  DatabaseConfig,
  ProjectIdentity,
  IndexingConfig,
  SummarizationConfig as ConfigSummarizationConfig,
  EmbeddingsConfig,
  RetrievalConfig as ConfigRetrievalConfig
} from './config';

// Database
export { DatabaseConnection } from './db/connection';
export { MigrationManager } from './db/migrations';

// Project Management
export { ProjectManager, Project, ProjectConfig } from './project';

// Entity Storage
export { EntityStore, Entity, EntityType, EntityCreateInput, EntityUpdateInput, EntitySearchOptions } from './entities';

// Embeddings
export {
  EmbeddingManager,
  EmbeddingProviderFactory,
  LocalEmbeddingProvider,
  OpenAIEmbeddingProvider,
  MockEmbeddingProvider,
  EmbeddingProvider,
  BatchOptions,
  StoredEmbedding,
  SimilarityResult,
  ProviderConfig
} from './embeddings';

// MCP Server
export { CtxSysMcpServer, McpServerConfig, ToolRegistry, Tool } from './mcp';

// AST Parsing
export {
  ASTParser,
  Symbol,
  SymbolType,
  Parameter,
  ImportStatement,
  ImportSpecifier,
  ParseResult,
  ParseError,
  SupportedLanguage,
  LanguageExtractor,
  TypeScriptExtractor,
  PythonExtractor,
  GenericExtractor
} from './ast';

// Summarization
export {
  SymbolSummarizer,
  SymbolSummary,
  ParameterSummary,
  FileSummary,
  FileMetrics,
  SummaryLevel,
  SummarizationOptions,
  LLMSummarizer
} from './summarization';

// Codebase Indexing
export {
  CodebaseIndexer,
  IndexedFile,
  IndexStats,
  IndexResult,
  IndexOptions,
  IndexEntry,
  FileStatus
} from './indexer';

// Relationship Extraction
export {
  RelationshipExtractor,
  Relationship,
  RelationshipType,
  GraphNode,
  GraphStats,
  ExtractionOptions
} from './relationships';

// Git Diff Processing
export {
  GitDiffProcessor,
  DiffResult,
  FileDiff,
  DiffHunk,
  DiffLine,
  DiffOptions,
  ChangeType,
  ChangedSymbol
} from './git';

// v2 F1.0: conversation memory removed.

// Application Context
export { AppContext, getDefaultDbPath } from './context';

// Document Intelligence
export {
  MarkdownParser,
  RequirementExtractor,
  DocumentLinker,
  MarkdownDocument,
  MarkdownSection,
  CodeBlock,
  Link,
  Requirement,
  RequirementInput,
  RequirementSource,
  CodeReference,
  LinkingResult
} from './documents';

// Graph RAG
export {
  RelationshipStore,
  GraphTraversal,
  EntityResolver,
  DuplicateGroup,
  DuplicateDetectionOptions,
  MergeOptions,
  MergeResult,
  SemanticLinker,
  SemanticDiscoveryOptions,
  DiscoveryResult,
  SemanticLink,
  FindRelatedOptions,
  GraphRelationshipType,
  StoredRelationship,
  RelationshipInput,
  RelationshipQueryOptions,
  SubgraphResult,
  PathInfo,
  PathResult,
  GraphStatistics,
  TraversalOptions
} from './graph';

// Advanced Retrieval
export {
  QueryParser,
  QueryIntent,
  EntityMention,
  ParsedQuery,
  QueryParserOptions,
  MultiStrategySearch,
  MultiSearchOptions,
  StrategyWeights,
  ContextAssembler,
  ContextSource,
  ContextFormat,
  AssemblyOptions,
  AssembledContext,
  estimateTokens,
  HyDEQueryExpander,
  HypotheticalProvider,
  HypotheticalOptions,
  HyDEConfig,
  HyDEResult,
  HyDEQueryContext,
  MockHypotheticalProvider,
  DEFAULT_HYDE_CONFIG,
  buildHypotheticalMessages,
  SearchResult,
  SearchStrategy,
  SearchConfig,
  RetrievalGate,
  GateModelProvider,
  GateDecision,
  GateContext,
  GateConfig,
  MockGateModelProvider,
  DEFAULT_GATE_CONFIG
} from './retrieval';

// Model Abstraction
export {
  ProviderFactory,
  ProviderFactoryOptions,
  ModelProviderConfig,
  ProviderHealth,
  MockSummarizationProvider,
  defaultProviderFactory
} from './models';

// File Watching
export {
  FileWatcher,
  WatchConfig,
  WatchEvent,
  WatchEventType,
  WatchStats,
  DEFAULT_WATCH_CONFIG,
  createFileWatcher
} from './watch';

// v2 F1.0: agent-patterns layer (checkpoints / memory / reflection /
// proactive) and the git-hooks layer were removed alongside the
// conversational-memory tools they supported.
