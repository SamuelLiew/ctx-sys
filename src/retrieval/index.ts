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

// Relevance Feedback
export {
  RelevanceFeedback,
  FeedbackType,
  FeedbackSignal,
  FeedbackStats,
  RecordFeedbackOptions
} from './relevance-feedback';

// HyDE Query Expansion
export {
  HyDEQueryExpander,
  HypotheticalProvider,
  HypotheticalOptions,
  HyDEConfig,
  HyDEResult,
  HyDEQueryContext,
  MockHypotheticalProvider,
  OllamaHypotheticalProvider,
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

// Draft-Critique Loop
export {
  DraftCritique,
  CritiqueModelProvider,
  CritiqueConfig,
  DEFAULT_CRITIQUE_CONFIG,
  ExtractedClaim,
  CritiqueIteration,
  DraftCritiqueOutput,
  CritiqueOptions,
  MockCritiqueModelProvider
} from './draft-critique';

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

// LLM Re-ranking
export {
  LLMReranker,
  RerankerConfig,
  RerankResult
} from './llm-reranker';

// Score normalization (v2 F1.5: replaces the cut heuristic reranker's
// normalization step; called at the end of the fusion path).
export { normalizeScores } from './score-normalizer';

// Shared Types
export {
  SearchResult,
  SearchStrategy,
  SearchConfig,
  RelevanceFeedbackInput,
  StoredFeedback,
  CritiqueResult,
  CritiqueIssue
} from './types';
