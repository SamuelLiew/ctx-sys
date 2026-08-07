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

// Context Expansion
export {
  ContextExpander,
  ExpansionOptions
} from './context-expander';

// Score normalization (called at the end of the fusion path).
export { normalizeScores } from './score-normalizer';

// Shared Types
export {
  SearchResult,
  SearchStrategy,
  SearchConfig
} from './types';
