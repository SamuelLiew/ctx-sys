/**
 * v2 F2.3: pluggable PDF extractor.
 *
 * Verifies the Tier 1 (pdf-parse) extractor produces structured
 * markdown with page headings + title + author metadata, that the
 * resolveExtractor() dispatcher returns Tier 1 for 'auto', and that
 * extractWithCache() actually caches by content hash + extractor name.
 *
 * Uses the same pdf-parse jest.mock pattern as
 * tests/phase-10i/pdf-parser.test.ts.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('pdf-parse', () => {
  class MockPDFParse {
    private options: any;
    constructor(options: any) { this.options = options; }

    async getText() {
      const data = Buffer.from(this.options.data);
      const content = data.toString('utf-8');
      if (content.includes('MULTI_PAGE')) {
        return {
          pages: [
            { num: 1, text: 'Page one content.' },
            { num: 2, text: 'Page two content.' },
          ],
          text: 'Page one content.\nPage two content.',
          total: 2,
        };
      }
      return {
        pages: [{ num: 1, text: 'Hello PDF' }],
        text: 'Hello PDF',
        total: 1,
      };
    }
    async getInfo() {
      const data = Buffer.from(this.options.data);
      const content = data.toString('utf-8');
      if (content.includes('WITH_METADATA')) {
        return { info: { Title: 'F2.3 Test Doc', Author: 'ctx-sys' }, total: 1 };
      }
      return { info: {}, total: 1 };
    }
    async destroy() {}
  }
  return { PDFParse: MockPDFParse };
});

import { resolveExtractor, PdfParseExtractor, extractWithCache } from '../../src/documents/pdf-extractor';

describe('F2.3 pluggable PDF extractor', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-sys-f23-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  describe('resolveExtractor', () => {
    it('returns Tier 2 (pdfjs) for auto and explicit name', () => {
      // v2 F2.3 finalised: 'auto' returns Tier 2 because pdfjs is a
      // clean superset of Tier 1 (heading detection + better reading
      // order) at no install cost (pdfjs-dist is already a dep).
      expect(resolveExtractor().name).toBe('pdfjs');
      expect(resolveExtractor('auto').name).toBe('pdfjs');
    });

    it('returns Tier 1 (pdf-parse) when explicitly asked', () => {
      const extractor = resolveExtractor('pdf-parse');
      expect(extractor).toBeInstanceOf(PdfParseExtractor);
      expect(extractor.name).toBe('pdf-parse');
    });
  });

  describe('PdfParseExtractor.extract', () => {
    it('returns structured markdown with a # title heading + author + page headings', async () => {
      const buffer = Buffer.from('WITH_METADATA MULTI_PAGE');
      const result = await new PdfParseExtractor().extract(buffer);

      expect(result.metadata.pageCount).toBe(2);
      expect(result.metadata.title).toBe('F2.3 Test Doc');
      expect(result.metadata.author).toBe('ctx-sys');
      expect(result.markdown).toContain('# F2.3 Test Doc');
      expect(result.markdown).toContain('*Author: ctx-sys*');
      expect(result.markdown).toContain('## Page 1');
      expect(result.markdown).toContain('Page one content.');
      expect(result.markdown).toContain('## Page 2');
    });

    it('falls back to "Untitled PDF" when no metadata is present', async () => {
      const result = await new PdfParseExtractor().extract(Buffer.from('SINGLE'));
      expect(result.markdown).toContain('# Untitled PDF');
    });

    it('healthCheck returns ok for the pure-JS Tier 1 extractor', async () => {
      const health = await new PdfParseExtractor().healthCheck();
      expect(health.status).toBe('ok');
    });
  });

  describe('extractWithCache', () => {
    it('caches by content hash on first call; reuses on second', async () => {
      const buffer = Buffer.from('SOME_CONTENT');
      const extractor = new PdfParseExtractor();

      const first = await extractWithCache(buffer, extractor, tmp);
      expect(first.cacheHit).toBe(false);

      const cacheDir = path.join(tmp, 'pdf-cache', 'pdf-parse');
      const cached = fs.readdirSync(cacheDir);
      expect(cached.some(f => f.endsWith('.md'))).toBe(true);
      expect(cached.some(f => f.endsWith('.json'))).toBe(true);

      const second = await extractWithCache(buffer, extractor, tmp);
      expect(second.cacheHit).toBe(true);
      expect(second.markdown).toBe(first.markdown);
      expect(second.metadata).toEqual(first.metadata);
      // v2 F2.3 final: cached payload also round-trips pages + fullText
      // so the document-indexer can rebuild per-page Section entities
      // on a cache hit without re-running the extractor.
      expect(second.pages).toEqual(first.pages);
      expect(second.fullText).toBe(first.fullText);
    });

    it('different buffers get different cache entries', async () => {
      const extractor = new PdfParseExtractor();
      await extractWithCache(Buffer.from('A'), extractor, tmp);
      await extractWithCache(Buffer.from('B'), extractor, tmp);

      const cacheDir = path.join(tmp, 'pdf-cache', 'pdf-parse');
      const mdFiles = fs.readdirSync(cacheDir).filter(f => f.endsWith('.md'));
      expect(mdFiles).toHaveLength(2);
    });
  });
});
