export { MarkdownParser } from './markdown-parser';
export { RequirementExtractor } from './requirement-extractor';
export { DocumentLinker } from './document-linker';
export { DocumentIndexer } from './document-indexer';
export { chunkSections, ChunkingOptions } from './document-chunker';
export type { DocumentIndexOptions, DocumentIndexResult, DirectoryIndexOptions, DirectoryIndexResult } from './document-indexer';
export {
  MarkdownDocument,
  MarkdownSection,
  CodeBlock,
  Link,
  Requirement,
  RequirementInput,
  RequirementSource,
  CodeReference,
  LinkingResult
} from './types';

// v2 F2.3: pluggable PDF extractor (Tier 1 wired; Tier 2 + Tier 3 are
// follow-up commits that add new implementations behind the interface).
export {
  PdfExtractor,
  ExtractedPdf,
  ExtractOptions,
  ProviderHealth,
  PdfParseExtractor,
  resolveExtractor,
  extractWithCache,
} from './pdf-extractor';
