/**
 * v2 F2.3: pluggable PDF extractor.
 *
 * Spec: extract() returns structured markdown that flows into the
 * existing markdown-parser + document-chunker pipeline. Three tiers
 * are planned (pdf-parse → pdfjs → Docling); Tier 1 (pdf-parse) is
 * implemented in this commit. Tier 2 + Tier 3 are additive: add a new
 * file that implements the interface, register it in resolveExtractor.
 *
 * Caching: PDFs are slow to re-extract. extractWithCache() keys on the
 * SHA-256 of the buffer + extractor name, so swapping extractors
 * invalidates correctly and revisions are content-addressed.
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { parsePdf } from './pdf-parser';

export interface ExtractOptions {
  /** Hint for the extractor — e.g. enable OCR on image PDFs (extractor-specific). */
  ocr?: boolean;
}

export interface ExtractedPdf {
  /** Structured markdown for the existing document indexer to consume. */
  markdown: string;
  metadata: {
    title?: string;
    author?: string;
    pageCount: number;
    [key: string]: string | number | undefined;
  };
  warnings?: string[];
}

export interface ProviderHealth {
  status: 'ok' | 'unavailable';
  detail?: string;
}

export interface PdfExtractor {
  /** Short identifier; used by the cache key so swaps invalidate. */
  name: string;
  extract(buffer: Buffer, opts?: ExtractOptions): Promise<ExtractedPdf>;
  healthCheck(): Promise<ProviderHealth>;
}

/**
 * Tier 1 — pdf-parse based extractor. Same coverage as today's
 * pdf-parser.ts; renders each non-empty page as a `## Page N` heading
 * followed by the page's text. Lossy on tables / columns / headings
 * (the original limitation that motivates Tier 2 + Tier 3) but is
 * pure JS, zero-install, and the right default fallback.
 */
export class PdfParseExtractor implements PdfExtractor {
  readonly name = 'pdf-parse';

  async extract(buffer: Buffer): Promise<ExtractedPdf> {
    const doc = await parsePdf(buffer);
    const headerLines: string[] = [];
    if (doc.title) headerLines.push(`# ${doc.title}`);
    else headerLines.push('# Untitled PDF');
    if (doc.author) headerLines.push(`*Author: ${doc.author}*`);
    headerLines.push(`*Pages: ${doc.pageCount}*`);

    const body = doc.pages
      .map(p => [`## Page ${p.pageNumber}`, '', p.text].join('\n'))
      .join('\n\n');

    const warnings: string[] = [];
    if (doc.pages.length === 0) warnings.push('PDF contained no extractable text (possibly image-only — Tier 1 has no OCR).');

    return {
      markdown: [headerLines.join('\n'), '', body].join('\n').trimEnd() + '\n',
      metadata: {
        title: doc.title || undefined,
        author: doc.author || undefined,
        pageCount: doc.pageCount,
        ...doc.metadata,
      },
      warnings: warnings.length ? warnings : undefined,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    // pdf-parse is a JS dep — it's available iff the package was installed.
    return { status: 'ok', detail: 'pure-JS Tier 1 extractor' };
  }
}

/**
 * Resolve the active extractor by name. Today only Tier 1 is wired;
 * adding Tier 2 / Tier 3 is a switch case + a new implementation file.
 */
export function resolveExtractor(name: 'auto' | 'pdf-parse' = 'auto'): PdfExtractor {
  switch (name) {
    case 'pdf-parse':
    case 'auto':
    default:
      return new PdfParseExtractor();
  }
}

/**
 * Extract a PDF buffer, caching the structured markdown in
 * .ctx-sys/pdf-cache/<sha256>.md so re-indexing the same PDF is a
 * no-op. Cache is content-addressed and namespaced by the extractor
 * name, so swapping extractors invalidates cleanly.
 */
export async function extractWithCache(
  buffer: Buffer,
  extractor: PdfExtractor,
  cacheRoot: string,
  opts?: ExtractOptions,
): Promise<ExtractedPdf & { cacheHit: boolean }> {
  const hash = createHash('sha256').update(buffer).digest('hex');
  const cacheDir = path.join(cacheRoot, 'pdf-cache', extractor.name);
  const mdPath = path.join(cacheDir, `${hash}.md`);
  const metaPath = path.join(cacheDir, `${hash}.json`);

  if (fs.existsSync(mdPath) && fs.existsSync(metaPath)) {
    const markdown = fs.readFileSync(mdPath, 'utf-8');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as Omit<ExtractedPdf, 'markdown'>;
    return { markdown, ...meta, cacheHit: true };
  }

  const result = await extractor.extract(buffer, opts);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(mdPath, result.markdown);
  fs.writeFileSync(metaPath, JSON.stringify({ metadata: result.metadata, warnings: result.warnings }));
  return { ...result, cacheHit: false };
}
