// Query Parsing
export {
  QueryParser,
  QueryIntent,
  EntityMention,
  ParsedQuery,
  QueryParserOptions
} from './query-parser';

// Multi-Strategy Search
export {
  MultiStrategySearch,
  MultiSearchOptions,
  StrategyWeights
} from './multi-strategy-search';

// Context Assembly
export {
  ContextAssembler,
  ContextSource,
  ContextFormat,
  AssemblyOptions,
  AssembledContext,
  estimateTokens
} from './context-assembler';

// HyDE Query Expansion
export {
  HyDEQueryExpander,
  HypotheticalProvider,
  HypotheticalOptions,
  HyDEConfig,
  HyDEResult,
  HyDEQueryContext,
  MockHypotheticalProvider,
  DEFAULT_HYDE_CONFIG,
  buildHypotheticalMessages
} from './hyde-expander';

// Retrieval Gating
export {
  RetrievalGate,
  GateModelProvider,
  GateDecision,
  GateContext,
  GateConfig,
  MockGateModelProvider,
  DEFAULT_GATE_CONFIG
} from './retrieval-gate';

// Context Expansion
export {
  ContextExpander,
  ExpansionOptions
} from './context-expander';

// Query Decomposition
export {
  QueryDecomposer,
  SubQuery,
  DecompositionResult
} from './query-decomposer';

// Score normalization (called at the end of the fusion path).
export { normalizeScores } from './score-normalizer';

// Shared Types
export {
  SearchResult,
  SearchStrategy,
  SearchConfig
} from './types';
