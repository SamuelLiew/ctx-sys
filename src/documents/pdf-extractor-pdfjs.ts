/**
 * v2 F2.3 Tier 2 — pdfjs-dist layout-aware extractor.
 *
 * Better than the Tier 1 pdf-parse wrapper on three axes:
 *
 *   1. Heading detection: pdfjs gives per-item font heights; we treat
 *      items at >1.4× the page's median font height as headings and
 *      emit them as '### Heading' rather than dropping them into the
 *      page-text blob.
 *   2. Reading order: pdfjs gives a stable per-page item order from
 *      the document's content stream (left-to-right, top-to-bottom).
 *      Multi-column layouts are still approximate, but the per-page
 *      sequence is much more honest than pdf-parse's flat newline-
 *      separated text dump.
 *   3. Page boundaries are explicit. Same as Tier 1; preserved.
 *
 * Lossy on tables (no native table reconstruction — that's Tier 3
 * Docling's territory). Pure JS/WASM, no system deps.
 *
 * pdfjs-dist 5.x is ESM-only, so we load it via dynamic import() to
 * stay compatible with the CommonJS build (same pattern as
 * src/cli/init-mcp.ts uses for smol-toml).
 */

import type { PdfExtractor, ExtractedPdf, ExtractOptions, ProviderHealth } from './pdf-extractor';

interface TextItem {
  str: string;
  height: number;
  x: number;
  y: number;
}

type PdfjsModule = {
  getDocument(args: { data: Uint8Array; verbosity?: number; useSystemFonts?: boolean }): {
    promise: Promise<{
      numPages: number;
      getMetadata(): Promise<{ info?: Record<string, string> }>;
      getPage(n: number): Promise<{
        getTextContent(): Promise<{ items: Array<{ str: string; transform: number[]; height: number }> }>;
      }>;
      destroy(): Promise<void>;
    }>;
  };
};

let _mod: Promise<PdfjsModule> | null = null;
async function loadPdfjs(): Promise<PdfjsModule> {
  if (!_mod) {
    _mod = (async () => {
      // pdfjs-dist 5.x is ESM-only with no shipped type declarations
      // for the build path. Cast through unknown — runtime contract
      // is captured by the PdfjsModule type above.
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — no .d.ts on the build path
      const m = await import('pdfjs-dist/build/pdf.mjs');
      return m as unknown as PdfjsModule;
    })();
  }
  return _mod;
}

/**
 * Group items into lines (items with similar y coordinate) and decide
 * which lines are headings based on relative font height.
 *
 * Heuristic: compute the median font height across all items on the
 * page; lines whose dominant item height is ≥1.4× the median are
 * treated as headings. Bigger ratios → deeper heading levels.
 */
function pageItemsToMarkdown(items: TextItem[], pageNumber: number): string {
  if (items.length === 0) return `## Page ${pageNumber}\n\n*(no extractable text)*`;

  const heights = items.map(i => i.height).filter(h => h > 0).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] || 10;

  // Group into lines by y coordinate (≤2 unit delta).
  const lines: TextItem[][] = [];
  let current: TextItem[] = [];
  let lastY: number | null = null;
  // Items come out of pdfjs roughly top-to-bottom; bucket close-y items.
  for (const it of items) {
    if (lastY === null || Math.abs(it.y - lastY) <= 2) {
      current.push(it);
    } else {
      if (current.length > 0) lines.push(current);
      current = [it];
    }
    lastY = it.y;
  }
  if (current.length > 0) lines.push(current);

  const out: string[] = [`## Page ${pageNumber}`, ''];
  for (const line of lines) {
    // Sort items on a line left-to-right.
    line.sort((a, b) => a.x - b.x);
    const text = line.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const maxHeight = Math.max(...line.map(i => i.height));
    const ratio = maxHeight / median;
    if (ratio >= 1.8) out.push(`### ${text}`);
    else if (ratio >= 1.4) out.push(`#### ${text}`);
    else out.push(text);
    out.push('');
  }
  return out.join('\n').trimEnd();
}

export class PdfjsExtractor implements PdfExtractor {
  readonly name = 'pdfjs';

  async extract(buffer: Buffer, _opts?: ExtractOptions): Promise<ExtractedPdf> {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      verbosity: 0,
      useSystemFonts: false,
    }).promise;
    try {
      const meta = await doc.getMetadata().catch(() => ({ info: {} as Record<string, string> }));
      const info: Record<string, string> = meta.info ?? {};
      const title = (info.Title || '').toString();
      const author = (info.Author || '').toString();
      const pageCount = doc.numPages;

      const pages: Array<{ pageNumber: number; text: string; markdown: string }> = [];
      const warnings: string[] = [];

      for (let n = 1; n <= pageCount; n++) {
        const page = await doc.getPage(n);
        const tc = await page.getTextContent();
        const items: TextItem[] = tc.items.map(i => {
          // transform = [a, b, c, d, e, f] — translation is (e, f); on
          // most PDFs y grows downward in our coordinate convention.
          const x = i.transform[4] ?? 0;
          const y = i.transform[5] ?? 0;
          return { str: i.str, height: i.height ?? 10, x, y };
        });
        // Sort by y descending (top first), then x ascending — pdfjs's
        // pdf-coordinate origin is bottom-left so 'top of page' is the
        // largest y. Reverse to make our bucketer give top-down lines.
        items.sort((a, b) => b.y - a.y || a.x - b.x);
        const markdown = pageItemsToMarkdown(items, n);
        const plainText = items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
        pages.push({ pageNumber: n, text: plainText, markdown });
      }
      if (pages.every(p => p.text.length === 0)) {
        warnings.push('PDF contained no extractable text (possibly image-only — Tier 2 has no OCR).');
      }

      const header: string[] = [];
      header.push(title ? `# ${title}` : '# Untitled PDF');
      if (author) header.push(`*Author: ${author}*`);
      header.push(`*Pages: ${pageCount}*`);

      const body = pages.map(p => p.markdown).join('\n\n');
      const markdown = [header.join('\n'), '', body].join('\n').trimEnd() + '\n';
      const fullText = pages.map(p => p.text).join('\n\n');

      return {
        markdown,
        pages: pages.map(p => ({ pageNumber: p.pageNumber, text: p.text })),
        fullText,
        metadata: {
          title: title || undefined,
          author: author || undefined,
          pageCount,
        },
        warnings: warnings.length ? warnings : undefined,
      };
    } finally {
      await doc.destroy().catch(() => undefined);
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      await loadPdfjs();
      return { status: 'ok', detail: 'pdfjs-dist layout-aware extractor' };
    } catch (err) {
      return {
        status: 'unavailable',
        detail: `pdfjs-dist failed to load: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
